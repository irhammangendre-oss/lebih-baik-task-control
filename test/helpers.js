'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Harus di-set sebelum modul src/config dimuat.
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-test-uploads-'));
process.env.JOB_INTERVAL_SECONDS = '0';

const request = require('supertest');
const config = require('../src/config');
const clock = require('../src/clock');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { ensureBaseData, seedDemo } = require('../src/seed');
const { runJobs } = require('../src/services/jobs');

const H = { 'X-Requested-With': 'lb-app' };
// JPEG minimal yang valid secara magic bytes.
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(64, 1), Buffer.from([0xff, 0xd9])]);

/** WIB (UTC+7) jam lokal -> ISO UTC pada tanggal tertentu. */
const wib = (date, hhmm) => new Date(`${date}T${hhmm}:00+07:00`);

function setup({ date = '2026-11-02', time = '08:00', notifications = true } = {}) {
  config.notificationsEnabled = notifications;
  let now = wib(date, time).getTime();
  clock.set(() => now);
  const db = openDb(':memory:');
  ensureBaseData(db, { adminPassword: 'admin12345', quiet: true });
  const demo = seedDemo(db, { password: 'demo1234', createdAt: wib(date, '00:00').toISOString() });
  db.run("UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE username = 'crew') WHERE username = 'admin'");
  const app = createApp(db);
  runJobs(db);
  const ctx = {
    db, app, demo, H, JPEG,
    setTime: (d, t) => { now = wib(d, t).getTime(); },
    advanceMinutes: (m) => { now += m * 60000; },
    jobs: () => runJobs(db),
    async login(username, password = 'demo1234') {
      const agent = request.agent(app);
      const res = await agent.post('/api/auth/login').set(H).send({ username, password });
      if (res.status !== 200) throw new Error(`login ${username} gagal: ${res.status} ${JSON.stringify(res.body)}`);
      const wrap = (m) => (url) => agent[m](url).set(H);
      return { agent, me: res.body, get: wrap('get'), post: wrap('post'), put: wrap('put'), delete: wrap('delete') };
    },
  };
  return ctx;
}

module.exports = { setup, request, H, JPEG, wib, clock };
