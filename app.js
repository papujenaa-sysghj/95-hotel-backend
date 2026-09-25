import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import routes from './routes/index.js';
import { env } from './config/env.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';

import path from 'path';

const app = express();
app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({ origin: env.clientUrl.split(','), credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));
// Strip Mongo operators ($, .) from user input to block NoSQL injection
const sanitize = (o) => { if (o && typeof o === 'object') for (const k of Object.keys(o)) { if (k.startsWith('$') || k.includes('.')) delete o[k]; else sanitize(o[k]); } return o; };
app.use((req, _res, next) => { sanitize(req.body); sanitize(req.query); sanitize(req.params); next(); });
if (env.nodeEnv !== 'test') app.use(morgan('dev'));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: true, message: { success: false, message: 'Too many requests. Slow down.' } }));
app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);
export default app;
