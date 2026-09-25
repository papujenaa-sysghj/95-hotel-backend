import PDFDocument from 'pdfkit';
import { Booking, Room, Guest, Payment, Maintenance, Invoice, Hotel, nextSeq } from '../models/index.js';
import * as svc from '../services/booking.service.js';
import { findAvailableRooms, BLOCKING_STATUSES } from '../services/availability.service.js';
import { hasPermission } from '../middleware/permission.middleware.js';
import { audit } from '../services/audit.service.js';
import { notify } from '../services/notification.service.js';
import { withStatus } from './inventory.controller.js';
import { toDay, fmt } from '../utils/dates.js';
import { ApiError, ok, asyncHandler } from '../utils/ApiError.js';

const pop = svc.bookingPopulate;
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const availability = asyncHandler(async (req, res) => ok(res, { rooms: await findAvailableRooms(req.query.checkInDate, req.query.checkOutDate, req.query) }));

export const list = asyncHandler(async (req, res) => {
  const { status, paymentStatus, from, to, guest, room, q, page = 1, limit = 25 } = req.query; const f = {};
  if (status) f.bookingStatus = { $in: status.split(',') }; if (paymentStatus) f.paymentStatus = paymentStatus; if (guest) f.guest = guest; if (room) f.room = room;
  if (to) f.checkInDate = { $lt: new Date(to) }; // stays overlapping [from,to)
  if (from) f.checkOutDate = { $gt: new Date(from) };
  if (q) { const rx = new RegExp(esc(q), 'i'); const gs = await Guest.find({ $or: [{ name: rx }, { phone: rx }] }).distinct('_id'); const rs = await Room.find({ roomNumber: rx }).distinct('_id'); f.$or = [{ bookingNumber: rx }, { guest: { $in: gs } }, { room: { $in: rs } }]; }
  const [items, total] = await Promise.all([Booking.find(f).populate(pop).sort({ checkInDate: -1 }).skip((page - 1) * limit).limit(Number(limit)), Booking.countDocuments(f)]);
  ok(res, { items, total, page: Number(page) });
});
export const get = asyncHandler(async (req, res) => {
  const b = await Booking.findById(req.params.id).populate(pop).populate('roomHistory.room', 'roomNumber'); if (!b) throw new ApiError(404, 'Booking not found.');
  ok(res, { booking: b, payments: await Payment.find({ booking: b._id }).populate('receivedBy', 'name').sort({ paidAt: -1 }) });
});
export const create = asyncHandler(async (req, res) => {
  const b = await svc.createBooking({ ...req.body, canEditRate: hasPermission(req, 'bookings.edit_rate'), canGiveDiscount: hasPermission(req, 'bookings.give_discount') }, req.user);
  await audit(req, 'booking.create', { entity: 'Booking', entityId: b._id, summary: `Created booking ${b.bookingNumber}${b.discount ? ` (Discount: ₹${b.discount.toLocaleString('en-IN')})` : ''}`, meta: { room: b.room?.roomNumber, discount: b.discount } });
  ok(res, { booking: b }, 'Booking created successfully', 201);
});
export const update = asyncHandler(async (req, res) => {
  const b = await svc.updateBooking(req.params.id, { ...req.body, canEditRate: hasPermission(req, 'bookings.edit_rate'), canGiveDiscount: hasPermission(req, 'bookings.give_discount') }, req.user);
  await audit(req, 'booking.update', { entity: 'Booking', entityId: b._id, summary: `Updated booking ${b.bookingNumber}${b.discount ? ` (Discount: ₹${b.discount.toLocaleString('en-IN')})` : ''}`, meta: { discount: b.discount } });
  ok(res, { booking: b }, 'Booking updated');
});
// Drag/drop, resize, extend, shorten, change room — always re-validated server side.
const stay = (action, label) => asyncHandler(async (req, res) => {
  const r = await svc.modifyStay(req.params.id, req.body, req.user); const b = r.booking;
  await audit(req, action, { entity: 'Booking', entityId: b._id, summary: `${label} ${b.bookingNumber} (${fmt(b.checkInDate)}→${fmt(b.checkOutDate)}, Room ${b.room?.roomNumber})`, meta: { previousRoom: r.previousRoom, previousRange: r.previousRange } });
  ok(res, { booking: b }, `${label} saved`);
});
export const move = stay('booking.move', 'Booking moved');
export const extend = stay('booking.extend', 'Stay changed');
export const changeRoom = asyncHandler(async (req, res, next) => stay('booking.room_change', 'Room changed')(req, res, next));
export const cancel = asyncHandler(async (req, res) => {
  const b = await svc.cancelBooking(req.params.id, req.body.reason, req.user);
  await audit(req, 'booking.cancel', { entity: 'Booking', entityId: b._id, summary: `Cancelled booking ${b.bookingNumber}`, meta: { reason: req.body.reason } });
  await notify('cancellation', 'Booking cancelled', `${b.bookingNumber} was cancelled.`, { bookingId: b._id, forPermission: 'bookings.view' }); ok(res, { booking: b }, 'Booking cancelled');
});
export const noShow = asyncHandler(async (req, res) => { const b = await svc.markNoShow(req.params.id, req.user); await audit(req, 'booking.no_show', { entity: 'Booking', entityId: b._id, summary: `${b.bookingNumber} marked no-show` }); ok(res, { booking: b }); });

