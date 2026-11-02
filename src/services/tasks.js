'use strict';
const clock = require('../clock');
const { bad, forbidden, notFound, conflict } = require('../errors');
const { OPEN_STATUSES, DONE_STATUSES } = require('../constants');
const access = require('../access');
const { storeImages, removeFiles } = require('./files');
const { notify } = require('./notify');
const { audit } = require('./audit');

function fmtLocal(iso, tz) {
  return new Intl.DateTimeFormat('id-ID', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
}

function loadScoped(db, user, id) {
  const inst = access.getInstance(db, id);
  if (!inst || !user.outletIds.has(inst.outlet_id)) throw notFound('Tugas tidak ditemukan.');
  return inst;
}

/** PIC (level team) hanya boleh mengelola tugas area/shift-nya. */
function assertSupervises(db, user, inst) {
  if (access.monitorLevel(user) === 'team' && !access.inTeamScope(user, inst, access.memberInfoLookup(db))) {
    throw forbidden('Tugas ini di luar area/shift Anda.');
  }
}

function completeTask(db, user, id, { note, files = [] }) {
  const inst = loadScoped(db, user, id);
  if (!access.canComplete(user, inst)) throw forbidden('Tugas ini bukan tanggung jawab Anda.');
  if (!OPEN_STATUSES.includes(inst.status)) {
    throw conflict(`Tugas sudah diselesaikan oleh ${inst.completed_by_name || '-'} (${fmtLocal(inst.completed_at, inst.timezone)}).`);
  }
  const now = clock.now();
  const nowIso = now.toISOString();
  if (nowIso < inst.scheduled_at) throw bad(`Belum waktunya. Tugas ini mulai ${fmtLocal(inst.scheduled_at, inst.timezone)}.`);
  if (inst.requires_photo && files.length === 0) throw bad('Foto bukti wajib diunggah untuk tugas ini.');
  if (files.length > 3) throw bad('Maksimal 3 foto.');
  const stored = storeImages(files);
  const late = nowIso > inst.due_at ? 1 : 0;
  const newStatus = inst.requires_verification ? 'menunggu_verifikasi' : 'dikerjakan';
  try {
    return db.tx(() => {
      const upd = db.run(`UPDATE task_instances SET status = ?, completed_by = ?, completed_at = ?,
          was_late = MAX(was_late, ?), verified_by = NULL, verified_at = NULL, updated_at = ?
        WHERE id = ? AND status IN ('belum','perlu_perbaikan')`, newStatus, user.id, nowIso, late, nowIso, inst.id);
      if (Number(upd.changes) !== 1) throw conflict('Tugas sudah diselesaikan oleh anggota tim lain.');
      const sub = db.run('INSERT INTO task_submissions (instance_id, submitted_by, submitted_at, note, was_late) VALUES (?,?,?,?,?)',
        inst.id, user.id, nowIso, note ? String(note).slice(0, 1000) : null, late);
      const subId = Number(sub.lastInsertRowid);
      for (const s of stored) {
        db.run(`INSERT INTO task_evidence (submission_id, instance_id, stored_name, original_name, mime_type, size_bytes, sha256, uploaded_by, created_at)
          VALUES (?,?,?,?,?,?,?,?,?)`, subId, inst.id, s.stored_name, s.original_name, s.mime_type, s.size_bytes, s.sha256, user.id, nowIso);
      }
      audit(db, user.id, 'task.complete', 'task_instance', inst.id, { status: newStatus, late: !!late, photos: stored.length });
      return access.getInstance(db, inst.id);
    });
  } catch (e) {
    removeFiles(stored);
    throw e;
  }
}

function lastSubmissionId(db, instId) {
  const r = db.get('SELECT id FROM task_submissions WHERE instance_id = ? ORDER BY id DESC LIMIT 1', instId);
  return r ? r.id : null;
}

function verifyTask(db, user, id, { decision, reason }) {
  if (!user.perms.has('task.verify')) throw forbidden();
  const inst = loadScoped(db, user, id);
  if (inst.status !== 'menunggu_verifikasi') throw conflict('Tugas ini tidak sedang menunggu verifikasi.');
  if (inst.completed_by === user.id) throw forbidden('Anda tidak dapat memverifikasi tugas yang Anda kerjakan sendiri.');
  if (!['approve', 'reject'].includes(decision)) throw bad('Keputusan tidak valid.');
  const why = reason ? String(reason).trim() : '';
  if (decision === 'reject' && !why) throw bad('Alasan penolakan wajib diisi.');
  const nowIso = clock.nowIso();
  return db.tx(() => {
    const subId = lastSubmissionId(db, inst.id);
    const v = db.run('INSERT INTO verification_records (instance_id, submission_id, verifier_id, decision, reason, created_at) VALUES (?,?,?,?,?,?)',
      inst.id, subId, user.id, decision === 'approve' ? 'approved' : 'rejected', why || null, nowIso);
    if (decision === 'approve') {
      db.run(`UPDATE task_instances SET status = 'terverifikasi', verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ?`,
        user.id, nowIso, nowIso, inst.id);
    } else {
      db.run(`UPDATE task_instances SET status = 'perlu_perbaikan', verified_by = NULL, verified_at = NULL, updated_at = ? WHERE id = ?`,
        nowIso, inst.id);
      notify(db, { userId: inst.completed_by, instanceId: inst.id, kind: 'rejected',
        message: `Perlu perbaikan: "${inst.name}" (${inst.outlet_name}). Alasan: ${why}`, dedupeKey: `rej:${v.lastInsertRowid}` });
    }
    audit(db, user.id, decision === 'approve' ? 'task.verify' : 'task.reject', 'task_instance', inst.id, { reason: why || undefined });
    return access.getInstance(db, inst.id);
  });
}

function reopenTask(db, user, id, { reason }) {
  if (!user.perms.has('task.reopen')) throw forbidden();
  const inst = loadScoped(db, user, id);
  assertSupervises(db, user, inst);
  if (!DONE_STATUSES.includes(inst.status)) throw conflict('Hanya tugas yang sudah dikerjakan yang bisa dibuka ulang.');
  const why = reason ? String(reason).trim() : '';
  if (!why) throw bad('Alasan wajib diisi.');
  const nowIso = clock.nowIso();
  return db.tx(() => {
    const v = db.run('INSERT INTO verification_records (instance_id, submission_id, verifier_id, decision, reason, created_at) VALUES (?,?,?,?,?,?)',
      inst.id, lastSubmissionId(db, inst.id), user.id, 'reopened', why, nowIso);
    db.run(`UPDATE task_instances SET status = 'perlu_perbaikan', verified_by = NULL, verified_at = NULL, updated_at = ? WHERE id = ?`, nowIso, inst.id);
    if (inst.completed_by) {
      notify(db, { userId: inst.completed_by, instanceId: inst.id, kind: 'reopened',
        message: `Dibuka ulang: "${inst.name}" (${inst.outlet_name}). Alasan: ${why}`, dedupeKey: `reo:${v.lastInsertRowid}` });
    }
    audit(db, user.id, 'task.reopen', 'task_instance', inst.id, { reason: why });
    return access.getInstance(db, inst.id);
  });
}

/** Detail lengkap: riwayat pengiriman, bukti, verifikasi, dan aksi yang diizinkan untuk user ini. */
function instanceDetail(db, user, id) {
  const inst = loadScoped(db, user, id);
  const submissions = db.all(`SELECT s.id, s.submitted_at, s.note, s.was_late, u.name AS submitted_by_name
    FROM task_submissions s JOIN users u ON u.id = s.submitted_by WHERE s.instance_id = ? ORDER BY s.id`, inst.id);
  const evidence = db.all('SELECT id, submission_id, mime_type, created_at FROM task_evidence WHERE instance_id = ? ORDER BY id', inst.id);
  for (const s of submissions) {
    s.was_late = !!s.was_late;
    s.evidence = evidence.filter((e) => e.submission_id === s.id).map((e) => ({ id: e.id, url: `/api/evidence/${e.id}` }));
  }
  const verifications = db.all(`SELECT v.decision, v.reason, v.created_at, u.name AS verifier_name
    FROM verification_records v JOIN users u ON u.id = v.verifier_id WHERE v.instance_id = ? ORDER BY v.id`, inst.id);
  const supervises = access.monitorLevel(user) !== 'team' || access.inTeamScope(user, inst, access.memberInfoLookup(db));
  return {
    ...inst,
    submissions,
    verifications,
    last_rejection: inst.status === 'perlu_perbaikan' ? verifications.filter((v) => v.decision !== 'approved').at(-1) || null : null,
    can_complete: OPEN_STATUSES.includes(inst.status) && access.canComplete(user, inst),
    can_verify: inst.status === 'menunggu_verifikasi' && user.perms.has('task.verify') && inst.completed_by !== user.id,
    can_reopen: DONE_STATUSES.includes(inst.status) && user.perms.has('task.reopen') && supervises,
  };
}

module.exports = { completeTask, verifyTask, reopenTask, instanceDetail };
