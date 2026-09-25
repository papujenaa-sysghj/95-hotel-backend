// Runs against a REAL MongoDB. Set MONGO_URI_TEST (e.g. mongodb://127.0.0.1:27017/hms_test). Skipped otherwise.
import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

const URI = process.env.MONGO_URI_TEST;
const skip = !URI && 'MONGO_URI_TEST not set';
const day = 864e5;

test('booking engine (integration)', { skip }, async (t) => {
  process.env.JWT_SECRET ||= 't'; process.env.JWT_REFRESH_SECRET ||= 't'; process.env.MONGO_URI = URI;
  const M = await import('../models/index.js'); const B = await import('../services/booking.service.js'); const R = await import('../services/room.service.js'); const { toDay } = await import('../utils/dates.js');
  await mongoose.connect(URI); await mongoose.connection.dropDatabase(); await Promise.all(Object.values(M).filter((m) => m.init).map((m) => m.init()));
  const role = await M.Role.create({ name: 'Admin', permissions: ['*'] }); const user = await M.User.create({ name: 'T', email: 't@t.t', password: 'x', role: role._id });
  const type = await M.RoomType.create({ name: 'Deluxe', basePrice: 3000 });
  const [r1, r2] = await M.Room.insertMany([{ roomNumber: '101', floor: 1, roomType: type._id, basePrice: 3000 }, { roomNumber: '204', floor: 2, roomType: type._id, basePrice: 3000 }]);
  const base = toDay(new Date()); const at = (n) => new Date(+base + n * day);
  const book = (room, a, b, x = {}) => B.createBooking({ guest: { name: 'Guest One', phone: '9999999999' }, room: room._id, checkInDate: at(a), checkOutDate: at(b), adults: 2, children: 0, extraBedCharge: 0, otherCharges: 0, discount: 0, source: 'reception', ...x }, user);

  await t.test('overlap rejected, back-to-back allowed', async () => {
    await book(r1, 20, 23);
    await assert.rejects(book(r1, 22, 25), /already booked/);
    await book(r1, 23, 26);
  });
  await t.test('concurrent identical bookings: exactly one wins', async () => {
    const res = await Promise.allSettled([book(r2, 40, 43), book(r2, 40, 43), book(r2, 41, 44)]);
    assert.equal(res.filter((x) => x.status === 'fulfilled').length, 1);
  });
  await t.test('cancel frees the room', async () => {
    const b = await book(r2, 60, 63); await assert.rejects(book(r2, 61, 62)); await B.cancelBooking(b._id, 'guest request', user); await book(r2, 61, 62);
  });
  await t.test('extend checks future availability; success recalculates', async () => {
    const b = await book(r1, 30, 32); await book(r1, 33, 35);
    await assert.rejects(B.modifyStay(b._id, { checkOutDate: at(34) }, user), /already booked/);
    const ok = await B.modifyStay(b._id, { checkOutDate: at(33) }, user); assert.equal(ok.booking.nights, 3); assert.equal(ok.booking.totalAmount, 9000); // 3 nights x 3000, no hotel tax configured in test
  });
  await t.test('room transfer requires free target', async () => {
    const b = await book(r1, 70, 72); await book(r2, 71, 73);
    await assert.rejects(B.modifyStay(b._id, { room: r2._id }, user), /already booked/);
    await B.modifyStay(b._id, { room: r1._id, checkOutDate: at(73) }, user);
  });
  await t.test('maintenance block hides the room', async () => {
    const { findAvailableRooms } = await import('../services/availability.service.js');
    await M.Maintenance.create({ room: r1._id, issue: 'plumbing', blocksRoom: true, blockFrom: at(90), blockTo: at(95), status: 'open' });
    const rooms = await findAvailableRooms(at(91), at(93)); assert.ok(!rooms.some((r) => r.roomNumber === '101'));
  });
  await t.test('checkout marks room dirty & vacant; dirty room blocks check-in', async () => {
    const b = await book(r2, 0, 2); await M.Room.findByIdAndUpdate(r2._id, { housekeepingStatus: 'dirty' });
    await assert.rejects(B.checkIn_(b._id, user), /not ready/);
    await M.Room.findByIdAndUpdate(r2._id, { housekeepingStatus: 'clean' }); await B.checkIn_(b._id, user);
    await B.addPayment(b._id, { amount: b.totalAmount, method: 'cash' }, user); await B.checkOut(b._id, user);
    const room = await M.Room.findById(r2._id); assert.equal(room.housekeepingStatus, 'dirty'); assert.equal(room.occupancyStatus, 'vacant');
  });
  await t.test('overpayment rejected; AC toggle leaves bookings alone', async () => {
    const b = await book(r1, 100, 101); await assert.rejects(B.addPayment(b._id, { amount: b.totalAmount + 1, method: 'cash' }, user), /exceeds/);
    await R.markAcNotWorking(r1._id, { price: 2500 }, user); const after = await M.Booking.findById(b._id); assert.equal(after.roomRate, 3000); assert.equal(after.bookedAsAC, true);
    await R.markAcRepaired(r1._id, user); assert.equal((await M.Room.findById(r1._id)).tempConfig.active, false);
  });
  await mongoose.disconnect();
});
