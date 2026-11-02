'use strict';
const express = require('express');
const clock = require('../clock');
const { requirePerm } = require('../auth');
const { bad, notFound } = require('../errors');
const v = require('../validate');
const { PERMISSIONS } = require('../constants');
const { audit } = require('../services/audit');
const { runJobs } = require('../services/jobs');

module.exports = (db) => {
  const r = express.Router();

  r.get('/admin/roles', requirePerm('role.manage'), (_req, res) => {
    const roles = db.all('SELECT * FROM roles ORDER BY level, name');
    const perms = db.all('SELECT * FROM role_permissions');
    res.json({
      permissions: PERMISSIONS,
      roles: roles.map((ro) => ({ ...ro, permissions: perms.filter((p) => p.role_code === ro.code).map((p) => p.permission) })),
    });
  });

  r.put('/admin/roles/:code/permissions', requirePerm('role.manage'), (req, res) => {
    const role = db.get('SELECT * FROM roles WHERE code = ?', req.params.code);
    if (!role) throw notFound();
    const list = Array.isArray(req.body?.permissions) ? [...new Set(req.body.permissions)] : null;
    if (!list) throw bad('Daftar izin tidak valid.');
    for (const p of list) if (!PERMISSIONS[p]) throw bad(`Izin tidak dikenal: ${p}`);
    if (role.code === 'admin' && !list.includes('role.manage')) throw bad('Peran Management harus tetap memiliki izin "Mengatur izin per peran".');
    db.tx(() => {
      db.run('DELETE FROM role_permissions WHERE role_code = ?', role.code);
      for (const p of list) db.run('INSERT INTO role_permissions (role_code, permission) VALUES (?,?)', role.code, p);
      audit(db, req.user.id, 'role.permissions', 'role', null, { role: role.code, permissions: list });
    });
    res.json({ code: role.code, permissions: list });
  });

  r.get('/admin/escalation', requirePerm('escalation.manage'), (_req, res) => {
    res.json(db.all("SELECT * FROM escalation_rules ORDER BY CASE code WHEN 'default' THEN 1 ELSE 2 END"));
  });

  r.put('/admin/escalation/:code', requirePerm('escalation.manage'), (req, res) => {
    const rule = db.get('SELECT * FROM escalation_rules WHERE code = ?', req.params.code);
    if (!rule) throw notFound();
    const b = req.body || {};
    const d = {};
    for (const k of ['stage1_after_minutes', 'stage2_after_minutes', 'stage3_after_minutes', 'repeat_threshold', 'repeat_window_days']) {
      d[k] = b[k] === undefined ? rule[k] : v.int(b[k], k);
    }
    if (d.stage1_after_minutes < 0) throw bad('Menit tahap 1 tidak boleh negatif.');
    if (d.stage2_after_minutes < d.stage1_after_minutes || d.stage3_after_minutes < d.stage2_after_minutes) throw bad('Waktu tiap tahap harus berurutan (tahap 1 ≤ tahap 2 ≤ tahap 3).');
    if (d.repeat_threshold < 2) throw bad('Ambang pengulangan minimal 2.');
    if (d.repeat_window_days < 1 || d.repeat_window_days > 90) throw bad('Periode pengulangan 1-90 hari.');
    db.run(`UPDATE escalation_rules SET stage1_after_minutes=?, stage2_after_minutes=?, stage3_after_minutes=?, repeat_threshold=?,
      repeat_window_days=?, updated_by=?, updated_at=? WHERE code=?`, d.stage1_after_minutes, d.stage2_after_minutes,
    d.stage3_after_minutes, d.repeat_threshold, d.repeat_window_days, req.user.id, clock.nowIso(), rule.code);
    audit(db, req.user.id, 'escalation.update', 'escalation_rule', null, { code: rule.code, ...d });
    res.json(db.get('SELECT * FROM escalation_rules WHERE code = ?', rule.code));
  });

  r.post('/admin/run-jobs', requirePerm('escalation.manage'), (_req, res) => res.json(runJobs(db)));

  r.get('/admin/audit', requirePerm('audit.view'), (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 100, 500);
    res.json(db.all(`SELECT a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, u.name AS user_name
      FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.id DESC LIMIT ?`, limit));
  });

  return r;
};