export const arrivals = asyncHandler(async (_req, res) => { const t = toDay(new Date()); ok(res, { items: await Booking.find({ checkInDate: t, bookingStatus: { $in: ['confirmed', 'hold', 'checked_in'] } }).populate(pop) }); });
export const departures = asyncHandler(async (_req, res) => { const t = toDay(new Date()); ok(res, { items: await Booking.find({ checkOutDate: { $lte: t }, bookingStatus: { $in: ['checked_in', 'checked_out'] }, $or: [{ bookingStatus: 'checked_in' }, { actualCheckOut: { $gte: t } }] }).populate(pop) }); });
export const doCheckIn = asyncHandler(async (req, res) => { const b = await svc.checkIn_(req.params.id, req.user); await audit(req, 'booking.check_in', { entity: 'Booking', entityId: b._id, summary: `Checked in ${b.bookingNumber} (Room ${b.room?.roomNumber})` }); ok(res, { booking: b }, 'Guest checked in'); });
export const doCheckOut = asyncHandler(async (req, res) => {
  if (req.body?.payment && !hasPermission(req, 'payments.create')) throw new ApiError(403, "You don't have permission to take payments.");
  const b = await svc.checkOut(req.params.id, req.user, { ...req.body, canGiveDiscount: hasPermission(req, 'bookings.give_discount') });
  await audit(req, 'booking.check_out', { entity: 'Booking', entityId: b._id, summary: `Checked out ${b.bookingNumber}${b.discount ? ` (Discount: ₹${b.discount.toLocaleString('en-IN')})` : ''}; Room ${b.room?.roomNumber} is now dirty`, meta: { discount: b.discount } });
  ok(res, { booking: b }, 'Guest checked out');
});

// ---- payments ----
export const takePayment = asyncHandler(async (req, res) => {
  const r = await svc.addPayment(req.params.id, req.body, req.user);
  await audit(req, 'payment.create', { entity: 'Payment', entityId: r.payment._id, summary: `${req.user.name} received ₹${req.body.amount.toLocaleString('en-IN')} (${req.body.method}) for ${r.booking.bookingNumber}` }); ok(res, r, 'Payment recorded', 201);
});
export const refund = asyncHandler(async (req, res) => {
  const r = await svc.addPayment(req.params.id, { ...req.body, type: 'refund' }, req.user);
  await audit(req, 'payment.refund', { entity: 'Payment', entityId: r.payment._id, summary: `Refunded ₹${req.body.amount} on ${r.booking.bookingNumber}` }); ok(res, r, 'Refund recorded', 201);
});
export const listPayments = asyncHandler(async (req, res) => {
  const { method, from, to, booking, page = 1, limit = 50 } = req.query; const f = {};
  if (method) f.method = method; if (booking) f.booking = booking; if (from || to) f.paidAt = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
  const [items, total] = await Promise.all([Payment.find(f).populate('booking', 'bookingNumber').populate('guest', 'name').populate('receivedBy', 'name').sort({ paidAt: -1 }).skip((page - 1) * limit).limit(Number(limit)), Payment.countDocuments(f)]);
  ok(res, { items, total });
});

// ---- calendar ----
export const calendar = asyncHandler(async (req, res) => {
  const from = toDay(req.query.from), to = toDay(req.query.to);
  if (isNaN(from) || isNaN(to) || to <= from) throw new ApiError(400, 'Provide a valid from/to range.');
  if ((to - from) / 864e5 > 62) throw new ApiError(400, 'Calendar range is limited to 62 days.');
  const { roomType, floor, status, bookingStatus, q } = req.query; const rf = { isActive: true };
  if (roomType) rf.roomType = roomType; if (floor) rf.floor = Number(floor);
  if (q) { const rx = new RegExp(esc(q), 'i'); const bs = await Booking.find({ bookingNumber: rx }).distinct('room'); const gs = await Guest.find({ $or: [{ name: rx }, { phone: rx }] }).distinct('_id'); const bg = await Booking.find({ guest: { $in: gs } }).distinct('room'); rf.$or = [{ roomNumber: rx }, { _id: { $in: [...bs, ...bg] } }]; }
  let rooms = (await Room.find(rf).populate('roomType', 'name').sort({ floor: 1, roomNumber: 1 })).map(withStatus);
  if (status) rooms = rooms.filter((r) => r.status === status);
  const ids = rooms.map((r) => r._id);
  const bf = { room: { $in: ids }, checkInDate: { $lt: to }, checkOutDate: { $gt: from }, bookingStatus: bookingStatus ? { $in: bookingStatus.split(',') } : { $in: BLOCKING_STATUSES.concat('checked_out') } };
  const [bookings, blocks] = await Promise.all([
    Booking.find(bf).populate('guest', 'name phone').select('bookingNumber room guest checkInDate checkOutDate nights bookingStatus paymentStatus totalAmount balanceAmount bookedAsAC'),
    Maintenance.find({ room: { $in: ids }, blocksRoom: true, status: { $in: ['open', 'in_progress'] }, blockFrom: { $lt: to }, blockTo: { $gt: from } }).select('room issue blockFrom blockTo priority'),
  ]);
  const byRoom = (arr) => arr.reduce((m, x) => ((m[x.room] ||= []).push(x), m), {});
  const bMap = byRoom(bookings), mMap = byRoom(blocks);
  const summary = { total: rooms.length, occupied: 0, available: 0, maintenance: 0, out_of_service: 0, cleaning: 0 }; rooms.forEach((r) => (summary[r.status] += 1));
  ok(res, { from, to, rooms: rooms.map((r) => ({ ...r, bookings: bMap[r._id] || [], blocks: mMap[r._id] || [] })), summary });
});

