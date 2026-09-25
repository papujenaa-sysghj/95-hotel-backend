import * as auth from '../services/auth.service.js';
import { audit } from '../services/audit.service.js';
import { ok, asyncHandler } from '../utils/ApiError.js';
import { User } from '../models/index.js';

const cookieOpts = { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 864e5, path: '/api/auth' };
export const login = asyncHandler(async (req, res) => {
  const r = await auth.login(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  req.user = r.userDoc; await audit(req, 'auth.login', { entity: 'User', entityId: r.userDoc._id, summary: `${r.user.name} logged in` });
  res.cookie('refreshToken', r.refreshToken, cookieOpts);
  ok(res, { user: r.user, accessToken: r.accessToken, refreshToken: r.refreshToken }, 'Logged in successfully');
});
export const refresh = asyncHandler(async (req, res) => {
  const token = req.body?.refreshToken || req.headers.cookie?.match(/refreshToken=([^;]+)/)?.[1];
  const r = await auth.refresh(token || '');
  res.cookie('refreshToken', r.refreshToken, cookieOpts); ok(res, r);
});
export const logout = asyncHandler(async (req, res) => { await auth.logout(req.user._id); await audit(req, 'auth.logout', { entity: 'User', entityId: req.user._id, summary: `${req.user.name} logged out` }); res.clearCookie('refreshToken', { path: '/api/auth' }); ok(res, {}, 'Logged out'); });
export const me = asyncHandler(async (req, res) => ok(res, { user: auth.publicUser(req.user) }));
export const changePassword = asyncHandler(async (req, res) => { await auth.changePassword(req.user._id, req.body); await audit(req, 'auth.password_change', { entity: 'User', entityId: req.user._id, summary: `${req.user.name} changed password` }); ok(res, {}, 'Password changed. Please log in again.'); });
export const forgot = asyncHandler(async (req, res) => { await auth.forgotPassword(req.body.email || ''); ok(res, {}, 'If that email exists, a reset link has been sent.'); });
export const reset = asyncHandler(async (req, res) => { await auth.resetPassword(req.body); ok(res, {}, 'Password reset. You can now log in.'); });
export const loginActivity = asyncHandler(async (req, res) => { const u = await User.findById(req.user._id).select('loginHistory'); ok(res, { history: [...u.loginHistory].reverse() }); });
