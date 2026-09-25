import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate } from '../middleware/auth.middleware.js';
import { requirePermission as P, authorize } from '../middleware/permission.middleware.js';
import { validate as V } from '../middleware/validate.middleware.js';
import * as S from '../validators/schemas.js';
import * as auth from '../controllers/auth.controller.js';
import * as admin from '../controllers/admin.controller.js';
import * as inv from '../controllers/inventory.controller.js';
import * as bk from '../controllers/booking.controller.js';
import * as rep from '../controllers/report.controller.js';

const r = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, message: { success: false, message: 'Too many attempts. Please try again in a few minutes.' } });

// ---------- public ----------
r.post('/auth/login', loginLimiter, V(S.loginSchema), auth.login);
r.post('/auth/refresh', auth.refresh);
r.post('/auth/forgot-password', loginLimiter, auth.forgot);
r.post('/auth/reset-password', loginLimiter, V(S.resetSchema), auth.reset);
r.get('/health', (_q, s) => s.json({ success: true, message: 'ok' }));

import { handleSingleUpload } from '../middleware/upload.middleware.js';

// ---------- everything below requires a valid session ----------
r.use(authenticate);
r.post('/auth/logout', auth.logout);
r.get('/auth/me', auth.me);
r.post('/auth/change-password', V(S.changePasswordSchema), auth.changePassword);
r.get('/auth/login-activity', auth.loginActivity);

// Document upload route
r.post('/upload', handleSingleUpload('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'No document file uploaded.' });
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, data: { url: fileUrl, filename: req.file.originalname }, url: fileUrl });
});

// users / roles / permissions
r.get('/users', P('users.view'), admin.listUsers);
r.post('/users', P('users.create'), V(S.userCreateSchema), admin.createUser);
r.put('/users/:id', P('users.edit'), V(S.userUpdateSchema), admin.updateUser);
r.patch('/users/:id/disable', P('users.edit'), admin.setUserActive(false));
r.patch('/users/:id/enable', P('users.edit'), admin.setUserActive(true));
r.post('/users/:id/reset-password', P('users.edit'), V(S.resetSchema.pick({ newPassword: true })), admin.adminResetPassword);
r.get('/permissions', P('roles.view'), admin.permissionCatalogue);
r.get('/roles', P('roles.view', 'users.view'), admin.listRoles);
r.post('/roles', P('roles.manage'), V(S.roleSchema), admin.createRole);
r.put('/roles/:id', P('roles.manage'), V(S.roleSchema), admin.updateRole);
r.delete('/roles/:id', P('roles.manage'), admin.deleteRole);

// amenities / room types / rooms
r.get('/amenities', P('rooms.view'), inv.amenityCtl.list); r.post('/amenities', P('rooms.create'), V(S.amenitySchema), inv.amenityCtl.create);
r.put('/amenities/:id', P('rooms.edit'), V(S.amenitySchema), inv.amenityCtl.update); r.delete('/amenities/:id', P('rooms.delete'), inv.amenityCtl.remove);
r.get('/room-types', P('rooms.view'), inv.roomTypeCtl.list); r.get('/room-types/:id', P('rooms.view'), inv.roomTypeCtl.get);
r.post('/room-types', P('rooms.create'), V(S.roomTypeSchema), inv.roomTypeCtl.create); r.put('/room-types/:id', P('rooms.edit'), V(S.roomTypeSchema.partial()), inv.roomTypeCtl.update); r.delete('/room-types/:id', P('rooms.delete'), inv.roomTypeCtl.remove);
r.get('/rooms', P('rooms.view'), inv.roomCtl.list); r.get('/rooms/:id', P('rooms.view'), inv.roomCtl.get);
r.post('/rooms', P('rooms.create'), V(S.roomSchema), inv.roomCtl.create); r.put('/rooms/:id', P('rooms.edit'), V(S.roomSchema.partial()), inv.roomCtl.update); r.delete('/rooms/:id', P('rooms.delete'), inv.roomCtl.remove);
r.post('/rooms/:id/ac-not-working', P('rooms.configure'), V(S.acIssueSchema), inv.roomCtl.markAcNotWorking);
r.post('/rooms/:id/ac-repaired', P('rooms.configure'), inv.roomCtl.markAcRepaired);
r.patch('/rooms/:id/maintenance-status', P('rooms.configure'), V(S.maintenanceStatusSchema), inv.roomCtl.setMaintenance);

