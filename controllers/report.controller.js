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
  // 1. Day-wise / Daily Complete Audit Report
  async daywise(q) {
    const { from, to } = range(q);
    const totalRooms = await Room.countDocuments({ isActive: true });
    
    // Get occupied room nights by day
    const occRows = await RoomNight.aggregate([
      { $match: { night: { $gte: from, $lt: to } } },
      { $group: { _id: '$night', occupied: { $sum: 1 } } }
    ]);
    const occMap = Object.fromEntries(occRows.map(r => [r._id.toISOString().slice(0, 10), r.occupied]));

    // Get bookings in range
    const bookings = await Booking.find({
      $or: [
        { checkInDate: { $gte: from, $lt: to } },
        { checkOutDate: { $gte: from, $lt: to } },
        { checkInDate: { $lte: from }, checkOutDate: { $gte: to } }
      ],
      bookingStatus: { $nin: ['cancelled', 'no_show'] }
    });

    // Payments in range
    const pays = await Payment.find({ paidAt: { $gte: from, $lt: to } });
    const payMap = {};
    pays.forEach(p => {
      const k = p.paidAt.toISOString().slice(0, 10);
      payMap[k] ||= { collected: 0, refunded: 0 };
      if (p.type === 'refund') payMap[k].refunded += p.amount;
      else payMap[k].collected += p.amount;
    });

    const rows = [];
    const curr = new Date(from);
    while (curr < to) {
      const dStr = curr.toISOString().slice(0, 10);
      const nextDay = new Date(+curr + day);

      const dOcc = occMap[dStr] || 0;
      const dCheckIns = bookings.filter(b => b.checkInDate.toISOString().slice(0, 10) === dStr).length;
      const dCheckOuts = bookings.filter(b => b.checkOutDate.toISOString().slice(0, 10) === dStr).length;

      // Bookings checking in on this day or active on this day
      const checkInBks = bookings.filter(b => b.checkInDate.toISOString().slice(0, 10) === dStr);
      const dRoomRev = checkInBks.reduce((s, b) => s + (b.subtotal || b.roomRate * b.nights || 0), 0);
      const dExtra = checkInBks.reduce((s, b) => s + (b.extraBedCharge || 0) + (b.otherCharges || 0), 0);
      const dTax = checkInBks.reduce((s, b) => s + (b.tax || 0), 0);
      const dDiscount = checkInBks.reduce((s, b) => s + (b.discount || 0), 0);
      const dGross = checkInBks.reduce((s, b) => s + (b.totalAmount || 0), 0);
      const dBalance = checkInBks.reduce((s, b) => s + (b.balanceAmount || 0), 0);

      const pData = payMap[dStr] || { collected: 0, refunded: 0 };
      const dCollected = pData.collected;
      const dRefunded = pData.refunded;
      const dNet = dCollected - dRefunded;

      rows.push({
        date: dStr,
        roomNights: dOcc,
        occupancyPct: totalRooms ? +((dOcc / totalRooms) * 100).toFixed(1) : 0,
        checkIns: dCheckIns,
        checkOuts: dCheckOuts,
        roomRevenue: dRoomRev,
        extraCharges: dExtra,
        tax: dTax,
        discount: dDiscount,
        grossBilled: dGross,
        collected: dCollected,
        refunded: dRefunded,
        netCollected: dNet,
        balancePending: dBalance,
      });

      curr.setUTCDate(curr.getUTCDate() + 1);
    }

    return {
      columns: [
        'date',
        'roomNights',
        'occupancyPct',
        'checkIns',
        'checkOuts',
        'roomRevenue',
        'extraCharges',
        'tax',
        'discount',
        'grossBilled',
        'collected',
        'refunded',
        'netCollected',
        'balancePending'
      ],
      rows
    };
  },

  // 2. Monthly Consolidated Report
  async monthly(q) {
    const { from, to } = range(q, 365);
    const totalRooms = await Room.countDocuments({ isActive: true });
    
    // Group payments by YYYY-MM
    const pays = await netPayments(from, to);
    const payBuckets = {};
    pays.forEach(p => {
      const k = p.paidAt.toISOString().slice(0, 7);
      payBuckets[k] ||= { collected: 0, refunded: 0 };
      if (p.type === 'refund') payBuckets[k].refunded += p.amount;
      else payBuckets[k].collected += p.amount;
    });

    // Group room nights by month
    const occRows = await RoomNight.aggregate([
      { $match: { night: { $gte: from, $lt: to } } },
      { $group: { _id: { $substr: ['$night', 0, 7] }, roomNights: { $sum: 1 }, days: { $addToSet: { $substr: ['$night', 0, 10] } } } }
    ]);
    const occBuckets = Object.fromEntries(occRows.map(r => [r._id, { roomNights: r.roomNights, daysCount: r.days.length }]));

    // Bookings in range
    const bookings = await Booking.find({
      checkInDate: { $gte: from, $lt: to },
      bookingStatus: { $nin: ['cancelled', 'no_show'] }
    });

    const bkBuckets = {};
    bookings.forEach(b => {
      const k = b.checkInDate.toISOString().slice(0, 7);
      bkBuckets[k] ||= { count: 0, roomRevenue: 0, extra: 0, tax: 0, discount: 0, total: 0 };
      bkBuckets[k].count += 1;
      bkBuckets[k].roomRevenue += (b.subtotal || b.roomRate * b.nights || 0);
      bkBuckets[k].extra += (b.extraBedCharge || 0) + (b.otherCharges || 0);
      bkBuckets[k].tax += (b.tax || 0);
      bkBuckets[k].discount += (b.discount || 0);
      bkBuckets[k].total += (b.totalAmount || 0);
    });

    // Gather all months in range
    const allMonths = new Set([...Object.keys(payBuckets), ...Object.keys(occBuckets), ...Object.keys(bkBuckets)]);
    const sortedMonths = Array.from(allMonths).sort();

    const rows = sortedMonths.map(m => {
      const [yearStr, monthStr] = m.split('-');
      const y = parseInt(yearStr, 10);
      const mon = parseInt(monthStr, 10);
      const daysInMon = new Date(Date.UTC(y, mon, 0)).getUTCDate();
      const totalAvailableNights = totalRooms * daysInMon;

      const occ = occBuckets[m] || { roomNights: 0 };
      const bk = bkBuckets[m] || { count: 0, roomRevenue: 0, extra: 0, tax: 0, discount: 0, total: 0 };
      const py = payBuckets[m] || { collected: 0, refunded: 0 };
      const net = py.collected - py.refunded;
      const occPct = totalAvailableNights ? +((occ.roomNights / totalAvailableNights) * 100).toFixed(1) : 0;
      const adr = occ.roomNights ? Math.round(bk.roomRevenue / occ.roomNights) : 0;
      const revPar = totalAvailableNights ? Math.round(bk.roomRevenue / totalAvailableNights) : 0;

      return {
        month: m,
        roomNightsSold: occ.roomNights,
        totalNightsAvailable: totalAvailableNights,
        occupancyPct: occPct,
        bookingsCount: bk.count,
        roomRevenue: bk.roomRevenue,
        extraCharges: bk.extra,
        tax: bk.tax,
        discount: bk.discount,
        grossBilled: bk.total,
        collected: py.collected,
        refunded: py.refunded,
        netRevenue: net,
        adr,
        revPar
      };
    });

    return {
      columns: [
        'month',
        'roomNightsSold',
        'totalNightsAvailable',
        'occupancyPct',
        'bookingsCount',
        'roomRevenue',
        'extraCharges',
        'tax',
        'discount',
        'grossBilled',
        'collected',
        'refunded',
        'netRevenue',
        'adr',
        'revPar'
      ],
      rows
    };
  },

  // 3. A to Z Bookings Detailed Register
  async bookings(q) {
    const { from, to } = range(q);
    const bookings = await Booking.find({
      checkInDate: { $gte: from, $lt: to }
    })
      .populate('guest', 'name phone email')
      .populate('room', 'roomNumber')
      .populate('roomType', 'name')
      .populate('createdBy', 'name')
      .sort({ checkInDate: -1 });

    const rows = bookings.map(b => ({
      bookingNumber: b.bookingNumber,
      customerName: b.guest?.name || 'Guest',
      mobileNo: b.guest?.phone || '-',
      email: b.guest?.email || '-',
      roomNumber: b.room?.roomNumber || '-',
      roomType: b.roomType?.name || '-',
      checkInDate: b.checkInDate.toISOString().slice(0, 10),
      checkOutDate: b.checkOutDate.toISOString().slice(0, 10),
      nights: b.nights || 1,
      roomRate: b.roomRate || 0,
      extraCharges: (b.extraBedCharge || 0) + (b.otherCharges || 0),
      subtotal: b.subtotal || 0,
      taxPercent: b.taxPercent || 0,
      tax: b.tax || 0,
      discount: b.discount || 0,
      totalAmount: b.totalAmount || 0,
      paidAmount: b.paidAmount || 0,
      balanceAmount: b.balanceAmount || 0,
      bookingStatus: b.bookingStatus,
      paymentStatus: b.paymentStatus,
      source: b.source || 'reception',
      bookedBy: b.createdBy?.name || 'Staff'
    }));

    return {
      columns: [
        'bookingNumber',
        'customerName',
        'mobileNo',
        'email',
        'roomNumber',
        'roomType',
        'checkInDate',
        'checkOutDate',
        'nights',
        'roomRate',
        'extraCharges',
        'subtotal',
        'taxPercent',
        'tax',
        'discount',
        'totalAmount',
        'paidAmount',
        'balanceAmount',
        'bookingStatus',
        'paymentStatus',
        'source',
        'bookedBy'
      ],
      rows
    };
  },

  // 4. A to Z GST / Tax Register
  async tax(q) {
    const { from, to } = range(q);
    const bookings = await Booking.find({
      checkInDate: { $gte: from, $lt: to },
      bookingStatus: { $nin: ['cancelled', 'no_show'] }
    })
      .populate('guest', 'name phone')
      .populate('room', 'roomNumber')
      .sort({ checkInDate: -1 });

    const rows = bookings.map(b => {
      const taxable = (b.subtotal || 0) - (b.discount || 0) + ((b.extraBedCharge || 0) + (b.otherCharges || 0));
      const totalTax = b.tax || 0;
      const cgst = +(totalTax / 2).toFixed(2);
      const sgst = +(totalTax / 2).toFixed(2);

      return {
        date: b.checkInDate.toISOString().slice(0, 10),
        bookingNumber: b.bookingNumber,
        customerName: b.guest?.name || 'Guest',
        mobileNo: b.guest?.phone || '-',
        roomNumber: b.room?.roomNumber || '-',
        taxableAmount: taxable,
        taxPercent: b.taxPercent || 0,
        cgst,
        sgst,
        totalTax,
        invoiceAmount: b.totalAmount || 0
      };
    });

    return {
      columns: [
        'date',
        'bookingNumber',
        'customerName',
        'mobileNo',
        'roomNumber',
        'taxableAmount',
        'taxPercent',
        'cgst',
        'sgst',
        'totalTax',
        'invoiceAmount'
      ],
      rows
    };
  },

  // 5. Occupancy Trend
  async occupancy(q) {
    const { from, to } = range(q);
    const total = await Room.countDocuments({ isActive: true });
    const rows = await RoomNight.aggregate([
      { $match: { night: { $gte: from, $lt: to } } },
      { $group: { _id: '$night', occupied: { $sum: 1 } } }
    ]);
    const b = {};
    rows.forEach((r) => {
      const k = bucketKey(r._id, q.group || 'day');
      (b[k] ||= { period: k, roomNights: 0, days: 0 });
      b[k].roomNights += r.occupied;
      b[k].days += 1;
    });
    return {
      columns: ['period', 'roomNights', 'occupancyPct'],
      rows: Object.values(b)
        .sort((x, y) => x.period.localeCompare(y.period))
        .map((r) => ({
          period: r.period,
          roomNights: r.roomNights,
          occupancyPct: total ? +((r.roomNights / (total * r.days)) * 100).toFixed(1) : 0
        }))
    };
  },

  // 6. Revenue Trend
  async revenue(q) {
    const { from, to } = range(q);
    const b = {};
    (await netPayments(from, to)).forEach((p) => {
      const k = bucketKey(p.paidAt, q.group || 'day');
      (b[k] ||= { period: k, collected: 0, refunded: 0 });
      if (p.type === 'refund') b[k].refunded += p.amount;
      else b[k].collected += p.amount;
    });
    return {
      columns: ['period', 'collected', 'refunded', 'net'],
      rows: Object.values(b)
        .sort((x, y) => x.period.localeCompare(y.period))
        .map((r) => ({ ...r, net: r.collected - r.refunded }))
    };
  },

  // 7. Discounts Log
  async discounts(q) {
    const { from, to } = range(q);
    const bookings = await Booking.find({
      checkInDate: { $lt: to },
      checkOutDate: { $gt: from },
      discount: { $gt: 0 }
    })
      .populate('createdBy', 'name')
      .populate('room', 'roomNumber')
      .populate('guest', 'name phone');
    return {
      columns: ['bookingNumber', 'customerName', 'mobileNo', 'room', 'subtotal', 'discount', 'totalAmount', 'givenBy'],
      rows: bookings.map((b) => ({
        bookingNumber: b.bookingNumber,
        customerName: b.guest?.name || 'Guest',
        mobileNo: b.guest?.phone || '-',
        room: b.room?.roomNumber || '-',
        subtotal: b.subtotal || 0,
        discount: b.discount || 0,
        totalAmount: b.totalAmount || 0,
        givenBy: b.createdBy?.name || 'Receptionist'
      }))
    };
  },

  // 8. Payments Log
  async payments(q) {
    const { from, to } = range(q);
    const payments = await Payment.find({ paidAt: { $gte: from, $lt: to } })
      .populate({ path: 'booking', select: 'bookingNumber', populate: { path: 'room guest', select: 'roomNumber name phone' } })
      .populate('guest', 'name phone')
      .populate('receivedBy', 'name')
      .sort({ paidAt: -1 });

    const rows = payments.map(p => ({
      paymentId: p.paymentId || String(p._id).slice(-6).toUpperCase(),
      date: p.paidAt.toISOString().slice(0, 10),
      bookingNumber: p.booking?.bookingNumber || '-',
      customerName: p.guest?.name || p.booking?.guest?.name || 'Guest',
      mobileNo: p.guest?.phone || p.booking?.guest?.phone || '-',
      roomNumber: p.booking?.room?.roomNumber || '-',
      method: p.method,
      type: p.type,
      amount: p.amount,
      receivedBy: p.receivedBy?.name || 'Staff',
      notes: p.notes || '-'
    }));

    return {
      columns: [
        'paymentId',
        'date',
        'bookingNumber',
        'customerName',
        'mobileNo',
        'roomNumber',
        'method',
        'type',
        'amount',
        'receivedBy',
        'notes'
      ],
      rows
    };
  },

  // 9. Room Performance Matrix
  async rooms(q) {
    const { from, to } = range(q);
    const totalDays = Math.max(1, Math.round((to - from) / day));
    const allRooms = await Room.find({ isActive: true }).populate('roomType', 'name');

    const bkRows = await Booking.aggregate([
      { $match: { checkInDate: { $lt: to }, checkOutDate: { $gt: from }, bookingStatus: { $nin: ['cancelled', 'no_show'] } } },
      { $group: { _id: '$room', nights: { $sum: '$nights' }, revenue: { $sum: { $multiply: ['$roomRate', '$nights'] } } } }
    ]);
    const bkMap = Object.fromEntries(bkRows.map(r => [String(r._id), r]));

    const rows = allRooms.map(r => {
      const bk = bkMap[String(r._id)] || { nights: 0, revenue: 0 };
      const occPct = +((bk.nights / totalDays) * 100).toFixed(1);
      const adr = bk.nights ? Math.round(bk.revenue / bk.nights) : 0;
      return {
        roomNumber: r.roomNumber,
        roomType: r.roomType?.name || '-',
        floor: `Floor ${r.floor}`,
        isAC: r.isAC ? 'AC' : 'Non-AC',
        nightsOccupied: bk.nights,
        occupancyPct: occPct,
        roomRevenue: bk.revenue,
        adr,
        currentStatus: r.occupancyStatus === 'occupied' ? 'Occupied' : r.maintenanceStatus !== 'normal' ? 'Maintenance' : 'Available'
      };
    }).sort((a, b) => b.roomRevenue - a.roomRevenue);

    return {
      columns: ['roomNumber', 'roomType', 'floor', 'isAC', 'nightsOccupied', 'occupancyPct', 'roomRevenue', 'adr', 'currentStatus'],
      rows
    };
  },

  // 10. Staff Activity & Sales
  async staff(q) {
    const { from, to } = range(q);
    const [bk, py, ac, ds] = await Promise.all([
      Booking.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$createdBy', bookings: { $sum: 1 } } }]),
      Payment.aggregate([{ $match: { paidAt: { $gte: from, $lt: to }, type: 'payment' } }, { $group: { _id: '$receivedBy', collected: { $sum: '$amount' } } }]),
      AuditLog.aggregate([{ $match: { createdAt: { $gte: from, $lt: to } } }, { $group: { _id: '$user', name: { $first: '$userName' }, actions: { $sum: 1 } } }]),
      Booking.aggregate([{ $match: { createdAt: { $gte: from, $lt: to }, discount: { $gt: 0 } } }, { $group: { _id: '$createdBy', discountsGiven: { $sum: '$discount' } } }])
    ]);
    return {
      columns: ['staff', 'bookingsCreated', 'discountsGiven', 'paymentsCollected', 'actions'],
      rows: ac.map((a) => ({
        staff: a.name || 'Staff User',
        bookingsCreated: bk.find((x) => String(x._id) === String(a._id))?.bookings || 0,
        discountsGiven: ds.find((x) => String(x._id) === String(a._id))?.discountsGiven || 0,
        paymentsCollected: py.find((x) => String(x._id) === String(a._id))?.collected || 0,
        actions: a.actions
      }))
    };
  },
};

