import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import * as M from '../models/index.js';
import { createBooking, checkIn_, checkOut } from '../services/booking.service.js';

await connectDB();

const user = await M.User.findOne({ username: 'admin' }) || await M.User.findOne();
if (!user) {
  console.error('No admin user found. Run npm run seed first.');
  process.exit(1);
}

const rooms = await M.Room.find({ isActive: true });
if (!rooms.length) {
  console.error('No rooms found.');
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

// Helper to create date string for Oct 2026
const d = (day) => {
  const month = day <= 0 ? '09' : day > 31 ? '11' : '10';
  let dateNum = day;
  if (day <= 0) dateNum = 30 + day; // e.g. 0 -> Sep 30, -1 -> Sep 29
  if (day > 31) dateNum = day - 31; // e.g. 32 -> Nov 1, 33 -> Nov 2
  return `2026-${month}-${String(dateNum).padStart(2, '0')}`;
};

// Planned demo booking schedule for October 2026
const DEMO_STAYS = [
  // Room 101 (Standard)
  { room: '101', in: d(1), out: d(5), guestIdx: 0, status: 'checked_out', pay: 8000 },
  { room: '101', in: d(5), out: d(9), guestIdx: 1, status: 'checked_in', pay: 8000 },
  { room: '101', in: d(10), out: d(15), guestIdx: 2, status: 'confirmed', pay: 4000 },
  { room: '101', in: d(18), out: d(23), guestIdx: 3, status: 'confirmed', pay: 5000 },
  { room: '101', in: d(25), out: d(30), guestIdx: 4, status: 'confirmed', pay: 0 },

  // Room 102 (Standard Non-AC)
  { room: '102', in: d(2), out: d(6), guestIdx: 5, status: 'checked_out', pay: 6000 },
  { room: '102', in: d(8), out: d(13), guestIdx: 6, status: 'confirmed', pay: 5000 },
  { room: '102', in: d(15), out: d(20), guestIdx: 7, status: 'confirmed', pay: 3000 },
  { room: '102', in: d(22), out: d(27), guestIdx: 8, status: 'hold', pay: 0 },

  // Room 103 (Standard)
  { room: '103', in: d(6), out: d(11), guestIdx: 9, status: 'checked_in', pay: 10000 },
  { room: '103', in: d(14), out: d(19), guestIdx: 10, status: 'confirmed', pay: 5000 },
  { room: '103', in: d(21), out: d(26), guestIdx: 11, status: 'confirmed', pay: 8000 },

  // Room 104 (Deluxe)
  { room: '104', in: d(0), out: d(4), guestIdx: 12, status: 'checked_out', pay: 12000 },
  { room: '104', in: d(4), out: d(8), guestIdx: 13, status: 'checked_in', pay: 12000 },
  { room: '104', in: d(9), out: d(14), guestIdx: 14, status: 'confirmed', pay: 6000 },
  { room: '104', in: d(16), out: d(22), guestIdx: 15, status: 'confirmed', pay: 10000 },
  { room: '104', in: d(24), out: d(29), guestIdx: 16, status: 'confirmed', pay: 0 },

  // Room 105 (Deluxe)
  { room: '105', in: d(3), out: d(7), guestIdx: 17, status: 'checked_in', pay: 12000 },
  { room: '105', in: d(8), out: d(12), guestIdx: 18, status: 'confirmed', pay: 6000 },
  { room: '105', in: d(15), out: d(21), guestIdx: 19, status: 'confirmed', pay: 15000 },
  { room: '105', in: d(23), out: d(28), guestIdx: 0, status: 'confirmed', pay: 5000 },

  // Room 106 (Deluxe)
  { room: '106', in: d(1), out: d(5), guestIdx: 1, status: 'checked_out', pay: 12000 },
  { room: '106', in: d(6), out: d(10), guestIdx: 2, status: 'checked_in', pay: 12000 },
  { room: '106', in: d(12), out: d(17), guestIdx: 3, status: 'confirmed', pay: 10000 },
  { room: '106', in: d(20), out: d(25), guestIdx: 4, status: 'confirmed', pay: 0 },

  // Room 107 (Deluxe)
  { room: '107', in: d(4), out: d(8), guestIdx: 5, status: 'checked_in', pay: 12000 },
  { room: '107', in: d(10), out: d(15), guestIdx: 6, status: 'confirmed', pay: 8000 },
  { room: '107', in: d(18), out: d(24), guestIdx: 7, status: 'confirmed', pay: 12000 },

  // Room 108 (Executive)
  { room: '108', in: d(2), out: d(6), guestIdx: 8, status: 'checked_out', pay: 16800 },
  { room: '108', in: d(6), out: d(12), guestIdx: 9, status: 'checked_in', pay: 20000 },
  { room: '108', in: d(14), out: d(19), guestIdx: 10, status: 'confirmed', pay: 15000 },
  { room: '108', in: d(21), out: d(27), guestIdx: 11, status: 'confirmed', pay: 10000 },

  // Room 109 (Executive)
  { room: '109', in: d(5), out: d(9), guestIdx: 12, status: 'checked_in', pay: 16800 },
  { room: '109', in: d(11), out: d(16), guestIdx: 13, status: 'confirmed', pay: 12000 },
  { room: '109', in: d(18), out: d(23), guestIdx: 14, status: 'confirmed', pay: 0 },
  { room: '109', in: d(25), out: d(31), guestIdx: 15, status: 'confirmed', pay: 15000 },

  // Room 110 (Suite)
  { room: '110', in: d(1), out: d(4), guestIdx: 16, status: 'checked_out', pay: 19500 },
  { room: '110', in: d(5), out: d(10), guestIdx: 17, status: 'checked_in', pay: 25000 },
  { room: '110', in: d(12), out: d(18), guestIdx: 18, status: 'confirmed', pay: 20000 },
  { room: '110', in: d(20), out: d(26), guestIdx: 19, status: 'confirmed', pay: 30000 },
  { room: '110', in: d(28), out: d(33), guestIdx: 0, status: 'confirmed', pay: 15000 },

  // Floor 2 rooms
  { room: '201', in: d(3), out: d(7), guestIdx: 1, status: 'checked_in', pay: 8000 },
  { room: '201', in: d(9), out: d(14), guestIdx: 2, status: 'confirmed', pay: 10000 },
  { room: '201', in: d(17), out: d(22), guestIdx: 3, status: 'confirmed', pay: 0 },

  { room: '202', in: d(5), out: d(10), guestIdx: 4, status: 'checked_in', pay: 10000 },
  { room: '202', in: d(13), out: d(18), guestIdx: 5, status: 'confirmed', pay: 5000 },
  { room: '202', in: d(21), out: d(26), guestIdx: 6, status: 'confirmed', pay: 8000 },

  { room: '204', in: d(2), out: d(7), guestIdx: 7, status: 'checked_in', pay: 15000 },
  { room: '204', in: d(9), out: d(15), guestIdx: 8, status: 'confirmed', pay: 12000 },
  { room: '204', in: d(18), out: d(24), guestIdx: 9, status: 'confirmed', pay: 0 },

  { room: '205', in: d(6), out: d(11), guestIdx: 10, status: 'checked_in', pay: 15000 },
  { room: '205', in: d(14), out: d(20), guestIdx: 11, status: 'confirmed', pay: 10000 },

  { room: '208', in: d(4), out: d(9), guestIdx: 12, status: 'checked_in', pay: 21000 },
  { room: '208', in: d(12), out: d(18), guestIdx: 13, status: 'confirmed', pay: 15000 },
  { room: '208', in: d(22), out: d(28), guestIdx: 14, status: 'confirmed', pay: 20000 },

  { room: '210', in: d(5), out: d(12), guestIdx: 15, status: 'checked_in', pay: 45000 },
  { room: '210', in: d(15), out: d(21), guestIdx: 16, status: 'confirmed', pay: 30000 },

  // Floor 3, 4, 5 rooms
  { room: '301', in: d(1), out: d(5), guestIdx: 17, status: 'checked_out', pay: 8000 },
  { room: '301', in: d(6), out: d(10), guestIdx: 18, status: 'checked_in', pay: 8000 },
  { room: '301', in: d(15), out: d(20), guestIdx: 19, status: 'confirmed', pay: 5000 },

  { room: '304', in: d(4), out: d(9), guestIdx: 0, status: 'checked_in', pay: 15000 },
  { room: '304', in: d(11), out: d(16), guestIdx: 1, status: 'confirmed', pay: 10000 },

  { room: '401', in: d(5), out: d(10), guestIdx: 2, status: 'checked_in', pay: 10000 },
  { room: '401', in: d(14), out: d(19), guestIdx: 3, status: 'confirmed', pay: 5000 },

  { room: '408', in: d(6), out: d(12), guestIdx: 4, status: 'checked_in', pay: 25000 },
  { room: '408', in: d(16), out: d(22), guestIdx: 5, status: 'confirmed', pay: 15000 },

  { room: '501', in: d(3), out: d(8), guestIdx: 6, status: 'checked_in', pay: 10000 },
  { room: '501', in: d(12), out: d(18), guestIdx: 7, status: 'confirmed', pay: 12000 },
  { room: '501', in: d(20), out: d(26), guestIdx: 8, status: 'confirmed', pay: 8000 },

  { room: '510', in: d(4), out: d(10), guestIdx: 9, status: 'checked_in', pay: 39000 },
  { room: '510', in: d(14), out: d(20), guestIdx: 10, status: 'confirmed', pay: 25000 },
  { room: '510', in: d(24), out: d(30), guestIdx: 11, status: 'confirmed', pay: 20000 },
];

let createdCount = 0;
let errorCount = 0;

for (const s of DEMO_STAYS) {
  const roomDoc = rooms.find((r) => r.roomNumber === s.room);
  if (!roomDoc) {
    continue;
  }

  const guestData = GUESTS_DATA[s.guestIdx % GUESTS_DATA.length];

  try {
    const bookingInput = {
      guest: guestData,
      room: roomDoc._id,
      checkInDate: new Date(s.in),
      checkOutDate: new Date(s.out),
      adults: 2,
      children: 0,
      notes: `Demo stay for ${guestData.name}`,
      source: s.guestIdx % 3 === 0 ? 'walk_in' : s.guestIdx % 3 === 1 ? 'phone' : 'reception',
      hold: s.status === 'hold',
      payment: s.pay > 0 ? { amount: s.pay, method: s.guestIdx % 2 === 0 ? 'upi' : 'card' } : undefined,
    };

    const b = await createBooking(bookingInput, user);

    if (s.status === 'checked_in') {
      try {
        await checkIn_(b._id, user);
      } catch (e) {
        // ignore if already checked in or date check
      }
    } else if (s.status === 'checked_out') {
      try {
        await checkIn_(b._id, user);
        await checkOut(b._id, user, { payment: { amount: Math.max(1000, b.totalAmount - s.pay), method: 'cash' } });
      } catch (e) {
        // ignore checkout conflict
      }
    }

    createdCount++;
  } catch (err) {
    // Room might have overlap or conflict, skip gracefully
    errorCount++;
  }
}

console.log(`✅ Successfully seeded ${createdCount} demo bookings for October 2026 (${errorCount} skipped due to overlaps).`);
await mongoose.disconnect();
process.exit(0);
