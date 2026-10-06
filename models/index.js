import mongoose from 'mongoose';
const { Schema, model } = mongoose;
const ref = (name, extra = {}) => ({ type: Schema.Types.ObjectId, ref: name, ...extra });
const opts = { timestamps: true };

export const Permission = model('Permission', new Schema({
  key: { type: String, required: true, unique: true }, group: String, description: String,
}, opts));

export const Role = model('Role', new Schema({
  name: { type: String, required: true, unique: true }, description: String,
  permissions: [{ type: String }], // permission keys; '*' = everything
  isSystem: { type: Boolean, default: false },
}, opts));

export const User = model('User', new Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  phone: String, department: String,
  password: { type: String, required: true, select: false },
  role: ref('Role', { required: true }),
  isActive: { type: Boolean, default: true },
  refreshTokenHash: { type: String, select: false },
  resetTokenHash: { type: String, select: false }, resetTokenExpires: Date,
  loginHistory: [{ at: Date, ip: String, userAgent: String, success: Boolean }],
  lastLoginAt: Date,
}, opts));

export const Hotel = model('Hotel', new Schema({
  name: { type: String, required: true }, logo: String, address: String, phone: String, email: String, website: String,
  gstNumber: String,
  invoice: { prefix: { type: String, default: 'INV' }, footerNote: String },
  booking: {
    checkInTime: { type: String, default: '12:00' }, checkOutTime: { type: String, default: '11:00' },
    taxPercent: { type: Number, default: 12 }, cancellationHours: { type: Number, default: 24 },
  },
  floors: [Number],
}, opts));

export const Amenity = model('Amenity', new Schema({ name: { type: String, required: true, unique: true }, icon: String }, opts));

export const RoomType = model('RoomType', new Schema({
  name: { type: String, required: true, unique: true }, description: String,
  basePrice: { type: Number, required: true, min: 0 }, maxOccupancy: { type: Number, default: 2 },
  amenities: [ref('Amenity')], acAvailable: { type: Boolean, default: true }, isActive: { type: Boolean, default: true },
}, opts));

const roomSchema = new Schema({
  roomNumber: { type: String, required: true, unique: true, trim: true },
  floor: { type: Number, required: true }, roomType: ref('RoomType', { required: true }),
  standardCapacity: { type: Number, default: 2 }, adultsCapacity: { type: Number, default: 2 }, childrenCapacity: { type: Number, default: 1 },
  basePrice: { type: Number, required: true, min: 0 }, isAC: { type: Boolean, default: true }, // permanent configuration
  bedType: String, amenities: [ref('Amenity')], description: String, photos: [String], isActive: { type: Boolean, default: true },
  // Four independent status dimensions
  occupancyStatus: { type: String, enum: ['vacant', 'occupied'], default: 'vacant' },
  housekeepingStatus: { type: String, enum: ['clean', 'dirty', 'cleaning', 'inspected'], default: 'clean' },
  maintenanceStatus: { type: String, enum: ['normal', 'maintenance', 'out_of_service'], default: 'normal' },
  // Temporary sellable override (e.g. AC broken). Never mutates isAC/basePrice.
  tempConfig: { active: { type: Boolean, default: false }, isAC: Boolean, price: Number, reason: String, since: Date, setBy: ref('User') },
}, opts);
roomSchema.index({ floor: 1, roomNumber: 1 });
export const Room = model('Room', roomSchema);

export const Guest = model('Guest', new Schema({
  guestId: { type: String, unique: true, sparse: true },
  name: { type: String, required: true, trim: true, index: true }, phone: { type: String, required: true, index: true }, email: String, address: String,
  idType: String, idNumber: String, idDocumentUrl: String, dateOfBirth: Date, nationality: String,
  totalStays: { type: Number, default: 0 }, totalSpent: { type: Number, default: 0 }, lastVisit: Date,
}, opts));

