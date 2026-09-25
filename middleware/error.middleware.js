import { ZodError } from 'zod';
import { env } from '../config/env.js';

export const notFound = (req, res) => res.status(404).json({ success: false, message: `Route not found: ${req.method} ${req.originalUrl}` });

export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(422).json({ success: false, message: err.issues[0]?.message || 'Validation failed', errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })) });
  }
  if (err.code === 11000) return res.status(409).json({ success: false, message: 'A record with the same unique value already exists.' });
  if (err.name === 'CastError') return res.status(400).json({ success: false, message: 'Invalid identifier supplied.' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ success: false, message: status >= 500 && env.nodeEnv === 'production' ? 'Something went wrong. Please try again.' : err.message, ...(err.details ? { details: err.details } : {}) });
};
