import PDFDocument from 'pdfkit';
import { Room, Booking, Payment, RoomNight, AuditLog, RoomType, Maintenance } from '../models/index.js';
import { ok, asyncHandler, ApiError } from '../utils/ApiError.js';
import { toDay, fmt } from '../utils/dates.js';
import { withStatus } from './inventory.controller.js';

const day = 864e5;
const range = (q, def = 30) => { const to = q.to ? toDay(q.to) : toDay(new Date(Date.now() + day)); const from = q.from ? toDay(q.from) : new Date(to - def * day); return { from, to }; };
const bucketKey = (d, g) => { const x = new Date(d); if (g === 'year') return String(x.getUTCFullYear()); if (g === 'month') return x.toISOString().slice(0, 7); if (g === 'week') { const s = new Date(x); s.setUTCDate(s.getUTCDate() - s.getUTCDay()); return s.toISOString().slice(0, 10); } return x.toISOString().slice(0, 10); };
const netPayments = (from, to) => Payment.find({ paidAt: { $gte: from, $lt: to } }).populate('booking', 'bookingNumber').populate('receivedBy', 'name');

export const dashboard = asyncHandler(async (req, res) => {
  const selectedDate = req.query.date ? toDay(req.query.date) : null;
  const today = toDay(new Date()), tomorrow = new Date(+today + day);
  const targetDate = selectedDate || today;

  const rooms = (await Room.find({ isActive: true }).populate('roomType', 'name')).map(withStatus);
  const count = (s) => rooms.filter((r) => r.status === s).length;
  
  const [arr, dep, payToday, pending, recent, activity, dateBookings, dateMaint] = await Promise.all([
    Booking.find({ checkInDate: today, bookingStatus: { $in: ['confirmed', 'hold', 'checked_in'] } }).populate('guest room', 'name roomNumber'),
    Booking.find({ checkOutDate: today, bookingStatus: { $in: ['checked_in', 'checked_out'] } }).populate('guest room', 'name roomNumber'),
    netPayments(today, tomorrow),
    Booking.aggregate([{ $match: { balanceAmount: { $gt: 0 }, bookingStatus: { $in: ['confirmed', 'checked_in', 'hold'] } } }, { $group: { _id: null, total: { $sum: '$balanceAmount' }, count: { $sum: 1 } } }]),
    Booking.find().populate('guest room', 'name roomNumber').sort({ createdAt: -1 }).limit(8),
    AuditLog.find().sort({ createdAt: -1 }).limit(10),
    Booking.find({ checkInDate: { $lte: targetDate }, checkOutDate: { $gt: targetDate }, bookingStatus: { $in: ['confirmed', 'checked_in', 'hold'] } }),
    Maintenance.find({ blocksRoom: true, status: { $in: ['open', 'in_progress'] }, blockFrom: { $lte: targetDate }, blockTo: { $gt: targetDate } }),
  ]);

  const occRoomMap = new Map(dateBookings.map((b) => [String(b.room), b._id]));
  const maintRoomSet = new Set(dateMaint.map((m) => String(m.room)));

  const roomGrid = rooms.map((r) => {
    let st = r.status;
    let bId = r.currentBookingId;
    if (selectedDate) {
      if (maintRoomSet.has(String(r._id))) {
        st = 'maintenance';
        bId = null;
      } else if (occRoomMap.has(String(r._id))) {
        st = 'occupied';
        bId = occRoomMap.get(String(r._id));
      } else if (r.maintenanceStatus === 'out_of_service') {
        st = 'out_of_service';
        bId = null;
      } else {
        st = 'available';
        bId = null;
      }
    }
    return {
      _id: r._id,
      roomNumber: r.roomNumber,
      status: st,
      isTemporary: r.isTemporary,
      housekeepingStatus: r.housekeepingStatus,
      currentBookingId: bId,
      floor: r.floor,
    };
  });

  const occByType = {}; 
  rooms.forEach((r) => { const n = r.roomType?.name || 'Unknown'; (occByType[n] ||= { total: 0, occupied: 0 }).total++; if (r.status === 'occupied') occByType[n].occupied++; });

  ok(res, {
    date: targetDate.toISOString().slice(0, 10),
    stats: { 
      totalRooms: rooms.length, occupied: count('occupied'), available: count('available'), maintenance: count('maintenance'), outOfService: count('out_of_service'), cleaning: count('cleaning'), tempNonAC: rooms.filter((r) => r.isTemporary).length,
      todayCheckIns: arr.length, todayCheckOuts: dep.length, todayRevenue: payToday.reduce((s, p) => s + (p.type === 'refund' ? -p.amount : p.amount), 0), pendingPayments: pending[0]?.total || 0, pendingCount: pending[0]?.count || 0 
    },
    roomTypeOccupancy: Object.entries(occByType).map(([name, v]) => ({ name, ...v, rate: v.total ? Math.round((v.occupied / v.total) * 100) : 0 })),
    arrivals: arr, departures: dep, recentBookings: recent, activity,
    roomGrid,
  });
});

