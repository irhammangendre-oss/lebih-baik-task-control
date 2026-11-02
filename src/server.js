'use strict';
const config = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');
const { runJobs } = require('./services/jobs');
const { ensureBaseData } = require('./seed');

const db = openDb(config.dbPath);
ensureBaseData(db);
const app = createApp(db);

function tick() {
  try {
    const r = runJobs(db);
    if (r.created || r.notified) console.log(`[jobs] ${new Date().toISOString()} tugas baru=${r.created} notifikasi=${r.notified}`);
  } catch (e) {
    console.error('[jobs] gagal:', e);
  }
}

tick();
if (config.jobIntervalSeconds > 0) setInterval(tick, config.jobIntervalSeconds * 1000).unref();

const server = app.listen(config.port, () => console.log(`Lebih Baik Task Control berjalan di http://localhost:${config.port}`));
function shutdown() { server.close(() => { db.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
