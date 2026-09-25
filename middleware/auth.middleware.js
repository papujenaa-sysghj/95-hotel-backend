import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError, asyncHandler } from '../utils/ApiError.js';

export const authenticate = asyncHandler(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new ApiError(401, 'Please log in to continue.');
  let payload;
  try { payload = jwt.verify(token, env.jwtSecret); } catch { throw new ApiError(401, 'Your session has expired. Please log in again.'); }
  const user = await User.findById(payload.sub).populate('role');
  if (!user || !user.isActive) throw new ApiError(401, 'This account is inactive or no longer exists.');
  req.user = user;
  req.permissions = new Set(user.role?.permissions || []); // loaded fresh each request so permission edits apply immediately
  next();
});