export const report = asyncHandler(async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) throw new ApiError(404, `Unknown report. Available: ${Object.keys(REPORTS).join(', ')}`);
  const data = await fn(req.query);
  const fmtQ = req.query.format;

  // CSV Export
  if (fmtQ === 'csv') {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.csv"`);
    return res.send([data.columns.join(','), ...data.rows.map((r) => data.columns.map((c) => esc(r[c])).join(','))].join('\n'));
  }

  // PDF Export (Landscape format with clean alignment)
  if (fmtQ === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-report.pdf"`);
    const doc = new PDFDocument({ margin: 30, size: 'A4', layout: 'landscape' });
    doc.pipe(res);
    
    // Header
    const title = `${req.params.type.toUpperCase()} REPORT`;
    doc.fontSize(16).font('Helvetica-Bold').text(title, 30, 30);
    doc.fontSize(9).font('Helvetica').fillColor('#64748B').text(`Generated on ${new Date().toLocaleString()} | Range: ${req.query.from || 'Start'} to ${req.query.to || 'End'}`, 30, 50);
    doc.fillColor('#000000');
    doc.moveDown(1.5);

    const availableWidth = 780; // landscape A4 width ~842 - 60 margins
    const colCount = Math.max(1, data.columns.length);
    const w = availableWidth / colCount;

    let curY = 80;
    // Table Header
    doc.rect(30, curY, availableWidth, 20).fill('#F1F5F9');
    doc.fillColor('#0F172A').fontSize(8).font('Helvetica-Bold');
    data.columns.forEach((c, i) => {
      const headerLabel = c.replace(/([A-Z])/g, ' $1').toUpperCase();
      doc.text(headerLabel, 34 + i * w, curY + 6, { width: w - 8, ellipsis: true });
    });
    curY += 22;

    // Table Rows
    doc.font('Helvetica').fontSize(7.5);
    data.rows.forEach((r, rowIdx) => {
      if (curY > 520) {
        doc.addPage();
        curY = 35;
      }
      if (rowIdx % 2 === 1) {
        doc.rect(30, curY - 2, availableWidth, 16).fill('#F8FAFC');
      }
      doc.fillColor('#334155');
      data.columns.forEach((c, i) => {
        let val = r[c] ?? '-';
        if (typeof val === 'number') val = val.toLocaleString('en-IN');
        doc.text(String(val), 34 + i * w, curY + 2, { width: w - 8, ellipsis: true });
      });
      curY += 16;
    });

    return doc.end();
  }

  ok(res, data);
});
export { fmt, RoomType };
