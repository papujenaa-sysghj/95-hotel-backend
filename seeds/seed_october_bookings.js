import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import * as M from '../models/index.js';
import { nextSeq } from '../models/index.js';

await connectDB();

const user = await M.User.findOne({ username: 'admin' }) || await M.User.findOne();
const rooms = await M.Room.find({ isActive: true }).populate('roomType');

if (!rooms.length || !user) {
  console.error('Database not initialized with rooms/user. Run seed first.');
  process.exit(1);
}

const GUESTS_DATA = [
  { name: 'Aarav Patel', phone: '9820011001', email: 'aarav.patel@example.com' },
  { name: 'Ananya Sharma', phone: '9820011002', email: 'ananya.s@example.com' },
  { name: 'Rohan Verma', phone: '9820011003', email: 'rohan.v@example.com' },
  { name: 'Meera Iyer', phone: '9820011004', email: 'meera.iyer@example.com' },
  { name: 'Kabir Kapoor', phone: '9820011005', email: 'kabir.k@example.com' },
  { name: 'Ishaan Malhotra', phone: '9820011006', email: 'ishaan.m@example.com' },
  { name: 'Pooja Hegde', phone: '9820011007', email: 'pooja.h@example.com' },
  { name: 'Siddharth Rao', phone: '9820011008', email: 'siddharth.r@example.com' },
  { name: 'Tara Deshmukh', phone: '9820011009', email: 'tara.d@example.com' },
  { name: 'Vikramaditya Bose', phone: '9820011010', email: 'vikram.bose@example.com' },
  { name: 'Sneha Kulkarni', phone: '9820011011', email: 'sneha.k@example.com' },
  { name: 'Aditya Sen', phone: '9820011012', email: 'aditya.sen@example.com' },
  { name: 'Kavita Chawla', phone: '9820011013', email: 'kavita.c@example.com' },
  { name: 'Gaurav Singhania', phone: '9820011014', email: 'gaurav.s@example.com' },
  { name: 'Divya Nair', phone: '9820011015', email: 'divya.n@example.com' },
  { name: 'Nikhil Roy', phone: '9820011016', email: 'nikhil.roy@example.com' },
  { name: 'Shreya Ghosh', phone: '9820011017', email: 'shreya.g@example.com' },
  { name: 'Harsh Vardhan', phone: '9820011018', email: 'harsh.v@example.com' },
  { name: 'Tanvi Joshi', phone: '9820011019', email: 'tanvi.j@example.com' },
  { name: 'Devendra Mishra', phone: '9820011020', email: 'devendra.m@example.com' },
];

// Upsert demo guests
const guestDocs = [];
for (let i = 0; i < GUESTS_DATA.length; i++) {
  const g = GUESTS_DATA[i];
  let doc = await M.Guest.findOne({ phone: g.phone });
  if (!doc) {
    const seq = await nextSeq('guest');
    doc = await M.Guest.create({ ...g, guestId: `GST-${String(seq).padStart(5, '0')}` });
  }
  guestDocs.push(doc);
}

// Helper to create date object (UTC 00:00:00)
const makeDate = (day) => {
  let month = 9; // Oct is index 9 (0-indexed)
  let year = 2026;
  let dateNum = day;
  if (day <= 0) {
    month = 8; // Sep
    dateNum = 30 + day;
  } else if (day > 31) {
    month = 10; // Nov
    dateNum = day - 31;
  }
  return new Date(Date.UTC(year, month, dateNum, 0, 0, 0));
};

