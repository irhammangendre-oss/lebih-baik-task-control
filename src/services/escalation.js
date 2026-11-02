'use strict';
const clock = require('../clock');
const { addDays, localDate } = require('../time');
const { notify } = require('./notify');

function hhmm(iso, tz) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
}

function usersAtOutlet(db, outletId, where = '', ...params) {
  return db.all(`SELECT u.id, uo.team FROM users u JOIN user_outlets uo ON uo.user_id = u.id
    WHERE uo.outlet_id = ? AND u.active = 1 ${where}`, outletId, ...params).map((r) => r.id);
}

function assigneeIds(db, inst) {
  if (inst.assignee_type === 'user') return [inst.assignee_user_id];
  if (inst.assignee_type === 'role') return usersAtOutlet(db, inst.outlet_id, 'AND u.role_code = ?', inst.assignee_role);
  return usersAtOutlet(db, inst.outlet_id, 'AND uo.team = ?', inst.assignee_team);
}

function picIds(db, inst) {
  const team = inst.assignee_type === 'team' ? inst.assignee_team
    : inst.assignee_type === 'user'
      ? (db.get('SELECT team FROM user_outlets WHERE user_id = ? AND outlet_id = ?', inst.assignee_user_id, inst.outlet_id) || {}).team
      : null;
  const ids = team
    ? usersAtOutlet(db, inst.outlet_id, "AND u.role_code = 'pic' AND (uo.team IS NULL OR uo.team = ?)", team)
    : usersAtOutlet(db, inst.outlet_id, "AND u.role_code = 'pic'");
  if (inst.assignee_type === 'user') {
    const sup = db.get('SELECT reports_to_user_id FROM users WHERE id = ?', inst.assignee_user_id);
    if (sup && sup.reports_to_user_id) ids.push(sup.reports_to_user_id);
  }
  return ids;
}

function recipientsFor(db, inst, stage) {
  if (stage === 1) return [...assigneeIds(db, inst), ...picIds(db, inst)];
  if (stage === 2) return usersAtOutlet(db, inst.outlet_id, "AND u.role_code = 'head'");
  if (stage === 3) return usersAtOutlet(db, inst.outlet_id, "AND u.role_code = 'spv'");
  return [];
}

/**
 * Tahap 1: terlambat -> karyawan + PIC. Tahap 2: belum selesai setelah X menit -> Head.
 * Tahap 3: belum selesai setelah Y menit ATAU tugas yang sama sering terlewat -> SPV.
 * Tahap 4: Management melihat masalah berulang di dashboard (tanpa notifikasi).
 * Setiap tahap hanya dikirim sekali per tugas per penerima.
 */
function runEscalation(db, now = clock.now()) {
  const rules = Object.fromEntries(db.all('SELECT * FROM escalation_rules').map((r) => [r.code, r]));
  const nowIso = now.toISOString();
  const horizon = new Date(now.getTime() - 3 * 86400000).toISOString();
  const rows = db.all(`SELECT ti.*, o.name AS outlet_name, o.timezone FROM task_instances ti
    JOIN outlets o ON o.id = ti.outlet_id AND o.active = 1
    WHERE ti.status IN ('belum','perlu_perbaikan') AND ti.due_at < ? AND ti.due_at >= ? AND ti.escalation_stage < 3`,
  nowIso, horizon);
  let sent = 0;
  db.tx(() => {
    for (const inst of rows) {
      const rule = (inst.is_critical && rules.critical) || rules.default;
      if (!rule) continue;
      const lateMin = Math.floor((now.getTime() - Date.parse(inst.due_at)) / 60000);
      let target = 0;
      if (lateMin >= rule.stage1_after_minutes) target = 1;
      if (lateMin >= rule.stage2_after_minutes) target = 2;
      if (lateMin >= rule.stage3_after_minutes) target = 3;
      let repeatCount = 0;
      if (target >= 1 && target < 3) {
        const since = addDays(localDate(now, inst.timezone), -(rule.repeat_window_days - 1));
        repeatCount = db.get(`SELECT COUNT(*) AS c FROM task_instances WHERE template_id = ? AND outlet_id = ?
            AND id <> ? AND business_date >= ? AND (was_late = 1 OR (status IN ('belum','perlu_perbaikan') AND due_at < ?))`,
        inst.template_id, inst.outlet_id, inst.id, since, nowIso).c + 1;
        if (repeatCount >= rule.repeat_threshold) target = 3;
      }
      if (target <= inst.escalation_stage) continue;
      const due = hhmm(inst.due_at, inst.timezone);
      for (let stage = inst.escalation_stage + 1; stage <= target; stage++) {
        const msg = stage === 1
          ? `Tugas terlambat: "${inst.name}" di ${inst.outlet_name} (deadline ${due}). Segera selesaikan.`
          : stage === 2
            ? `Eskalasi Head: "${inst.name}" di ${inst.outlet_name} belum selesai, terlambat ${lateMin} menit.`
            : `Eskalasi SPV: "${inst.name}" di ${inst.outlet_name} belum selesai (terlambat ${lateMin} menit).`
              + (repeatCount >= rule.repeat_threshold ? ` Terlewat ${repeatCount}x dalam ${rule.repeat_window_days} hari.` : '');
        for (const uid of new Set(recipientsFor(db, inst, stage))) {
          if (notify(db, { userId: uid, instanceId: inst.id, kind: 'escalation', stage, message: msg, dedupeKey: `esc:${inst.id}:${stage}:${uid}` })) sent++;
        }
      }
      db.run('UPDATE task_instances SET escalation_stage = ?, last_escalated_at = ? WHERE id = ?', target, nowIso, inst.id);
    }
  });
  return sent;
}

module.exports = { runEscalation };
