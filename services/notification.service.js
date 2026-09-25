import nodemailer from 'nodemailer';
import { env } from '../config/env.js';
import { Notification } from '../models/index.js';

export const sendMail = async ({ to, subject, text, html }) => {
  if (!env.smtp.host) { console.log(`[mail disabled] to=${to} subject=${subject}\n${text}`); return; }
  const t = nodemailer.createTransport({ host: env.smtp.host, port: Number(env.smtp.port), auth: { user: env.smtp.user, pass: env.smtp.pass } });
  await t.sendMail({ from: env.smtp.user, to, subject, text, html });
};
export const notify = (type, title, message, extra = {}) => Notification.create({ type, title, message, ...extra }).catch(() => {});
