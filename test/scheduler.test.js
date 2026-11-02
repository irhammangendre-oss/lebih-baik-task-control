'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { occurrencesFor } = require('../src/services/scheduler');
const { zonedToUtc, localDate } = require('../src/time');
const { setup } = require('./helpers');

test('konversi zona waktu WIB/WITA', () => {
  assert.equal(zonedToUtc('2026-11-02', '08:00', 'Asia/Jakarta').toISOString(), '2026-11-02T01:00:00.000Z');
  assert.equal(zonedToUtc('2026-11-02', '08:00', 'Asia/Makassar').toISOString(), '2026-11-02T00:00:00.000Z');
  assert.equal(localDate(new Date('2026-11-02T18:00:00Z'), 'Asia/Jakarta'), '2026-11-03');
});

test('jadwal interval per jam (inspeksi toilet) menghasilkan kejadian yang benar', () => {
  const occ = occurrencesFor({ recurrence: 'interval', start_time: '09:00', end_time: '21:00', interval_minutes: 60, due_after_minutes: 30 }, '2026-11-02', 'Asia/Jakarta');
  assert.equal(occ.length, 13);
  assert.equal(occ[0].scheduled_at.toISOString(), '2026-11-02T02:00:00.000Z');
  assert.equal(occ[0].due_at.toISOString(), '2026-11-02T02:30:00.000Z');
  assert.equal(occ[12].scheduled_at.toISOString(), '2026-11-02T14:00:00.000Z');
});

test('deadline closing melewati tengah malam dan jadwal mingguan', () => {
  const [o] = occurrencesFor({ recurrence: 'daily', start_time: '22:00', due_time: '00:30' }, '2026-11-02', 'Asia/Jakarta');
  assert.equal(o.due_at.toISOString(), '2026-11-02T17:30:00.000Z');
  // 2026-11-02 = Senin
  assert.equal(occurrencesFor({ recurrence: 'weekly', days_of_week: '1,3', start_time: '08:00', due_time: '09:00' }, '2026-11-02', 'Asia/Jakarta').length, 1);
  assert.equal(occurrencesFor({ recurrence: 'weekly', days_of_week: '2', start_time: '08:00', due_time: '09:00' }, '2026-11-02', 'Asia/Jakarta').length, 0);
});

test('generate tugas idempoten (tidak ada duplikasi)', () => {
  const ctx = setup();
  const count = () => ctx.db.get('SELECT COUNT(*) AS c FROM task_instances').c;
  const before = count();
  assert.ok(before > 0);
  ctx.jobs();
  ctx.jobs();
  assert.equal(count(), before);
  // Template tidak otomatis ditugaskan ke semua outlet: BAKMI-01 hanya punya 4 template.
  const bakmiTemplates = ctx.db.get('SELECT COUNT(DISTINCT template_id) AS c FROM task_instances WHERE outlet_id = ?', ctx.demo.outlets.m1).c;
  assert.equal(bakmiTemplates, 4);
});
