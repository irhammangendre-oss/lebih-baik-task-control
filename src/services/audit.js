'use strict';
const clock = require('../clock');

function audit(db, userId, action, entityType, entityId, details) {
  db.run('INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, created_at) VALUES (?,?,?,?,?,?)',
    userId ?? null, action, entityType ?? null, entityId ?? null, details ? JSON.stringify(details) : null, clock.nowIso());
}
module.exports = { audit };
