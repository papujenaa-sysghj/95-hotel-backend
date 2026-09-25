import { Room, RoomType, Amenity, Guest, Booking, Maintenance, Housekeeping, RoomNight } from '../models/index.js';
import { audit } from '../services/audit.service.js';
import * as rooms from '../services/room.service.js';
import { sellableConfig } from '../services/availability.service.js';
import { ApiError, ok, asyncHandler } from '../utils/ApiError.js';

export const deriveRoomStatus = (r) =>
  r.maintenanceStatus === 'out_of_service' ? 'out_of_service' : r.maintenanceStatus === 'maintenance' ? 'maintenance' : r.occupancyStatus === 'occupied' ? 'occupied'
  : ['dirty', 'cleaning'].includes(r.housekeepingStatus) ? 'cleaning' : 'available';
export const withStatus = (r) => { const o = r.toObject ? r.toObject() : r; return { ...o, status: deriveRoomStatus(o), ...sellableConfig(o) }; };

// ---- generic CRUD factory with audit ----
const crud = (Model, name, { populate = '', searchFields = [], guard } = {}) => ({
  list: asyncHandler(async (req, res) => {
    const { q, page = 1, limit = 100, ...rest } = req.query; const f = { ...rest };
    if (q && searchFields.length) f.$or = searchFields.map((k) => ({ [k]: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') }));
    const [items, total] = await Promise.all([Model.find(f).populate(populate).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)), Model.countDocuments(f)]);
    ok(res, { items, total });
  }),
  get: asyncHandler(async (req, res) => { const d = await Model.findById(req.params.id).populate(populate); if (!d) throw new ApiError(404, `${name} not found.`); ok(res, { item: d }); }),
  create: asyncHandler(async (req, res) => { const d = await Model.create(req.body); await audit(req, `${name.toLowerCase()}.create`, { entity: name, entityId: d._id, summary: `Created ${name}` }); ok(res, { item: d }, `${name} created`, 201); }),
  update: asyncHandler(async (req, res) => { const d = await Model.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true }); if (!d) throw new ApiError(404, `${name} not found.`); await audit(req, `${name.toLowerCase()}.update`, { entity: name, entityId: d._id, summary: `Updated ${name}` }); ok(res, { item: d }, `${name} updated`); }),
  remove: asyncHandler(async (req, res) => { if (guard) await guard(req.params.id); const d = await Model.findByIdAndDelete(req.params.id); if (!d) throw new ApiError(404, `${name} not found.`); await audit(req, `${name.toLowerCase()}.delete`, { entity: name, entityId: d._id, summary: `Deleted ${name}` }); ok(res, {}, `${name} deleted`); }),
});

export const amenityCtl = crud(Amenity, 'Amenity', { searchFields: ['name'] });
export const roomTypeCtl = crud(RoomType, 'RoomType', { populate: 'amenities', searchFields: ['name'], guard: async (id) => { if (await Room.exists({ roomType: id })) throw new ApiError(409, 'Rooms still use this room type. Deactivate it instead.'); } });
export const guestCtl = crud(Guest, 'Guest', { searchFields: ['name', 'phone', 'email', 'guestId'] });
export const guestHistory = asyncHandler(async (req, res) => ok(res, { bookings: await Booking.find({ guest: req.params.id }).populate('room', 'roomNumber').sort({ checkInDate: -1 }) }));

const roomBase = crud(Room, 'Room', { populate: 'roomType amenities', searchFields: ['roomNumber'], guard: async (id) => { if (await Booking.exists({ room: id, bookingStatus: { $in: ['hold', 'confirmed', 'checked_in'] } })) throw new ApiError(409, 'This room has active bookings. Deactivate it instead.'); } });
export const roomCtl = {
  ...roomBase,
  list: asyncHandler(async (req, res) => {
    const { roomType, floor, q, isActive } = req.query; const f = {};
    if (roomType) f.roomType = roomType; if (floor) f.floor = Number(floor); if (isActive !== undefined) f.isActive = isActive === 'true'; if (q) f.roomNumber = new RegExp(q, 'i');
    ok(res, { items: (await Room.find(f).populate('roomType amenities').sort({ floor: 1, roomNumber: 1 })).map(withStatus) });
  }),
  markAcNotWorking: asyncHandler(async (req, res) => { const r = await rooms.markAcNotWorking(req.params.id, req.body, req.user); await audit(req, 'room.ac_not_working', { entity: 'Room', entityId: r.room._id, summary: `Room ${r.room.roomNumber}: AC not working (temporary Non-AC)` }); ok(res, { ...r, room: withStatus(r.room) }, 'Room switched to temporary Non-AC'); }),
  markAcRepaired: asyncHandler(async (req, res) => { const r = await rooms.markAcRepaired(req.params.id, req.user); await audit(req, 'room.ac_repaired', { entity: 'Room', entityId: r._id, summary: `Room ${r.roomNumber}: AC repaired` }); ok(res, { room: withStatus(r) }, 'AC restored'); }),
  setMaintenance: asyncHandler(async (req, res) => { const r = await rooms.setMaintenanceStatus(req.params.id, req.body.status); await audit(req, 'room.status_change', { entity: 'Room', entityId: r._id, summary: `Room ${r.roomNumber} set to ${req.body.status.replace('_', ' ')}` }); ok(res, { room: withStatus(r) }); }),
  setHousekeeping: asyncHandler(async (req, res) => { const r = await rooms.setHousekeeping(req.params.id, req.body.status, req.user, req.body.notes); await audit(req, 'housekeeping.update', { entity: 'Room', entityId: r._id, summary: `Room ${r.roomNumber} marked ${req.body.status}` }); ok(res, { room: withStatus(r) }); }),
};

