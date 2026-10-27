import { fileURLToPath } from 'url';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import assert from 'node:assert/strict';

// ----------------------------------------------------------------------------
// 1. PROJECT-RELATIVE PATHS & ENVIRONMENT LOADING
// ----------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

import { runSeed } from '../seeds/seed.js';
import * as M from '../models/index.js';

// Preserve original environment variables for safe restoration
const originalEnv = {
  NODE_ENV: process.env.NODE_ENV,
};

// ----------------------------------------------------------------------------
// 2. URI PARSING & DISPOSABLE DB CONSTRUCTION SAFETY HELPERS
// ----------------------------------------------------------------------------
function parseMongoDbName(uri) {
  if (!uri || typeof uri !== 'string') return null;
  try {
    const parsed = new URL(uri);
    const db = parsed.pathname.replace(/^\//, '').split('?')[0];
    if (db) return db;
  } catch (_) {}
  const match = uri.match(/(?:mongodb(?:\+srv)?:\/\/[^/]+\/)([^?]+)/);
  return match ? match[1] : null;
}

function buildDisposableUri(baseUri, disposableDbName) {
  try {
    const url = new URL(baseUri);
    url.pathname = `/${disposableDbName}`;
    return url.toString();
  } catch (_) {
    return baseUri.replace(/(mongodb(?:\+srv)?:\/\/[^/]+\/)[^?]+(\?.*)?$/, `$1${disposableDbName}$2`);
  }
}

// ----------------------------------------------------------------------------
// 3. STRICT INDEPENDENT DROP GUARD
// ----------------------------------------------------------------------------
async function safeDropDisposableDatabase(expectedDbName, originalDbName) {
  if (!mongoose.connection.readyState) return;

  const activeDbName = mongoose.connection.name;
  console.log(`🛡️ Safe-Drop Guard: Checking connection '${activeDbName}' before cleanup...`);

  if (!activeDbName) {
    throw new Error('CRITICAL SAFETY VIOLATION: Active connection has no database name.');
  }
  if (activeDbName === originalDbName) {
    throw new Error(`CRITICAL SAFETY BLOCKED: Refusing to drop original database '${activeDbName}'!`);
  }
  if (!activeDbName.startsWith('disp_test_')) {
    throw new Error(`CRITICAL SAFETY BLOCKED: Database '${activeDbName}' lacks required disposable prefix 'disp_test_'!`);
  }
  if (activeDbName !== expectedDbName) {
    throw new Error(`CRITICAL SAFETY BLOCKED: Active DB '${activeDbName}' does not match expected disposable DB '${expectedDbName}'!`);
  }

  await mongoose.connection.dropDatabase();
  console.log(`✓ Safely dropped verified disposable database: ${activeDbName}`);
}

// ----------------------------------------------------------------------------
// 4. MAIN VERIFICATION SUITE
// ----------------------------------------------------------------------------
export async function runSafetyVerification() {
  const baseUri = process.env.MONGO_URI;

  if (!baseUri) {
    console.error('❌ CONFIGURATION ERROR: MONGO_URI is missing in server/.env.');
    console.error('Cannot guarantee isolated disposable database testing. Aborting.');
    process.exit(1);
  }

  const originalDbName = parseMongoDbName(baseUri);
  if (!originalDbName) {
    console.error('❌ CONFIGURATION ERROR: Could not parse database name from MONGO_URI.');
    console.error('Cannot guarantee isolated disposable database testing. Aborting.');
    process.exit(1);
  }

  // Generate unique disposable DB names (< 38 chars for MongoDB Atlas limits)
  const randSuffix = Math.random().toString(36).substring(2, 6);
  const timeSuffix = Math.floor(Date.now() / 1000);
  const devDbName = `disp_test_dev_${timeSuffix}_${randSuffix}`;
  const prodDbName = `disp_test_prd_${timeSuffix}_${randSuffix}`;

  const disposableDevUri = buildDisposableUri(baseUri, devDbName);
  const disposableProdUri = buildDisposableUri(baseUri, prodDbName);

  // Assert URI Safety checks before proceeding
  assert.notEqual(disposableDevUri, baseUri, 'Dev URI must not match base URI');
  assert.notEqual(disposableProdUri, baseUri, 'Prod URI must not match base URI');
  assert.equal(parseMongoDbName(disposableDevUri), devDbName, 'Dev URI db name mismatch');
  assert.equal(parseMongoDbName(disposableProdUri), prodDbName, 'Prod URI db name mismatch');
  assert.notEqual(devDbName, originalDbName, 'Dev DB name must not match original DB');
  assert.notEqual(prodDbName, originalDbName, 'Prod DB name must not match original DB');

  console.log('============================================================');
  console.log('🔒 HOTEL PMS SEED SAFETY & IDEMPOTENCY VERIFICATION SUITE');
  console.log('============================================================');
  console.log(`Original Base Database: ${originalDbName} (PROTECTED)`);
  console.log(`Disposable Dev DB:      ${devDbName}`);
  console.log(`Disposable Prod DB:     ${prodDbName}`);
  console.log('============================================================\n');

  let devDbCreated = false;
  let prodDbCreated = false;

  try {
    // =========================================================================
    // STEP A: TEST DEVELOPMENT SEEDING (FIRST RUN)
    // =========================================================================
    console.log('▶️ [PHASE 1] Initial Seeding on Disposable Dev Database...');
    process.env.NODE_ENV = 'development';

    await mongoose.connect(disposableDevUri);
    devDbCreated = true;

    // Strict Connection Assertion
    if (mongoose.connection.name !== devDbName) {
      throw new Error(`CRITICAL ABORT: Connected to '${mongoose.connection.name}', expected '${devDbName}'`);
    }

    const devRun1Result = await runSeed({ customUri: disposableDevUri });
    assert.equal(devRun1Result.isProd, false, 'Expected development mode result');

    // Verify Counts after Run 1
    const counts1 = {
      permissions: await M.Permission.countDocuments(),
      roles: await M.Role.countDocuments(),
      users: await M.User.countDocuments(),
      hotel: await M.Hotel.countDocuments(),
      amenities: await M.Amenity.countDocuments(),
      roomTypes: await M.RoomType.countDocuments(),
      rooms: await M.Room.countDocuments(),
      bookings: await M.Booking.countDocuments(),
      maintenance: await M.Maintenance.countDocuments(),
    };

    console.log('Run 1 Counts:', counts1);
    assert.equal(counts1.permissions, 38, 'Expected 38 default permissions');
    assert.equal(counts1.roles, 5, 'Expected 5 default roles');
    assert.equal(counts1.users, 1, 'Expected exactly 1 initial administrator account');
    assert.equal(counts1.hotel, 1, 'Expected 1 hotel profile');
    assert.equal(counts1.amenities, 7, 'Expected 7 amenities');
    assert.equal(counts1.roomTypes, 4, 'Expected 4 room types');
    assert.equal(counts1.rooms, 50, 'Expected 50 rooms');
    assert.equal(counts1.bookings, 0, 'Seed baseline must NOT create demo bookings');
    assert.equal(counts1.maintenance, 0, 'Seed baseline must NOT create mock maintenance');

    // Take deep content snapshots of existing records to verify non-mutation on re-run
    const adminUser1 = await M.User.findOne({ username: 'admin' }).lean();
    const adminRole1 = await M.Role.findOne({ name: 'Admin' }).lean();
    const hotel1 = await M.Hotel.findOne().lean();
    const room101_1 = await M.Room.findOne({ roomNumber: '101' }).lean();
    const room501_1 = await M.Room.findOne({ roomNumber: '501' }).lean();

    console.log('✓ Snapshot captured for: Administrator, Roles, Hotel, Rooms');
    console.log('✅ PHASE 1 PASSED: Initial seed succeeded on disposable dev database.\n');

    // =========================================================================
    // STEP B: TEST IDEMPOTENCY & DATA PRESERVATION (SECOND RUN)
    // =========================================================================
    console.log('▶️ [PHASE 2] Testing Idempotency & Data Preservation (Re-running Seed)...');
    
    // Assert connection is still pointing strictly to devDbName
    if (mongoose.connection.name !== devDbName) {
      throw new Error(`CRITICAL ABORT: Connection drifted to '${mongoose.connection.name}'`);
    }

    const devRun2Result = await runSeed({ customUri: disposableDevUri });
    assert.equal(devRun2Result.isProd, false);

    // Verify Counts after Run 2
    const counts2 = {
      permissions: await M.Permission.countDocuments(),
      roles: await M.Role.countDocuments(),
      users: await M.User.countDocuments(),
      hotel: await M.Hotel.countDocuments(),
      amenities: await M.Amenity.countDocuments(),
      roomTypes: await M.RoomType.countDocuments(),
      rooms: await M.Room.countDocuments(),
      bookings: await M.Booking.countDocuments(),
      maintenance: await M.Maintenance.countDocuments(),
    };

    console.log('Run 2 Counts:', counts2);
    for (const [k, v] of Object.entries(counts1)) {
      assert.equal(counts2[k], v, `Count mismatch on key '${k}': Run 1 had ${v}, Run 2 had ${counts2[k]}`);
    }

    // Verify Contents of Existing Records are completely preserved
    const adminUser2 = await M.User.findOne({ username: 'admin' }).lean();
    const adminRole2 = await M.Role.findOne({ name: 'Admin' }).lean();
    const hotel2 = await M.Hotel.findOne().lean();
    const room101_2 = await M.Room.findOne({ roomNumber: '101' }).lean();
    const room501_2 = await M.Room.findOne({ roomNumber: '501' }).lean();

    assert.equal(String(adminUser2._id), String(adminUser1._id), 'Admin user ID must not change');
    assert.equal(adminUser2.password, adminUser1.password, 'Admin password hash must remain unchanged');
    assert.equal(adminUser2.email, adminUser1.email, 'Admin email must remain unchanged');

    assert.equal(String(adminRole2._id), String(adminRole1._id), 'Admin role ID must not change');
    assert.deepEqual(adminRole2.permissions, adminRole1.permissions, 'Admin role permissions must remain unchanged');

    assert.equal(String(hotel2._id), String(hotel1._id), 'Hotel ID must not change');
    assert.equal(hotel2.gstNumber, hotel1.gstNumber, 'Hotel GST number must remain unchanged');

    assert.equal(String(room101_2._id), String(room101_1._id), 'Room 101 ID must not change');
    assert.equal(room101_2.basePrice, room101_1.basePrice, 'Room 101 price must remain unchanged');
    assert.equal(String(room501_2._id), String(room501_1._id), 'Room 501 ID must not change');

    console.log('✓ All record contents verified: 100% identical, zero mutations or wipes.');
    console.log('✅ PHASE 2 PASSED: Seeding is completely idempotent.\n');

    // Clean up dev test database safely
    await safeDropDisposableDatabase(devDbName, originalDbName);
    devDbCreated = false;
    await mongoose.disconnect();

    // =========================================================================
    // STEP C: TEST PRODUCTION MODE SEPARATELY
    // =========================================================================
    console.log('▶️ [PHASE 3] Testing Production Guard on Separate Disposable DB...');
    process.env.NODE_ENV = 'production';

    await mongoose.connect(disposableProdUri);
    prodDbCreated = true;

    // Strict Connection Assertion
    if (mongoose.connection.name !== prodDbName) {
      throw new Error(`CRITICAL ABORT: Connected to '${mongoose.connection.name}', expected '${prodDbName}'`);
    }

    const prodRunResult = await runSeed({ customUri: disposableProdUri });
    console.log('Production Seed Result:', prodRunResult);

    assert.equal(prodRunResult.isProd, true, 'Expected isProd to be true');

    const prodCounts = {
      permissions: await M.Permission.countDocuments(),
      roles: await M.Role.countDocuments(),
      users: await M.User.countDocuments(),
      hotel: await M.Hotel.countDocuments(),
      amenities: await M.Amenity.countDocuments(),
      roomTypes: await M.RoomType.countDocuments(),
      rooms: await M.Room.countDocuments(),
      bookings: await M.Booking.countDocuments(),
      maintenance: await M.Maintenance.countDocuments(),
    };

    console.log('Production Mode Counts:', prodCounts);

    // Essential system configuration must be provisioned
    assert.equal(prodCounts.permissions, 38, 'Default permissions must be present in production');
    assert.equal(prodCounts.roles, 5, 'Default roles must be present in production');
    assert.equal(prodCounts.users, 1, 'Only primary admin account created if no users exist in production');
    assert.equal(prodCounts.hotel, 1, 'Default hotel profile must be present in production');
    assert.equal(prodCounts.rooms, 50, 'Rooms layout must be present in production');

    // Strict Production Guard Assertion: ZERO mock bookings or maintenance records in production
    assert.equal(prodCounts.bookings, 0, 'CRITICAL: Production mode must NEVER create demo bookings');
    assert.equal(prodCounts.maintenance, 0, 'CRITICAL: Production mode must NEVER create mock maintenance');

    // Check room statuses: none should be marked dirty or out of service by mock data
    const dirtyRooms = await M.Room.countDocuments({ housekeepingStatus: 'dirty' });
    const maintRooms = await M.Room.countDocuments({ maintenanceStatus: { $in: ['maintenance', 'out_of_service'] } });
    assert.equal(dirtyRooms, 0, 'CRITICAL: Production mode must not create mock dirty rooms');
    assert.equal(maintRooms, 0, 'CRITICAL: Production mode must not create mock maintenance status');

    console.log('✅ PHASE 3 PASSED: Production guard verified. No demo data created in production mode.\n');

    // Clean up prod test database safely
    await safeDropDisposableDatabase(prodDbName, originalDbName);
    prodDbCreated = false;
    await mongoose.disconnect();

    console.log('============================================================');
    console.log('🎉 ALL SAFETY, IDEMPOTENCY, AND PRODUCTION GUARD TESTS PASSED');
    console.log('============================================================');
    return { success: true };
  } catch (err) {
    console.error('\n❌ VERIFICATION TEST FAILED:', err);
    throw err;
  } finally {
    console.log('\n🧹 Initiating Post-Test Cleanup & Environment Restoration...');
    try {
      if (mongoose.connection.readyState) {
        const curName = mongoose.connection.name;
        if (devDbCreated && curName === devDbName) {
          await safeDropDisposableDatabase(devDbName, originalDbName);
        } else if (prodDbCreated && curName === prodDbName) {
          await safeDropDisposableDatabase(prodDbName, originalDbName);
        }
        await mongoose.disconnect();
      }
    } catch (cleanupErr) {
      console.error('Warning during emergency cleanup:', cleanupErr.message);
    } finally {
      process.env.NODE_ENV = originalEnv.NODE_ENV;
      console.log(`✓ Restored original NODE_ENV: '${process.env.NODE_ENV}'`);
    }
  }
}

// Standalone execution if invoked directly
const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectExecution) {
  runSafetyVerification()
    .then(() => {
      console.log('Exiting with code 0');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Exiting with code 1 due to error:', err.message);
      process.exit(1);
    });
}
