// Production-safe, idempotent seeding script.
// Does NOT drop or wipe the database.
// Creates only missing default records and preserves all existing data.
import 'dotenv/config';
import mongoose from 'mongoose';
import { connectDB } from '../config/db.js';
import * as M from '../models/index.js';
import { ALL_KEYS, DEFAULT_ROLES } from '../config/permissions.js';
import { hashPassword } from '../services/auth.service.js';

export async function runSeed({ customUri = null } = {}) {
  const isProd = process.env.NODE_ENV === 'production';

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

    if (targetDbName && mongoose.connection.name !== targetDbName) {
      throw new Error(`CRITICAL SAFETY ERROR: Connected DB '${mongoose.connection.name}' does not match customUri target '${targetDbName}'`);
    }
  } else if (!mongoose.connection.readyState) {
    await connectDB();
  }

  console.log(`🌱 Seeding database '${mongoose.connection.name}' (${isProd ? 'PRODUCTION GUARD ACTIVE' : 'DEVELOPMENT MODE'})...`);

  // 1. Idempotent Permissions: create only missing permission keys
  const existingPermKeys = new Set((await M.Permission.find().select('key')).map((p) => p.key));
  const missingPerms = ALL_KEYS.filter((key) => !existingPermKeys.has(key)).map((key) => ({
    key,
    group: key.split('.')[0],
  }));
  if (missingPerms.length > 0) {
    await M.Permission.insertMany(missingPerms);
    console.log(`✓ Inserted ${missingPerms.length} missing permissions`);
  } else {
    console.log(`✓ All ${ALL_KEYS.length} permissions exist`);
  }

  // 2. Idempotent Roles: create only missing default system roles
  const roles = {};
  for (const r of DEFAULT_ROLES) {
    let role = await M.Role.findOne({ name: r.name });
    if (!role) {
      role = await M.Role.create({ ...r, isSystem: true });
      console.log(`✓ Created missing role: ${r.name}`);
    }
    roles[r.name] = role;
  }

  // 3. Idempotent Users: Initialize initial administrator account only if NO users exist
  const existingUsersCount = await M.User.countDocuments();
  if (existingUsersCount === 0) {
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD || process.env.SEED_PASSWORD || 'Admin@12345';
    const pw = await hashPassword(adminPassword);
    await M.User.create({
      name: process.env.INITIAL_ADMIN_NAME || 'System Administrator',
      email: process.env.INITIAL_ADMIN_EMAIL || 'admin@hotel.local',
      username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
      role: roles.Admin?._id,
      department: 'Management',
      password: pw,
    });
    console.log(`✓ Initialized primary administrator account`);
  } else {
    console.log(`✓ Preserving ${existingUsersCount} existing user account(s)`);
  }

  // 4. Idempotent Hotel: create default hotel configuration only if none exists
  let hotel = await M.Hotel.findOne();
  if (!hotel) {
    hotel = await M.Hotel.create({
      name: process.env.HOTEL_NAME || 'GS Hotels',
      address: process.env.HOTEL_ADDRESS || '',
      phone: process.env.HOTEL_PHONE || '',
      email: process.env.HOTEL_EMAIL || '',
      gstNumber: process.env.HOTEL_GST || '',
      floors: [1, 2, 3, 4, 5],
      invoice: { prefix: 'INV', footerNote: 'Thank you for choosing our hotel.' },
    });
    console.log(`✓ Initialized default hotel profile: ${hotel.name}`);
  }

  // 5. Idempotent Amenities: insert only missing amenities
  const defaultAmenities = ['WiFi', 'TV', 'Mini Fridge', 'Geyser', 'Balcony', 'Bathtub', 'Work Desk'];
  const amenities = [];
  for (const name of defaultAmenities) {
    let amen = await M.Amenity.findOne({ name });
    if (!amen) {
      amen = await M.Amenity.create({ name });
      console.log(`✓ Created missing amenity: ${name}`);
    }
    amenities.push(amen);
  }
  const A = (n) => amenities.slice(0, n).map((a) => a._id);

  // 6. Idempotent Room Types: insert only missing room types
  const defaultTypes = [
    { name: 'Standard', basePrice: 2000, maxOccupancy: 2, amenitiesCount: 3, description: 'Comfortable standard room' },
    { name: 'Deluxe', basePrice: 3000, maxOccupancy: 3, amenitiesCount: 5, description: 'Spacious deluxe room' },
    { name: 'Executive', basePrice: 4200, maxOccupancy: 3, amenitiesCount: 6, description: 'Executive room with work desk' },
    { name: 'Suite', basePrice: 6500, maxOccupancy: 4, amenitiesCount: 7, description: 'Suite with living area' },
  ];
  const types = {};
  for (const t of defaultTypes) {
    let rt = await M.RoomType.findOne({ name: t.name });
    if (!rt) {
      rt = await M.RoomType.create({
        name: t.name,
        basePrice: t.basePrice,
        maxOccupancy: t.maxOccupancy,
        amenities: A(t.amenitiesCount),
        description: t.description,
      });
      console.log(`✓ Created missing room type: ${t.name}`);
    }
    types[t.name] = rt;
  }

  // 7. Idempotent Rooms: create only rooms that do not exist yet
  const layout = ['Standard', 'Standard', 'Standard', 'Deluxe', 'Deluxe', 'Deluxe', 'Deluxe', 'Executive', 'Executive', 'Suite']; // 10 per floor
  let createdRoomsCount = 0;
  for (let i = 0; i < 50; i++) {
    const floor = Math.floor(i / 10) + 1;
    const roomNumber = `${floor}${String((i % 10) + 1).padStart(2, '0')}`;
    const t = types[layout[i % 10]];

    const exists = await M.Room.findOne({ roomNumber });
    if (!exists) {
      await M.Room.create({
        roomNumber,
        floor,
        roomType: t._id,
        basePrice: t.basePrice,
        isAC: t.name !== 'Standard' || i % 2 === 0,
        adultsCapacity: t.maxOccupancy,
        childrenCapacity: 1,
        standardCapacity: 2,
        bedType: t.name === 'Suite' ? 'King' : i % 2 ? 'Queen' : 'Twin',
        amenities: t.amenities,
        description: 'Room',
      });
      createdRoomsCount++;
    }
  }
  if (createdRoomsCount > 0) {
    console.log(`✓ Created ${createdRoomsCount} missing rooms`);
  } else {
    console.log(`✓ All 50 rooms already present`);
  }

  // Production baseline initialization complete
  // Zero mock bookings, fake guests, or dummy maintenance records are created.
  console.log(`✓ System initialization completed cleanly.`);
  return { success: true, isProd };
}

// Standalone execution wrapper
const isDirectExecution = process.argv[1] && (
  process.argv[1].endsWith('seed.js') ||
  process.argv[1].endsWith('seed')
);

if (isDirectExecution) {
  runSeed()
    .then(async () => {
      console.log('✅ Seed completed successfully without dropping any database.');
      await mongoose.disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('❌ Seed failed:', err);
      await mongoose.disconnect();
      process.exit(1);
    });
}
