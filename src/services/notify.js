'use strict';
const clock = require('../clock');
const config = require('../config');

/**
 * Simpan notifikasi in-app. dedupe_key UNIQUE -> notifikasi yang sama tidak pernah dikirim dua kali.
 * Jika NOTIFY_WEBHOOK_URL diisi, notifikasi baru juga diteruskan (fire-and-forget) ke webhook tersebut.
 */
function notify(db, { userId, instanceId = null, kind, stage = null, message, dedupeKey }) {
  const r = db.run(`INSERT OR IGNORE INTO notifications (user_id, instance_id, kind, stage, message, dedupe_key, created_at)
    VALUES (?,?,?,?,?,?,?)`, userId, instanceId, kind, stage, message, dedupeKey, clock.nowIso());
  const inserted = Number(r.changes) === 1;
  if (inserted && config.notifyWebhookUrl) {
    const user = db.get('SELECT id, name, username FROM users WHERE id = ?', userId);
    fetch(config.notifyWebhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user, instance_id: instanceId, kind, stage, message }),
      signal: AbortSignal.timeout(5000),
    }).catch((e) => console.error('[notify] webhook gagal:', e.message));
  }
  return inserted;
}

module.exports = { notify };
