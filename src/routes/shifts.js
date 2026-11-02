'use strict';
const express = require('express');
const clock = require('../clock');
const { requireAuth, requirePerm } = require('../auth');
const { bad, notFound, forbidden, conflict } = require('../errors');
const v = require('../validate');
const access = require('../access');
const { audit } = require('../services/audit');
const shifts = require('../services/shifts');
const { TIME_RE, DATE_RE, addDays, localDate } = require('../time');

module.exports = (db) => {
  const r = express.Router();
  r.use(requireAuth);

  const outletOf = (req, id) => {
    access.assertOutlet(req.user, id);
    return req.user.outlets.find((o) => o.outlet_id === Number(id));
  };
  const shiftNo = (x, field = 'Shift') => {
    const n = Number(x);
    if (n !== 1 && n !== 2) throw bad(`${field} harus 1 atau 2.`);
    return n;
  };

  // ---- Jam shift per outlet ----
  r.get('/shifts/outlets/:id', (req, res) => {
    const o = outletOf(req, req.params.id);
    res.json(shifts.shiftStatus(db, o));
  });

  r.put('/shifts/outlets/:id', requirePerm('shift.manage'), (req, res) => {
    const o = outletOf(req, req.params.id);
    const list = Array.isArray(req.body?.shifts) ? req.body.shifts : [];
    if (list.length !== 2 || new Set(list.map((s) => Number(s.shift_no))).size !== 2) throw bad('Isi jam untuk Shift 1 dan Shift 2.');
    for (const s of list) {
      shiftNo(s.shift_no);
      if (!TIME_RE.test(String(s.start_time)) || !TIME_RE.test(String(s.end_time))) throw bad('Jam harus berformat JJ:MM.');
      if (s.start_time === s.end_time) throw bad('Jam mulai dan selesai shift tidak boleh sama.');
    }
    const now = clock.nowIso();
    db.tx(() => {
      for (const s of list) {
        db.run('UPDATE outlet_shifts SET start_time = ?, end_time = ?, updated_by = ?, updated_at = ? WHERE outlet_id = ? AND shift_no = ?',
          s.start_time, s.end_time, req.user.id, now, o.outlet_id, Number(s.shift_no));
      }
      audit(db, req.user.id, 'shift.update', 'outlet', o.outlet_id, { shifts: list });
    });
    res.json(shifts.shiftStatus(db, o));
  });

  // ---- Jadwal shift karyawan (bukan absensi) ----
  r.get('/shifts/roster', requirePerm('shift.manage'), (req, res) => {
    const o = outletOf(req, req.query.outlet_id);
    const date = DATE_RE.test(String(req.query.date || '')) ? String(req.query.date) : localDate(clock.now(), o.timezone);
    const staff = db.all(`SELECT u.id, u.name, r.name AS role_name, r.level, uo.team, uo.shift_no AS default_shift, sr.shift_no AS date_shift
      FROM user_outlets uo JOIN users u ON u.id = uo.user_id JOIN roles r ON r.code = u.role_code
      LEFT JOIN shift_rosters sr ON sr.user_id = u.id AND sr.outlet_id = uo.outlet_id AND sr.work_date = ?
      WHERE uo.outlet_id = ? AND u.active = 1 ORDER BY r.level, u.name`, date, o.outlet_id)
      .map((s) => ({ ...s, shift_no: s.date_shift ?? s.default_shift ?? null }));
    res.json({ outlet: o, date, shifts: shifts.getShifts(db, o.outlet_id), staff });
  });

  /** Atur shift karyawan: { outlet_id, user_id, shift_no, date? }. Dengan date = hanya tanggal itu; tanpa date = shift tetap. */
  r.put('/shifts/roster', requirePerm('shift.manage'), (req, res) => {
    const b = req.body || {};
    const o = outletOf(req, b.outlet_id);
    const userId = v.int(b.user_id, 'Karyawan');
    if (!db.get('SELECT 1 FROM user_outlets WHERE user_id = ? AND outlet_id = ?', userId, o.outlet_id)) throw bad('Karyawan tidak ditempatkan di outlet ini.');
    const shift = b.shift_no === null || b.shift_no === '' ? null : shiftNo(b.shift_no);
    const now = clock.nowIso();
    if (b.date) {
      if (!DATE_RE.test(String(b.date))) throw bad('Tanggal tidak valid.');
      if (shift === null) db.run('DELETE FROM shift_rosters WHERE user_id = ? AND outlet_id = ? AND work_date = ?', userId, o.outlet_id, b.date);
      else {
        db.run(`INSERT INTO shift_rosters (user_id, outlet_id, work_date, shift_no, updated_by, updated_at) VALUES (?,?,?,?,?,?)
          ON CONFLICT (user_id, outlet_id, work_date) DO UPDATE SET shift_no = excluded.shift_no, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
        userId, o.outlet_id, b.date, shift, req.user.id, now);
      }
    } else {
      db.run('UPDATE user_outlets SET shift_no = ? WHERE user_id = ? AND outlet_id = ?', shift, userId, o.outlet_id);
    }
    audit(db, req.user.id, 'shift.roster', 'user', userId, { outlet_id: o.outlet_id, date: b.date || null, shift_no: shift });
    res.json({ ok: true });
  });

  // ---- Serah terima shift ----
  function handoverRow(id) {
    const h = db.get(`SELECT h.*, o.name AS outlet_name, o.timezone, cu.name AS created_by_name, uu.name AS updated_by_name, au.name AS acknowledged_by_name
      FROM shift_handovers h JOIN outlets o ON o.id = h.outlet_id JOIN users cu ON cu.id = h.created_by
      LEFT JOIN users uu ON uu.id = h.updated_by LEFT JOIN users au ON au.id = h.acknowledged_by WHERE h.id = ?`, Number(id));
    return h;
  }
  function handoverDetail(req, id) {
    const h = handoverRow(id);
    if (!h || !req.user.outletIds.has(h.outlet_id)) throw notFound('Serah terima tidak ditemukan.');
    const items = db.all('SELECT instance_id, status_at_handover FROM shift_handover_items WHERE handover_id = ?', h.id)
      .map((it) => {
        const inst = access.getInstance(db, it.instance_id);
        return {
          instance_id: it.instance_id, status_at_handover: it.status_at_handover, name: inst.name, category: inst.category,
          assignee_label: inst.assignee_label, due_at: inst.due_at, timezone: inst.timezone, shift_no: inst.shift_no,
          status: inst.status, effective_status: inst.effective_status, is_overdue: inst.is_overdue, was_late: inst.was_late,
          completed_by_name: inst.completed_by_name, completed_at: inst.completed_at,
        };
      });
    return { ...h, items, can_acknowledge: !h.acknowledged_at && h.created_by !== req.user.id && req.user.perms.has('handover.create') };
  }

  /** Tugas yang belum selesai sampai akhir shift asal (termasuk sisa dari hari sebelumnya). */
  function unfinishedFor(outletId, date, window) {
    return db.all(`SELECT id, status FROM task_instances WHERE outlet_id = ? AND status IN ('belum','perlu_perbaikan')
      AND business_date BETWEEN ? AND ? AND scheduled_at < ? ORDER BY due_at`, outletId, addDays(date, -1), date, window.end_at);
  }

  function resolveShift(o, body) {
    const st = shifts.shiftStatus(db, o);
    let from = body.from_shift ? shiftNo(body.from_shift, 'Shift asal') : null;
    let date = body.business_date && DATE_RE.test(String(body.business_date)) ? String(body.business_date) : null;
    if (!from || !date) {
      const cur = st.current || st.previous;
      from = from || cur.shift_no;
      date = date || cur.business_date;
    }
    const def = st.shifts.find((s) => s.shift_no === from);
    const window = shifts.shiftWindow(def, date, o.timezone);
    const to = shifts.nextShift(from, date);
    return { from, date, window, to, status: st };
  }

  r.get('/handovers', (req, res) => {
    const o = outletOf(req, req.query.outlet_id || req.user.outlets[0]?.outlet_id);
    const date = DATE_RE.test(String(req.query.date || '')) ? String(req.query.date) : localDate(clock.now(), o.timezone);
    const list = db.all(`SELECT h.id, h.business_date, h.from_shift, h.to_shift, h.to_business_date, h.created_at, h.acknowledged_at,
        cu.name AS created_by_name, au.name AS acknowledged_by_name,
        (SELECT COUNT(*) FROM shift_handover_items i WHERE i.handover_id = h.id) AS item_count,
        (h.stock_issues IS NOT NULL) AS has_stock, (h.equipment_issues IS NOT NULL) AS has_equipment
      FROM shift_handovers h JOIN users cu ON cu.id = h.created_by LEFT JOIN users au ON au.id = h.acknowledged_by
      WHERE h.outlet_id = ? AND (h.business_date BETWEEN ? AND ? OR h.to_business_date BETWEEN ? AND ?)
      ORDER BY h.business_date DESC, h.from_shift DESC`, o.outlet_id, addDays(date, -6), date, addDays(date, -6), date);
    res.json({ outlet: o, date, shift: shifts.shiftStatus(db, o), handovers: list });
  });

  /** Draf serah terima: shift asal/tujuan default + daftar tugas yang belum selesai saat ini. */
  r.get('/handovers/draft', requirePerm('handover.create'), (req, res) => {
    const o = outletOf(req, req.query.outlet_id || req.user.outlets[0]?.outlet_id);
    const { from, date, window, to, status } = resolveShift(o, req.query);
    const existing = db.get('SELECT id FROM shift_handovers WHERE outlet_id = ? AND business_date = ? AND from_shift = ?', o.outlet_id, date, from);
    const items = unfinishedFor(o.outlet_id, date, window).map((x) => {
      const i = access.getInstance(db, x.id);
      return { instance_id: i.id, name: i.name, effective_status: i.effective_status, status: i.status, due_at: i.due_at, timezone: i.timezone, assignee_label: i.assignee_label, shift_no: i.shift_no };
    });
    res.json({
      outlet: o, business_date: date, from_shift: from, to_shift: to.shift_no, to_business_date: to.business_date,
      window, shift: status, items, existing: existing ? handoverDetail(req, existing.id) : null,
    });
  });

  r.post('/handovers', requirePerm('handover.create'), (req, res) => {
    const b = req.body || {};
    const o = outletOf(req, b.outlet_id);
    if (!req.user.assignedOutletIds.has(o.outlet_id) && !req.user.perms.has('scope.all')) throw forbidden();
    const { from, date, window, to } = resolveShift(o, b);
    const d = {
      stock_issues: v.str(b.stock_issues, 'Masalah stok', { max: 2000 }),
      equipment_issues: v.str(b.equipment_issues, 'Masalah peralatan', { max: 2000 }),
      notes: v.str(b.notes, 'Catatan', { max: 2000 }),
    };
    const now = clock.nowIso();
    const id = db.tx(() => {
      const ex = db.get('SELECT id, acknowledged_at FROM shift_handovers WHERE outlet_id = ? AND business_date = ? AND from_shift = ?', o.outlet_id, date, from);
      let hid;
      if (ex) {
        if (ex.acknowledged_at) throw conflict('Serah terima ini sudah diterima shift berikutnya dan tidak bisa diubah.');
        db.run('UPDATE shift_handovers SET stock_issues = ?, equipment_issues = ?, notes = ?, updated_by = ?, updated_at = ? WHERE id = ?',
          d.stock_issues, d.equipment_issues, d.notes, req.user.id, now, ex.id);
        hid = ex.id;
        db.run('DELETE FROM shift_handover_items WHERE handover_id = ?', hid);
      } else {
        hid = Number(db.run(`INSERT INTO shift_handovers (outlet_id, business_date, from_shift, to_shift, to_business_date, stock_issues,
            equipment_issues, notes, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        o.outlet_id, date, from, to.shift_no, to.business_date, d.stock_issues, d.equipment_issues, d.notes, req.user.id, now, req.user.id, now).lastInsertRowid);
      }
      for (const it of unfinishedFor(o.outlet_id, date, window)) {
        db.run('INSERT INTO shift_handover_items (handover_id, instance_id, status_at_handover) VALUES (?,?,?)', hid, it.id, it.status);
      }
      audit(db, req.user.id, ex ? 'handover.update' : 'handover.create', 'shift_handover', hid, { outlet_id: o.outlet_id, date, from_shift: from });
      return hid;
    });
    res.status(201).json(handoverDetail(req, id));
  });

  r.get('/handovers/:id', (req, res) => res.json(handoverDetail(req, req.params.id)));

  r.post('/handovers/:id/acknowledge', requirePerm('handover.create'), (req, res) => {
    const h = handoverDetail(req, req.params.id);
    if (h.acknowledged_at) throw conflict(`Sudah diterima oleh ${h.acknowledged_by_name}.`);
    if (h.created_by === req.user.id) throw forbidden('Serah terima harus diterima oleh orang dari shift berikutnya.');
    db.run('UPDATE shift_handovers SET acknowledged_by = ?, acknowledged_at = ? WHERE id = ? AND acknowledged_at IS NULL', req.user.id, clock.nowIso(), h.id);
    audit(db, req.user.id, 'handover.acknowledge', 'shift_handover', h.id);
    res.json(handoverDetail(req, h.id));
  });

  return r;
};
