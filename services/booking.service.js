import { Booking, Guest, Room, Hotel, Payment, nextSeq } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { toDay, fmt } from '../utils/dates.js';
import { calcPricing, paymentStatusFor } from '../utils/pricing.js';
import { validateRange, assertRoomAvailable, reserveNights, releaseNights, sellableConfig, listNights } from './availability.service.js';

const populate = 'guest room roomType createdBy';
const getBooking = async (id) => { const b = await Booking.findById(id); if (!b) throw new ApiError(404, 'Booking not found.'); return b; };
const money = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

const recalc = (b) => {
  const p = calcPricing({ roomRate: b.roomRate, nights: b.nights, extraBedCharge: b.extraBedCharge, otherCharges: b.otherCharges, discount: b.discount, taxPercent: b.taxPercent });
  Object.assign(b, p); b.balanceAmount = Math.max(0, p.totalAmount - b.paidAmount);
  if (b.paymentStatus !== 'refunded') b.paymentStatus = paymentStatusFor(b.paidAmount, p.totalAmount);
};

export const upsertGuest = async (g) => {
  if (g._id) {
    const found = await Guest.findById(g._id);
    if (found) {
      const updates = Object.fromEntries(Object.entries(g).filter(([k, v]) => v !== undefined && k !== '_id'));
      Object.assign(found, updates);
      return found.save();
    }
  }
  const existing = await Guest.findOne({ phone: g.phone });
  if (existing) {
    const updates = Object.fromEntries(Object.entries(g).filter(([, v]) => v !== undefined));
    Object.assign(existing, updates);
    return existing.save();
  }
  const seq = await nextSeq('guest');
  return Guest.create({ ...g, guestId: `GST-${String(seq).padStart(5, '0')}` });
};

export const createBooking = async (input, user) => {
  const { checkIn, checkOut, nights } = validateRange(input.checkInDate, input.checkOutDate);
  const room = await assertRoomAvailable(input.room, checkIn, checkOut);
  if (input.adults > room.adultsCapacity + 2 || (input.adults + (input.children || 0)) > room.adultsCapacity + room.childrenCapacity + 1)
    throw new ApiError(400, `Room ${room.roomNumber} cannot host that many guests.`);
  const hotel = await Hotel.findOne();
  const cfg = sellableConfig(room);
  const guest = await upsertGuest(input.guest);
  const year = new Date().getUTCFullYear();
  const bookingNumber = `BK-${year}-${String(await nextSeq(`booking-${year}`)).padStart(6, '0')}`;
  const roomRate = input.roomRate ?? cfg.sellablePrice;
  if (input.roomRate !== undefined && input.roomRate !== cfg.sellablePrice && !input.canEditRate) throw new ApiError(403, "You don't have permission to override the room rate.");
  if (input.discount > 0 && !input.canGiveDiscount) throw new ApiError(403, "You don't have permission to give discounts. Ask an Admin to enable this permission.");

  const b = new Booking({
    bookingNumber, guest: guest._id, room: room._id, roomType: room.roomType, checkInDate: checkIn, checkOutDate: checkOut, adults: input.adults, children: input.children || 0,
    nights, roomRate, extraBedCharge: input.extraBedCharge || 0, otherCharges: input.otherCharges || 0, discount: input.discount || 0,
    taxPercent: input.taxPercent ?? hotel?.booking?.taxPercent ?? 0, bookedAsAC: cfg.sellableIsAC, bookingStatus: input.hold ? 'hold' : 'confirmed',
    source: input.source || 'reception', notes: input.notes, createdBy: user._id, updatedBy: user._id, paidAmount: 0,
    roomHistory: [{ room: room._id, from: checkIn, changedBy: user._id, reason: 'Initial booking' }],
  });
  recalc(b);
  if (b.discount > b.subtotal) throw new ApiError(400, 'Discount cannot exceed the subtotal.');
  await b.save();
  try { await reserveNights(room._id, b._id, checkIn, checkOut); } catch (e) { await Booking.deleteOne({ _id: b._id }); throw e; }

  if (input.payment?.amount > 0) await addPayment(b._id, input.payment, user);
  if (input.checkInNow) await checkIn_(b._id, user);
  return Booking.findById(b._id).populate(populate);
};

