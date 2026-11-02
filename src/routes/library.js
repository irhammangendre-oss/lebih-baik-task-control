'use strict';
const express = require('express');
const multer = require('multer');
const clock = require('../clock');
const config = require('../config');
const { requirePerm } = require('../auth');
const { bad, notFound } = require('../errors');
const v = require('../validate');
const access = require('../access');
const { audit } = require('../services/audit');
const { storeImages, removeFiles } = require('../services/files');
const { generateInstances } = require('../services/scheduler');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

const SCHEDULE_COLS = ['recurrence', 'days_of_week', 'start_time', 'due_time', 'end_time', 'interval_minutes', 'due_after_minutes'];

module.exports = (db) => {
  const r = express.Router();
  r.use(requirePerm('template.manage'));

  function templateInput(body) {
    const b = body || {};
    const category = b.category;
    if (!['opening', 'operasional', 'closing'].includes(category)) throw bad('Kategori tidak valid.');
    const sched = v.schedule(b);
    const role = b.default_assignee_role || null;
    if (role && !db.get('SELECT 1 FROM roles WHERE code = ?', role)) throw bad('Peran tidak valid.');
    const brandIds = Array.isArray(b.brand_ids) ? [...new Set(b.brand_ids.map(Number))] : [];
    for (const id of brandIds) if (!db.get('SELECT 1 FROM brands WHERE id = ?', id)) throw bad('Brand tidak valid.');
    const url = v.str(b.reference_url, 'Link SOP', { max: 500 });
    if (url && !/^https?:\/\//i.test(url)) throw bad('Link SOP harus diawali http:// atau https://');
    return {
      name: v.str(b.name, 'Nama tugas', { required: true, max: 120 }),
      instructions: v.str(b.instructions, 'Instruksi', { max: 2000 }) || '',
      category,
      is_critical: v.flag(b.is_critical),
      requires_photo: v.flag(b.requires_photo),
      requires_verification: v.flag(b.requires_verification),
      sop_text: v.str(b.sop_text, 'SOP', { max: 4000 }),
      reference_url: url,
      default_assignee_role: role,
      ...Object.fromEntries(SCHEDULE_COLS.map((k) => [k, sched[k]])),
      brandIds,
    };
  }

  function templateRow(id) {
    const t = db.get('SELECT * FROM task_templates WHERE id = ?', Number(id));
    if (!t) throw notFound('Template tidak ditemukan.');
    t.brand_ids = db.all('SELECT brand_id FROM template_brands WHERE template_id = ?', t.id).map((x) => x.brand_id);
    t.has_reference_image = !!t.reference_image_file;
    delete t.reference_image_file;
    return t;
  }

  r.get('/templates', (req, res) => {
    const rows = db.all(`SELECT t.*, (t.reference_image_file IS NOT NULL) AS has_reference_image,
        (SELECT COUNT(*) FROM task_assignments a WHERE a.template_id = t.id AND a.active = 1) AS active_assignments
      FROM task_templates t ORDER BY t.active DESC, CASE t.category WHEN 'opening' THEN 1 WHEN 'operasional' THEN 2 ELSE 3 END, t.name`);
    const brands = db.all('SELECT template_id, brand_id FROM template_brands');
    for (const t of rows) {
      t.brand_ids = brands.filter((b) => b.template_id === t.id).map((b) => b.brand_id);
      t.has_reference_image = !!t.has_reference_image;
      delete t.reference_image_file;
    }
    res.json(rows);
  });

  r.get('/templates/:id', (req, res) => {
    const t = templateRow(req.params.id);
    t.assignments = listAssignments(req.user, { template_id: t.id });
    res.json(t);
  });

  r.post('/templates', (req, res) => {
    const d = templateInput(req.body);
    const now = clock.nowIso();
    const id = db.tx(() => {
      const ins = db.run(`INSERT INTO task_templates (name, instructions, category, is_critical, requires_photo, requires_verification,
          sop_text, reference_url, default_assignee_role, ${SCHEDULE_COLS.join(', ')}, active, created_by, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?,?)`,
      d.name, d.instructions, d.category, d.is_critical, d.requires_photo, d.requires_verification, d.sop_text,
      d.reference_url, d.default_assignee_role, ...SCHEDULE_COLS.map((k) => d[k]), req.user.id, now, now);
      const tid = Number(ins.lastInsertRowid);
      for (const b of d.brandIds) db.run('INSERT INTO template_brands (template_id, brand_id) VALUES (?,?)', tid, b);
      audit(db, req.user.id, 'template.create', 'task_template', tid, { name: d.name });
      return tid;
    });
    res.status(201).json(templateRow(id));
  });

  r.put('/templates/:id', (req, res) => {
    const t = templateRow(req.params.id);
    const d = templateInput(req.body);
    const now = clock.nowIso();
    db.tx(() => {
      db.run(`UPDATE task_templates SET name=?, instructions=?, category=?, is_critical=?, requires_photo=?, requires_verification=?,
          sop_text=?, reference_url=?, default_assignee_role=?, ${SCHEDULE_COLS.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`,
      d.name, d.instructions, d.category, d.is_critical, d.requires_photo, d.requires_verification, d.sop_text, d.reference_url,
      d.default_assignee_role, ...SCHEDULE_COLS.map((k) => d[k]), now, t.id);
      db.run('DELETE FROM template_brands WHERE template_id = ?', t.id);
      for (const b of d.brandIds) db.run('INSERT INTO template_brands (template_id, brand_id) VALUES (?,?)', t.id, b);
      // Tugas yang belum dimulai ikut diperbarui; tugas yang sudah berjalan/selesai tetap sesuai snapshot (histori).
      db.run(`UPDATE task_instances SET name=?, category=?, is_critical=?, requires_photo=?, requires_verification=?, updated_at=?
        WHERE template_id=? AND status='belum' AND scheduled_at > ?`,
      d.name, d.category, d.is_critical, d.requires_photo, d.requires_verification, now, t.id, now);
      audit(db, req.user.id, 'template.update', 'task_template', t.id, { name: d.name });
    });
    res.json(templateRow(t.id));
  });

  r.post('/templates/:id/active', (req, res) => {
    const t = templateRow(req.params.id);
    const active = v.flag(req.body?.active);
    const now = clock.nowIso();
    db.tx(() => {
      db.run('UPDATE task_templates SET active = ?, updated_at = ? WHERE id = ?', active, now, t.id);
      if (!active) removeFutureInstances('template_id', t.id);
      audit(db, req.user.id, active ? 'template.activate' : 'template.deactivate', 'task_template', t.id);
    });
    if (active) generateInstances(db);
    res.json(templateRow(t.id));
  });

  r.post('/templates/:id/reference-image', upload.single('image'), (req, res) => {
    const t = db.get('SELECT id, reference_image_file FROM task_templates WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound();
    if (!req.file) throw bad('Pilih gambar referensi.');
    const [s] = storeImages([req.file], 'reference');
    db.run('UPDATE task_templates SET reference_image_file = ?, reference_image_mime = ?, updated_at = ? WHERE id = ?',
      s.stored_name, s.mime_type, clock.nowIso(), t.id);
    if (t.reference_image_file) removeFiles([{ stored_name: t.reference_image_file }]);
    audit(db, req.user.id, 'template.reference_image', 'task_template', t.id);
    res.json(templateRow(t.id));
  });

  r.delete('/templates/:id/reference-image', (req, res) => {
    const t = db.get('SELECT id, reference_image_file FROM task_templates WHERE id = ?', Number(req.params.id));
    if (!t) throw notFound();
    db.run('UPDATE task_templates SET reference_image_file = NULL, reference_image_mime = NULL WHERE id = ?', t.id);
    if (t.reference_image_file) removeFiles([{ stored_name: t.reference_image_file }]);
    res.json(templateRow(t.id));
  });

  // ---- Penugasan & jadwal ----

  function removeFutureInstances(col, id) {
    db.run(`DELETE FROM task_instances WHERE ${col} = ? AND status = 'belum' AND due_at > ?
      AND NOT EXISTS (SELECT 1 FROM task_submissions s WHERE s.instance_id = task_instances.id)
      AND NOT EXISTS (SELECT 1 FROM notifications n WHERE n.instance_id = task_instances.id)`, id, clock.nowIso());
  }

  function listAssignments(user, { template_id, outlet_id } = {}) {
    const rows = db.all(`SELECT a.*, t.name AS template_name, t.category, o.name AS outlet_name, b.name AS brand_name,
        u.name AS assignee_user_name, r.name AS assignee_role_name
      FROM task_assignments a JOIN task_templates t ON t.id = a.template_id JOIN outlets o ON o.id = a.outlet_id
      JOIN brands b ON b.id = o.brand_id LEFT JOIN users u ON u.id = a.assignee_user_id LEFT JOIN roles r ON r.code = a.assignee_role
      WHERE (? IS NULL OR a.template_id = ?) AND (? IS NULL OR a.outlet_id = ?)
      ORDER BY a.active DESC, b.name, o.name, t.name`, template_id ?? null, template_id ?? null, outlet_id ?? null, outlet_id ?? null)
      .filter((a) => user.outletIds.has(a.outlet_id));
    for (const a of rows) a.schedules = db.all('SELECT * FROM task_schedules WHERE assignment_id = ? ORDER BY id', a.id);
    return rows;
  }

  function assigneeInput(body, outletId) {
    const type = body.assignee_type;
    if (!['role', 'team', 'user'].includes(type)) throw bad('Jenis penanggung jawab tidak valid.');
    const out = { assignee_type: type, assignee_role: null, assignee_team: null, assignee_user_id: null, mode: type === 'user' ? 'individual' : 'shared' };
    if (type === 'role') {
      if (!db.get('SELECT 1 FROM roles WHERE code = ?', body.assignee_role)) throw bad('Peran tidak valid.');
      out.assignee_role = body.assignee_role;
    } else if (type === 'team') {
      out.assignee_team = v.str(body.assignee_team, 'Nama tim', { required: true, max: 60 });
    } else {
      const uid = v.int(body.assignee_user_id, 'Karyawan');
      const ok = db.get(`SELECT 1 FROM users u JOIN user_outlets uo ON uo.user_id = u.id
        WHERE u.id = ? AND uo.outlet_id = ? AND u.active = 1`, uid, outletId);
      if (!ok) throw bad('Karyawan tersebut tidak ditempatkan di outlet ini.');
      out.assignee_user_id = uid;
    }
    return out;
  }

  function scheduleFrom(body, template) {
    if (body.schedule) return v.schedule(body.schedule);
    return v.schedule(Object.fromEntries(SCHEDULE_COLS.map((k) => [k, template[k]])));
  }

  function insertSchedule(assignmentId, s, now) {
    db.run(`INSERT INTO task_schedules (assignment_id, recurrence, days_of_week, start_time, due_time, end_time, interval_minutes,
        due_after_minutes, start_date, end_date, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`,
    assignmentId, s.recurrence, s.days_of_week, s.start_time, s.due_time, s.end_time, s.interval_minutes, s.due_after_minutes,
    s.start_date, s.end_date, now, now);
  }

  r.get('/assignments', (req, res) => {
    res.json(listAssignments(req.user, {
      template_id: req.query.template_id ? Number(req.query.template_id) : null,
      outlet_id: req.query.outlet_id ? Number(req.query.outlet_id) : null,
    }));
  });

  /** Tugaskan template ke outlet terpilih (satu penugasan per outlet). Tidak pernah otomatis ke semua outlet. */
  r.post('/assignments', (req, res) => {
    const b = req.body || {};
    const template = db.get('SELECT * FROM task_templates WHERE id = ?', Number(b.template_id));
    if (!template) throw bad('Template tidak ditemukan.');
    if (!template.active) throw bad('Template tidak aktif.');
    const outletIds = Array.isArray(b.outlet_ids) ? [...new Set(b.outlet_ids.map(Number))] : [];
    if (!outletIds.length) throw bad('Pilih minimal satu outlet.');
    const allowedBrands = db.all('SELECT brand_id FROM template_brands WHERE template_id = ?', template.id).map((x) => x.brand_id);
    const sched = scheduleFrom(b, template);
    const now = clock.nowIso();
    const ids = db.tx(() => outletIds.map((oid) => {
      access.assertOutlet(req.user, oid);
      const outlet = db.get('SELECT id, brand_id, name FROM outlets WHERE id = ?', oid);
      if (allowedBrands.length && !allowedBrands.includes(outlet.brand_id)) throw bad(`Template tidak berlaku untuk brand outlet ${outlet.name}.`);
      const a = assigneeInput(b, oid);
      const ins = db.run(`INSERT INTO task_assignments (template_id, outlet_id, mode, assignee_type, assignee_role, assignee_team,
          assignee_user_id, active, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?,?)`,
      template.id, oid, a.mode, a.assignee_type, a.assignee_role, a.assignee_team, a.assignee_user_id, req.user.id, now, now);
      const aid = Number(ins.lastInsertRowid);
      insertSchedule(aid, sched, now);
      audit(db, req.user.id, 'assignment.create', 'task_assignment', aid, { template_id: template.id, outlet_id: oid, ...a, schedule: sched });
      return aid;
    }));
    generateInstances(db);
    res.status(201).json(listAssignments(req.user, { template_id: template.id }).filter((a) => ids.includes(a.id)));
  });

  r.put('/assignments/:id', (req, res) => {
    const a = db.get('SELECT * FROM task_assignments WHERE id = ?', Number(req.params.id));
    if (!a) throw notFound();
    access.assertOutlet(req.user, a.outlet_id);
    const b = req.body || {};
    const template = db.get('SELECT * FROM task_templates WHERE id = ?', a.template_id);
    const who = assigneeInput(b, a.outlet_id);
    const sched = scheduleFrom(b, template);
    const now = clock.nowIso();
    db.tx(() => {
      db.run(`UPDATE task_assignments SET mode=?, assignee_type=?, assignee_role=?, assignee_team=?, assignee_user_id=?, updated_at=? WHERE id=?`,
        who.mode, who.assignee_type, who.assignee_role, who.assignee_team, who.assignee_user_id, now, a.id);
      // Jadwal lama dinonaktifkan (tetap tersimpan untuk histori), jadwal baru berlaku mulai sekarang.
      db.run('UPDATE task_schedules SET active = 0, updated_at = ? WHERE assignment_id = ? AND active = 1', now, a.id);
      removeFutureInstances('assignment_id', a.id);
      insertSchedule(a.id, sched, now);
      audit(db, req.user.id, 'assignment.update', 'task_assignment', a.id, { ...who, schedule: sched });
    });
    generateInstances(db);
    res.json(listAssignments(req.user, { template_id: a.template_id }).find((x) => x.id === a.id));
  });

  r.post('/assignments/:id/active', (req, res) => {
    const a = db.get('SELECT * FROM task_assignments WHERE id = ?', Number(req.params.id));
    if (!a) throw notFound();
    access.assertOutlet(req.user, a.outlet_id);
    const active = v.flag(req.body?.active);
    db.tx(() => {
      db.run('UPDATE task_assignments SET active = ?, updated_at = ? WHERE id = ?', active, clock.nowIso(), a.id);
      if (!active) removeFutureInstances('assignment_id', a.id);
      audit(db, req.user.id, active ? 'assignment.activate' : 'assignment.deactivate', 'task_assignment', a.id);
    });
    if (active) generateInstances(db);
    res.json({ ok: true });
  });

  return r;
};
