'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');

// Alur MVP lengkap sesuai kriteria penerimaan (1-12).
test('alur lengkap: template -> penugasan -> checklist -> selesai + foto -> verifikasi -> eskalasi -> monitoring -> histori', async (t) => {
  const ctx = setup({ date: '2026-11-02', time: '08:00' });
  const { k1, k2, m1 } = ctx.demo.outlets;
  const { bKopi } = ctx.demo.brands;
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew'); // KOPI-01, tim Bar
  const crew2 = await ctx.login('crew2'); // KOPI-01, tim Dapur
  const crew3 = await ctx.login('crew3'); // KOPI-02
  const head = await ctx.login('head'); // KOPI-01
  const head2 = await ctx.login('head2'); // KOPI-02
  const spv = await ctx.login('spv'); // KOPI-01 & KOPI-02
  const spv2 = await ctx.login('spv2'); // BAKMI-01
  let tpl; let instK1; let instK2;

  await t.test('1. Admin membuat template', async () => {
    const res = await admin.post('/api/templates').send({
      name: 'Cek kebersihan etalase', instructions: 'Lap kaca etalase', category: 'operasional',
      requires_photo: true, requires_verification: true, brand_ids: [bKopi],
      recurrence: 'daily', start_time: '08:00', due_time: '10:00', default_assignee_role: 'crew',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    tpl = res.body;
    assert.equal(tpl.requires_photo, 1);
    assert.deepEqual(tpl.brand_ids, [bKopi]);
    const bad = await admin.post('/api/templates').send({ name: '', category: 'opening', start_time: '08:00', due_time: '09:00' });
    assert.equal(bad.status, 400);
  });

  await t.test('2. Admin menugaskan ke outlet terpilih (brand dibatasi)', async () => {
    const wrongBrand = await admin.post('/api/assignments').send({ template_id: tpl.id, outlet_ids: [m1], assignee_type: 'role', assignee_role: 'crew' });
    assert.equal(wrongBrand.status, 400);
    const res = await admin.post('/api/assignments').send({ template_id: tpl.id, outlet_ids: [k1, k2], assignee_type: 'role', assignee_role: 'crew' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.length, 2);
    assert.equal(res.body[0].mode, 'shared');
  });

  await t.test('3. Tugas muncul di checklist outlet yang benar saja', async () => {
    const c1 = await head.get(`/api/checklist?outlet_id=${k1}`);
    instK1 = c1.body.groups.operasional.find((x) => x.template_id === tpl.id);
    assert.ok(instK1, 'muncul di KOPI-01');
    assert.equal(instK1.business_date, '2026-11-02');
    const c2 = await head2.get(`/api/checklist?outlet_id=${k2}`);
    instK2 = c2.body.groups.operasional.find((x) => x.template_id === tpl.id);
    assert.ok(instK2, 'muncul di KOPI-02');
    const bakmi = ctx.db.get('SELECT COUNT(*) AS c FROM task_instances WHERE template_id = ? AND outlet_id = ?', tpl.id, m1).c;
    assert.equal(bakmi, 0);
    // Tugas Saya: crew KOPI-01 melihat instance KOPI-01 saja.
    const my = await crew.get('/api/my-tasks');
    const mine = my.body.tasks.filter((x) => x.template_id === tpl.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].outlet_id, k1);
    assert.equal(mine[0].requires_photo, true);
    assert.equal(mine[0].assignee_label, 'Semua Crew');
  });

  await t.test('4-6. Karyawan menyelesaikan via HP, foto wajib, tercatat siapa & kapan', async () => {
    const noPhoto = await crew.post(`/api/instances/${instK1.id}/complete`).field('note', 'tanpa foto');
    assert.equal(noPhoto.status, 400);
    assert.match(noPhoto.body.error, /Foto bukti wajib/);
    const notImage = await crew.post(`/api/instances/${instK1.id}/complete`).attach('photos', Buffer.from('bukan gambar sama sekali'), 'x.jpg');
    assert.equal(notImage.status, 400);
    ctx.advanceMinutes(15); // 08:15
    const ok = await crew.post(`/api/instances/${instK1.id}/complete`).field('note', 'Sudah bersih').attach('photos', ctx.JPEG, 'etalase.jpg');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'menunggu_verifikasi');
    assert.equal(ok.body.completed_by_name, 'Andi (Crew Bar)');
    assert.equal(ok.body.completed_at, '2026-11-02T01:15:00.000Z');
    assert.equal(ok.body.was_late, false);
    assert.equal(ok.body.evidence_count, 1);
    // Tugas bersama: anggota tim lain tidak bisa mengerjakan ulang (tidak duplikat).
    const dup = await crew2.post(`/api/instances/${instK1.id}/complete`).attach('photos', ctx.JPEG, 'b.jpg');
    assert.equal(dup.status, 409);
  });

  await t.test('7. Supervisor berwenang memverifikasi (tolak dengan alasan, lalu setujui)', async () => {
    assert.equal((await crew.post(`/api/instances/${instK1.id}/verify`).send({ decision: 'approve' })).status, 403);
    assert.equal((await head2.post(`/api/instances/${instK1.id}/verify`).send({ decision: 'approve' })).status, 404, 'Head outlet lain tidak bisa');
    assert.equal((await head.post(`/api/instances/${instK1.id}/verify`).send({ decision: 'reject' })).status, 400, 'alasan wajib');
    const rej = await head.post(`/api/instances/${instK1.id}/verify`).send({ decision: 'reject', reason: 'Kaca masih bernoda' });
    assert.equal(rej.body.status, 'perlu_perbaikan');
    const notif = await crew.get('/api/notifications');
    assert.ok(notif.body.items.some((n) => n.kind === 'rejected' && /Kaca masih bernoda/.test(n.message)));
    const detail = await crew.get(`/api/instances/${instK1.id}`);
    assert.equal(detail.body.last_rejection.reason, 'Kaca masih bernoda');
    assert.equal(detail.body.can_complete, true);
    const re = await crew.post(`/api/instances/${instK1.id}/complete`).attach('photos', ctx.JPEG, 'ulang.jpg');
    assert.equal(re.body.status, 'menunggu_verifikasi');
    const ok = await head.post(`/api/instances/${instK1.id}/verify`).send({ decision: 'approve' });
    assert.equal(ok.body.status, 'terverifikasi');
    assert.equal(ok.body.verified_by_name, 'Hendra (Head Kemang)');
    const d2 = await head.get(`/api/instances/${instK1.id}`);
    assert.equal(d2.body.submissions.length, 2);
    assert.deepEqual(d2.body.verifications.map((v) => v.decision), ['rejected', 'approved']);
    // Bukti hanya untuk yang berhak.
    const evUrl = d2.body.submissions[0].evidence[0].url;
    assert.equal((await head.get(evUrl)).status, 200);
    assert.equal((await head2.get(evUrl)).status, 404);
  });

  await t.test('8. Tugas terlambat memicu eskalasi bertahap tanpa notifikasi berulang', async () => {
    const count = (uname, iid) => ctx.db.get(`SELECT COUNT(*) AS c FROM notifications n JOIN users u ON u.id = n.user_id
      WHERE u.username = ? AND n.instance_id = ? AND n.kind = 'escalation'`, uname, iid).c;
    ctx.setTime('2026-11-02', '10:01');
    ctx.jobs();
    assert.equal(count('crew3', instK2.id), 1, 'tahap 1 ke karyawan');
    assert.equal(count('head2', instK2.id), 0);
    ctx.setTime('2026-11-02', '11:01');
    ctx.jobs();
    ctx.jobs();
    assert.equal(count('head2', instK2.id), 1, 'tahap 2 ke Head');
    assert.equal(count('crew3', instK2.id), 1, 'tidak dikirim ulang');
    assert.equal(count('spv', instK2.id), 0);
    ctx.setTime('2026-11-02', '14:01');
    ctx.jobs();
    assert.equal(count('spv', instK2.id), 1, 'tahap 3 ke SPV');
    assert.equal(count('spv2', instK2.id), 0, 'SPV lain tidak menerima');
    const mon = await head2.get('/api/monitoring');
    assert.ok(mon.body.overdue.some((x) => x.id === instK2.id));
    // Diselesaikan terlambat: tidak lagi "belum selesai", tapi histori terlambat tetap ada.
    const late = await crew3.post(`/api/instances/${instK2.id}/complete`).attach('photos', ctx.JPEG, 'late.jpg');
    assert.equal(late.status, 200);
    assert.equal(late.body.was_late, true);
    assert.equal(late.body.is_overdue, false);
    assert.equal(late.body.effective_status, 'menunggu_verifikasi');
    const mon2 = await head2.get('/api/monitoring');
    assert.ok(!mon2.body.overdue.some((x) => x.id === instK2.id));
    assert.ok(mon2.body.cards.late_completed >= 1);
    const before = ctx.db.get('SELECT COUNT(*) AS c FROM notifications WHERE instance_id = ?', instK2.id).c;
    ctx.setTime('2026-11-02', '18:00');
    ctx.jobs();
    assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM notifications WHERE instance_id = ?', instK2.id).c, before, 'eskalasi berhenti setelah selesai');
    assert.equal(count('crew3', instK2.id), 1);
  });

  await t.test('9. Management memantau semua outlet; SPV hanya outlet yang diawasi', async () => {
    const a = await admin.get('/api/monitoring?date=2026-11-02');
    assert.equal(a.status, 200);
    assert.equal(a.body.level, 'all');
    assert.deepEqual(a.body.by_outlet.map((o) => o.outlet_id).sort(), [k1, k2, m1].sort());
    // Angka dashboard sesuai record database.
    const dbTotal = ctx.db.get("SELECT COUNT(*) AS c FROM task_instances WHERE business_date = '2026-11-02'").c;
    const dbVerified = ctx.db.get("SELECT COUNT(*) AS c FROM task_instances WHERE business_date = '2026-11-02' AND status = 'terverifikasi'").c;
    const dbRejected = ctx.db.get("SELECT COUNT(*) AS c FROM verification_records WHERE decision = 'rejected'").c;
    assert.equal(a.body.cards.total, dbTotal);
    assert.equal(a.body.cards.verified, dbVerified);
    assert.equal(a.body.cards.rejected, dbRejected);
    const byBrand = await admin.get(`/api/monitoring?date=2026-11-02&brand_id=${bKopi}`);
    assert.deepEqual(byBrand.body.by_outlet.map((o) => o.outlet_id).sort(), [k1, k2].sort());
    const s = await spv.get('/api/monitoring?date=2026-11-02');
    assert.deepEqual(s.body.by_outlet.map((o) => o.outlet_id).sort(), [k1, k2].sort());
    const s2 = await spv2.get('/api/monitoring?date=2026-11-02');
    assert.deepEqual(s2.body.by_outlet.map((o) => o.outlet_id), [m1]);
    assert.ok(s2.body.instances.every((i) => i.outlet_id === m1));
    const detail = await admin.get(`/api/monitoring/outlets/${k1}?date=2026-11-02`);
    assert.ok(detail.body.instances.some((i) => i.id === instK1.id && i.completed_by_name && i.evidence_count === 2));
    assert.ok(detail.body.staff.length > 0);
    const status = await admin.get('/api/monitoring?date=2026-11-02&status=terverifikasi');
    assert.ok(status.body.instances.every((i) => i.effective_status === 'terverifikasi'));
  });

  await t.test('10. Data historis tetap tersedia di hari berikutnya', async () => {
    ctx.setTime('2026-11-03', '09:00');
    ctx.jobs();
    const hist = await head.get(`/api/checklist?outlet_id=${k1}&date=2026-11-02`);
    const old = hist.body.groups.operasional.find((x) => x.id === instK1.id);
    assert.equal(old.status, 'terverifikasi');
    assert.equal(old.completed_by_name, 'Andi (Crew Bar)');
    const today = await head.get(`/api/checklist?outlet_id=${k1}`);
    assert.equal(today.body.date, '2026-11-03');
    assert.ok(today.body.groups.operasional.some((x) => x.template_id === tpl.id && x.status === 'belum'), 'kejadian baru hari ini');
  });

  await t.test('11. Pengguna tidak bisa mengakses data outlet lain', async () => {
    assert.equal((await head2.get(`/api/checklist?outlet_id=${k1}`)).status, 404);
    assert.equal((await head2.get(`/api/instances/${instK1.id}`)).status, 404);
    assert.equal((await spv2.get(`/api/monitoring?outlet_id=${k1}`)).status, 404);
    assert.equal((await spv2.get(`/api/monitoring/outlets/${k1}`)).status, 404);
    assert.equal((await crew3.post(`/api/instances/${instK1.id}/complete`).attach('photos', ctx.JPEG, 'x.jpg')).status, 404);
    assert.equal((await crew.get('/api/monitoring')).status, 403, 'Crew tidak punya monitoring');
    assert.equal((await crew.get('/api/templates')).status, 403);
    assert.equal((await head.post('/api/templates').send({ name: 'x', category: 'opening', start_time: '08:00', due_time: '09:00' })).status, 403);
  });
});
