import { z } from 'zod';
const oid = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const date = z.coerce.date({ invalid_type_error: 'Invalid date' });
const num = z.coerce.number();

export const loginSchema = z.object({ identifier: z.string().min(1, 'Email or username is required'), password: z.string().min(1, 'Password is required') });
export const passwordRule = z.string().min(8, 'Password must be at least 8 characters').regex(/[A-Za-z]/, 'Password needs a letter').regex(/\d/, 'Password needs a number');
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1), newPassword: passwordRule });
export const resetSchema = z.object({ token: z.string().min(10), newPassword: passwordRule });

export const guestSchema = z.object({
  _id: oid.optional(), name: z.string().min(2, 'Guest name is required'), phone: z.string().min(7, 'A valid phone number is required'),
  email: z.string().email().optional().or(z.literal('')), address: z.string().optional(), idType: z.string().optional(), idNumber: z.string().optional(),
  idDocumentUrl: z.string().optional(), dateOfBirth: date.optional(), nationality: z.string().optional(),
});

export const bookingCreateSchema = z.object({
  guest: guestSchema, room: oid, checkInDate: date, checkOutDate: date,
  adults: z.coerce.number().int().min(1, 'At least one adult is required'), children: z.coerce.number().int().min(0).default(0),
  roomRate: num.min(0).optional(), extraBedCharge: num.min(0).default(0), otherCharges: num.min(0).default(0), discount: num.min(0).default(0),
  taxPercent: num.min(0).max(100).optional(), source: z.enum(['reception', 'walk_in', 'phone', 'other']).default('reception'),
  hold: z.boolean().optional(), notes: z.string().max(1000).optional(), checkInNow: z.boolean().optional(),
  payment: z.object({ amount: num.positive(), method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']), notes: z.string().optional() }).optional(),
});
export const bookingUpdateSchema = z.object({
  adults: z.coerce.number().int().min(1).optional(), children: z.coerce.number().int().min(0).optional(), extraBedCharge: num.min(0).optional(),
  otherCharges: num.min(0).optional(), discount: num.min(0).optional(), roomRate: num.min(0).optional(), taxPercent: num.min(0).max(100).optional(), notes: z.string().max(1000).optional(),
  source: z.enum(['reception', 'walk_in', 'phone', 'other']).optional(), guest: guestSchema.partial().optional(),
});
export const modifyStaySchema = z.object({ room: oid.optional(), checkInDate: date.optional(), checkOutDate: date.optional(), reason: z.string().optional(), newRate: num.min(0).optional() });
export const cancelSchema = z.object({ reason: z.string().min(3, 'Please provide a cancellation reason') });
export const paymentSchema = z.object({ amount: num.positive('Amount must be greater than zero'), method: z.enum(['cash', 'upi', 'card', 'bank_transfer', 'other']), notes: z.string().optional() });
export const availabilityQuery = z.object({ checkInDate: date, checkOutDate: date, roomType: oid.optional(), floor: z.string().optional(), isAC: z.string().optional(), adults: z.string().optional(), children: z.string().optional() });

export const roomSchema = z.object({
  roomNumber: z.string().min(1), floor: num.int(), roomType: oid, standardCapacity: num.int().min(1).optional(), adultsCapacity: num.int().min(1).optional(),
  childrenCapacity: num.int().min(0).optional(), basePrice: num.min(0), isAC: z.boolean().optional(), bedType: z.string().optional(), amenities: z.array(oid).optional(),
  description: z.string().optional(), isActive: z.boolean().optional(),
});
export const roomTypeSchema = z.object({ name: z.string().min(2), description: z.string().optional(), basePrice: num.min(0), maxOccupancy: num.int().min(1).optional(), amenities: z.array(oid).optional(), acAvailable: z.boolean().optional(), isActive: z.boolean().optional() });
export const amenitySchema = z.object({ name: z.string().min(2), icon: z.string().optional() });
export const acIssueSchema = z.object({ price: num.min(0).optional(), reason: z.string().optional(), expectedRepairDate: date.optional() });
export const housekeepingSchema = z.object({ status: z.enum(['dirty', 'cleaning', 'clean', 'inspected']), notes: z.string().optional() });
export const maintenanceStatusSchema = z.object({ status: z.enum(['normal', 'maintenance', 'out_of_service']) });

export const maintenanceSchema = z.object({
  room: oid, issue: z.enum(['ac_not_working', 'tv', 'water_leakage', 'electrical', 'bathroom', 'plumbing', 'other']), description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('medium'), expectedRepairDate: date.optional(), blocksRoom: z.boolean().default(false),
  blockFrom: date.optional(), blockTo: date.optional(), notes: z.string().optional(),
}).refine((d) => !d.blocksRoom || (d.blockFrom && d.blockTo && d.blockTo > d.blockFrom), { message: 'Blocking maintenance needs a valid date range', path: ['blockTo'] });
export const maintenanceUpdateSchema = z.object({ status: z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), priority: z.enum(['low', 'medium', 'high', 'critical']).optional(), notes: z.string().optional(), expectedRepairDate: date.optional() });

export const userCreateSchema = z.object({ name: z.string().min(2), email: z.string().email(), username: z.string().min(3).optional(), phone: z.string().optional(), department: z.string().optional(), role: oid, password: passwordRule, isActive: z.boolean().optional() });
export const userUpdateSchema = userCreateSchema.omit({ password: true }).partial();
export const roleSchema = z.object({ name: z.string().min(2), description: z.string().optional(), permissions: z.array(z.string()) });
export const settingsSchema = z.object({
  name: z.string().min(2).optional(), address: z.string().optional(), phone: z.string().optional(), email: z.string().email().optional(), website: z.string().optional(), gstNumber: z.string().optional(),
  invoice: z.object({ prefix: z.string().optional(), footerNote: z.string().optional() }).optional(),
  booking: z.object({ checkInTime: z.string().optional(), checkOutTime: z.string().optional(), taxPercent: num.min(0).max(100).optional(), cancellationHours: num.min(0).optional() }).optional(),
});
