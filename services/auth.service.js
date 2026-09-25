import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env.js';
import { User } from '../models/index.js';
import { ApiError } from '../utils/ApiError.js';
import { sendMail } from './notification.service.js';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const signAccess = (u) => jwt.sign({ sub: u._id }, env.jwtSecret, { expiresIn: '15m' });
export const signRefresh = (u) => jwt.sign({ sub: u._id }, env.jwtRefreshSecret, { expiresIn: '7d' });
export const hashPassword = (p) => bcrypt.hash(p, 12);

export const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, phone: u.phone, department: u.department, role: u.role?.name, permissions: u.role?.permissions || [] });

export const login = async ({ identifier, password }, meta) => {
  const user = await User.findOne({ $or: [{ email: identifier.toLowerCase() }, { username: identifier.toLowerCase() }] }).select('+password +refreshTokenHash').populate('role');
  const fail = async () => { if (user) { user.loginHistory.push({ at: new Date(), ...meta, success: false }); user.loginHistory = user.loginHistory.slice(-30); await user.save(); } throw new ApiError(401, 'Invalid email/username or password.'); };
  if (!user || !(await bcrypt.compare(password, user.password))) return fail();
  if (!user.isActive) throw new ApiError(403, 'This account has been disabled. Contact your administrator.');
  const refreshToken = signRefresh(user);
  user.refreshTokenHash = sha(refreshToken); user.lastLoginAt = new Date();
  user.loginHistory.push({ at: new Date(), ...meta, success: true }); user.loginHistory = user.loginHistory.slice(-30);
  await user.save();
  return { user: publicUser(user), accessToken: signAccess(user), refreshToken, userDoc: user };
};

export const refresh = async (token) => {
  let p; try { p = jwt.verify(token, env.jwtRefreshSecret); } catch { throw new ApiError(401, 'Session expired. Please log in again.'); }
  const user = await User.findById(p.sub).select('+refreshTokenHash').populate('role');
  if (!user || !user.isActive || user.refreshTokenHash !== sha(token)) throw new ApiError(401, 'Session expired. Please log in again.');
  const refreshToken = signRefresh(user); user.refreshTokenHash = sha(refreshToken); await user.save(); // rotation
  return { accessToken: signAccess(user), refreshToken, user: publicUser(user) };
};

export const logout = (userId) => User.findByIdAndUpdate(userId, { $unset: { refreshTokenHash: 1 } });

export const changePassword = async (userId, { currentPassword, newPassword }) => {
  const u = await User.findById(userId).select('+password');
  if (!(await bcrypt.compare(currentPassword, u.password))) throw new ApiError(400, 'Current password is incorrect.');
  u.password = await hashPassword(newPassword); u.refreshTokenHash = undefined; await u.save();
};

export const forgotPassword = async (email) => {
  const u = await User.findOne({ email: email.toLowerCase(), isActive: true });
  if (!u) return; // never reveal whether an account exists
  const raw = crypto.randomBytes(32).toString('hex');
  u.resetTokenHash = sha(raw); u.resetTokenExpires = new Date(Date.now() + 30 * 60 * 1000); await u.save();
  await sendMail({ to: u.email, subject: 'Reset your password', text: `Reset link (valid 30 min): ${env.clientUrl}/reset-password?token=${raw}` });
};

export const resetPassword = async ({ token, newPassword }) => {
  const u = await User.findOne({ resetTokenHash: sha(token), resetTokenExpires: { $gt: new Date() } });
  if (!u) throw new ApiError(400, 'This reset link is invalid or has expired.');
  u.password = await hashPassword(newPassword); u.resetTokenHash = undefined; u.resetTokenExpires = undefined; u.refreshTokenHash = undefined; await u.save();
};
