'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, request } = require('./helpers');

async function createTemplate(admin, body = {}) {
  const res = await admin.post('/api/templates').send({
    name: 'Tugas uji', category: 'operasional', recurrence: 'daily', start_time: '08:00', due_time: '10:00', ...body,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body;
}
async function assign(admin, tpl, outletId, who) {
  const res = await admin.post('/api/assignments').send({ template_id: tpl.id, outlet_ids: [outletId], ...who });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body[0];
}
const instanceOf = (ctx, tplId, outletId) => ctx.db.get(
  "SELECT * FROM task_instances WHERE template_id = ? AND outlet_id = ? ORDER BY scheduled_at DESC LIMIT 1", tplId, outletId);

test('tugas individu hanya untuk karyawan yang ditugaskan; tugas tanpa foto selesai dengan satu aksi', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew');
  const crew2 = await ctx.login('crew2');
  const tpl = await createTemplate(admin, { name: 'Isi stok sabun' });
  await assign(admin, tpl, ctx.demo.outlets.k1, { assignee_type: 'user', assignee_user_id: ctx.demo.users.crew2 });
  const inst = instanceOf(ctx, tpl.id, ctx.demo.outlets.k1);
  assert.equal(inst.mode, 'individual');
  assert.ok(!(await crew.get('/api/my-tasks')).body.tasks.some((t) => t.id === inst.id));
  assert.ok((await crew2.get('/api/my-tasks')).body.tasks.some((t) => t.id === inst.id));
  assert.equal((await crew.post(`/api/instances/${inst.id}/complete`)).status, 403);
  const ok = await crew2.post(`/api/instances/${inst.id}/complete`);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.status, 'dikerjakan', 'tanpa verifikasi -> langsung selesai');
  // Penugasan individu ke karyawan yang tidak ditempatkan di outlet ditolak.
  const bad = await admin.post('/api/assignments').send({ template_id: tpl.id, outlet_ids: [ctx.demo.outlets.k2], assignee_type: 'user', assignee_user_id: ctx.demo.users.crew2 });
  assert.equal(bad.status, 400);
});

test('tugas tim: hanya anggota tim; PIC memantau area/shift-nya saja', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew'); // Bar
  const crew2 = await ctx.login('crew2'); // Dapur
  const pic = await ctx.login('pic'); // PIC Bar
  const pic2 = await ctx.login('pic2'); // PIC Dapur
  const tplDapur = await createTemplate(admin, { name: 'Bersihkan hood dapur' });
  await assign(admin, tplDapur, ctx.demo.outlets.k1, { assignee_type: 'team', assignee_team: 'Dapur' });
  const inst = instanceOf(ctx, tplDapur.id, ctx.demo.outlets.k1);
  assert.equal((await crew.post(`/api/instances/${inst.id}/complete`)).status, 403, 'tim Bar tidak boleh');
  const monPic = await pic.get('/api/monitoring');
  assert.equal(monPic.body.level, 'team');
  assert.ok(!monPic.body.instances.some((t) => t.id === inst.id), 'PIC Bar tidak melihat tugas tim Dapur');
  assert.ok(monPic.body.instances.some((t) => t.assignee_label === 'Tim Bar'), 'PIC Bar melihat tugas tim Bar');
  const monPic2 = await pic2.get('/api/monitoring');
  assert.ok(monPic2.body.instances.some((t) => t.id === inst.id));
  assert.deepEqual(monPic.body.by_outlet, [], 'PIC tidak melihat perbandingan outlet');
  assert.equal((await crew2.post(`/api/instances/${inst.id}/complete`)).status, 200);
  // PIC Bar tidak boleh membuka ulang tugas tim Dapur; PIC Dapur boleh.
  assert.equal((await pic.post(`/api/instances/${inst.id}/reopen`).send({ reason: 'x' })).status, 403);
  const re = await pic2.post(`/api/instances/${inst.id}/reopen`).send({ reason: 'Masih berminyak' });
  assert.equal(re.status, 200);
  assert.equal(re.body.status, 'perlu_perbaikan');
  assert.equal((await pic2.post(`/api/instances/${inst.id}/reopen`).send({ reason: 'lagi' })).status, 409);
});

