import { Booking, Room, RoomNight, Maintenance } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { toDay, nightsBetween, fmt, rangesOverlap } from '../utils/dates.js';

// Only these statuses hold inventory. cancelled / checked_out / no_show never block.
export const BLOCKING_STATUSES = ['hold', 'confirmed', 'checked_in'];

export const validateRange = (checkIn, checkOut) => {
  const a = toDay(checkIn), b = toDay(checkOut);
  if (isNaN(a) || isNaN(b)) throw new ApiError(400, 'Please provide valid check-in and check-out dates.');
  if (b <= a) throw new ApiError(400, 'Check-out date must be after check-in date.');
  return { checkIn: a, checkOut: b, nights: nightsBetween(a, b) };
};

// Half-open overlap query: existing.checkIn < new.checkOut AND existing.checkOut > new.checkIn
export const overlapQuery = (from, to) => ({ checkInDate: { $lt: to }, checkOutDate: { $gt: from } });

export const listNights = (from, to) => {
  const out = []; for (let d = toDay(from); d < toDay(to); d = new Date(d.getTime() + 86400000)) out.push(d); return out;
};

/** Throws a descriptive 409 if the room cannot be sold for [from,to). excludeBookingId lets edits ignore themselves. */
export const assertRoomAvailable = async (roomId, from, to, { excludeBookingId, ignoreHousekeeping = true } = {}) => {
  const { checkIn, checkOut } = validateRange(from, to);
  const room = await Room.findById(roomId);
  if (!room || !room.isActive) throw new ApiError(404, 'Room not found or inactive.');
  if (room.maintenanceStatus === 'out_of_service') throw new ApiError(409, `Room ${room.roomNumber} is out of service and cannot be booked.`);

  const maint = await Maintenance.findOne({ room: roomId, blocksRoom: true, status: { $in: ['open', 'in_progress'] }, blockFrom: { $lt: checkOut }, blockTo: { $gt: checkIn } });
  if (maint) throw new ApiError(409, `Room ${room.roomNumber} is under maintenance from ${fmt(maint.blockFrom)} to ${fmt(maint.blockTo)}.`);
  if (room.maintenanceStatus === 'maintenance' && checkIn <= toDay(new Date())) throw new ApiError(409, `Room ${room.roomNumber} is currently under maintenance.`);

  const q = { room: roomId, bookingStatus: { $in: BLOCKING_STATUSES }, ...overlapQuery(checkIn, checkOut) };
  if (excludeBookingId) q._id = { $ne: excludeBookingId };
  const clash = await Booking.findOne(q).select('checkInDate checkOutDate bookingNumber');
  if (clash) throw new ApiError(409, `Room ${room.roomNumber} is already booked from ${fmt(clash.checkInDate)} to ${fmt(clash.checkOutDate)}.`, { conflictingBooking: clash.bookingNumber });
  return room;
};

/** Atomic inventory claim. The unique (room,night) index is the real concurrency guard. */
export const reserveNights = async (roomId, bookingId, from, to) => {
  const docs = listNights(from, to).map((night) => ({ room: roomId, night, booking: bookingId }));
  try { await RoomNight.insertMany(docs, { ordered: true }); }
  catch (e) {
    await RoomNight.deleteMany({ booking: bookingId, room: roomId, night: { $in: docs.map((d) => d.night) } }); // roll back partial insert
    if (e.code === 11000 || e.writeErrors) throw new ApiError(409, 'Room is unavailable for the selected dates.');
    throw e;
  }
};
export const releaseNights = (bookingId, filter = {}) => RoomNight.deleteMany({ booking: bookingId, ...filter });

/** Comprehensive room availability check for [from,to) — returns both sellable rooms and all rooms with availability status. */
export const getRoomsAvailability = async (from, to, { roomType, floor, isAC, adults = 0, children = 0 } = {}) => {
  const { checkIn, checkOut } = validateRange(from, to);
  const busy = await Booking.find({ bookingStatus: { $in: BLOCKING_STATUSES }, ...overlapQuery(checkIn, checkOut) }).select('room bookingNumber checkInDate checkOutDate');
  const blocked = await Maintenance.find({ blocksRoom: true, status: { $in: ['open', 'in_progress'] }, blockFrom: { $lt: checkOut }, blockTo: { $gt: checkIn } }).select('room issue blockFrom blockTo');
  
  const busyMap = new Map();
  busy.forEach((b) => {
    if (b.room) busyMap.set(String(b.room), b);
  });
  
  const blockedMap = new Map();
  blocked.forEach((m) => {
    if (m.room) blockedMap.set(String(m.room), m);
  });

  const filter = { isActive: true };
  if (roomType) filter.roomType = roomType;
  if (floor !== undefined && floor !== '') filter.floor = Number(floor);
  
  let allRooms = await Room.find(filter).populate('roomType amenities').sort({ floor: 1, roomNumber: 1 });
  const today = toDay(new Date());

  const processed = allRooms.map((r) => {
    const rid = String(r._id);
    let isAvailable = true;
    let reason = null; // 'occupied' | 'maintenance' | 'out_of_service' | 'capacity'
    let detail = null;

    if (r.maintenanceStatus === 'out_of_service') {
      isAvailable = false;
      reason = 'out_of_service';
      detail = 'Out of service';
    } else if (blockedMap.has(rid) || (r.maintenanceStatus === 'maintenance' && checkIn <= today)) {
      isAvailable = false;
      reason = 'maintenance';
      const m = blockedMap.get(rid);
      detail = m?.issue ? `Maintenance (${m.issue.replace(/_/g, ' ')})` : 'Under maintenance';
    } else if (busyMap.has(rid)) {
      isAvailable = false;
      reason = 'occupied';
      const b = busyMap.get(rid);
      detail = b?.bookingNumber ? `Occupied (${b.bookingNumber})` : 'Occupied';
    } else if (adults && r.adultsCapacity < Number(adults)) {
      isAvailable = false;
      reason = 'capacity';
      detail = `Capacity: max ${r.adultsCapacity} adults`;
    } else if (children && r.childrenCapacity < Number(children)) {
      isAvailable = false;
      reason = 'capacity';
      detail = `Capacity: max ${r.childrenCapacity} children`;
    }

    const cfg = sellableConfig(r);
    return {
      ...r.toObject(),
      ...cfg,
      isAvailable,
      unavailabilityReason: reason,
      unavailabilityDetail: detail,
      conflictingBooking: busyMap.get(rid)?.bookingNumber || null,
    };
  }).filter((r) => isAC === undefined || isAC === '' || r.sellableIsAC === (isAC === 'true' || isAC === true));

  const availableRooms = processed.filter((r) => r.isAvailable);

  return {
    rooms: availableRooms,
    allRooms: processed,
    availableCount: availableRooms.length,
    unavailableCount: processed.length - availableRooms.length,
    totalCount: processed.length,
  };
};

/** Rooms sellable for [from,to) — used by booking wizard & walk-in. */
export const findAvailableRooms = async (from, to, options = {}) => {
  const res = await getRoomsAvailability(from, to, options);
  return res.rooms;
};

/** Effective (temporary-aware) config used for new bookings. Permanent fields are never mutated. */
export const sellableConfig = (room) =>
  room.tempConfig?.active
    ? { sellableIsAC: room.tempConfig.isAC, sellablePrice: room.tempConfig.price ?? room.basePrice, isTemporary: true, tempReason: room.tempConfig.reason }
    : { sellableIsAC: room.isAC, sellablePrice: room.basePrice, isTemporary: false };

export { rangesOverlap };
