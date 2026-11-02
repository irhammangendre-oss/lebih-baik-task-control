'use strict';
const express = require('express');
const clock = require('../clock');
const { requirePerm, hashPassword } = require('../auth');
const { bad, notFound, forbidden, conflict } = require('../errors');
const v = require('../validate');
const access = require('../access');
const { audit } = require('../services/audit');
const { isValidTz } = require('../time');

module.exports = (db) => {
  const r = express.Router();
  const all = (req) => req.user.perms.has('scope.all');
  const needAll = (req) => { if (!all(req)) throw forbidden('Hanya pengguna dengan akses semua outlet.'); };

  function wrapUnique(fn, msg) {
    try { return fn(); } catch (e) {
      if (/UNIQUE/i.test(e.message)) throw conflict(msg);
      throw e;
    }
  }

  // ---- Brand ----
  r.get('/org/brands', requirePerm('org.manage', 'template.manage'), (req, res) => {
    const rows = db.all('SELECT * FROM brands ORDER BY name');
    const brandIds = new Set(req.user.outlets.map((o) => o.brand_id));
    res.json(all(req) ? rows : rows.filter((b) => brandIds.has(b.id)));
  });
  r.post('/org/brands', requirePerm('org.manage'), (req, res) => {
    needAll(req);
    const name = v.str(req.body?.name, 'Nama brand', { required: true, max: 80 });
    const id = wrapUnique(() => Number(db.run('INSERT INTO brands (name, active, created_at) VALUES (?,1,?)', name, clock.nowIso()).lastInsertRowid), 'Nama brand sudah dipakai.');
    audit(db, req.user.id, 'brand.create', 'brand', id, { name });
    res.status(201).json(db.get('SELECT * FROM brands WHERE id = ?', id));
  });
  r.put('/org/brands/:id', requirePerm('org.manage'), (req, res) => {
    needAll(req);
    const b = db.get('SELECT * FROM brands WHERE id = ?', Number(req.params.id));
    if (!b) throw notFound();
    const name = v.str(req.body?.name ?? b.name, 'Nama brand', { required: true, max: 80 });
    const active = req.body?.active === undefined ? b.active : v.flag(req.body.active);
    wrapUnique(() => db.run('UPDATE brands SET name = ?, active = ? WHERE id = ?', name, active, b.id), 'Nama brand sudah dipakai.');
    audit(db, req.user.id, 'brand.update', 'brand', b.id, { name, active });
    res.json(db.get('SELECT * FROM brands WHERE id = ?', b.id));
  });

  // ---- Outlet ----
  r.get('/org/outlets', requirePerm('org.manage', 'template.manage'), (req, res) => {
    const rows = db.all(`SELECT o.*, b.name AS brand_name,
        (SELECT COUNT(*) FROM user_outlets uo JOIN users u ON u.id = uo.user_id WHERE uo.outlet_id = o.id AND u.active = 1) AS staff_count
      FROM outlets o JOIN brands b ON b.id = o.brand_id ORDER BY b.name, o.name`);
    res.json(all(req) ? rows : rows.filter((o) => req.user.outletIds.has(o.id)));
  });
  function outletInput(body, cur = {}) {
    const brandId = v.int(body.brand_id ?? cur.brand_id, 'Brand');
    if (!db.get('SELECT 1 FROM brands WHERE id = ?', brandId)) throw bad('Brand tidak valid.');
    const tz = v.str(body.timezone ?? cur.timezone ?? 'Asia/Jakarta', 'Zona waktu', { required: true, max: 64 });
    if (!isValidTz(tz)) throw bad('Zona waktu tidak valid (contoh: Asia/Jakarta, Asia/Makassar).');
    return {
      brand_id: brandId,
      code: v.str(body.code ?? cur.code, 'Kode outlet', { required: true, max: 20 }).toUpperCase(),
      name: v.str(body.name ?? cur.name, 'Nama outlet', { required: true, max: 100 }),
      timezone: tz,
      active: body.active === undefined ? (cur.active ?? 1) : v.flag(body.active),
    };
  }
  r.post('/org/outlets', requirePerm('org.manage'), (req, res) => {
    needAll(req);
    const d = outletInput(req.body || {});
    const id = wrapUnique(() => Number(db.run('INSERT INTO outlets (brand_id, code, name, timezone, active, created_at) VALUES (?,?,?,?,?,?)',
      d.brand_id, d.code, d.name, d.timezone, d.active, clock.nowIso()).lastInsertRowid), 'Kode outlet sudah dipakai.');
    audit(db, req.user.id, 'outlet.create', 'outlet', id, d);
    res.status(201).json(db.get('SELECT * FROM outlets WHERE id = ?', id));
  });
  r.put('/org/outlets/:id', requirePerm('org.manage'), (req, res) => {
    needAll(req);
    const o = db.get('SELECT * FROM outlets WHERE id = ?', Number(req.params.id));
    if (!o) throw notFound();
    const d = outletInput(req.body || {}, o);
    wrapUnique(() => db.run('UPDATE outlets SET brand_id=?, code=?, name=?, timezone=?, active=? WHERE id=?',
      d.brand_id, d.code, d.name, d.timezone, d.active, o.id), 'Kode outlet sudah dipakai.');
    audit(db, req.user.id, 'outlet.update', 'outlet', o.id, d);
    res.json(db.get('SELECT * FROM outlets WHERE id = ?', o.id));
  });
  r.get('/org/outlets/:id/teams', requirePerm('org.manage', 'template.manage'), (req, res) => {
    access.assertOutlet(req.user, req.params.id);
    res.json(db.all(`SELECT DISTINCT team FROM user_outlets WHERE outlet_id = ? AND team IS NOT NULL
      UNION SELECT DISTINCT assignee_team FROM task_assignments WHERE outlet_id = ? AND assignee_team IS NOT NULL ORDER BY 1`,
    Number(req.params.id), Number(req.params.id)).map((x) => x.team));
  });

  // ---- Karyawan ----
  function userRows(req, outletId) {
    const users = db.all(`SELECT u.id, u.name, u.username, u.role_code, r.name AS role_name, r.level AS role_level,
        u.reports_to_user_id, s.name AS reports_to_name, u.active, u.created_at
      FROM users u JOIN roles r ON r.code = u.role_code LEFT JOIN users s ON s.id = u.reports_to_user_id
      ORDER BY u.active DESC, r.level DESC, u.name`);
    const links = db.all(`SELECT uo.user_id, uo.outlet_id, uo.team, o.name AS outlet_name FROM user_outlets uo JOIN outlets o ON o.id = uo.outlet_id`);
    for (const u of users) u.outlets = links.filter((l) => l.user_id === u.id).map(({ outlet_id, team, outlet_name }) => ({ outlet_id, team, outlet_name }));
    let out = users;
    if (!all(req)) out = out.filter((u) => u.id === req.user.id || u.outlets.some((o) => req.user.outletIds.has(o.outlet_id)));
    if (outletId) out = out.filter((u) => u.outlets.some((o) => o.outlet_id === Number(outletId)));
    return out;
  }
  r.get('/org/users', requirePerm('org.manage', 'template.manage'), (req, res) => {
    if (req.query.outlet_id) access.assertOutlet(req.user, req.query.outlet_id);
    res.json(userRows(req, req.query.outlet_id));
  });

  /** Mencegah eskalasi hak akses: hanya pemilik izin role.manage yang boleh membuat/mengubah user setingkat atau di atasnya. */
  function assertRoleAllowed(req, roleCode) {
    const role = db.get('SELECT code, level FROM roles WHERE code = ?', roleCode);
    if (!role) throw bad('Peran tidak valid.');
    if (!req.user.perms.has('role.manage') && role.level >= req.user.role_level) throw forbidden('Anda tidak dapat mengelola peran setingkat atau di atas Anda.');
    return role;
  }

  function userInput(req, cur = null) {
    const b = req.body || {};
    const d = {
      name: v.str(b.name ?? cur?.name, 'Nama', { required: true, max: 100 }),
      username: v.str(b.username ?? cur?.username, 'Username', { required: true, max: 50 }),
      role_code: b.role_code ?? cur?.role_code,
      reports_to_user_id: b.reports_to_user_id === undefined ? (cur?.reports_to_user_id ?? null) : v.optInt(b.reports_to_user_id, 'Atasan'),
      active: b.active === undefined ? (cur?.active ?? 1) : v.flag(b.active),
    };
    if (!/^[a-zA-Z0-9._-]{3,50}$/.test(d.username)) throw bad('Username 3-50 karakter: huruf, angka, titik, minus, garis bawah.');
    assertRoleAllowed(req, d.role_code);
    if (d.reports_to_user_id && !db.get('SELECT 1 FROM users WHERE id = ?', d.reports_to_user_id)) throw bad('Atasan tidak valid.');
    let outlets = null;
    if (Array.isArray(b.outlets)) {
      outlets = b.outlets.map((o) => ({ outlet_id: v.int(o.outlet_id, 'Outlet'), team: v.str(o.team, 'Tim', { max: 60 }) }));
      for (const o of outlets) access.assertOutlet(req.user, o.outlet_id);
    }
    return { d, outlets };
  }

  function saveOutlets(req, userId, outlets) {
    if (!outlets) return;
    // User tanpa scope.all hanya mengubah penempatan pada outlet dalam cakupannya.
    const keep = all(req) ? [] : db.all('SELECT outlet_id, team FROM user_outlets WHERE user_id = ?', userId).filter((o) => !req.user.outletIds.has(o.outlet_id));
    db.run('DELETE FROM user_outlets WHERE user_id = ?', userId);
    const seen = new Set();
    for (const o of [...keep, ...outlets]) {
      if (seen.has(o.outlet_id)) continue;
      seen.add(o.outlet_id);
      db.run('INSERT INTO user_outlets (user_id, outlet_id, team) VALUES (?,?,?)', userId, o.outlet_id, o.team || null);
    }
  }

  r.post('/org/users', requirePerm('org.manage'), (req, res) => {
    const { d, outlets } = userInput(req);
    const pw = String(req.body?.password || '');
    if (pw.length < 8) throw bad('Password minimal 8 karakter.');
    const now = clock.nowIso();
    const id = db.tx(() => {
      const uid = wrapUnique(() => Number(db.run(`INSERT INTO users (name, username, password_hash, role_code, reports_to_user_id, active, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?)`, d.name, d.username, hashPassword(pw), d.role_code, d.reports_to_user_id, d.active, now, now).lastInsertRowid), 'Username sudah dipakai.');
      saveOutlets(req, uid, outlets || []);
      audit(db, req.user.id, 'user.create', 'user', uid, { ...d, outlets });
      return uid;
    });
    res.status(201).json(userRows(req).find((u) => u.id === id));
  });

  r.put('/org/users/:id', requirePerm('org.manage'), (req, res) => {
    const cur = db.get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!cur || !userRows(req).some((u) => u.id === cur.id)) throw notFound();
    assertRoleAllowed(req, cur.role_code);
    const { d, outlets } = userInput(req, cur);
    if (cur.id === req.user.id && (!d.active || d.role_code !== cur.role_code)) throw bad('Anda tidak dapat menonaktifkan atau mengubah peran akun sendiri.');
    if (d.reports_to_user_id === cur.id) throw bad('Atasan tidak boleh diri sendiri.');
    db.tx(() => {
      wrapUnique(() => db.run('UPDATE users SET name=?, username=?, role_code=?, reports_to_user_id=?, active=?, updated_at=? WHERE id=?',
        d.name, d.username, d.role_code, d.reports_to_user_id, d.active, clock.nowIso(), cur.id), 'Username sudah dipakai.');
      saveOutlets(req, cur.id, outlets);
      if (!d.active) db.run('DELETE FROM sessions WHERE user_id = ?', cur.id);
      audit(db, req.user.id, 'user.update', 'user', cur.id, { ...d, outlets });
    });
    res.json(userRows(req).find((u) => u.id === cur.id));
  });

  r.post('/org/users/:id/password', requirePerm('org.manage'), (req, res) => {
    const cur = db.get('SELECT * FROM users WHERE id = ?', Number(req.params.id));
    if (!cur || !userRows(req).some((u) => u.id === cur.id)) throw notFound();
    assertRoleAllowed(req, cur.role_code);
    const pw = String(req.body?.password || '');
    if (pw.length < 8) throw bad('Password minimal 8 karakter.');
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', hashPassword(pw), clock.nowIso(), cur.id);
    db.run('DELETE FROM sessions WHERE user_id = ?', cur.id);
    audit(db, req.user.id, 'user.password_reset', 'user', cur.id);
    res.json({ ok: true });
  });

  return r;
};
