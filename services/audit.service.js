import { AuditLog } from '../models/index.js';
export const audit = (req, action, { entity, entityId, summary, meta } = {}) =>
  AuditLog.create({ user: req.user?._id, userName: req.user?.name, action, entity, entityId, summary, meta, ip: req.ip }).catch((e) => console.error('audit failed', e.message));
