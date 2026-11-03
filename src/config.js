'use strict';
const path = require('node:path');

const root = path.resolve(__dirname, '..');

module.exports = {
  port: Number(process.env.PORT || 3000),
  dbPath: process.env.DB_PATH || path.join(root, 'data', 'app.db'),
  uploadDir: process.env.UPLOAD_DIR || path.join(root, 'data', 'uploads'),
  sessionDays: Number(process.env.SESSION_DAYS || 14),
  // Interval job internal (generate tugas + eskalasi). 0 = matikan (pakai `npm run jobs` via cron).
  jobIntervalSeconds: Number(process.env.JOB_INTERVAL_SECONDS ?? 60),
  // Fitur notifikasi (lonceng in-app + webhook). Default MATI; set NOTIFICATIONS_ENABLED=true untuk menyalakan.
  notificationsEnabled: process.env.NOTIFICATIONS_ENABLED === 'true',
  // Opsional: URL webhook untuk meneruskan notifikasi eskalasi (WhatsApp/Telegram gateway, dll.)
  notifyWebhookUrl: process.env.NOTIFY_WEBHOOK_URL || '',
  // Tugas harian/mingguan boleh dikerjakan X menit sebelum jam mulainya (tugas per interval tidak).
  earlyStartMinutes: Number(process.env.EARLY_START_MINUTES ?? 60),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8),
  secureCookies: process.env.NODE_ENV === 'production',
  publicDir: path.join(root, 'public'),
};