// Planned demo booking schedule for October 2026
const STAYS = [
  // Room 101
  { room: '101', in: 1, out: 5, guestIdx: 0, status: 'checked_out', pay: 8000 },
  { room: '101', in: 5, out: 9, guestIdx: 1, status: 'checked_in', pay: 8000 },
  { room: '101', in: 10, out: 15, guestIdx: 2, status: 'confirmed', pay: 4000 },
  { room: '101', in: 18, out: 23, guestIdx: 3, status: 'confirmed', pay: 5000 },
  { room: '101', in: 25, out: 30, guestIdx: 4, status: 'confirmed', pay: 0 },

  // Room 102
  { room: '102', in: 2, out: 6, guestIdx: 5, status: 'checked_out', pay: 6000 },
  { room: '102', in: 8, out: 13, guestIdx: 6, status: 'confirmed', pay: 5000 },
  { room: '102', in: 15, out: 20, guestIdx: 7, status: 'confirmed', pay: 3000 },
  { room: '102', in: 22, out: 27, guestIdx: 8, status: 'hold', pay: 0 },

  // Room 103
  { room: '103', in: 6, out: 11, guestIdx: 9, status: 'checked_in', pay: 10000 },
  { room: '103', in: 14, out: 19, guestIdx: 10, status: 'confirmed', pay: 5000 },
  { room: '103', in: 21, out: 26, guestIdx: 11, status: 'confirmed', pay: 8000 },

  // Room 104
  { room: '104', in: -1, out: 4, guestIdx: 12, status: 'checked_out', pay: 12000 },
  { room: '104', in: 4, out: 8, guestIdx: 13, status: 'checked_in', pay: 12000 },
  { room: '104', in: 9, out: 14, guestIdx: 14, status: 'confirmed', pay: 6000 },
  { room: '104', in: 16, out: 22, guestIdx: 15, status: 'confirmed', pay: 10000 },
  { room: '104', in: 24, out: 29, guestIdx: 16, status: 'confirmed', pay: 0 },

  // Room 105
  { room: '105', in: 3, out: 7, guestIdx: 17, status: 'checked_in', pay: 12000 },
  { room: '105', in: 8, out: 12, guestIdx: 18, status: 'confirmed', pay: 6000 },
  { room: '105', in: 15, out: 21, guestIdx: 19, status: 'confirmed', pay: 15000 },
  { room: '105', in: 23, out: 28, guestIdx: 0, status: 'confirmed', pay: 5000 },

  // Room 106
  { room: '106', in: 1, out: 5, guestIdx: 1, status: 'checked_out', pay: 12000 },
  { room: '106', in: 6, out: 10, guestIdx: 2, status: 'checked_in', pay: 12000 },
  { room: '106', in: 12, out: 17, guestIdx: 3, status: 'confirmed', pay: 10000 },
  { room: '106', in: 20, out: 25, guestIdx: 4, status: 'confirmed', pay: 0 },

  // Room 107
  { room: '107', in: 4, out: 8, guestIdx: 5, status: 'checked_in', pay: 12000 },
  { room: '107', in: 10, out: 15, guestIdx: 6, status: 'confirmed', pay: 8000 },
  { room: '107', in: 18, out: 24, guestIdx: 7, status: 'confirmed', pay: 12000 },

  // Room 108
  { room: '108', in: 2, out: 6, guestIdx: 8, status: 'checked_out', pay: 16800 },
  { room: '108', in: 6, out: 12, guestIdx: 9, status: 'checked_in', pay: 20000 },
  { room: '108', in: 14, out: 19, guestIdx: 10, status: 'confirmed', pay: 15000 },
  { room: '108', in: 21, out: 27, guestIdx: 11, status: 'confirmed', pay: 10000 },

  // Room 109
  { room: '109', in: 5, out: 9, guestIdx: 12, status: 'checked_in', pay: 16800 },
  { room: '109', in: 11, out: 16, guestIdx: 13, status: 'confirmed', pay: 12000 },
  { room: '109', in: 18, out: 23, guestIdx: 14, status: 'confirmed', pay: 0 },
  { room: '109', in: 25, out: 31, guestIdx: 15, status: 'confirmed', pay: 15000 },

  // Room 110
  { room: '110', in: 1, out: 4, guestIdx: 16, status: 'checked_out', pay: 19500 },
  { room: '110', in: 5, out: 10, guestIdx: 17, status: 'checked_in', pay: 25000 },
  { room: '110', in: 12, out: 18, guestIdx: 18, status: 'confirmed', pay: 20000 },
  { room: '110', in: 20, out: 26, guestIdx: 19, status: 'confirmed', pay: 30000 },
  { room: '110', in: 28, out: 33, guestIdx: 0, status: 'confirmed', pay: 15000 },

  // Floor 2
  { room: '201', in: 3, out: 7, guestIdx: 1, status: 'checked_in', pay: 8000 },
  { room: '201', in: 9, out: 14, guestIdx: 2, status: 'confirmed', pay: 10000 },
  { room: '201', in: 17, out: 22, guestIdx: 3, status: 'confirmed', pay: 0 },

  { room: '202', in: 5, out: 10, guestIdx: 4, status: 'checked_in', pay: 10000 },
  { room: '202', in: 13, out: 18, guestIdx: 5, status: 'confirmed', pay: 5000 },
  { room: '202', in: 21, out: 26, guestIdx: 6, status: 'confirmed', pay: 8000 },

  { room: '204', in: 2, out: 7, guestIdx: 7, status: 'checked_in', pay: 15000 },
  { room: '204', in: 9, out: 15, guestIdx: 8, status: 'confirmed', pay: 12000 },
  { room: '204', in: 18, out: 24, guestIdx: 9, status: 'confirmed', pay: 0 },

  { room: '205', in: 6, out: 11, guestIdx: 10, status: 'checked_in', pay: 15000 },
  { room: '205', in: 14, out: 20, guestIdx: 11, status: 'confirmed', pay: 10000 },

  { room: '208', in: 4, out: 9, guestIdx: 12, status: 'checked_in', pay: 21000 },
  { room: '208', in: 12, out: 18, guestIdx: 13, status: 'confirmed', pay: 15000 },
  { room: '208', in: 22, out: 28, guestIdx: 14, status: 'confirmed', pay: 20000 },

  { room: '210', in: 5, out: 12, guestIdx: 15, status: 'checked_in', pay: 45000 },
  { room: '210', in: 15, out: 21, guestIdx: 16, status: 'confirmed', pay: 30000 },

  // Floor 3, 4, 5
  { room: '301', in: 1, out: 5, guestIdx: 17, status: 'checked_out', pay: 8000 },
  { room: '301', in: 6, out: 10, guestIdx: 18, status: 'checked_in', pay: 8000 },
  { room: '301', in: 15, out: 20, guestIdx: 19, status: 'confirmed', pay: 5000 },

  { room: '304', in: 4, out: 9, guestIdx: 0, status: 'checked_in', pay: 15000 },
  { room: '304', in: 11, out: 16, guestIdx: 1, status: 'confirmed', pay: 10000 },

  { room: '401', in: 5, out: 10, guestIdx: 2, status: 'checked_in', pay: 10000 },
  { room: '401', in: 14, out: 19, guestIdx: 3, status: 'confirmed', pay: 5000 },

  { room: '408', in: 6, out: 12, guestIdx: 4, status: 'checked_in', pay: 25000 },
  { room: '408', in: 16, out: 22, guestIdx: 5, status: 'confirmed', pay: 15000 },

  { room: '501', in: 3, out: 8, guestIdx: 6, status: 'checked_in', pay: 10000 },
  { room: '501', in: 12, out: 18, guestIdx: 7, status: 'confirmed', pay: 12000 },
  { room: '501', in: 20, out: 26, guestIdx: 8, status: 'confirmed', pay: 8000 },

  { room: '510', in: 4, out: 10, guestIdx: 9, status: 'checked_in', pay: 39000 },
  { room: '510', in: 14, out: 20, guestIdx: 10, status: 'confirmed', pay: 25000 },
  { room: '510', in: 24, out: 30, guestIdx: 11, status: 'confirmed', pay: 20000 },
];