export const occupancyTrend = asyncHandler(async (req, res) => {
  const days = Math.min(Number(req.query.days) || 7, 365), total = await Room.countDocuments({ isActive: true }); const to = toDay(new Date()); const from = new Date(+to - (days - 1) * day);
  const rows = await RoomNight.aggregate([{ $match: { night: { $gte: from, $lte: to } } }, { $group: { _id: '$night', occupied: { $sum: 1 } } }]);
  const map = Object.fromEntries(rows.map((r) => [r._id.toISOString().slice(0, 10), r.occupied]));
  const series = Array.from({ length: days }, (_, i) => { const d = new Date(+from + i * day).toISOString().slice(0, 10); const occ = map[d] || 0; return { date: d, occupied: occ, rate: total ? Math.round((occ / total) * 100) : 0 }; });
  ok(res, { series, totalRooms: total });
});

export const revenueOverview = asyncHandler(async (req, res) => {
  const { from, to } = range(req.query); const g = req.query.group || 'day';
  const pays = await netPayments(from, to); const buckets = {};
  pays.forEach((p) => { const k = bucketKey(p.paidAt, g); (buckets[k] ||= { period: k, collected: 0 }).collected += p.type === 'refund' ? -p.amount : p.amount; });
  const bookings = await Booking.find({ checkInDate: { $lt: to }, checkOutDate: { $gt: from }, bookingStatus: { $nin: ['cancelled', 'no_show'] } });
  const roomRevenue = bookings.reduce((s, b) => s + b.roomRate * b.nights, 0), other = bookings.reduce((s, b) => s + b.extraBedCharge + b.otherCharges, 0);
  ok(res, { series: Object.values(buckets).sort((a, b) => a.period.localeCompare(b.period)), roomRevenue, otherRevenue: other, totalRevenue: roomRevenue + other });
});