test('Kasir tidak otomatis membawahi Crew; izin peran dapat dikonfigurasi', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const kasir = await ctx.login('kasir');
  assert.equal((await kasir.get('/api/monitoring')).status, 403);
  const roles = await admin.get('/api/admin/roles');
  const kasirPerms = roles.body.roles.find((r) => r.code === 'kasir').permissions;
  const up = await admin.put('/api/admin/roles/kasir/permissions').send({ permissions: [...kasirPerms, 'monitor.team'] });
  assert.equal(up.status, 200);
  assert.equal((await kasir.get('/api/monitoring')).status, 200);
  assert.equal((await admin.put('/api/admin/roles/admin/permissions').send({ permissions: ['monitor.all'] })).status, 400, 'admin tidak bisa mengunci diri');
  assert.equal((await admin.put('/api/admin/roles/kasir/permissions').send({ permissions: ['hack.all'] })).status, 400);
  assert.equal((await kasir.put('/api/admin/roles/kasir/permissions').send({ permissions: ['scope.all'] })).status, 403);
  // Hubungan pelaporan dapat diatur: crew melapor ke kasir.
  const res = await admin.put(`/api/org/users/${ctx.demo.users.crew}`).send({ reports_to_user_id: ctx.demo.users.kasir });
  assert.equal(res.status, 200);
  assert.equal(res.body.reports_to_name, 'Citra (Kasir)');
});

test('tidak bisa diselesaikan sebelum waktunya; verifikator tidak boleh memverifikasi pekerjaannya sendiri', async () => {
  const ctx = setup({ time: '07:00' });
  const admin = await ctx.login('admin');
  const head = await ctx.login('head');
  const tpl = await createTemplate(admin, { name: 'Briefing', requires_verification: true, start_time: '09:00', due_time: '11:00' });
  await assign(admin, tpl, ctx.demo.outlets.k1, { assignee_type: 'role', assignee_role: 'head' });
  const inst = instanceOf(ctx, tpl.id, ctx.demo.outlets.k1);
  const early = await head.post(`/api/instances/${inst.id}/complete`);
  assert.equal(early.status, 400);
  assert.match(early.body.error, /Belum waktunya/);
  ctx.setTime('2026-11-02', '09:05');
  assert.equal((await head.post(`/api/instances/${inst.id}/complete`)).status, 200);
  assert.equal((await head.post(`/api/instances/${inst.id}/verify`).send({ decision: 'approve' })).status, 403);
  const spv = await ctx.login('spv');
  assert.equal((await spv.post(`/api/instances/${inst.id}/verify`).send({ decision: 'approve' })).body.status, 'terverifikasi');
});

test('eskalasi: aturan kritis lebih ketat, ambang pengulangan, dan konfigurasi oleh Management', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew');
  const { k2 } = ctx.demo.outlets;
  const normal = await createTemplate(admin, { name: 'Tugas normal' });
  const crit = await createTemplate(admin, { name: 'Tugas kritis', is_critical: true });
  await assign(admin, normal, k2, { assignee_type: 'role', assignee_role: 'crew' });
  await assign(admin, crit, k2, { assignee_type: 'role', assignee_role: 'crew' });
  const n = instanceOf(ctx, normal.id, k2).id;
  const c = instanceOf(ctx, crit.id, k2).id;
  ctx.setTime('2026-11-02', '10:20'); // terlambat 20 menit
  ctx.jobs();
  const stage = (id) => ctx.db.get('SELECT escalation_stage FROM task_instances WHERE id = ?', id).escalation_stage;
  assert.equal(stage(n), 1, 'normal: tahap 2 setelah 60 menit');
  assert.equal(stage(c), 2, 'kritis: tahap 2 setelah 15 menit');

  // Validasi & otorisasi konfigurasi.
  assert.equal((await crew.put('/api/admin/escalation/default').send({ stage2_after_minutes: 5 })).status, 403);
  assert.equal((await admin.put('/api/admin/escalation/default').send({ stage1_after_minutes: 30, stage2_after_minutes: 10 })).status, 400);
  const upd = await admin.put('/api/admin/escalation/default').send({ stage2_after_minutes: 10, stage3_after_minutes: 20 });
  assert.equal(upd.status, 200);
  ctx.jobs();
  assert.equal(stage(n), 3, 'aturan baru langsung berlaku');
  assert.ok(ctx.db.get("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'escalation.update'").c >= 1);
});

test('tugas yang berulang kali terlewat langsung dieskalasi ke SPV dan tampil di dashboard Management', async () => {
  const ctx = setup({ date: '2026-10-30', time: '07:00' });
  const admin = await ctx.login('admin');
  const { k2 } = ctx.demo.outlets;
  const tpl = await createTemplate(admin, { name: 'Cek APAR' });
  await assign(admin, tpl, k2, { assignee_type: 'role', assignee_role: 'crew' });
  for (const d of ['2026-10-30', '2026-10-31', '2026-11-01']) {
    ctx.setTime(d, '07:00'); ctx.jobs();
    ctx.setTime(d, '10:05'); ctx.jobs();
  }
  const last = instanceOf(ctx, tpl.id, k2);
  assert.equal(last.business_date, '2026-11-01');
  assert.equal(last.escalation_stage, 3, 'terlewat ke-3 dalam 7 hari -> SPV');
  const spvNotif = ctx.db.get(`SELECT message FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.username = 'spv' AND n.instance_id = ?`, last.id);
  assert.match(spvNotif.message, /Terlewat 3x/);
  const mon = await admin.get('/api/monitoring?date=2026-11-01');
  const rep = mon.body.repeated.find((r) => r.template_id === tpl.id);
  assert.ok(rep);
  assert.equal(rep.missed, 3);
});

