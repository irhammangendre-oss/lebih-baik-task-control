'use strict';
const clock = require('../clock');
const { zonedToUtc, localDate, addDays } = require('../time');

const DEFAULT_SHIFTS = { 1: ['07:00', '15:00'], 2: ['15:00', '23:00'] };

/** Pastikan setiap outlet punya tepat dua shift (dibuat dengan jam default bila belum ada). */
function ensureOutletShifts(db, outletId = null) {
  const outlets = outletId ? [{ id: outletId }] : db.all('SELECT id FROM outlets');
  const now = clock.nowIso();
  for (const o of outlets) {
    for (const n of [1, 2]) {
      db.run('INSERT OR IGNORE INTO outlet_shifts (outlet_id, shift_no, start_time, end_time, updated_at) VALUES (?,?,?,?,?)',
        o.id, n, DEFAULT_SHIFTS[n][0], DEFAULT_SHIFTS[n][1], now);
    }
  }
}

function getShifts(db, outletId) {
  return db.all('SELECT shift_no, start_time, end_time FROM outlet_shifts WHERE outlet_id = ? ORDER BY shift_no', outletId);
}

/** Rentang waktu (UTC) sebuah shift pada tanggal bisnis tertentu. Shift lewat tengah malam berakhir besoknya. */
function shiftWindow(shift, date, tz) {
  const start = zonedToUtc(date, shift.start_time, tz);
  let end = zonedToUtc(date, shift.end_time, tz);
  if (end <= start) end = new Date(end.getTime() + 86400000);
  return { shift_no: shift.shift_no, business_date: date, start_at: start.toISOString(), end_at: end.toISOString() };
}

/** Shift berikutnya: Shift 1 -> Shift 2 (hari sama), Shift 2 -> Shift 1 (hari berikutnya). */
function nextShift(shiftNo, date) {
  return shiftNo === 1 ? { shift_no: 2, business_date: date } : { shift_no: 1, business_date: addDays(date, 1) };
}

/**
 * Shift yang sedang berjalan di outlet. Jika di luar jam shift: current = null,
 * previous = shift terakhir yang sudah selesai, next = shift berikutnya.
 */
function shiftStatus(db, outlet, now = clock.now()) {
  const tz = outlet.timezone;
  const shifts = getShifts(db, outlet.outlet_id ?? outlet.id);
  const today = localDate(now, tz);
  const nowIso = now.toISOString();
  const windows = [];
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) for (const s of shifts) windows.push(shiftWindow(s, d, tz));
  windows.sort((a, b) => a.start_at.localeCompare(b.start_at));
  const current = windows.find((w) => w.start_at <= nowIso && nowIso < w.end_at) || null;
  const previous = windows.filter((w) => w.end_at <= nowIso).at(-1) || null;
  const next = windows.find((w) => w.start_at > nowIso) || null;
  return { shifts, current, previous, next };
}

/** Shift efektif karyawan pada tanggal tertentu: jadwal per tanggal, jika tidak ada pakai shift tetap. */
function effectiveShift(db, userId, outletId, date) {
  const r = db.get('SELECT shift_no FROM shift_rosters WHERE user_id = ? AND outlet_id = ? AND work_date = ?', userId, outletId, date);
  if (r) return r.shift_no;
  const d = db.get('SELECT shift_no FROM user_outlets WHERE user_id = ? AND outlet_id = ?', userId, outletId);
  return d ? d.shift_no : null;
}

module.exports = { DEFAULT_SHIFTS, ensureOutletShifts, getShifts, shiftWindow, nextShift, shiftStatus, effectiveShift };
