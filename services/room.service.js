import { Room, Maintenance, Booking, Housekeeping } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { BLOCKING_STATUSES } from './availability.service.js';
import { toDay } from '../utils/dates.js';
import { notify } from './notification.service.js';

/** Temporary "AC not working" — reversible override; original isAC/basePrice untouched; existing bookings untouched. */
export const markAcNotWorking = async (roomId, { price, reason, expectedRepairDate }, user) => {
  const room = await Room.findById(roomId);
  if (!room) throw new ApiError(404, 'Room not found.');
  if (!room.isAC) throw new ApiError(409, 'This room is already Non-AC.');
  if (room.tempConfig?.active) throw new ApiError(409, 'AC issue is already recorded for this room.');
  room.tempConfig = { active: true, isAC: false, price: price ?? room.basePrice, reason: reason || 'AC Not Working', since: new Date(), setBy: user._id };
  await room.save();
  await Maintenance.create({ room: room._id, issue: 'ac_not_working', description: reason, reportedBy: user._id, priority: 'high', expectedRepairDate, status: 'open' });
  // Do NOT rewrite bookings. Report who is affected so staff can Change Room / Offer Discount / Contact Guest / Keep Out of Service.
  const affected = await Booking.find({ room: room._id, bookingStatus: { $in: BLOCKING_STATUSES }, checkOutDate: { $gt: toDay(new Date()) }, bookedAsAC: true }).populate('guest', 'name phone');
  await notify('ac_issue', `AC issue: Room ${room.roomNumber}`, `${affected.length} existing booking(s) were sold as AC.`, { roomId: room._id, forPermission: 'maintenance.view' });
  return { room, affectedBookings: affected, suggestedActions: ['change_room', 'offer_discount', 'contact_guest', 'keep_out_of_service'] };
};

export const markAcRepaired = async (roomId, user) => {
  const room = await Room.findById(roomId);
  if (!room?.tempConfig?.active) throw new ApiError(409, 'No active AC issue on this room.');
  room.tempConfig = { active: false }; await room.save();
  await Maintenance.updateMany({ room: room._id, issue: 'ac_not_working', status: { $in: ['open', 'in_progress'] } }, { status: 'resolved', resolvedAt: new Date() });
  return room;
};

const FLOW = { dirty: ['cleaning'], cleaning: ['clean', 'dirty'], clean: ['inspected', 'dirty'], inspected: ['dirty'] };
export const setHousekeeping = async (roomId, to, user, notes) => {
  const room = await Room.findById(roomId);
  if (!room) throw new ApiError(404, 'Room not found.');
  if (room.occupancyStatus === 'occupied' && to !== 'dirty' && to !== 'cleaning') throw new ApiError(409, 'An occupied room can only be marked dirty or cleaning.');
  if (!FLOW[room.housekeepingStatus]?.includes(to)) throw new ApiError(409, `Cannot change housekeeping from ${room.housekeepingStatus} to ${to}.`);
  const from = room.housekeepingStatus; room.housekeepingStatus = to; await room.save();
  await Housekeeping.create({ room: room._id, from, to, changedBy: user._id, notes });
  return room;
};

export const setMaintenanceStatus = async (roomId, status) => {
  const room = await Room.findByIdAndUpdate(roomId, { maintenanceStatus: status }, { new: true });
  if (!room) throw new ApiError(404, 'Room not found.');
  return room;
};
