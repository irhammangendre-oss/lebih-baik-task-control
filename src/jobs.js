'use strict';
// Jalankan sekali: generate tugas terjadwal + eskalasi. Cocok untuk cron (mis. tiap menit).
const config = require('./config');
const { openDb } = require('./db');
const { runJobs } = require('./services/jobs');
const { ensureBaseData } = require('./seed');

const db = openDb(config.dbPath);
ensureBaseData(db);
console.log(JSON.stringify({ at: new Date().toISOString(), ...runJobs(db) }));
db.close();