// guests
r.get('/guests', P('guests.view'), inv.guestCtl.list); r.get('/guests/:id', P('guests.view'), inv.guestCtl.get); r.get('/guests/:id/bookings', P('guests.view'), inv.guestHistory);
r.post('/guests', P('guests.create'), V(S.guestSchema), inv.guestCtl.create); r.put('/guests/:id', P('guests.edit'), V(S.guestSchema.partial()), inv.guestCtl.update);

// bookings
r.get('/bookings/availability', P('bookings.view', 'bookings.create'), V(S.availabilityQuery, 'query'), bk.availability);
r.get('/bookings', P('bookings.view'), bk.list); r.get('/bookings/:id', P('bookings.view'), bk.get);
r.post('/bookings', P('bookings.create'), V(S.bookingCreateSchema), bk.create);
r.put('/bookings/:id', P('bookings.edit'), V(S.bookingUpdateSchema), bk.update);
r.patch('/bookings/:id/extend', P('bookings.edit'), V(S.modifyStaySchema), bk.extend);
r.patch('/bookings/:id/change-room', P('bookings.edit'), V(S.modifyStaySchema), bk.changeRoom);
r.patch('/bookings/:id/cancel', P('bookings.cancel'), V(S.cancelSchema), bk.cancel);
r.patch('/bookings/:id/no-show', P('bookings.edit'), bk.noShow);
r.post('/bookings/:id/payments', P('payments.create'), V(S.paymentSchema), bk.takePayment);
r.post('/bookings/:id/refund', P('payments.refund'), V(S.paymentSchema), bk.refund);

// calendar (drag/drop + resize hit the same service as extend/change-room)
r.get('/calendar', P('calendar.view'), bk.calendar);
r.patch('/calendar/bookings/:id/move', P('calendar.edit'), V(S.modifyStaySchema), bk.move);

// check-in / check-out
r.get('/check-in/arrivals', P('checkin.perform'), bk.arrivals); r.post('/check-in/:id', P('checkin.perform'), bk.doCheckIn);
r.get('/check-out/departures', P('checkout.perform'), bk.departures); r.post('/check-out/:id', P('checkout.perform'), bk.doCheckOut);

// payments / invoices
r.get('/payments', P('payments.view'), bk.listPayments);
r.get('/invoices/:bookingId', P('invoices.view'), bk.invoiceJson); r.get('/invoices/:bookingId/pdf', P('invoices.view'), bk.invoicePdf);

// housekeeping / maintenance
r.get('/housekeeping', P('housekeeping.view'), inv.housekeepingBoard); r.get('/housekeeping/log', P('housekeeping.view'), inv.housekeepingLog);
r.patch('/housekeeping/rooms/:id', P('housekeeping.update'), V(S.housekeepingSchema), inv.roomCtl.setHousekeeping);
r.get('/maintenance', P('maintenance.view'), inv.maintenanceCtl.list); r.post('/maintenance', P('maintenance.create'), V(S.maintenanceSchema), inv.maintenanceCtl.create);
r.patch('/maintenance/:id', P('maintenance.update'), V(S.maintenanceUpdateSchema), inv.maintenanceCtl.update);

// dashboard / reports / settings / audit / notifications
r.get('/dashboard', P('dashboard.view'), rep.dashboard); r.get('/dashboard/occupancy', P('dashboard.view'), rep.occupancyTrend); r.get('/dashboard/revenue', P('dashboard.view'), rep.revenueOverview);
r.get('/reports/:type', P('reports.view'), rep.report);
r.get('/settings', admin.getSettings); r.put('/settings', P('settings.manage'), V(S.settingsSchema), admin.updateSettings);
r.get('/audit-logs', P('audit.view'), admin.listAudit);
r.get('/notifications', admin.listNotifications); r.post('/notifications/read', admin.markNotificationsRead);
export default r;
