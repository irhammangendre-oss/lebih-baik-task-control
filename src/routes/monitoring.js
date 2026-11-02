'use strict';
const express = require('express');
const clock = require('../clock');
const { requireAuth } = require('../auth');
const { forbidden } = require('../errors');
const access = require('../access');
const { localDate, addDays, DATE_RE } = require('../time');
const { OPEN_STATUSES, DONE_STATUSES, STATUS } = require('../constants');

function cardsFor(rows, rejectedCount) {
  return {
    total: rows.length,
    completed: rows.filter((t) => DONE_STATUSES.includes(t.status)).length,
    verified: rows.filter((t) => t.status === 'terverifikasi').length,
    waiting_verification: rows.filter((t) => t.status === 'menunggu_verifikasi').length,
    incomplete: rows.filter((t) => OPEN_STATUSES.includes(t.status)).length,
    overdue: rows.filter((t) => t.is_overdue).length,
    late_completed: rows.filter((t) => t.was_late && DONE_STATUSES.includes(t.status)).length,
    rejected: rejectedCount,
  };
}

const slim = (t) => ({
  id: t.id, name: t.name, outlet_id: t.outlet_id, outlet_name: t.outlet_name, brand_name: t.brand_name,
  category: t.category, business_date: t.business_date, scheduled_at: t.scheduled_at, due_at: t.due_at,
  status: t.status, effective_status: t.effective_status, is_overdue: t.is_overdue, was_late: t.was_late,
  assignee_label: t.assignee_label, completed_by_name: t.completed_by_name, completed_at: t.completed_at,
  verified_by_name: t.verified_by_name, verified_at: t.verified_at, requires_photo: t.requires_photo,
  requires_verification: t.requires_verification, is_critical: t.is_critical, evidence_count: t.evidence_count,
  escalation_stage: t.escalation_stage, timezone: t.timezone, mode: t.mode, template_id: t.template_id,
  shift_no: t.shift_no, is_carried_over: t.is_carried_over, completed_after_shift: t.completed_after_shift,
});

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  function scope(req, override = {}) {
    const q = { ...req.query, ...override };
    const user = req.user;
    const level = access.monitorLevel(user);
    if (!level) throw forbidden();
    let outlets = user.outlets;
    if (q.brand_id) outlets = outlets.filter((o) => o.brand_id === Number(q.brand_id));
    if (q.outlet_id) {
      access.assertOutlet(user, q.outlet_id);
      outlets = outlets.filter((o) => o.outlet_id === Number(q.outlet_id));
    }
    const tz = outlets[0]?.timezone || user.outlets[0]?.timezone || 'Asia/Jakarta';
    const date = DATE_RE.test(String(q.date || '')) ? String(q.date) : localDate(clock.now(), tz);
    const memberInfo = access.memberInfoLookup(db);
    const shift = q.shift === '1' || q.shift === '2' ? Number(q.shift) : null;
    const filter = (rows) => (level === 'team' ? rows.filter((t) => access.inTeamScope(user, t, memberInfo)) : rows)
      .filter((t) => !shift || t.shift_no === shift);
    return { user, level, outlets, outletIds: outlets.map((o) => o.outlet_id), date, filter };
  }

  function rejectedCount(rows, date, outletIds) {
    if (!outletIds.length) return 0;
    const ids = new Set(rows.map((t) => t.id));
    return db.all(`SELECT v.instance_id FROM verification_records v JOIN task_instances ti ON ti.id = v.instance_id
      WHERE v.decision = 'rejected' AND ti.business_date = ? AND ti.outlet_id IN (${outletIds.map(() => '?').join(',')})`,
    date, ...outletIds).filter((v) => ids.has(v.instance_id)).length;
  }

  // C. Monitoring / dashboard. Semua angka dihitung dari record database.
  r.get('/monitoring', (req, res) => {
    const { user, level, outlets, outletIds, date, filter } = scope(req);
    const rows = filter(access.listInstances(db, outletIds, date));
    const status = req.query.status && STATUS[req.query.status] ? req.query.status : null;

    const byOutlet = outlets.map((o) => {
      const list = rows.filter((t) => t.outlet_id === o.outlet_id);
      const c = cardsFor(list, 0);
      return {
        outlet_id: o.outlet_id, outlet_name: o.outlet_name, brand_name: o.brand_name, ...c,
        completion_rate: c.total ? Math.round((c.completed / c.total) * 100) : null,
      };
    }).sort((a, b) => (a.completion_rate ?? 101) - (b.completion_rate ?? 101));

    // Antrean verifikasi: 7 hari terakhir, bukan hanya tanggal terpilih.
    const recent = filter(access.listInstances(db, outletIds, addDays(date, -6), date));
    const queue = user.perms.has('task.verify')
      ? recent.filter((t) => t.status === 'menunggu_verifikasi' && t.completed_by !== user.id).map(slim) : [];

    // Masalah berulang: tugas yang terlambat/terlewat >= 2x dalam 7 hari.
    const groups = new Map();
    for (const t of recent) {
      const k = `${t.outlet_id}:${t.template_id}`;
      const g = groups.get(k) || { outlet_id: t.outlet_id, outlet_name: t.outlet_name, brand_name: t.brand_name, template_id: t.template_id, name: t.name, is_critical: t.is_critical, occurrences: 0, missed: 0, last_missed: null };
      g.occurrences++;
      if (t.was_late || t.is_overdue) { g.missed++; if (!g.last_missed || t.due_at > g.last_missed) g.last_missed = t.due_at; }
      groups.set(k, g);
    }
    const repeated = [...groups.values()].filter((g) => g.missed >= 2).sort((a, b) => b.missed - a.missed).slice(0, 50);

    const list = status ? rows.filter((t) => t.effective_status === status) : rows;
    res.json({
      level, date,
      filters: { brand_id: req.query.brand_id || null, outlet_id: req.query.outlet_id || null, status, shift: req.query.shift || null },
      brands: [...new Map(user.outlets.map((o) => [o.brand_id, { id: o.brand_id, name: o.brand_name }])).values()],
      outlets: user.outlets.map((o) => ({ id: o.outlet_id, name: o.outlet_name, brand_id: o.brand_id })),
      cards: cardsFor(rows, rejectedCount(rows, date, outletIds)),
      by_outlet: level === 'team' ? [] : byOutlet,
      verification_queue: queue,
      overdue: rows.filter((t) => t.is_overdue).map(slim),
      repeated,
      instances: list.slice(0, 500).map(slim),
    });
  });

  // Detail outlet: penugasan, penanggung jawab, waktu, dan bukti.
  r.get('/monitoring/outlets/:id', (req, res) => {
    const { outlets, outletIds, date, filter } = scope(req, { outlet_id: req.params.id, brand_id: undefined });
    const rows = filter(access.listInstances(db, outletIds, date));
    const staff = db.all(`SELECT u.id, u.name, r.name AS role_name, uo.team FROM user_outlets uo
      JOIN users u ON u.id = uo.user_id JOIN roles r ON r.code = u.role_code
      WHERE uo.outlet_id = ? AND u.active = 1 ORDER BY r.level DESC, u.name`, outletIds[0]);
    res.json({ outlet: outlets[0], date, cards: cardsFor(rows, rejectedCount(rows, date, outletIds)), instances: rows.map(slim), staff });
  });

  return r;
};
