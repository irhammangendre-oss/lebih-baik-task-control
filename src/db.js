'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

/** Pembungkus tipis node:sqlite: statement cache, helper query, dan transaksi. */
class Db {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    if (file !== ':memory:') this.raw.exec('PRAGMA journal_mode = WAL;');
    this.stmts = new Map();
    this.depth = 0;
  }
  prep(sql) {
    let s = this.stmts.get(sql);
    if (!s) { s = this.raw.prepare(sql); this.stmts.set(sql, s); }
    return s;
  }
  all(sql, ...p) { return this.prep(sql).all(...clean(p)); }
  get(sql, ...p) { return this.prep(sql).get(...clean(p)); }
  run(sql, ...p) { return this.prep(sql).run(...clean(p)); }
  exec(sql) { this.raw.exec(sql); }
  tx(fn) {
    if (this.depth > 0) return fn();
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth++;
    try {
      const r = fn();
      this.raw.exec('COMMIT');
      return r;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    } finally {
      this.depth--;
    }
  }
  migrate() {
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    this.raw.exec(schema);
    const version = this.raw.prepare('PRAGMA user_version').get().user_version;
    if (version < 2) migrateV2(this, schema);
    if (version < 3) {
      // v3: login dengan PIN.
      if (!hasColumn(this, 'users', 'pin_hash')) this.raw.exec('ALTER TABLE users ADD COLUMN pin_hash TEXT');
      this.raw.exec('PRAGMA user_version = 3');
    }
  }
  close() { this.raw.close(); }
}

const hasColumn = (db, table, col) => db.raw.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col);

// Kolom yang disalin saat membangun ulang tabel lama (v1) ke struktur baru.
const V1_COLUMNS = {
  task_assignments: 'id, template_id, outlet_id, mode, assignee_type, assignee_role, assignee_team, assignee_user_id, active, created_by, created_at, updated_at',
  task_instances: `id, schedule_id, assignment_id, template_id, outlet_id, business_date, scheduled_at, due_at, name, category, is_critical,
    requires_photo, requires_verification, mode, assignee_type, assignee_role, assignee_team, assignee_user_id, status, completed_by,
    completed_at, was_late, verified_by, verified_at, escalation_stage, last_escalated_at, created_at, updated_at`,
};

/**
 * v2: shift & serah terima. Database v1 di-upgrade otomatis tanpa kehilangan data:
 * kolom baru ditambahkan, dan tabel dengan CHECK constraint yang berubah dibangun ulang.
 */
function migrateV2(db, schema) {
  const raw = db.raw;
  const legacy = !hasColumn(db, 'task_instances', 'shift_no');
  if (legacy) {
    raw.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON;');
    raw.exec('BEGIN IMMEDIATE');
    try {
      const add = [
        ['user_outlets', 'shift_no', 'INTEGER CHECK (shift_no IS NULL OR shift_no IN (1,2))'],
        ['task_templates', 'default_shift_no', 'INTEGER CHECK (default_shift_no IS NULL OR default_shift_no IN (1,2))'],
        ['task_submissions', 'shift_no', 'INTEGER'],
      ];
      for (const [t, c, def] of add) if (!hasColumn(db, t, c)) raw.exec(`ALTER TABLE ${t} ADD COLUMN ${c} ${def}`);
      for (const t of Object.keys(V1_COLUMNS)) raw.exec(`ALTER TABLE ${t} RENAME TO _v1_${t}`);
      raw.exec(schema);
      for (const [t, cols] of Object.entries(V1_COLUMNS)) raw.exec(`INSERT INTO ${t} (${cols}) SELECT ${cols} FROM _v1_${t}`);
      for (const t of Object.keys(V1_COLUMNS).reverse()) raw.exec(`DROP TABLE _v1_${t}`);
      raw.exec(schema); // index yang sebelumnya menempel pada tabel lama
      const bad = raw.prepare('PRAGMA foreign_key_check').all();
      if (bad.length) throw new Error(`Migrasi v2 gagal: ${bad.length} pelanggaran foreign key`);
      raw.exec('COMMIT');
    } catch (e) {
      raw.exec('ROLLBACK');
      throw e;
    } finally {
      raw.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
    }
  }
  // Izin baru untuk peran yang sudah ada (database lama).
  const grants = { crew: ['handover.create'], kasir: ['handover.create'], pic: ['handover.create'], head: ['handover.create', 'shift.manage'], spv: ['handover.create', 'shift.manage'], admin: ['handover.create', 'shift.manage'] };
  for (const [role, perms] of Object.entries(grants)) {
    const exists = raw.prepare('SELECT COUNT(*) AS c FROM role_permissions WHERE role_code = ?').get(role).c;
    if (exists) for (const p of perms) raw.prepare('INSERT OR IGNORE INTO role_permissions (role_code, permission) VALUES (?,?)').run(role, p);
  }
  raw.exec('PRAGMA user_version = 2');
}

function clean(params) {
  return params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

function openDb(file) {
  const db = new Db(file);
  db.migrate();
  return db;
}

module.exports = { openDb, Db };
