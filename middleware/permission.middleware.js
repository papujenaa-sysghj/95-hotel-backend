import { ApiError } from '../utils/ApiError.js';

export const hasPermission = (req, key) => req.permissions?.has('*') || req.permissions?.has(key);

// authorize('Admin','Manager') — coarse role-name gate (use sparingly; prefer requirePermission)
export const authorize = (...roles) => (req, _res, next) =>
  roles.includes(req.user?.role?.name) || hasPermission(req, '*') ? next() : next(new ApiError(403, "You don't have permission to perform this action."));

// requirePermission('bookings.create') — any of the listed keys is enough
export const requirePermission = (...keys) => (req, _res, next) =>
  keys.some((k) => hasPermission(req, k)) ? next() : next(new ApiError(403, "You don't have permission to perform this action."));