// ---------- tabular reports with CSV / PDF export ----------
const REPORTS = {
  async occupancy(q) { const { from, to } = range(q); const total = await Room.countDocuments({ isActive: true }); const rows = await RoomNight.aggregate([{ $match: { night: { $gte: from, $lt: to } } }, { $group: { _id: '$night', occupied: { $sum: 1 } } }]); const b = {};
    rows.forEach((r) => { const k = bucketKey(r._id, q.group || 'day'); (b[k] ||= { period: k, roomNights: 0, days: 0 }); b[k].roomNights += r.occupied; b[k].days += 1; });
    return { columns: ['period', 'roomNights', 'occupancyPct'], rows: Object.values(b).sort((x, y) => x.period.localeCompare(y.period)).map((r) => ({ period: r.period, roomNights: r.roomNights, occupancyPct: total ? +((r.roomNights / (total * r.days)) * 100).toFixed(1) : 0 })) }; },
  async revenue(q) { const { from, to } = range(q); const b = {}; (await netPayments(from, to)).forEach((p) => { const k = bucketKey(p.paidAt, q.group || 'day'); (b[k] ||= { period: k, collected: 0, refunded: 0 }); if (p.type === 'refund') b[k].refunded += p.amount; else b[k].collected += p.amount; });
    return { columns: ['period', 'collected', 'refunded', 'net'], rows: Object.values(b).sort((x, y) => x.period.localeCompare(y.period)).map((r) => ({ ...r, net: r.collected - r.refunded })) }; },
  async bookings(q) { const { from, to } = range(q); const rows = await Booking.aggregate([{ $match: { checkInDate: { $gte: from, $lt: to } } }, { $group: { _id: '$bookingStatus', count: { $sum: 1 }, discount: { $sum: '$discount' }, amount: { $sum: '$totalAmount' } } }]); return { columns: ['status', 'count', 'discount', 'amount'], rows: rows.map((r) => ({ status: r._id, count: r.count, discount: r.discount || 0, amount: r.amount })) }; },
  async discounts(q) { const { from, to } = range(q); const bookings = await Booking.find({ checkInDate: { $lt: to }, checkOutDate: { $gt: from }, discount: { $gt: 0 } }).populate('createdBy', 'name').populate('room', 'roomNumber').populate('guest', 'name'); return { columns: ['bookingNumber', 'guest', 'room', 'subtotal', 'discount', 'totalAmount', 'givenBy'], rows: bookings.map((b) => ({ bookingNumber: b.bookingNumber, guest: b.guest?.name || 'Guest', room: b.room?.roomNumber || '-', subtotal: b.subtotal || 0, discount: b.discount || 0, totalAmount: b.totalAmount || 0, givenBy: b.createdBy?.name || 'Receptionist' })) }; },
  async payments(q) { const { from, to } = range(q); const rows = await Payment.aggregate([{ $match: { paidAt: { $gte: from, $lt: to } } }, { $group: { _id: { m: '$method', t: '$type' }, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]); return { columns: ['method', 'type', 'count', 'amount'], rows: rows.map((r) => ({ method: r._id.m, type: r._id.t, count: r.count, amount: r.amount })) }; },
  async rooms(q) { const { from, to } = range(q); const rows = await Booking.aggregate([{ $match: { checkInDate: { $lt: to }, checkOutDate: { $gt: from }, bookingStatus: { $nin: ['cancelled', 'no_show'] } } }, { $group: { _id: '$room', nights: { $sum: '$nights' }, revenue: { $sum: { $multiply: ['$roomRate', '$nights'] } } } }, { $lookup: { from: 'rooms', localField: '_id', foreignField: '_id', as: 'room' } }, { $unwind: '$room' }, { $lookup: { from: 'roomtypes', localField: 'room.roomType', foreignField: '_id', as: 'type' } }, { $sort: { revenue: -1 } }]);
    return { columns: ['room', 'roomType', 'nights', 'revenue'], rows: rows.map((r) => ({ room: r.room.roomNumber, roomType: r.type[0]?.name, nights: r.nights, revenue: r.revenue })) }; },
  async staff(q) { const { from, to } = range(q); const [bk, py, ac, ds] = await Promise.all([Booking.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$createdBy', bookings: { $sum: 1 } } }]), Payment.aggregate([{ $match: { paidAt: { $gte: from, $lt: to }, type: 'payment' } }, { $group: { _id: '$receivedBy', collected: { $sum: '$amount' } } }]), AuditLog.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$user', name: { $first: '$userName' }, actions: { $sum: 1 } } }]), Booking.aggregate([{ $match: { createdAt: { $gte: from, $lt: to }, discount: { $gt: 0 } } }, { $group: { _id: '$createdBy', discountsGiven: { $sum: '$discount' } } }])]);
    return { columns: ['staff', 'bookingsCreated', 'discountsGiven', 'paymentsCollected', 'actions'], rows: ac.map((a) => ({ staff: a.name, bookingsCreated: bk.find((x) => String(x._id) === String(a._id))?.bookings || 0, discountsGiven: ds.find((x) => String(x._id) === String(a._id))?.discountsGiven || 0, paymentsCollected: py.find((x) => String(x._id) === String(a._id))?.collected || 0, actions: a.actions })) }; },
};

export const report = asyncHandler(async (req, res) => {
  const fn = REPORTS[req.params.type]; if (!fn) throw new ApiError(404, `Unknown report. Available: ${Object.keys(REPORTS).join(', ')}`);
  const data = await fn(req.query); const fmtQ = req.query.format;
  if (fmtQ === 'csv') { const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`; res.setHeader('Content-Type', 'text/csv'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`); return res.send([data.columns.join(','), ...data.rows.map((r) => data.columns.map((c) => esc(r[c])).join(','))].join('\n')); }
  if (fmtQ === 'pdf') { res.setHeader('Content-Type', 'application/pdf'); res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.pdf"`); const doc = new PDFDocument({ margin: 40 }); doc.pipe(res); doc.fontSize(16).text(`${req.params.type[0].toUpperCase() + req.params.type.slice(1)} report`).moveDown(); const w = 500 / data.columns.length;
    doc.fontSize(10).font('Helvetica-Bold'); data.columns.forEach((c, i) => doc.text(c, 40 + i * w, doc.y - (i ? 12 : 0), { width: w })); doc.font('Helvetica'); data.rows.forEach((r) => { const y = doc.y + 2; data.columns.forEach((c, i) => doc.text(String(r[c] ?? ''), 40 + i * w, y, { width: w })); }); return doc.end(); }
  ok(res, data);
});
export { fmt, RoomType };
