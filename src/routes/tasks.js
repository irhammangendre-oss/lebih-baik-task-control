'use strict';
const express = require('express');
const fs = require('node:fs');
const multer = require('multer');
const clock = require('../clock');
const config = require('../config');
const { requireAuth, requirePerm } = require('../auth');
const { notFound } = require('../errors');
const access = require('../access');
const tasks = require('../services/tasks');
const { absolutePath } = require('../services/files');
const { localDate, addDays, DATE_RE } = require('../time');
const { OPEN_STATUSES } = require('../constants');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 3 } });

function sortKey(t) {
  if (t.is_overdue) return 0;
  if (OPEN_STATUSES.includes(t.status) && !t.is_upcoming) return 1;
  if (t.is_upcoming) return 2;
  return 3;
}

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  // A. Tugas Saya: tugas individu + tugas bersama tim/peran yang menjadi hak user.
  r.get('/my-tasks', (req, res) => {
    const user = req.user;
    const now = clock.now();
    const nowIso = now.toISOString();
    const outlets = user.outlets.filter((o) => user.assignedOutletIds.has(o.outlet_id) || user.perms.has('scope.all'));
    const todayBy = new Map(outlets.map((o) => [o.outlet_id, localDate(now, o.timezone)]));
    if (!outlets.length) return res.json({ tasks: [], summary: { total: 0, done: 0, overdue: 0 } });
    const dates = [...todayBy.values()].sort();
    const rows = access.listInstances(db, todayBy.keys(), addDays(dates[0], -1), dates.at(-1));
    const tasksOut = rows.filter((t) => {
      if (!access.isAssignee(user, t)) return false;
      const today = todayBy.get(t.outlet_id);
      return t.business_date === today || (OPEN_STATUSES.includes(t.status) && t.business_date === addDays(today, -1));
    }).map((t) => ({ ...t, is_upcoming: t.scheduled_at > nowIso, can_complete: access.canComplete(user, t) }))
      .sort((a, b) => sortKey(a) - sortKey(b) || a.due_at.localeCompare(b.due_at));
    const current = tasksOut.filter((t) => !t.is_upcoming);
    res.json({
      tasks: tasksOut,
      summary: {
        total: current.length,
        done: current.filter((t) => !OPEN_STATUSES.includes(t.status)).length,
        overdue: current.filter((t) => t.is_overdue).length,
      },
    });
  });

  // B. Checklist Outlet: dikelompokkan Opening / Operasional / Closing.
  r.get('/checklist', requirePerm('checklist.view'), (req, res) => {
    const user = req.user;
    const outletId = Number(req.query.outlet_id || user.outlets[0]?.outlet_id);
    if (!outletId) return res.json({ outlet: null, groups: {} });
    access.assertOutlet(user, outletId);
    const outlet = user.outlets.find((o) => o.outlet_id === outletId);
    const date = DATE_RE.test(String(req.query.date || '')) ? String(req.query.date) : localDate(clock.now(), outlet.timezone);
    const nowIso = clock.nowIso();
    const rows = access.listInstances(db, [outletId], date)
      .map((t) => ({ ...t, is_upcoming: t.scheduled_at > nowIso, can_complete: OPEN_STATUSES.includes(t.status) && access.canComplete(user, t) }));
    const groups = { opening: [], operasional: [], closing: [] };
    for (const t of rows) groups[t.category].push(t);
    const count = (list) => ({
      total: list.length,
      done: list.filter((t) => !OPEN_STATUSES.includes(t.status)).length,
      overdue: list.filter((t) => t.is_overdue).length,
    });
    res.json({
      outlet, date, groups,
      counts: Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, count(v)])),
    });
  });

  r.get('/instances/:id', (req, res) => res.json(tasks.instanceDetail(db, req.user, req.params.id)));

  r.post('/instances/:id/complete', upload.array('photos', 3), (req, res) => {
    const inst = tasks.completeTask(db, req.user, req.params.id, { note: req.body?.note, files: req.files || [] });
    res.json(inst);
  });

  r.post('/instances/:id/verify', (req, res) => {
    res.json(tasks.verifyTask(db, req.user, req.params.id, { decision: req.body?.decision, reason: req.body?.reason }));
  });

  r.post('/instances/:id/reopen', (req, res) => {
    res.json(tasks.reopenTask(db, req.user, req.params.id, { reason: req.body?.reason }));
  });

  // Bukti foto hanya untuk user yang punya akses ke outlet tugas tersebut.
  r.get('/evidence/:id', (req, res) => {
    const e = db.get(`SELECT e.stored_name, e.mime_type, ti.outlet_id FROM task_evidence e
      JOIN task_instances ti ON ti.id = e.instance_id WHERE e.id = ?`, Number(req.params.id));
    if (!e || !req.user.outletIds.has(e.outlet_id)) throw notFound();
    const p = absolutePath(e.stored_name);
    if (!fs.existsSync(p)) throw notFound('File bukti tidak ditemukan.');
    res.set('Cache-Control', 'private, max-age=86400');
    res.type(e.mime_type).sendFile(p);
  });

  // Gambar referensi/SOP: untuk pengelola library atau user yang outletnya memakai template tsb.
  r.get('/templates/:id/reference-image', (req, res) => {
    const t = db.get('SELECT id, reference_image_file, reference_image_mime FROM task_templates WHERE id = ?', Number(req.params.id));
    if (!t || !t.reference_image_file) throw notFound();
    if (!req.user.perms.has('template.manage')) {
      const used = db.all('SELECT DISTINCT outlet_id FROM task_assignments WHERE template_id = ?', t.id)
        .some((a) => req.user.outletIds.has(a.outlet_id));
      if (!used) throw notFound();
    }
    res.set('Cache-Control', 'private, max-age=3600');
    res.type(t.reference_image_mime).sendFile(absolutePath(t.reference_image_file));
  });

  r.get('/notifications', (req, res) => {
    const items = db.all('SELECT id, instance_id, kind, stage, message, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
    const unread = db.get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL', req.user.id).c;
    res.json({ items, unread });
  });
  r.post('/notifications/read-all', (req, res) => {
    db.run('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', clock.nowIso(), req.user.id);
    res.json({ ok: true });
  });
  r.post('/notifications/:id/read', (req, res) => {
    db.run('UPDATE notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND user_id = ?', clock.nowIso(), Number(req.params.id), req.user.id);
    res.json({ ok: true });
  });

  return r;
};