export const housekeepingBoard = asyncHandler(async (_req, res) => {
  const all = (await Room.find({ isActive: true }).populate('roomType', 'name').sort({ floor: 1, roomNumber: 1 })).map(withStatus);
  ok(res, { board: { dirty: all.filter((r) => r.housekeepingStatus === 'dirty'), cleaning: all.filter((r) => r.housekeepingStatus === 'cleaning'), clean: all.filter((r) => r.housekeepingStatus === 'clean'), inspected: all.filter((r) => r.housekeepingStatus === 'inspected') } });
});
export const housekeepingLog = asyncHandler(async (req, res) => ok(res, { logs: await Housekeeping.find(req.query.room ? { room: req.query.room } : {}).populate('room', 'roomNumber').populate('changedBy', 'name').sort({ createdAt: -1 }).limit(100) }));

export const maintenanceCtl = {
  list: asyncHandler(async (req, res) => { const f = {}; for (const k of ['status', 'room', 'priority']) if (req.query[k]) f[k] = req.query[k]; ok(res, { items: await Maintenance.find(f).populate('room', 'roomNumber floor').populate('reportedBy', 'name').sort({ createdAt: -1 }) }); }),
  create: asyncHandler(async (req, res) => {
    const m = await Maintenance.create({ ...req.body, reportedBy: req.user._id });
    const room = await Room.findById(m.room); await audit(req, 'maintenance.create', { entity: 'Maintenance', entityId: m._id, summary: `Maintenance reported for Room ${room?.roomNumber}: ${m.issue}` });
    // A blocking issue that covers today flips the room's maintenance dimension
    if (m.blocksRoom && m.blockFrom <= new Date() && m.blockTo > new Date()) await Room.findByIdAndUpdate(m.room, { maintenanceStatus: 'maintenance' });
    const clashes = m.blocksRoom ? await Booking.find({ room: m.room, bookingStatus: { $in: ['hold', 'confirmed', 'checked_in'] }, checkInDate: { $lt: m.blockTo }, checkOutDate: { $gt: m.blockFrom } }).select('bookingNumber checkInDate checkOutDate') : [];
    ok(res, { item: m, conflictingBookings: clashes }, clashes.length ? 'Reported. Some existing bookings overlap the blocked dates.' : 'Maintenance reported', 201);
  }),
  update: asyncHandler(async (req, res) => {
    const m = await Maintenance.findById(req.params.id); if (!m) throw new ApiError(404, 'Maintenance record not found.');
    Object.assign(m, req.body); if (['resolved', 'closed'].includes(m.status) && !m.resolvedAt) m.resolvedAt = new Date(); await m.save();
    if (['resolved', 'closed'].includes(m.status)) {
      if (m.issue === 'ac_not_working') await Room.findByIdAndUpdate(m.room, { tempConfig: { active: false } });
      if (!(await Maintenance.exists({ room: m.room, blocksRoom: true, status: { $in: ['open', 'in_progress'] }, _id: { $ne: m._id } }))) await Room.updateOne({ _id: m.room, maintenanceStatus: 'maintenance' }, { maintenanceStatus: 'normal' });
    }
    await audit(req, 'maintenance.update', { entity: 'Maintenance', entityId: m._id, summary: `Maintenance ${m._id} → ${m.status}` }); ok(res, { item: m }, 'Maintenance updated');
  }),
};
export { RoomNight };