export const updateBooking = async (id, patch, user) => {
  const b = await getBooking(id);
  if (['cancelled', 'checked_out'].includes(b.bookingStatus)) throw new ApiError(409, `A ${b.bookingStatus.replace('_', '-')} booking cannot be edited.`);
  for (const k of ['adults', 'children', 'extraBedCharge', 'otherCharges', 'discount', 'notes', 'source']) if (patch[k] !== undefined) b[k] = patch[k];
  if (patch.roomRate !== undefined && patch.roomRate !== b.roomRate) { if (!patch.canEditRate) throw new ApiError(403, "You don't have permission to edit rates."); b.roomRate = patch.roomRate; }
  if (patch.discount !== undefined && patch.discount > 0 && patch.discount !== b.discount && !patch.canGiveDiscount) throw new ApiError(403, "You don't have permission to give or edit discounts. Ask an Admin to enable this permission.");
  if (patch.guest) await Guest.findByIdAndUpdate(b.guest, patch.guest);
  recalc(b);
  if (b.discount > b.subtotal) throw new ApiError(400, 'Discount cannot exceed the subtotal.');
  if (b.paidAmount > b.totalAmount + 0.005) throw new ApiError(409, `Total cannot drop below the ${money(b.paidAmount)} already paid. Issue a refund first.`);
  b.updatedBy = user._id; await b.save();
  return Booking.findById(id).populate(populate);
};

/**
 * Single entry point for drag/drop, resize, extend, shorten, and room transfer.
 * The old nights are released and the new ones claimed; if the claim fails the old reservation is restored.
 */
export const modifyStay = async (id, { room: newRoomId, checkInDate, checkOutDate, reason, newRate }, user) => {
  const b = await getBooking(id);
  if (!['hold', 'confirmed', 'checked_in'].includes(b.bookingStatus)) throw new ApiError(409, 'Only active bookings can be moved or changed.');
  const targetRoom = newRoomId || b.room;
  const inD = checkInDate ? toDay(checkInDate) : b.checkInDate;
  const outD = checkOutDate ? toDay(checkOutDate) : b.checkOutDate;
  if (b.bookingStatus === 'checked_in' && +inD !== +toDay(b.checkInDate)) throw new ApiError(409, 'The check-in date of a checked-in guest cannot be changed.');
  const { nights } = validateRange(inD, outD);
  const roomChanged = String(targetRoom) !== String(b.room);
  if (roomChanged) await assertCompatible(b, targetRoom);
  await assertRoomAvailable(targetRoom, inD, outD, { excludeBookingId: b._id });

  const oldRoom = b.room, oldIn = b.checkInDate, oldOut = b.checkOutDate;
  await releaseNights(b._id);
  try { await reserveNights(targetRoom, b._id, inD, outD); }
  catch (e) { await reserveNights(oldRoom, b._id, oldIn, oldOut); throw e; }

  if (roomChanged) {
    const nr = await Room.findById(targetRoom);
    b.roomHistory.push({ room: targetRoom, from: new Date(), changedBy: user._id, reason: reason || 'Room change' });
    if (b.bookingStatus === 'checked_in') { // physically move the guest
      await Room.findByIdAndUpdate(oldRoom, { occupancyStatus: 'vacant', housekeepingStatus: 'dirty' });
      await Room.findByIdAndUpdate(targetRoom, { occupancyStatus: 'occupied' });
    }
    b.room = targetRoom; b.roomType = nr.roomType; b.bookedAsAC = sellableConfig(nr).sellableIsAC;
    if (newRate !== undefined) b.roomRate = newRate;
  }
  b.checkInDate = inD; b.checkOutDate = outD; b.nights = nights; b.updatedBy = user._id;
  recalc(b); await b.save();
  return { booking: await Booking.findById(id).populate(populate), previousRoom: oldRoom, roomChanged, previousRange: { from: oldIn, to: oldOut } };
};

const assertCompatible = async (b, targetRoomId) => {
  const r = await Room.findById(targetRoomId);
  if (!r) throw new ApiError(404, 'Target room not found.');
  if (r.adultsCapacity < b.adults || r.adultsCapacity + r.childrenCapacity < b.adults + b.children) throw new ApiError(409, `Room ${r.roomNumber} is too small for this party.`);
  if (b.bookingStatus === 'checked_in') {
    if (r.occupancyStatus === 'occupied') throw new ApiError(409, `Room ${r.roomNumber} is currently occupied.`);
    if (!['clean', 'inspected'].includes(r.housekeepingStatus)) throw new ApiError(409, `Room ${r.roomNumber} is not ready (housekeeping: ${r.housekeepingStatus}).`);
  }
};

export const cancelBooking = async (id, reason, user) => {
  const b = await getBooking(id);
  if (b.bookingStatus === 'checked_in') throw new ApiError(409, 'A checked-in booking cannot be cancelled. Check the guest out instead.');
  if (['cancelled', 'checked_out'].includes(b.bookingStatus)) throw new ApiError(409, `Booking is already ${b.bookingStatus.replace('_', '-')}.`);
  b.bookingStatus = 'cancelled'; b.cancelReason = reason; b.updatedBy = user._id; await b.save();
  await releaseNights(b._id); // frees the room immediately
  return Booking.findById(id).populate(populate);
};

export const markNoShow = async (id, user) => {
  const b = await getBooking(id);
  if (b.bookingStatus !== 'confirmed') throw new ApiError(409, 'Only confirmed bookings can be marked no-show.');
  b.bookingStatus = 'no_show'; b.updatedBy = user._id; await b.save(); await releaseNights(b._id);
  return b;
};

