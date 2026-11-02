'use strict';
const { bad } = require('./errors');
const { TIME_RE, DATE_RE, toMinutes } = require('./time');

const str = (v, field, { max = 200, required = false } = {}) => {
  const s = v === undefined || v === null ? '' : String(v).trim();
  if (required && !s) throw bad(`${field} wajib diisi.`);
  if (s.length > max) throw bad(`${field} maksimal ${max} karakter.`);
  return s || null;
};
const flag = (v) => (v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0);
const int = (v, field) => {
  const n = Number(v);
  if (!Number.isInteger(n)) throw bad(`${field} tidak valid.`);
  return n;
};
const optInt = (v, field) => (v === undefined || v === null || v === '' ? null : int(v, field));

/** Normalisasi & validasi definisi jadwal berulang. */
function schedule(input) {
  const s = input || {};
  const recurrence = s.recurrence || 'daily';
  if (!['daily', 'weekly', 'interval'].includes(recurrence)) throw bad('Jenis pengulangan tidak valid.');
  const time = (v, f, req) => {
    if (v === undefined || v === null || v === '') { if (req) throw bad(`${f} wajib diisi.`); return null; }
    if (!TIME_RE.test(String(v))) throw bad(`${f} harus berformat JJ:MM.`);
    return String(v);
  };
  const out = {
    recurrence,
    start_time: time(s.start_time, 'Jam mulai', true),
    due_time: null, end_time: null, interval_minutes: null, due_after_minutes: null, days_of_week: null,
    start_date: null, end_date: null,
  };
  if (s.days_of_week !== undefined && s.days_of_week !== null && s.days_of_week !== '') {
    const days = (Array.isArray(s.days_of_week) ? s.days_of_week : String(s.days_of_week).split(','))
      .map(Number).filter((d) => d >= 1 && d <= 7);
    if (!days.length) throw bad('Hari tidak valid.');
    out.days_of_week = [...new Set(days)].sort().join(',');
  }
  if (recurrence === 'weekly' && !out.days_of_week) throw bad('Pilih minimal satu hari untuk jadwal mingguan.');
  if (recurrence === 'daily') out.days_of_week = null;
  if (recurrence === 'interval') {
    out.end_time = time(s.end_time, 'Jam selesai', true);
    out.interval_minutes = int(s.interval_minutes, 'Interval');
    if (out.interval_minutes < 15) throw bad('Interval minimal 15 menit.');
    out.due_after_minutes = optInt(s.due_after_minutes, 'Batas waktu') || out.interval_minutes;
    if (out.due_after_minutes <= 0) throw bad('Batas waktu harus lebih dari 0 menit.');
    let span = toMinutes(out.end_time) - toMinutes(out.start_time);
    if (span < 0) span += 1440;
    if (span / out.interval_minutes > 96) throw bad('Terlalu banyak kejadian per hari.');
  } else {
    out.due_time = time(s.due_time, 'Deadline', true);
    if (out.due_time === out.start_time) throw bad('Deadline tidak boleh sama dengan jam mulai.');
  }
  for (const k of ['start_date', 'end_date']) {
    if (s[k]) {
      if (!DATE_RE.test(String(s[k]))) throw bad('Tanggal harus berformat YYYY-MM-DD.');
      out[k] = String(s[k]);
    }
  }
  if (out.start_date && out.end_date && out.end_date < out.start_date) throw bad('Tanggal selesai sebelum tanggal mulai.');
  return out;
}

module.exports = { str, flag, int, optInt, schedule };
