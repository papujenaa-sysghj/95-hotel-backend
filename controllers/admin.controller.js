import { User, Role, Hotel, AuditLog, Notification } from '../models/index.js';
import { ALL_KEYS, PERMISSIONS } from '../config/permissions.js';
import { hashPassword } from '../services/auth.service.js';
import { audit } from '../services/audit.service.js';
import { ApiError, ok, asyncHandler } from '../utils/ApiError.js';

// ---- users ----
export const listUsers = asyncHandler(async (req, res) => {
  const { q, role, isActive } = req.query; const f = {};
  if (q) f.$or = [{ name: new RegExp(q, 'i') }, { email: new RegExp(q, 'i') }];
  if (role) f.role = role; if (isActive !== undefined) f.isActive = isActive === 'true';
  ok(res, { users: await User.find(f).populate('role', 'name').sort({ name: 1 }) });
});
export const createUser = asyncHandler(async (req, res) => {
  const u = await User.create({ ...req.body, password: await hashPassword(req.body.password) });
  await audit(req, 'user.create', { entity: 'User', entityId: u._id, summary: `Created user ${u.name}` });
  ok(res, { user: await u.populate('role', 'name') }, 'User created', 201);
});
export const updateUser = asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id) && req.body.isActive === false) throw new ApiError(400, "You can't disable your own account.");
  const u = await User.findByIdAndUpdate(req.params.id, req.body, { new: true }).populate('role', 'name');
  if (!u) throw new ApiError(404, 'User not found.');
  await audit(req, 'user.update', { entity: 'User', entityId: u._id, summary: `Updated user ${u.name}`, meta: req.body }); ok(res, { user: u }, 'User updated');
});
export const setUserActive = (active) => asyncHandler(async (req, res) => {
  if (String(req.params.id) === String(req.user._id)) throw new ApiError(400, "You can't change your own status.");
  const u = await User.findByIdAndUpdate(req.params.id, { isActive: active, ...(active ? {} : { $unset: { refreshTokenHash: 1 } }) }, { new: true });
  if (!u) throw new ApiError(404, 'User not found.');
  await audit(req, active ? 'user.enable' : 'user.disable', { entity: 'User', entityId: u._id, summary: `${active ? 'Enabled' : 'Disabled'} ${u.name}` }); ok(res, { user: u });
});
export const adminResetPassword = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(req.params.id, { password: await hashPassword(req.body.newPassword), $unset: { refreshTokenHash: 1 } });
  await audit(req, 'user.password_reset', { entity: 'User', entityId: req.params.id, summary: 'Admin reset a user password' }); ok(res, {}, 'Password reset');
});

// ---- roles & permissions ----
export const permissionCatalogue = asyncHandler(async (_req, res) => ok(res, { groups: PERMISSIONS, keys: ALL_KEYS }));
export const listRoles = asyncHandler(async (_req, res) => ok(res, { roles: await Role.find().sort({ name: 1 }) }));
const cleanPerms = (p) => { const bad = p.filter((k) => k !== '*' && !ALL_KEYS.includes(k)); if (bad.length) throw new ApiError(400, `Unknown permission(s): ${bad.join(', ')}`); return p; };
export const createRole = asyncHandler(async (req, res) => { const r = await Role.create({ ...req.body, permissions: cleanPerms(req.body.permissions) }); await audit(req, 'role.create', { entity: 'Role', entityId: r._id, summary: `Created role ${r.name}` }); ok(res, { role: r }, 'Role created', 201); });
export const updateRole = asyncHandler(async (req, res) => {
  const r = await Role.findById(req.params.id); if (!r) throw new ApiError(404, 'Role not found.');
  if (r.name === 'Admin') throw new ApiError(400, 'The Admin role always has full access and cannot be edited.');
  Object.assign(r, { ...req.body, permissions: cleanPerms(req.body.permissions) }); await r.save();
  await audit(req, 'role.permission_change', { entity: 'Role', entityId: r._id, summary: `Changed permissions of ${r.name}`, meta: { permissions: r.permissions } }); ok(res, { role: r }, 'Role updated');
});
export const deleteRole = asyncHandler(async (req, res) => {
  const r = await Role.findById(req.params.id); if (!r) throw new ApiError(404, 'Role not found.');
  if (r.isSystem) throw new ApiError(400, 'System roles cannot be deleted.');
  if (await User.exists({ role: r._id })) throw new ApiError(409, 'Reassign users of this role before deleting it.');
  await r.deleteOne(); await audit(req, 'role.delete', { entity: 'Role', summary: `Deleted role ${r.name}` }); ok(res, {}, 'Role deleted');
});

// ---- settings ----
export const getSettings = asyncHandler(async (_req, res) => ok(res, { hotel: await Hotel.findOne() }));
export const updateSettings = asyncHandler(async (req, res) => {
  const h = (await Hotel.findOne()) || new Hotel({ name: 'Hotel' });
  const { invoice, booking, ...rest } = req.body; Object.assign(h, rest); if (invoice) Object.assign(h.invoice, invoice); if (booking) Object.assign(h.booking, booking);
  await h.save(); await audit(req, 'settings.update', { entity: 'Hotel', entityId: h._id, summary: 'Updated hotel settings' }); ok(res, { hotel: h }, 'Settings saved');
});

// ---- audit & notifications ----
export const listAudit = asyncHandler(async (req, res) => {
  const { action, user, from, to, page = 1, limit = 50 } = req.query; const f = {};
  if (action) f.action = new RegExp(`^${action}`); if (user) f.user = user;
  if (from || to) f.createdAt = { ...(from && { $gte: new Date(from) }), ...(to && { $lte: new Date(to) }) };
  const [logs, total] = await Promise.all([AuditLog.find(f).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(Number(limit)), AuditLog.countDocuments(f)]);
  ok(res, { logs, total, page: Number(page) });
});
export const listNotifications = asyncHandler(async (req, res) => {
  const perms = [...req.permissions]; const all = req.permissions.has('*');
  const f = all ? {} : { $or: [{ forPermission: { $in: perms } }, { forPermission: null }] };
  const items = await Notification.find(f).sort({ createdAt: -1 }).limit(50);
  ok(res, { notifications: items.map((n) => ({ ...n.toObject(), read: n.readBy.some((u) => String(u) === String(req.user._id)) })) });
});
export const markNotificationsRead = asyncHandler(async (req, res) => { await Notification.updateMany({}, { $addToSet: { readBy: req.user._id } }); ok(res, {}); });
