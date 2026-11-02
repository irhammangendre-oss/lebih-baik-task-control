'use strict';
const crypto = require('node:crypto');
const { ROLES, DEFAULT_ROLE_PERMISSIONS, DEFAULT_ESCALATION_RULES } = require('./constants');
const { hashPassword } = require('./auth');
const starter = require('./starter-templates');

const now = () => new Date().toISOString();

/** Data dasar yang wajib ada. Aman dijalankan berulang (idempoten) dan tidak menimpa konfigurasi yang sudah diubah. */
function ensureBaseData(db, { adminPassword = process.env.ADMIN_PASSWORD, quiet = false } = {}) {
  db.tx(() => {
    for (const r of ROLES) {
      db.run('INSERT OR IGNORE INTO roles (code, name, level, is_operational) VALUES (?,?,?,?)', r.code, r.name, r.level, r.is_operational);
      const has = db.get('SELECT COUNT(*) AS c FROM role_permissions WHERE role_code = ?', r.code).c;
      if (!has) for (const p of DEFAULT_ROLE_PERMISSIONS[r.code]) db.run('INSERT INTO role_permissions (role_code, permission) VALUES (?,?)', r.code, p);
    }
    for (const e of DEFAULT_ESCALATION_RULES) {
      db.run(`INSERT OR IGNORE INTO escalation_rules (code, name, stage1_after_minutes, stage2_after_minutes, stage3_after_minutes,
        repeat_threshold, repeat_window_days, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
      e.code, e.name, e.stage1_after_minutes, e.stage2_after_minutes, e.stage3_after_minutes, e.repeat_threshold, e.repeat_window_days, now());
    }
    if (!db.get('SELECT COUNT(*) AS c FROM task_templates').c) {
      for (const t of starter) insertTemplate(db, t);
    }
    if (!db.get('SELECT COUNT(*) AS c FROM users').c) {
      const pw = adminPassword || crypto.randomBytes(9).toString('base64url');
      db.run(`INSERT INTO users (name, username, password_hash, role_code, active, created_at, updated_at)
        VALUES ('Administrator','admin',?,'admin',1,?,?)`, hashPassword(pw), now(), now());
      if (!quiet) console.log(`\n[seed] Akun admin dibuat -> username: admin  password: ${pw}\n       Segera ganti password setelah login.\n`);
    }
  });
}

function insertTemplate(db, t) {
  const r = db.run(`INSERT INTO task_templates (name, instructions, category, is_critical, requires_photo, requires_verification,
      recurrence, days_of_week, start_time, due_time, end_time, interval_minutes, due_after_minutes, default_assignee_role,
      active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)`,
  t.name, t.instructions || '', t.category, t.is_critical || 0, t.requires_photo || 0, t.requires_verification || 0,
  t.recurrence, t.days_of_week || null, t.start_time, t.due_time || null, t.end_time || null, t.interval_minutes || null,
  t.due_after_minutes || null, t.default_assignee_role || null, now(), now());
  return Number(r.lastInsertRowid);
}

/** Data contoh: 2 brand, 3 outlet, karyawan tiap peran, dan beberapa penugasan. Password semua akun demo: demo1234 */
function seedDemo(db, { password = 'demo1234', createdAt = now() } = {}) {
  return db.tx(() => {
    if (db.get("SELECT 1 FROM outlets WHERE code = 'KOPI-01'")) return null;
    const ts = createdAt;
    const brand = (name) => Number(db.run('INSERT INTO brands (name, active, created_at) VALUES (?,1,?)', name, ts).lastInsertRowid);
    const outlet = (brandId, code, name) => Number(db.run('INSERT INTO outlets (brand_id, code, name, timezone, active, created_at) VALUES (?,?,?,?,1,?)',
      brandId, code, name, 'Asia/Jakarta', ts).lastInsertRowid);
    const hash = hashPassword(password);
    const user = (name, username, role, outlets, reportsTo = null) => {
      const id = Number(db.run(`INSERT INTO users (name, username, password_hash, role_code, reports_to_user_id, active, created_at, updated_at)
        VALUES (?,?,?,?,?,1,?,?)`, name, username, hash, role, reportsTo, ts, ts).lastInsertRowid);
      for (const [oid, team] of outlets) db.run('INSERT INTO user_outlets (user_id, outlet_id, team) VALUES (?,?,?)', id, oid, team || null);
      return id;
    };
    const bKopi = brand('Demo Kopi');
    const bBakmi = brand('Demo Bakmi');
    const k1 = outlet(bKopi, 'KOPI-01', 'Demo Kopi Kemang');
    const k2 = outlet(bKopi, 'KOPI-02', 'Demo Kopi Depok');
    const m1 = outlet(bBakmi, 'BAKMI-01', 'Demo Bakmi Tebet');

    const ids = {};
    ids.spv = user('Sari (SPV)', 'spv', 'spv', [[k1], [k2]]);
    ids.spv2 = user('Bima (SPV Bakmi)', 'spv2', 'spv', [[m1]]);
    ids.head = user('Hendra (Head Kemang)', 'head', 'head', [[k1]], ids.spv);
    ids.head2 = user('Dewi (Head Depok)', 'head2', 'head', [[k2]], ids.spv);
    ids.head3 = user('Rudi (Head Tebet)', 'head3', 'head', [[m1]], ids.spv2);
    ids.pic = user('Putri (PIC Bar)', 'pic', 'pic', [[k1, 'Bar']], ids.head);
    ids.pic2 = user('Agus (PIC Dapur)', 'pic2', 'pic', [[k1, 'Dapur']], ids.head);
    ids.crew = user('Andi (Crew Bar)', 'crew', 'crew', [[k1, 'Bar']], ids.pic);
    ids.crew2 = user('Budi (Crew Dapur)', 'crew2', 'crew', [[k1, 'Dapur']], ids.pic2);
    ids.kasir = user('Citra (Kasir)', 'kasir', 'kasir', [[k1]], ids.pic);
    ids.crew3 = user('Eko (Crew Depok)', 'crew3', 'crew', [[k2]], ids.head2);
    ids.crew4 = user('Fajar (Crew Tebet)', 'crew4', 'crew', [[m1]], ids.head3);

    const tpl = Object.fromEntries(db.all('SELECT * FROM task_templates').map((t) => [t.name, t]));
    const assign = (name, outletId, who) => {
      const t = tpl[name];
      if (!t) return;
      const w = who || { type: 'role', role: t.default_assignee_role || 'crew' };
      const a = Number(db.run(`INSERT INTO task_assignments (template_id, outlet_id, mode, assignee_type, assignee_role, assignee_team,
          assignee_user_id, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,1,?,?)`,
      t.id, outletId, w.type === 'user' ? 'individual' : 'shared', w.type, w.type === 'role' ? w.role : null,
      w.type === 'team' ? w.team : null, w.type === 'user' ? w.user : null, ts, ts).lastInsertRowid);
      db.run(`INSERT INTO task_schedules (assignment_id, recurrence, days_of_week, start_time, due_time, end_time, interval_minutes,
          due_after_minutes, active, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)`,
      a, t.recurrence, t.days_of_week, t.start_time, t.due_time, t.end_time, t.interval_minutes, t.due_after_minutes, ts, ts);
    };
    for (const name of Object.keys(tpl)) {
      if (name === 'Bersihkan peralatan') assign(name, k1, { type: 'team', team: 'Bar' });
      else if (name === 'Cek gas, listrik & kunci pintu') assign(name, k1, { type: 'user', user: ids.pic });
      else assign(name, k1);
    }
    for (const name of ['Menata meja dan kursi', 'Cek suhu chiller & freezer', 'Inspeksi kebersihan toilet', 'Pembersihan menyeluruh closing']) assign(name, k2);
    for (const name of ['Cek kesiapan peralatan', 'Cek suhu chiller & freezer', 'Bersihkan meja pelanggan', 'Bersihkan peralatan']) assign(name, m1);
    return { brands: { bKopi, bBakmi }, outlets: { k1, k2, m1 }, users: ids };
  });
}

module.exports = { ensureBaseData, seedDemo, insertTemplate };

if (require.main === module) {
  const config = require('./config');
  const { openDb } = require('./db');
  const db = openDb(config.dbPath);
  const demo = process.argv.includes('--demo');
  ensureBaseData(db, { adminPassword: process.env.ADMIN_PASSWORD || (demo ? 'demo1234' : undefined) });
  if (demo) {
    // Jadwal demo dianggap dibuat pukul 00:00 hari ini (WIB) agar semua tugas hari ini langsung muncul.
    const { zonedToUtc, localDate } = require('./time');
    const start = zonedToUtc(localDate(new Date(), 'Asia/Jakarta'), '00:00', 'Asia/Jakarta').toISOString();
    const r = seedDemo(db, { createdAt: start });
    console.log(r ? '[seed] Data demo dibuat. Password semua akun demo: demo1234 (admin, spv, head, pic, crew, crew2, kasir, ...)'
      : '[seed] Data demo sudah ada, dilewati.');
  }
  const { runJobs } = require('./services/jobs');
  console.log('[seed] Jobs:', runJobs(db));
  db.close();
}
