'use strict';
const clock = require('../clock');
const { zonedToUtc, localDate, addDays, isoWeekday, toMinutes } = require('../time');
const { shiftWindow } = require('./shifts');

/** Hitung kejadian (scheduled_at, due_at) sebuah jadwal pada satu tanggal lokal outlet. */
function occurrencesFor(s, dateStr, tz) {
  if (s.start_date && dateStr < s.start_date) return [];
  if (s.end_date && dateStr > s.end_date) return [];
  if (s.days_of_week) {
    const days = String(s.days_of_week).split(',').map(Number);
    if (!days.includes(isoWeekday(dateStr))) return [];
  }
  const start = zonedToUtc(dateStr, s.start_time, tz).getTime();
  if (s.recurrence === 'interval') {
    let span = toMinutes(s.end_time) - toMinutes(s.start_time);
    if (span < 0) span += 1440; // melewati tengah malam
    const step = s.interval_minutes;
    const dueAfter = s.due_after_minutes || step;
    const out = [];
    for (let m = 0; m <= span; m += step) {
      const at = start + m * 60000;
      out.push({ scheduled_at: new Date(at), due_at: new Date(at + dueAfter * 60000) });
    }
    return out;
  }
  let due = zonedToUtc(dateStr, s.due_time, tz).getTime();
  if (due <= start) due += 86400000; // deadline melewati tengah malam (closing)
  return [{ scheduled_at: new Date(start), due_at: new Date(due) }];
}

/**
 * Buat task_instances untuk kemarin & hari ini (per zona outlet). Idempoten:
 * UNIQUE(schedule_id, scheduled_at) + INSERT OR IGNORE mencegah duplikasi.
 * Kejadian yang deadline-nya sebelum jadwal dibuat tidak di-generate (agar tidak langsung "Terlambat").
 */
function generateInstances(db, now = clock.now()) {
  const rows = db.all(`
    SELECT s.*, a.template_id, a.outlet_id, a.mode, a.assignee_type, a.assignee_role, a.assignee_team,
      a.assignee_user_id, a.shift_no, a.created_at AS assignment_created_at, t.name, t.category, t.is_critical,
      t.requires_photo, t.requires_verification, o.timezone
    FROM task_schedules s
    JOIN task_assignments a ON a.id = s.assignment_id AND a.active = 1
    JOIN task_templates t ON t.id = a.template_id AND t.active = 1
    JOIN outlets o ON o.id = a.outlet_id AND o.active = 1
    JOIN brands b ON b.id = o.brand_id AND b.active = 1
    WHERE s.active = 1`);
  const nowIso = now.toISOString();
  const shifts = new Map(db.all('SELECT * FROM outlet_shifts').map((s) => [`${s.outlet_id}:${s.shift_no}`, s]));
  let created = 0;
  db.tx(() => {
    for (const s of rows) {
      const today = localDate(now, s.timezone);
      const since = s.created_at > s.assignment_created_at ? s.created_at : s.assignment_created_at;
      for (const d of [addDays(today, -1), today]) {
        const sh = s.shift_no ? shifts.get(`${s.outlet_id}:${s.shift_no}`) : null;
        const shiftEnd = sh ? shiftWindow(sh, d, s.timezone).end_at : null;
        for (const occ of occurrencesFor(s, d, s.timezone)) {
          if (occ.due_at.toISOString() <= since) continue;
          const r = db.run(`INSERT OR IGNORE INTO task_instances
            (schedule_id, assignment_id, template_id, outlet_id, business_date, scheduled_at, due_at, name, category,
             is_critical, requires_photo, requires_verification, mode, assignee_type, assignee_role, assignee_team,
             assignee_user_id, shift_no, shift_end_at, status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'belum',?,?)`,
          s.id, s.assignment_id, s.template_id, s.outlet_id, d, occ.scheduled_at.toISOString(), occ.due_at.toISOString(),
          s.name, s.category, s.is_critical, s.requires_photo, s.requires_verification, s.mode, s.assignee_type,
          s.assignee_role, s.assignee_team, s.assignee_user_id, s.shift_no, shiftEnd, nowIso, nowIso);
          created += Number(r.changes);
        }
      }
    }
  });
  return created;
}

module.exports = { generateInstances, occurrencesFor };
