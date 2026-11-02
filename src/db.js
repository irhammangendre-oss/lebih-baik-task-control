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
    this.raw.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
  }
  close() { this.raw.close(); }
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
