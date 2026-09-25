import test from 'node:test';
import assert from 'node:assert/strict';
import { rangesOverlap, nightsBetween, toDay } from '../utils/dates.js';
import { calcPricing, paymentStatusFor } from '../utils/pricing.js';
import { overlapQuery, validateRange, listNights, sellableConfig } from '../services/availability.service.js';
import { hasPermission } from '../middleware/permission.middleware.js';
import { DEFAULT_ROLES } from '../config/permissions.js';

const d = (s) => new Date(`2026-09-${s}T00:00:00Z`);

test('overlap: 20→23 vs 22→25 must clash', () => assert.equal(rangesOverlap(d(20), d(23), d(22), d(25)), true));
test('overlap: 20→23 vs 23→26 is allowed (check-out day is free)', () => assert.equal(rangesOverlap(d(20), d(23), d(23), d(26)), false));
test('overlap: containment and back-to-back before', () => {
  assert.equal(rangesOverlap(d(20), d(25), d(21), d(22)), true);
  assert.equal(rangesOverlap(d(20), d(23), d(17), d(20)), false);
});
test('nights: 20→23 = 3 and occupies nights 20,21,22 only', () => {
  assert.equal(nightsBetween(d(20), d(23)), 3);
  assert.deepEqual(listNights(d(20), d(23)).map((x) => x.getUTCDate()), [20, 21, 22]);
});
test('time-of-day never changes night count', () => assert.equal(nightsBetween('2026-09-20T18:30:00Z', '2026-09-23T02:00:00Z'), 3));
test('checkout must be after checkin', () => {
  assert.throws(() => validateRange(d(20), d(20)), /after check-in/);
  assert.throws(() => validateRange(d(23), d(20)), /after check-in/);
  assert.equal(validateRange(d(20), d(23)).nights, 3);
});
test('Mongo overlap query is half-open', () => {
  const q = overlapQuery(d(20), d(23));
  assert.deepEqual(q, { checkInDate: { $lt: d(23) }, checkOutDate: { $gt: d(20) } });
});
test('pricing: subtotal, discount, tax, total', () => {
  const p = calcPricing({ roomRate: 3000, nights: 3, extraBedCharge: 500, discount: 500, taxPercent: 12 });
  assert.deepEqual(p, { subtotal: 9500, tax: 1080, totalAmount: 10080 });
});
test('payment status transitions', () => {
  assert.equal(paymentStatusFor(0, 1000), 'pending'); assert.equal(paymentStatusFor(400, 1000), 'partial'); assert.equal(paymentStatusFor(1000, 1000), 'paid');
});
test('temporary Non-AC override does not touch the permanent config', () => {
  const room = { isAC: true, basePrice: 3000, tempConfig: { active: true, isAC: false, price: 2500, reason: 'AC Not Working' } };
  assert.deepEqual(sellableConfig(room), { sellableIsAC: false, sellablePrice: 2500, isTemporary: true, tempReason: 'AC Not Working' });
  assert.equal(room.isAC, true); assert.equal(room.basePrice, 3000);
  assert.equal(sellableConfig({ ...room, tempConfig: { active: false } }).sellablePrice, 3000); // repaired → back to AC price
});
test('RBAC: receptionist lacks admin-only permissions; admin has all', () => {
  const perms = (name) => ({ permissions: new Set(DEFAULT_ROLES.find((r) => r.name === name).permissions) });
  const rec = perms('Receptionist'), admin = perms('Admin');
  for (const k of ['bookings.cancel', 'bookings.edit_rate', 'payments.refund', 'rooms.configure', 'users.create', 'settings.manage', 'roles.manage']) assert.equal(hasPermission(rec, k), false, k);
  for (const k of ['bookings.create', 'checkin.perform', 'calendar.edit']) assert.equal(hasPermission(rec, k), true, k);
  assert.equal(hasPermission(admin, 'anything.at.all'), true);
});