test('keamanan: CSRF, sesi, eskalasi hak akses, dan user nonaktif', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  // Tanpa header khusus -> ditolak.
  const raw = await request(ctx.app).post('/api/auth/login').send({ username: 'crew', password: 'demo1234' });
  assert.equal(raw.status, 403);
  assert.equal((await request(ctx.app).get('/api/my-tasks')).status, 401);
  assert.equal((await request(ctx.app).post('/api/auth/login').set(ctx.H).send({ username: 'crew', password: 'salah' })).status, 401);
  // Head dengan izin org.manage tidak bisa membuat akun Management.
  await admin.put('/api/admin/roles/head/permissions').send({ permissions: ['task.complete', 'checklist.view', 'monitor.outlet', 'org.manage'] });
  const head = await ctx.login('head');
  const esc = await head.post('/api/org/users').send({ name: 'X', username: 'xadmin', password: 'password123', role_code: 'admin', outlets: [] });
  assert.equal(esc.status, 403);
  const other = await head.post('/api/org/users').send({ name: 'Crew baru', username: 'crewbaru', password: 'password123', role_code: 'crew', outlets: [{ outlet_id: ctx.demo.outlets.k2 }] });
  assert.equal(other.status, 404, 'tidak bisa menempatkan di outlet lain');
  const ok = await head.post('/api/org/users').send({ name: 'Crew baru', username: 'crewbaru', password: 'password123', role_code: 'crew', outlets: [{ outlet_id: ctx.demo.outlets.k1, team: 'Bar' }] });
  assert.equal(ok.status, 201);
  // Nonaktifkan user -> sesi langsung tidak berlaku.
  const crew = await ctx.login('crew');
  await admin.put(`/api/org/users/${ctx.demo.users.crew}`).send({ active: false });
  assert.equal((await crew.get('/api/my-tasks')).status, 401);
  assert.equal((await request(ctx.app).post('/api/auth/login').set(ctx.H).send({ username: 'crew', password: 'demo1234' })).status, 401);
});

test('menghentikan penugasan menghapus tugas yang belum jatuh tempo, histori tetap ada', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew');
  const tpl = await createTemplate(admin, { name: 'Cek AC', recurrence: 'interval', start_time: '08:00', end_time: '12:00', interval_minutes: 60, due_after_minutes: 30 });
  const a = await assign(admin, tpl, ctx.demo.outlets.k1, { assignee_type: 'role', assignee_role: 'crew' });
  const list = ctx.db.all('SELECT * FROM task_instances WHERE assignment_id = ? ORDER BY scheduled_at', a.id);
  assert.equal(list.length, 5);
  await crew.post(`/api/instances/${list[0].id}/complete`);
  ctx.setTime('2026-11-02', '09:45'); // kejadian 08:00 selesai, 09:00 terlambat
  await admin.post(`/api/assignments/${a.id}/active`).send({ active: false });
  const after = ctx.db.all('SELECT id, status FROM task_instances WHERE assignment_id = ?', a.id);
  assert.deepEqual(after.map((x) => x.id), [list[0].id, list[1].id], 'yang sudah selesai/terlambat tetap tersimpan');
  ctx.jobs();
  assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM task_instances WHERE assignment_id = ?', a.id).c, 2, 'tidak digenerate ulang');
});

test('fitur notifikasi dimatikan: tidak ada notifikasi, tapi eskalasi tetap tercatat untuk Monitoring', async () => {
  const ctx = setup({ notifications: false });
  const crew = await ctx.login('crew');
  assert.equal(crew.me.features.notifications, false);
  ctx.setTime('2026-11-02', '23:59');
  ctx.jobs();
  assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM notifications').c, 0);
  assert.ok(ctx.db.get('SELECT COUNT(*) AS c FROM task_instances WHERE escalation_stage > 0').c > 0);
  const head = await ctx.login('head');
  const mon = await head.get('/api/monitoring');
  assert.ok(mon.body.overdue.length > 0);
  assert.ok(mon.body.overdue.some((t) => t.escalation_stage > 0));
});