// ---- invoices ----
const buildInvoice = async (bookingId, user) => {
  const b = await Booking.findById(bookingId).populate('guest room roomType'); if (!b) throw new ApiError(404, 'Booking not found.');
  let inv = await Invoice.findOne({ booking: b._id });
  const hotel = (await Hotel.findOne()) || {};
  const lines = [{ description: `Room ${b.room.roomNumber} (${b.roomType?.name}, ${b.bookedAsAC ? 'AC' : 'Non-AC'}) × ${b.nights} night(s) @ ₹${b.roomRate}`, amount: b.roomRate * b.nights }];
  if (b.extraBedCharge) lines.push({ description: 'Extra bed', amount: b.extraBedCharge }); if (b.otherCharges) lines.push({ description: 'Other charges', amount: b.otherCharges });
  if (b.discount) lines.push({ description: 'Discount', amount: -b.discount }); lines.push({ description: `Tax (${b.taxPercent}%)`, amount: b.tax });
  if (!inv) inv = await Invoice.create({ invoiceNumber: `${hotel.invoice?.prefix || 'INV'}-${new Date().getUTCFullYear()}-${String(await nextSeq('invoice')).padStart(5, '0')}`, booking: b._id, generatedBy: user._id });
  inv.lines = lines; inv.snapshot = { hotel, guest: b.guest, booking: b }; await inv.save();
  return { inv, b, hotel, lines };
};
export const invoiceJson = asyncHandler(async (req, res) => { const { inv, b, hotel, lines } = await buildInvoice(req.params.bookingId, req.user); ok(res, { invoice: inv, booking: b, hotel, lines }); });
export const invoicePdf = asyncHandler(async (req, res) => {
  const { inv, b, hotel, lines } = await buildInvoice(req.params.bookingId, req.user);
  await audit(req, 'invoice.generate', { entity: 'Invoice', entityId: inv._id, summary: `Invoice ${inv.invoiceNumber} for ${b.bookingNumber}` });
  res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `inline; filename="${inv.invoiceNumber}.pdf"`);
  const doc = new PDFDocument({ margin: 50 }); doc.pipe(res);
  doc.fontSize(20).text(hotel.name || 'Hotel', { align: 'left' }).fontSize(9).fillColor('#555').text([hotel.address, hotel.phone, hotel.email, hotel.gstNumber && `GSTIN: ${hotel.gstNumber}`].filter(Boolean).join('  |  ')).fillColor('#000').moveDown();
  doc.fontSize(14).text(`TAX INVOICE  ${inv.invoiceNumber}`).fontSize(10).text(`Booking: ${b.bookingNumber}`).text(`Guest: ${b.guest.name}  |  ${b.guest.phone}`).text(`Room: ${b.room.roomNumber}   Check-in: ${fmt(b.checkInDate)}   Check-out: ${fmt(b.checkOutDate)}   Nights: ${b.nights}`).moveDown();
  lines.forEach((l) => doc.text(l.description, 50, doc.y, { continued: true, width: 380 }).text(`₹${l.amount.toLocaleString('en-IN')}`, { align: 'right' }));
  doc.moveDown().fontSize(12).text(`Total: ₹${b.totalAmount.toLocaleString('en-IN')}`, { align: 'right' }).text(`Paid: ₹${b.paidAmount.toLocaleString('en-IN')}`, { align: 'right' }).text(`Balance: ₹${b.balanceAmount.toLocaleString('en-IN')}`, { align: 'right' });
  if (hotel.invoice?.footerNote) doc.moveDown().fontSize(9).fillColor('#555').text(hotel.invoice.footerNote); doc.end();
});
