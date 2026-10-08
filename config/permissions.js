// Single source of truth for permission keys. Roles store these keys; code only ever asks requirePermission(key).
export const PERMISSIONS = {
  dashboard: ['view'],
  bookings: ['view', 'create', 'edit', 'cancel', 'edit_rate', 'give_discount'],
  calendar: ['view', 'edit'],
  checkin: ['perform'], checkout: ['perform'],
  rooms: ['view', 'create', 'edit', 'delete', 'configure'], // configure = temp AC/Non-AC & room configuration
  guests: ['view', 'create', 'edit'],
  payments: ['view', 'create', 'refund'],
  invoices: ['view', 'create'],
  housekeeping: ['view', 'update'],
  maintenance: ['view', 'create', 'update'],
  users: ['view', 'create', 'edit', 'delete'],
  roles: ['view', 'manage'],
  reports: ['view'], settings: ['manage'], audit: ['view'],
};
export const ALL_KEYS = Object.entries(PERMISSIONS).flatMap(([g, acts]) => acts.map((a) => `${g}.${a}`));
const pick = (...prefixes) => ALL_KEYS.filter((k) => prefixes.some((p) => k.startsWith(p)));

export const DEFAULT_ROLES = [
  { name: 'Admin', description: 'Super admin / owner — full access', permissions: ['*'] },
  { name: 'Manager', description: 'Operations manager', permissions: ALL_KEYS.filter((k) => !['users.delete', 'roles.manage', 'settings.manage'].includes(k)) },
  { name: 'Receptionist', description: 'Front desk', permissions: [
    'dashboard.view', 'bookings.view', 'bookings.create', 'bookings.edit', 'bookings.cancel', 'bookings.give_discount', 'calendar.view', 'calendar.edit', 'checkin.perform', 'checkout.perform',
    'rooms.view', 'guests.view', 'guests.create', 'guests.edit', 'payments.view', 'payments.create', 'invoices.view', 'invoices.create',
    'housekeeping.view', 'maintenance.view', 'maintenance.create'] },
  { name: 'Cashier', description: 'Payments & invoices', permissions: ['dashboard.view', 'bookings.view', 'guests.view', 'payments.view', 'payments.create', 'payments.refund', 'invoices.view', 'invoices.create', 'reports.view', 'checkout.perform'] },
  { name: 'Housekeeping', description: 'Cleaning & room readiness', permissions: ['rooms.view', 'housekeeping.view', 'housekeeping.update', 'maintenance.view', 'maintenance.create'] },
];