let insertedCount = 0;

for (const s of STAYS) {
  const room = rooms.find((r) => r.roomNumber === s.room);
  if (!room) continue;

  const inDate = makeDate(s.in);
  const outDate = makeDate(s.out);
  const nights = Math.max(1, Math.round((outDate - inDate) / 86400000));
  const rate = room.basePrice || 2500;
  const subtotal = rate * nights;
  const tax = Math.round(subtotal * 0.12);
  const total = subtotal + tax;
  const paid = Math.min(s.pay, total);
  const balance = Math.max(0, total - paid);
  const guest = guestDocs[s.guestIdx % guestDocs.length];

  // Check if overlap exists in RoomNight or Booking
  const overlap = await M.Booking.findOne({
    room: room._id,
    bookingStatus: { $in: ['hold', 'confirmed', 'checked_in', 'checked_out'] },
    checkInDate: { $lt: outDate },
    checkOutDate: { $gt: inDate },
  });

  if (overlap) {
    continue;
  }

  const year = 2026;
  const seq = await nextSeq(`booking-${year}`);
  const bookingNumber = `BK-${year}-${String(seq).padStart(6, '0')}`;

  const booking = await M.Booking.create({
    bookingNumber,
    guest: guest._id,
    room: room._id,
    roomType: room.roomType?._id || room.roomType,
    checkInDate: inDate,
    checkOutDate: outDate,
    adults: 2,
    children: 0,
    nights,
    roomRate: rate,
    extraBedCharge: 0,
    otherCharges: 0,
    subtotal,
    discount: 0,
    taxPercent: 12,
    tax,
    totalAmount: total,
    paidAmount: paid,
    balanceAmount: balance,
    bookedAsAC: room.isAC ?? true,
    bookingStatus: s.status,
    paymentStatus: paid >= total ? 'paid' : paid > 0 ? 'partial' : 'pending',
    source: 'reception',
    notes: `Demo stay for ${guest.name}`,
    createdBy: user._id,
    updatedBy: user._id,
    actualCheckIn: s.status === 'checked_in' || s.status === 'checked_out' ? inDate : undefined,
    actualCheckOut: s.status === 'checked_out' ? outDate : undefined,
    roomHistory: [{ room: room._id, from: inDate, changedBy: user._id, reason: 'Demo booking' }],
  });

  // Create RoomNight records if active booking
  if (['hold', 'confirmed', 'checked_in'].includes(s.status)) {
    const nightDocs = [];
    for (let cur = new Date(inDate); cur < outDate; cur = new Date(cur.getTime() + 86400000)) {
      nightDocs.push({ room: room._id, night: new Date(cur), booking: booking._id });
    }
    if (nightDocs.length) {
      try {
        await M.RoomNight.insertMany(nightDocs, { ordered: false });
      } catch (e) {
        // ignore duplicate nights
      }
    }
  }

  insertedCount++;
}

// Update room occupancy status
const todayDate = new Date(Date.UTC(2026, 9, 6)); // Oct 6, 2026
for (const room of rooms) {
  const activeStay = await M.Booking.findOne({
    room: room._id,
    bookingStatus: 'checked_in',
    checkInDate: { $lte: todayDate },
    checkOutDate: { $gt: todayDate },
  });
  await M.Room.findByIdAndUpdate(room._id, {
    occupancyStatus: activeStay ? 'occupied' : 'vacant',
  });
}

console.log(`✅ Successfully seeded ${insertedCount} demo bookings for October 2026!`);
await mongoose.disconnect();
process.exit(0);
