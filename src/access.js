'use strict';
const { notFound } = require('./errors');
const { OPEN_STATUSES } = require('./constants');
const clock = require('./clock');
const config = require('./config');

/** Melempar 404 (bukan 403) agar keberadaan data outlet lain tidak bocor. */
function assertOutlet(user, outletId) {
  if (!user.outletIds.has(Number(outletId))) throw notFound('Outlet tidak ditemukan atau Anda tidak memiliki akses.');
}

function teamAt(user, outletId) {
  const o = user.outlets.find((x) => x.outlet_id === Number(outletId));
  return o ? o.team || null : null;
}

/** Tugas shift yang belum selesai setelah shift-nya berakhir -> dioper ke shift berikutnya (tetap terlihat). */
function isCarriedOver(inst, nowIso = clock.nowIso()) {
  return !!(inst.shift_no && inst.shift_end_at && OPEN_STATUSES.includes(inst.status) && nowIso >= inst.shift_end_at);
}

/**
 * Apakah user termasuk penanggung jawab tugas (individu / peran / tim / shift).
 * Tugas ber-shift hanya untuk karyawan di shift tsb; karyawan tanpa jadwal shift dianggap fleksibel.
 * Setelah shift berakhir, tugas yang belum selesai boleh dikerjakan shift berikutnya.
 */
function isAssignee(user, inst, nowIso = clock.nowIso()) {
  if (!user.assignedOutletIds.has(inst.outlet_id) && !user.perms.has('scope.all')) return false;
  const onShift = () => {
    if (!inst.shift_no || isCarriedOver(inst, nowIso)) return true;
    const s = user.shiftOn ? user.shiftOn(inst.outlet_id, inst.business_date) : null;
    return s === null || s === inst.shift_no;
  };
  if (inst.assignee_type === 'user') return inst.assignee_user_id === user.id;
  if (inst.assignee_type === 'role') return inst.assignee_role === user.role_code && onShift();
  if (inst.assignee_type === 'team') return !!inst.assignee_team && teamAt(user, inst.outlet_id) === inst.assignee_team && onShift();
  if (inst.assignee_type === 'shift') return user.assignedOutletIds.has(inst.outlet_id) && onShift();
  return false;
}

function canComplete(user, inst) {
  if (!user.perms.has('task.complete') || !user.outletIds.has(inst.outlet_id)) return false;
  if (user.perms.has('task.complete_any')) return true;
  return isAssignee(user, inst);
}

function monitorLevel(user) {
  const p = user.perms;
  if (p.has('monitor.all')) return 'all';
  if (p.has('monitor.multi')) return 'multi';
  if (p.has('monitor.outlet')) return 'outlet';
  if (p.has('monitor.team')) return 'team';
  return null;
}

/**
 * Untuk monitoring level "team" (PIC): tugas tim/area yang sama, tugas individu milik anggota tim
 * atau bawahan langsungnya, serta tugas per-peran di outlet tersebut.
 * memberInfo(userId, outletId) -> { team, reports_to_user_id }
 */
function inTeamScope(user, inst, memberInfo) {
  const team = teamAt(user, inst.outlet_id);
  const myShift = user.shiftOn ? user.shiftOn(inst.outlet_id, inst.business_date) : null;
  if (inst.shift_no && myShift !== null && myShift !== inst.shift_no && !isCarriedOver(inst)) return false;
  if (inst.assignee_type === 'role' || inst.assignee_type === 'shift') return true;
  if (inst.assignee_type === 'team') return !team || inst.assignee_team === team;
  if (inst.assignee_user_id === user.id) return true;
  const m = memberInfo(inst.assignee_user_id, inst.outlet_id) || {};
  if (m.reports_to_user_id === user.id) return true;
  return !team || m.team === team;
}

function memberInfoLookup(db) {
  const cache = new Map();
  return (userId, outletId) => {
    const k = `${userId}:${outletId}`;
    if (!cache.has(k)) {
      cache.set(k, db.get(`SELECT uo.team, u.reports_to_user_id FROM users u
        LEFT JOIN user_outlets uo ON uo.user_id = u.id AND uo.outlet_id = ? WHERE u.id = ?`, outletId, userId) || null);
    }
    return cache.get(k);
  };
}

