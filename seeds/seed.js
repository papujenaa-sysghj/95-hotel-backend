// DEMO DATA ONLY — run `npm run seed`. Wipes the database it points at.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import * as M from '../models/index.js';
import { ALL_KEYS, DEFAULT_ROLES } from '../config/permissions.js';
import { hashPassword } from '../services/auth.service.js';
import { createBooking, checkIn_, checkOut } from '../services/booking.service.js';
import { markAcNotWorking } from '../services/room.service.js';
import { toDay } from '../utils/dates.js';

const PASSWORD = process.env.SEED_PASSWORD || 'Hotel@12345';
const day = 864e5, today = toDay(new Date());
const off = (n) => new Date(+today + n * day);

await connectDB();
if (process.env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
await mongoose.connection.dropDatabase();
await Promise.all(Object.values(M).filter((m) => m.init).map((m) => m.init()));

await M.Permission.insertMany(ALL_KEYS.map((key) => ({ key, group: key.split('.')[0] })));
const roles = Object.fromEntries((await M.Role.insertMany(DEFAULT_ROLES.map((r) => ({ ...r, isSystem: true })))).map((r) => [r.name, r]));
const pw = await hashPassword(PASSWORD);
const users = Object.fromEntries((await M.User.insertMany([
  { name: 'Demo Admin', email: 'admin@hotel.com', username: 'admin', role: roles.Admin._id, password: pw, department: 'Management' },
  { name: 'Demo Manager', email: 'manager@hotel.com', username: 'manager', role: roles.Manager._id, password: pw, department: 'Operations' },
  { name: 'Riya Sharma', email: 'reception@hotel.com', username: 'reception', role: roles.Receptionist._id, password: pw, department: 'Front Desk' },
  { name: 'Demo Cashier', email: 'cashier@hotel.com', username: 'cashier', role: roles.Cashier._id, password: pw, department: 'Accounts' },
  { name: 'Demo Housekeeping', email: 'housekeeping@hotel.com', username: 'housekeeping', role: roles.Housekeeping._id, password: pw, department: 'Housekeeping' },
])).map((u) => [u.username, u]));

await M.Hotel.create({ name: 'Demo Hotel (DEMO DATA)', address: '1 Demo Street, Bhubaneswar, Odisha', phone: '+91 00000 00000', email: 'frontdesk@demo-hotel.test', gstNumber: '00DEMO0000D0Z0', floors: [1, 2, 3, 4, 5], invoice: { prefix: 'INV', footerNote: 'Demo data — not a real invoice.' } });
const amenities = await M.Amenity.insertMany(['WiFi', 'TV', 'Mini Fridge', 'Geyser', 'Balcony', 'Bathtub', 'Work Desk'].map((name) => ({ name })));
const A = (n) => amenities.slice(0, n).map((a) => a._id);
const types = await M.RoomType.insertMany([
  { name: 'Standard', basePrice: 2000, maxOccupancy: 2, amenities: A(3), description: 'Comfortable standard room' },
  { name: 'Deluxe', basePrice: 3000, maxOccupancy: 3, amenities: A(5), description: 'Spacious deluxe room' },
  { name: 'Executive', basePrice: 4200, maxOccupancy: 3, amenities: A(6), description: 'Executive room with work desk' },
  { name: 'Suite', basePrice: 6500, maxOccupancy: 4, amenities: A(7), description: 'Suite with living area' },
]);
const T = Object.fromEntries(types.map((t) => [t.name, t]));
const layout = ['Standard', 'Standard', 'Standard', 'Deluxe', 'Deluxe', 'Deluxe', 'Deluxe', 'Executive', 'Executive', 'Suite']; // 10 per floor
const rooms = await M.Room.insertMany(Array.from({ length: 50 }, (_, i) => { const floor = Math.floor(i / 10) + 1, t = T[layout[i % 10]]; return {
  roomNumber: `${floor}${String((i % 10) + 1).padStart(2, '0')}`, floor, roomType: t._id, basePrice: t.basePrice, isAC: t.name !== 'Standard' || i % 2 === 0,
  adultsCapacity: t.maxOccupancy, childrenCapacity: 1, standardCapacity: 2, bedType: t.name === 'Suite' ? 'King' : i % 2 ? 'Queen' : 'Twin', amenities: t.amenities, description: 'DEMO room' }; }));
const R = (n) => rooms.find((r) => r.roomNumber === n);

const names = [['Rahul Sharma', '9000000001'], ['Priya Das', '9000000002'], ['Vikram Singh', '9000000003'], ['Kavita Nair', '9000000004'], ['Amit Patel', '9000000005'], ['Sneha Rao', '9000000006'], ['Arjun Mehta', '9000000007'], ['Neha Gupta', '9000000008']];
const guest = ([name, phone]) => ({ name, phone, email: `${name.split(' ')[0].toLowerCase()}@demo.test`, idType: 'Aadhaar', idNumber: 'DEMO-0000' });
const u = users.reception;
const mk = (gi, room, a, b, extra = {}) => createBooking({ guest: guest(names[gi]), room: R(room)._id, checkInDate: off(a), checkOutDate: off(b), adults: 2, children: 0, notes: 'DEMO booking', extraBedCharge: 0, otherCharges: 0, discount: 0, source: 'reception', ...extra }, u);

const staying = await Promise.all([mk(0, '101', -1, 2, { payment: { amount: 3000, method: 'upi' } }), mk(1, '104', -2, 1, { payment: { amount: 2000, method: 'cash' } }), mk(2, '107', 0, 3)]);
await checkIn_(staying[0]._id, u); await checkIn_(staying[1]._id, u);
const gone = await mk(3, '201', -5, -3); // past stay -> history + revenue
await checkIn_(gone._id, u);
await checkOut(gone._id, u, { payment: { amount: gone.totalAmount, method: 'card' } });
await Promise.all([mk(4, '105', 1, 4, { payment: { amount: 2000, method: 'upi' } }), mk(5, '110', 2, 6, { source: 'phone' }), mk(6, '204', 0, 2), mk(7, '308', 3, 5, { hold: true, source: 'walk_in' })]);

await M.Room.findByIdAndUpdate(R('103')._id, { maintenanceStatus: 'maintenance' });
await M.Maintenance.create({ room: R('103')._id, issue: 'water_leakage', description: 'DEMO: leak in bathroom', reportedBy: users.housekeeping._id, priority: 'high', blocksRoom: true, blockFrom: off(-1), blockTo: off(4) });
await M.Room.findByIdAndUpdate(R('502')._id, { maintenanceStatus: 'out_of_service' });
await M.Room.updateMany({ roomNumber: { $in: ['301', '302', '303'] } }, { housekeepingStatus: 'dirty' });
const acRoom = rooms.find((r) => r.isAC && r.roomNumber === '405') || R('404');
await markAcNotWorking(acRoom._id, { price: acRoom.basePrice - 500, reason: 'DEMO: AC compressor fault' }, users.manager);
console.log(`Seed complete (DEMO DATA). Login: admin@hotel.com / manager@hotel.com / reception@hotel.com / cashier@hotel.com / housekeeping@hotel.com — password: ${PASSWORD}`);
await mongoose.disconnect();
