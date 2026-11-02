'use strict';
// Helper zona waktu tanpa dependensi (Intl). Outlet menyimpan zona IANA, mis. Asia/Jakarta.
const cache = new Map();
function fmt(tz) {
  if (!cache.has(tz)) {
    cache.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  return cache.get(tz);
}
function parts(ms, tz) {
  const o = {};
  for (const p of fmt(tz).formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
function offsetMs(ms, tz) {
  const p = parts(ms, tz);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}
/** Tanggal+jam lokal di zona tz -> Date (UTC). */
function zonedToUtc(dateStr, timeStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const [hh, mm] = timeStr.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = offsetMs(guess, tz);
  let res = guess - off;
  const off2 = offsetMs(res, tz);
  if (off2 !== off) res = guess - off2;
  return new Date(res);
}
function localDate(date, tz) {
  const p = parts(date instanceof Date ? date.getTime() : date, tz);
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** 1 = Senin ... 7 = Minggu */
function isoWeekday(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const toMinutes = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
function isValidTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
module.exports = { zonedToUtc, localDate, addDays, isoWeekday, TIME_RE, DATE_RE, toMinutes, isValidTz };
