'use strict';
const express = require('express');
const auth = require('../auth');
const { audit } = require('../services/audit');
const { HttpError } = require('../errors');
const { PERMISSIONS, CATEGORIES, STATUS } = require('../constants');
const { monitorLevel } = require('../access');
const config = require('../config');

// Pembatas percobaan login sederhana (in-memory).
const attempts = new Map();
const WINDOW = 15 * 60 * 1000;
function tooMany(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) return false;
  return a.count >= 10;
}
function fail(key) {
  const a = attempts.get(key);
  if (!a || Date.now() - a.first > WINDOW) attempts.set(key, { first: Date.now(), count: 1 });
  else a.count++;
}

function serializeMe(db, user) {
  const roles = db.all('SELECT code, name, level FROM roles ORDER BY level, name');
  return {
    id: user.id, name: user.name, username: user.username, role_code: user.role_code, role_name: user.role_name,
    permissions: [...user.perms], outlets: user.outlets, monitor_level: monitorLevel(user),
    features: { notifications: config.notificationsEnabled },
    meta: { roles, permissions: PERMISSIONS, categories: CATEGORIES, statuses: STATUS },
  };
}

module.exports = (db) => {
  const r = express.Router();

  r.post('/auth/login', (req, res) => {
    const username = String(req.body?.username || '').trim();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${username.toLowerCase()}`;
    if (tooMany(key)) throw new HttpError(429, 'Terlalu banyak percobaan. Coba lagi dalam 15 menit.');
    const row = db.get('SELECT id, password_hash, pin_hash, active FROM users WHERE username = ?', username);
    const ok = row && row.active && (auth.verifyPin(password, row.pin_hash) || auth.verifyPassword(password, row.password_hash));
    if (!ok) {
      fail(key);
      throw new HttpError(401, 'Username atau PIN/password salah.');
    }
    attempts.delete(key);
    const { token, expires } = auth.createSession(db, row.id);
    auth.setSessionCookie(res, token, expires);
    audit(db, row.id, 'auth.login', 'user', row.id);
    res.json(serializeMe(db, auth.loadUser(db, row.id)));
  });

  r.post('/auth/logout', (req, res) => {
    auth.destroySession(db, req.sessionToken);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  });

  r.get('/me', auth.requireAuth, (req, res) => res.json(serializeMe(db, req.user)));

  r.post('/me/pin', auth.requireAuth, (req, res) => {
    const { current, new_pin: pin } = req.body || {};
    const row = db.get('SELECT password_hash, pin_hash FROM users WHERE id = ?', req.user.id);
    if (!auth.verifyPassword(current || '', row.password_hash) && !auth.verifyPin(current || '', row.pin_hash)) throw new HttpError(400, 'PIN/password lama salah.');
    if (!auth.PIN_RE.test(String(pin || ''))) throw new HttpError(400, 'PIN harus 6 angka.');
    db.run('UPDATE users SET pin_hash = ?, updated_at = ? WHERE id = ?', auth.hashPin(pin), new Date().toISOString(), req.user.id);
    audit(db, req.user.id, 'user.pin_change', 'user', req.user.id);
    res.json({ ok: true });
  });

  r.post('/me/password', auth.requireAuth, (req, res) => {
    const { current_password: cur, new_password: next } = req.body || {};
    const row = db.get('SELECT password_hash FROM users WHERE id = ?', req.user.id);
    if (!auth.verifyPassword(cur || '', row.password_hash) && !auth.verifyPin(cur || '', db.get('SELECT pin_hash FROM users WHERE id = ?', req.user.id).pin_hash)) throw new HttpError(400, 'Password lama salah.');
    if (!next || String(next).length < 8) throw new HttpError(400, 'Password baru minimal 8 karakter.');
    db.run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', auth.hashPassword(next), new Date().toISOString(), req.user.id);
    audit(db, req.user.id, 'user.password_change', 'user', req.user.id);
    res.json({ ok: true });
  });

  return r;
};
