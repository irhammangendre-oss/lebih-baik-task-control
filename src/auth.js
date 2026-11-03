'use strict';
const crypto = require('node:crypto');
const clock = require('./clock');
const config = require('./config');
const { HttpError, forbidden } = require('./errors');

const COOKIE = 'lb_sid';

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(pw), salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, keyHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !keyHex) return false;
  const key = crypto.scryptSync(String(pw), Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(keyHex, 'hex');
  return expected.length === key.length && crypto.timingSafeEqual(key, expected);
}
const PIN_RE = /^\d{6}$/;
/** PIN di-hash seperti password; hanya 6 digit angka. */
const hashPin = (pin) => hashPassword(`pin:${pin}`);
const verifyPin = (pin, stored) => !!stored && PIN_RE.test(String(pin)) && verifyPassword(`pin:${pin}`, stored);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createSession(db, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = clock.now();
  const expires = new Date(now.getTime() + config.sessionDays * 86400000);
  db.run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)',
    sha256(token), userId, now.toISOString(), expires.toISOString());
  return { token, expires };
}
function destroySession(db, token) {
  if (token) db.run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Memuat user lengkap: peran, izin, dan outlet yang boleh diakses. */
function loadUser(db, userId) {
  const u = db.get(`SELECT u.id, u.name, u.username, u.role_code, u.reports_to_user_id, u.active,
      r.name AS role_name, r.level AS role_level
    FROM users u JOIN roles r ON r.code = u.role_code WHERE u.id = ?`, userId);
  if (!u || !u.active) return null;
  const perms = new Set(db.all('SELECT permission FROM role_permissions WHERE role_code = ?', u.role_code).map((r) => r.permission));
  const assigned = db.all(`SELECT uo.outlet_id, uo.team, uo.shift_no, o.name AS outlet_name, o.brand_id, b.name AS brand_name, o.timezone
      FROM user_outlets uo JOIN outlets o ON o.id = uo.outlet_id JOIN brands b ON b.id = o.brand_id
      WHERE uo.user_id = ? AND o.active = 1 ORDER BY b.name, o.name`, u.id);
  let outlets = assigned;
  if (perms.has('scope.all')) {
    const teamBy = new Map(assigned.map((a) => [a.outlet_id, a.team]));
    outlets = db.all(`SELECT o.id AS outlet_id, o.name AS outlet_name, o.brand_id, b.name AS brand_name, o.timezone
        FROM outlets o JOIN brands b ON b.id = o.brand_id WHERE o.active = 1 ORDER BY b.name, o.name`)
      .map((o) => ({ ...o, team: teamBy.get(o.outlet_id) ?? null, shift_no: assigned.find((a) => a.outlet_id === o.outlet_id)?.shift_no ?? null }));
  }
  // Jadwal shift per tanggal (pengecualian) untuk 14 hari terakhir s.d. ke depan.
  const since = new Date(clock.now().getTime() - 14 * 86400000).toISOString().slice(0, 10);
  const roster = new Map(db.all('SELECT outlet_id, work_date, shift_no FROM shift_rosters WHERE user_id = ? AND work_date >= ?', u.id, since)
    .map((r) => [`${r.outlet_id}:${r.work_date}`, r.shift_no]));
  const defaultShift = new Map(assigned.map((a) => [a.outlet_id, a.shift_no ?? null]));
  return {
    id: u.id, name: u.name, username: u.username, role_code: u.role_code, role_name: u.role_name,
    role_level: u.role_level, reports_to_user_id: u.reports_to_user_id,
    perms, outlets, assignedOutletIds: new Set(assigned.map((a) => a.outlet_id)),
    outletIds: new Set(outlets.map((o) => o.outlet_id)),
    /** Shift karyawan di outlet pada tanggal tertentu (null = belum dijadwalkan / fleksibel). */
    shiftOn: (outletId, date) => roster.get(`${outletId}:${date}`) ?? defaultShift.get(Number(outletId)) ?? null,
  };
}

function authenticate(db) {
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    req.sessionToken = token;
    req.user = null;
    if (token) {
      const s = db.get('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?', sha256(token));
      if (s && s.expires_at > clock.nowIso()) req.user = loadUser(db, s.user_id);
    }
    next();
  };
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Silakan login terlebih dahulu.'));
  next();
}

/** Lolos jika user memiliki salah satu izin. */
const requirePerm = (...perms) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Silakan login terlebih dahulu.'));
  if (!perms.some((p) => req.user.perms.has(p))) return next(forbidden());
  next();
};

/** Proteksi CSRF sederhana: request yang mengubah data wajib membawa header khusus (tidak bisa dikirim form lintas situs). */
function csrfGuard(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'lb-app') return next(forbidden('Permintaan ditolak (CSRF).'));
  next();
}

function setSessionCookie(res, token, expires) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, expires, path: '/' });
}
function clearSessionCookie(res) {
  res.clearCookie(COOKIE, { path: '/' });
}

module.exports = {
  hashPassword, verifyPassword, hashPin, verifyPin, PIN_RE, createSession, destroySession, loadUser, authenticate, requireAuth,
  requirePerm, csrfGuard, setSessionCookie, clearSessionCookie, COOKIE,
};