const bookingSchema = new Schema({
  bookingNumber: { type: String, required: true, unique: true },
  guest: ref('Guest', { required: true }), room: ref('Room', { required: true }), roomType: ref('RoomType'),
  checkInDate: { type: Date, required: true }, checkOutDate: { type: Date, required: true },
  adults: { type: Number, default: 1 }, children: { type: Number, default: 0 },
  coGuests: [{
    name: { type: String, trim: true },
    phone: String,
    idType: { type: String, default: 'Aadhaar' },
    idNumber: String,
    idDocumentUrl: String,
  }],
  nights: Number, roomRate: Number, extraBedCharge: { type: Number, default: 0 }, otherCharges: { type: Number, default: 0 },
  subtotal: Number, discount: { type: Number, default: 0 }, taxPercent: { type: Number, default: 0 }, tax: Number,
  totalAmount: Number, paidAmount: { type: Number, default: 0 }, balanceAmount: Number,
  bookedAsAC: Boolean, // snapshot so later AC changes never rewrite the booking
  bookingStatus: { type: String, enum: ['hold', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'], default: 'confirmed' },
  paymentStatus: { type: String, enum: ['pending', 'partial', 'paid', 'refunded'], default: 'pending' },
  source: { type: String, enum: ['reception', 'walk_in', 'phone', 'other'], default: 'reception' },
  roomHistory: [{ room: ref('Room'), from: Date, to: Date, changedBy: ref('User'), reason: String }],
  actualCheckIn: Date, actualCheckOut: Date, cancelReason: String, notes: String,
  createdBy: ref('User'), updatedBy: ref('User'),
}, opts);
bookingSchema.index({ room: 1, checkInDate: 1, checkOutDate: 1, bookingStatus: 1 }); // availability queries
bookingSchema.index({ checkInDate: 1 }); bookingSchema.index({ checkOutDate: 1 });
bookingSchema.index({ guest: 1 }); bookingSchema.index({ bookingStatus: 1 });
export const Booking = model('Booking', bookingSchema);

export const Payment = model('Payment', new Schema({
  paymentId: { type: String, unique: true }, booking: ref('Booking', { required: true, index: true }), guest: ref('Guest'),
  amount: { type: Number, required: true }, type: { type: String, enum: ['payment', 'refund'], default: 'payment' },
  method: { type: String, enum: ['cash', 'upi', 'card', 'bank_transfer', 'other'], required: true },
  receivedBy: ref('User'), notes: String, paidAt: { type: Date, default: Date.now },
}, opts));

export const Invoice = model('Invoice', new Schema({
  invoiceNumber: { type: String, unique: true }, booking: ref('Booking', { required: true, unique: true }),
  lines: [{ description: String, amount: Number }], snapshot: Schema.Types.Mixed, generatedBy: ref('User'),
}, opts));

export const Maintenance = model('Maintenance', new Schema({
  room: ref('Room', { required: true, index: true }),
  issue: { type: String, enum: ['ac_not_working', 'tv', 'water_leakage', 'electrical', 'bathroom', 'plumbing', 'other'], required: true },
  description: String, reportedBy: ref('User'), reportedDate: { type: Date, default: Date.now },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  expectedRepairDate: Date, status: { type: String, enum: ['open', 'in_progress', 'resolved', 'closed'], default: 'open' },
  blocksRoom: { type: Boolean, default: false }, blockFrom: Date, blockTo: Date, // blocks availability for these dates
  notes: String, resolvedAt: Date,
}, opts));

export const Housekeeping = model('Housekeeping', new Schema({
  room: ref('Room', { required: true, index: true }), from: String, to: String, changedBy: ref('User'), notes: String,
}, opts));

export const AuditLog = model('AuditLog', new Schema({
  user: ref('User'), userName: String, action: { type: String, index: true }, entity: String, entityId: Schema.Types.ObjectId,
  summary: String, meta: Schema.Types.Mixed, ip: String,
}, opts));

export const Rate = model('Rate', new Schema({
  roomType: ref('RoomType', { required: true }), name: String, price: { type: Number, required: true },
  from: Date, to: Date, isAC: { type: Boolean, default: true },
}, opts));

export const Counter = model('Counter', new Schema({ _id: String, seq: { type: Number, default: 0 } }));
export const nextSeq = async (key) => (await Counter.findByIdAndUpdate(key, { $inc: { seq: 1 } }, { new: true, upsert: true })).seq;

export const Notification = model('Notification', new Schema({
  type: String, title: String, message: String, roomId: ref('Room'), bookingId: ref('Booking'), forPermission: String,
  readBy: [ref('User')],
}, opts));

// One document per (room, night) held by an active booking. The unique index makes double-booking
// impossible even under concurrent requests, without needing replica-set transactions.
const roomNightSchema = new Schema({
  room: ref('Room', { required: true }), night: { type: Date, required: true }, booking: ref('Booking', { required: true, index: true }),
});
roomNightSchema.index({ room: 1, night: 1 }, { unique: true });
export const RoomNight = model('RoomNight', roomNightSchema);