// exported as checkIn_ to avoid clashing with the local `checkIn` date variable above
export const checkIn_ = async (id, user, { requireDeposit = false } = {}) => {
  const b = await getBooking(id);
  if (!['confirmed', 'hold'].includes(b.bookingStatus)) throw new ApiError(409, `Cannot check in a ${b.bookingStatus.replace('_', '-')} booking.`);
  if (toDay(b.checkInDate) > toDay(new Date())) throw new ApiError(409, `Arrival is on ${fmt(b.checkInDate)}. Early check-in requires changing the booking dates first.`);
  const room = await Room.findById(b.room);
  if (room.maintenanceStatus !== 'normal') throw new ApiError(409, `Room ${room.roomNumber} is not available (${room.maintenanceStatus.replace('_', ' ')}).`);
  if (room.occupancyStatus === 'occupied') throw new ApiError(409, `Room ${room.roomNumber} is still occupied by the previous guest.`);
  if (!['clean', 'inspected'].includes(room.housekeepingStatus)) throw new ApiError(409, `Room ${room.roomNumber} is ${room.housekeepingStatus} and not ready for check-in.`);
  if (requireDeposit && b.paidAmount <= 0) throw new ApiError(409, 'An advance payment is required before check-in.');
  b.bookingStatus = 'checked_in'; b.actualCheckIn = new Date(); b.updatedBy = user._id; await b.save();
  room.occupancyStatus = 'occupied'; await room.save();
  return Booking.findById(id).populate(populate);
};

export const checkOut = async (id, user, { payment, discount, canGiveDiscount } = {}) => {
  let b = await getBooking(id);
  if (b.bookingStatus !== 'checked_in') throw new ApiError(409, 'Only checked-in guests can be checked out.');
  if (discount !== undefined) {
    if (discount > 0 && discount !== b.discount && !canGiveDiscount) throw new ApiError(403, "You don't have permission to apply discounts at check-out. Ask an Admin to enable this permission.");
    b.discount = Math.max(0, Number(discount) || 0);
    recalc(b);
    if (b.discount > b.subtotal) throw new ApiError(400, 'Discount cannot exceed the subtotal.');
    if (b.paidAmount > b.totalAmount + 0.005) throw new ApiError(409, `Total cannot drop below the ${money(b.paidAmount)} already paid. Issue a refund first.`);
    await b.save();
  }
  if (payment?.amount > 0) { await addPayment(id, payment, user); b = await getBooking(id); }
  if (b.balanceAmount > 0.005) throw new ApiError(409, `${money(b.balanceAmount)} balance pending. Collect payment before check-out.`, { balance: b.balanceAmount });
  b.bookingStatus = 'checked_out'; b.actualCheckOut = new Date(); b.updatedBy = user._id; await b.save();
  // Free FUTURE nights only if the guest leaves early; past nights stay as history.
  const today = toDay(new Date());
  if (today < toDay(b.checkOutDate)) await releaseNights(b._id, { night: { $gte: today } });
  await Room.findByIdAndUpdate(b.room, { occupancyStatus: 'vacant', housekeepingStatus: 'dirty' });
  await Guest.findByIdAndUpdate(b.guest, { $inc: { totalStays: 1, totalSpent: b.paidAmount }, lastVisit: new Date() });
  return Booking.findById(id).populate(populate);
};

export const addPayment = async (bookingId, { amount, method, notes, type = 'payment' }, user) => {
  const b = await getBooking(bookingId);
  if (b.bookingStatus === 'cancelled' && type === 'payment') throw new ApiError(409, 'Cannot take payment on a cancelled booking.');
  if (!(amount > 0)) throw new ApiError(400, 'Amount must be greater than zero.');
  if (type === 'payment' && b.paidAmount + amount > b.totalAmount + 0.005) throw new ApiError(409, `Payment exceeds the balance. Only ${money(b.balanceAmount)} is due.`, { balance: b.balanceAmount });
  if (type === 'refund' && amount > b.paidAmount + 0.005) throw new ApiError(409, `Cannot refund more than the ${money(b.paidAmount)} paid.`);
  const seq = await nextSeq('payment');
  const p = await Payment.create({ paymentId: `PAY-${String(seq).padStart(6, '0')}`, booking: b._id, guest: b.guest, amount, method, notes, type, receivedBy: user._id });
  b.paidAmount = Math.round((b.paidAmount + (type === 'refund' ? -amount : amount)) * 100) / 100;
  b.balanceAmount = Math.max(0, b.totalAmount - b.paidAmount);
  b.paymentStatus = type === 'refund' && b.paidAmount === 0 ? 'refunded' : paymentStatusFor(b.paidAmount, b.totalAmount);
  await b.save();
  return { payment: p, booking: b };
};

export { getBooking, populate as bookingPopulate, listNights };
