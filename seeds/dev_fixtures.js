// Optional development fixtures script.
// Strictly disallowed in production (NODE_ENV=production).
// Populates mock bookings and maintenance for local UI development.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import * as M from '../models/index.js';
import { createBooking, checkIn_, checkOut } from '../services/booking.service.js';
import { markAcNotWorking } from '../services/room.service.js';
import { toDay } from '../utils/dates.js';

export async function seedDevFixtures({ customUri = null } = {}) {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('SECURITY VIOLATION: Development fixtures cannot be run in production.');
  }

  if (customUri) {
    const targetDbMatch = customUri.match(/(?:mongodb(?:\+srv)?:\/\/[^/]+\/)([^?]+)/);
    const targetDbName = targetDbMatch ? targetDbMatch[1] : null;
    if (mongoose.connection.readyState !== 0) {
      if (!targetDbName || mongoose.connection.name !== targetDbName) {
        await mongoose.disconnect();
        await mongoose.connect(customUri);
      }
    } else {
      await mongoose.connect(customUri);
    }
  } else if (!mongoose.connection.readyState) {
    await connectDB();
  }

  const existingBookingsCount = await M.Booking.countDocuments();
  if (existingBookingsCount > 0) {
    console.log(`ℹ️ Existing bookings found (${existingBookingsCount}). Skipping dev fixtures to preserve data.`);
    return { success: true, skipped: true };
  }

  console.log('📝 Seeding development sandbox fixtures...');
  const allRooms = await M.Room.find({ isActive: true });
  const R = (n) => allRooms.find((r) => r.roomNumber === n);

  const day = 864e5, today = toDay(new Date());
  const off = (n) => new Date(+today + n * day);

  const names = [
    ['Rahul Sharma', '9000000001'],
    ['Priya Das', '9000000002'],
    ['Vikram Singh', '9000000003'],
    ['Kavita Nair', '9000000004'],
    ['Amit Patel', '9000000005'],
    ['Sneha Rao', '9000000006'],
    ['Arjun Mehta', '9000000007'],
    ['Neha Gupta', '9000000008'],
  ];
  const guest = ([name, phone]) => ({
    name,
    phone,
    email: `${name.split(' ')[0].toLowerCase()}@sandbox.local`,
    idType: 'Aadhaar',
    idNumber: 'SANDBOX-0000',
  });
  const u = (await M.User.findOne({ role: (await M.Role.findOne({ name: 'Receptionist' }))?._id })) || (await M.User.findOne());

  const mk = (gi, roomNum, a, b, extra = {}) => {
    const room = R(roomNum);
    if (!room) return null;
    return createBooking(
      {
        guest: guest(names[gi]),
        room: room._id,
        checkInDate: off(a),
        checkOutDate: off(b),
        adults: 2,
        children: 0,
        notes: 'Dev Sandbox stay',
        extraBedCharge: 0,
        otherCharges: 0,
        discount: 0,
        source: 'reception',
        ...extra,
      },
      u
    );
  };

  const staying = (await Promise.all([
    mk(0, '101', -1, 2, { payment: { amount: 3000, method: 'upi' } }),
    mk(1, '104', -2, 1, { payment: { amount: 2000, method: 'cash' } }),
    mk(2, '107', 0, 3),
  ])).filter(Boolean);

  if (staying[0]) await checkIn_(staying[0]._id, u);
  if (staying[1]) await checkIn_(staying[1]._id, u);

  const gone = await mk(3, '201', -5, -3);
  if (gone) {
    await checkIn_(gone._id, u);
    await checkOut(gone._id, u, { payment: { amount: gone.totalAmount, method: 'card' } });
  }

  await Promise.all([
    mk(4, '105', 1, 4, { payment: { amount: 2000, method: 'upi' } }),
    mk(5, '110', 2, 6, { source: 'phone' }),
    mk(6, '204', 0, 2),
    mk(7, '308', 3, 5, { hold: true, source: 'walk_in' }),
  ]);

  const r103 = R('103');
  if (r103) {
    await M.Room.findByIdAndUpdate(r103._id, { maintenanceStatus: 'maintenance' });
    await M.Maintenance.create({
      room: r103._id,
      issue: 'water_leakage',
      description: 'Dev fixture: bathroom plumbing check',
      reportedBy: u._id,
      priority: 'high',
      blocksRoom: true,
      blockFrom: off(-1),
      blockTo: off(4),
    });
  }

  const r502 = R('502');
  if (r502) await M.Room.findByIdAndUpdate(r502._id, { maintenanceStatus: 'out_of_service' });
  await M.Room.updateMany({ roomNumber: { $in: ['301', '302', '303'] } }, { housekeepingStatus: 'dirty' });

  const acRoom = allRooms.find((r) => r.isAC && r.roomNumber === '405') || R('404');
  if (acRoom) {
    await markAcNotWorking(acRoom._id, { price: acRoom.basePrice - 500, reason: 'Dev fixture: AC service pending' }, u);
  }

  console.log(`✓ Development sandbox fixtures initialized.`);
  return { success: true };
}

const isDirect = process.argv[1] && process.argv[1].endsWith('dev_fixtures.js');
if (isDirect) {
  seedDevFixtures()
    .then(async () => {
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (e) => {
      console.error(e);
      await mongoose.disconnect();
      process.exit(1);
    });
}