const INSTANCE_SELECT = `
  SELECT ti.*, o.name AS outlet_name, o.code AS outlet_code, o.timezone, b.id AS brand_id, b.name AS brand_name,
    cu.name AS completed_by_name, au.name AS assignee_user_name, r.name AS assignee_role_name,
    vu.name AS verified_by_name, sc.recurrence, t.instructions, t.sop_text, t.reference_url,
    (t.reference_image_file IS NOT NULL) AS has_reference_image,
    (SELECT COUNT(*) FROM task_evidence e WHERE e.instance_id = ti.id) AS evidence_count,
    (SELECT MAX(e.id) FROM task_evidence e WHERE e.instance_id = ti.id) AS last_evidence_id
  FROM task_instances ti
  JOIN outlets o ON o.id = ti.outlet_id
  JOIN brands b ON b.id = o.brand_id
  JOIN task_templates t ON t.id = ti.template_id
  JOIN task_schedules sc ON sc.id = ti.schedule_id
  LEFT JOIN users cu ON cu.id = ti.completed_by
  LEFT JOIN users au ON au.id = ti.assignee_user_id
  LEFT JOIN users vu ON vu.id = ti.verified_by
  LEFT JOIN roles r ON r.code = ti.assignee_role`;

function decorate(inst, nowIso = clock.nowIso()) {
  const overdue = OPEN_STATUSES.includes(inst.status) && inst.due_at < nowIso;
  inst.is_overdue = overdue;
  inst.effective_status = overdue ? 'terlambat' : inst.status;
  // Tugas harian/mingguan boleh dikerjakan lebih awal; tugas per interval (mis. inspeksi per jam) tidak.
  const early = inst.recurrence === 'interval' ? 0 : config.earlyStartMinutes;
  inst.available_at = new Date(Date.parse(inst.scheduled_at) - early * 60000).toISOString();
  inst.is_upcoming = nowIso < inst.available_at;
  inst.is_carried_over = isCarriedOver(inst, nowIso);
  inst.completed_after_shift = !!(inst.shift_end_at && inst.completed_at && inst.completed_at > inst.shift_end_at);
  const base = inst.assignee_type === 'user' ? inst.assignee_user_name
    : inst.assignee_type === 'team' ? `Tim ${inst.assignee_team}`
      : inst.assignee_type === 'shift' ? `Semua Shift ${inst.shift_no}`
        : `Semua ${inst.assignee_role_name || inst.assignee_role}`;
  inst.assignee_label = inst.shift_no && inst.assignee_type !== 'shift' && inst.assignee_type !== 'user' ? `${base} · Shift ${inst.shift_no}` : base;
  inst.has_reference_image = !!inst.has_reference_image;
  for (const k of ['is_critical', 'requires_photo', 'requires_verification', 'was_late']) inst[k] = !!inst[k];
  return inst;
}

/** Ambil instance-instance untuk sekumpulan outlet & rentang tanggal bisnis. */
function listInstances(db, outletIds, fromDate, toDate = fromDate) {
  const ids = [...outletIds].map(Number).filter(Number.isInteger);
  if (!ids.length) return [];
  const now = clock.nowIso();
  return db.all(`${INSTANCE_SELECT} WHERE ti.outlet_id IN (${ids.map(() => '?').join(',')})
      AND ti.business_date BETWEEN ? AND ? ORDER BY ti.due_at, ti.name`, ...ids, fromDate, toDate)
    .map((i) => decorate(i, now));
}

function getInstance(db, id) {
  const i = db.get(`${INSTANCE_SELECT} WHERE ti.id = ?`, Number(id));
  return i ? decorate(i) : null;
}

module.exports = {
  assertOutlet, teamAt, isAssignee, isCarriedOver, canComplete, monitorLevel, inTeamScope, memberInfoLookup,
  listInstances, getInstance, decorate, INSTANCE_SELECT,
};
