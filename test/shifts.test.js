'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { setup } = require('./helpers');
const { openDb } = require('../src/db');

async function shiftTask(ctx, admin, name, who, extra = {}) {
  const t = await admin.post('/api/templates').send({ name, category: 'operasional', recurrence: 'daily', start_time: '08:00', due_time: '14:00', ...extra });
  assert.equal(t.status, 201, JSON.stringify(t.body));
  const a = await admin.post('/api/assignments').send({ template_id: t.body.id, outlet_ids: [ctx.demo.outlets.k1], ...who });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return ctx.db.get('SELECT * FROM task_instances WHERE template_id = ? ORDER BY id DESC LIMIT 1', t.body.id);
}

test('setiap outlet punya tepat 2 shift dengan jam yang bisa diatur per outlet', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const head = await ctx.login('head');
  const head2 = await ctx.login('head2');
  const crew = await ctx.login('crew');
  const { k1, k2 } = ctx.demo.outlets;
  for (const o of Object.values(ctx.demo.outlets)) {
    assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM outlet_shifts WHERE outlet_id = ?', o).c, 2);
  }
  const s = await crew.get(`/api/shifts/outlets/${k1}`);
  assert.equal(s.body.current.shift_no, 1, '08:00 = Shift 1');
  assert.deepEqual(s.body.shifts.map((x) => [x.start_time, x.end_time]), [['07:00', '15:00'], ['15:00', '23:30']]);
  const k2s = await head2.get(`/api/shifts/outlets/${k2}`);
  assert.equal(k2s.body.shifts[1].end_time, '00:00', 'jam berbeda per outlet');

  const body = { shifts: [{ shift_no: 1, start_time: '06:00', end_time: '14:00' }, { shift_no: 2, start_time: '14:00', end_time: '22:00' }] };
  assert.equal((await crew.put(`/api/shifts/outlets/${k1}`).send(body)).status, 403);
  assert.equal((await head2.put(`/api/shifts/outlets/${k1}`).send(body)).status, 404, 'Head outlet lain tidak bisa');
  assert.equal((await head.put(`/api/shifts/outlets/${k1}`).send({ shifts: [body.shifts[0]] })).status, 400, 'harus dua shift');
  const ok = await head.put(`/api/shifts/outlets/${k1}`).send(body);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.shifts[0].start_time, '06:00');
  // Outlet baru otomatis mendapat Shift 1 & 2.
  const o = await admin.post('/api/org/outlets').send({ brand_id: ctx.demo.brands.bKopi, code: 'KOPI-09', name: 'Kopi Baru' });
  assert.equal(ctx.db.get('SELECT COUNT(*) AS c FROM outlet_shifts WHERE outlet_id = ?', o.body.id).c, 2);
});

test('tugas per shift: hanya karyawan di shift tsb, jadwal per tanggal bisa mengubah shift', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const head = await ctx.login('head');
  const crew = await ctx.login('crew'); // Shift 1
  const crew2 = await ctx.login('crew2'); // Shift 2
  const s2 = await shiftTask(ctx, admin, 'Isi ulang saus', { assignee_type: 'shift', shift_no: 2 });
  assert.equal(s2.shift_no, 2);
  assert.ok(s2.shift_end_at, 'akhir shift disimpan');
  assert.equal((await admin.post('/api/assignments').send({ template_id: s2.template_id, outlet_ids: [ctx.demo.outlets.k1], assignee_type: 'shift' })).status, 400);
  const s1crew = await shiftTask(ctx, admin, 'Cek gelas', { assignee_type: 'role', assignee_role: 'crew', shift_no: 1 });

  ctx.setTime('2026-11-02', '09:00');
  assert.ok((await crew.get('/api/my-tasks')).body.tasks.some((t) => t.id === s1crew.id));
  assert.ok(!(await crew.get('/api/my-tasks')).body.tasks.some((t) => t.id === s2.id), 'Shift 1 tidak melihat tugas Shift 2');
  assert.ok(!(await crew2.get('/api/my-tasks')).body.tasks.some((t) => t.id === s1crew.id));
  assert.equal((await crew.post(`/api/instances/${s2.id}/complete`)).status, 403);
  assert.equal((await crew2.post(`/api/instances/${s1crew.id}/complete`)).status, 403);
  const c = await crew2.post(`/api/instances/${s2.id}/complete`);
  assert.equal(c.status, 200);
  assert.equal(c.body.assignee_label, 'Semua Shift 2');

  // Tukar shift hanya untuk tanggal ini: crew masuk Shift 2.
  const roster = await head.put('/api/shifts/roster').send({ outlet_id: ctx.demo.outlets.k1, user_id: ctx.demo.users.crew2, shift_no: 1, date: '2026-11-02' });
  assert.equal(roster.status, 200);
  const crew2b = await ctx.login('crew2');
  assert.equal((await crew2b.post(`/api/instances/${s1crew.id}/complete`)).status, 200, 'setelah tukar shift boleh');
  const r = await head.get(`/api/shifts/roster?outlet_id=${ctx.demo.outlets.k1}&date=2026-11-02`);
  const row = r.body.staff.find((x) => x.id === ctx.demo.users.crew2);
  assert.deepEqual([row.default_shift, row.date_shift, row.shift_no], [2, 1, 1]);
  assert.equal((await crew.put('/api/shifts/roster').send({ outlet_id: ctx.demo.outlets.k1, user_id: ctx.demo.users.crew, shift_no: 2 })).status, 403);
});

test('tugas yang belum selesai tetap terlihat saat pergantian shift; identitas & waktu asli tersimpan', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew'); // S1
  const crew5 = await ctx.login('crew5'); // S2
  const inst = await shiftTask(ctx, admin, 'Cek stok cup', { assignee_type: 'role', assignee_role: 'crew', shift_no: 1 });
  ctx.setTime('2026-11-02', '14:30');
  const before = (await crew5.get('/api/my-tasks')).body.tasks.find((t) => t.id === inst.id);
  assert.equal(before, undefined, 'saat Shift 1 masih berjalan, tugas milik Shift 1');
  ctx.setTime('2026-11-02', '15:30');
  const mine = (await crew5.get('/api/my-tasks')).body.tasks.find((t) => t.id === inst.id);
  assert.ok(mine, 'shift berikutnya melihat tugas yang belum selesai');
  assert.equal(mine.is_carried_over, true);
  assert.equal(mine.is_overdue, true);
  assert.ok((await crew.get('/api/my-tasks')).body.tasks.some((t) => t.id === inst.id), 'shift asal juga tetap melihatnya');
  const done = await crew5.post(`/api/instances/${inst.id}/complete`);
  assert.equal(done.status, 200);
  assert.equal(done.body.completed_by_name, 'Gita (Crew Bar Shift 2)');
  assert.equal(done.body.completed_at, '2026-11-02T08:30:00.000Z');
  assert.equal(done.body.completed_after_shift, true);
  assert.equal(done.body.was_late, true);
  assert.equal(done.body.shift_no, 1, 'tugas tetap tercatat milik Shift 1');
  const d = await admin.get(`/api/instances/${inst.id}`);
  assert.equal(d.body.submissions[0].shift_no, 2, 'pengirim tercatat dari Shift 2');
  assert.equal(d.body.scheduled_at, '2026-11-02T01:00:00.000Z', 'jadwal asli tidak berubah');
});

test('serah terima shift: dibuat shift asal, dilihat & diterima shift berikutnya', async () => {
  const ctx = setup();
  const admin = await ctx.login('admin');
  const crew = await ctx.login('crew'); // S1
  const crew5 = await ctx.login('crew5'); // S2
  const head2 = await ctx.login('head2');
  const kasir = await ctx.login('kasir'); // S1
  const { k1 } = ctx.demo.outlets;
  const inst = await shiftTask(ctx, admin, 'Cek stok susu', { assignee_type: 'role', assignee_role: 'crew', shift_no: 1 });
  ctx.setTime('2026-11-02', '14:45');
  const draft = await crew.get(`/api/handovers/draft?outlet_id=${k1}`);
  assert.equal(draft.status, 200);
  assert.deepEqual([draft.body.from_shift, draft.body.to_shift, draft.body.business_date], [1, 2, '2026-11-02']);
  assert.ok(draft.body.items.some((i) => i.instance_id === inst.id));
  const created = await crew.post('/api/handovers').send({
    outlet_id: k1, stock_issues: 'Susu tinggal 2 liter', equipment_issues: 'Grinder bunyi aneh', notes: 'Pesanan katering jam 17:00',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const h = created.body;
  assert.equal(h.created_by_name, 'Andi (Crew Bar)');
  assert.equal(h.created_at, '2026-11-02T07:45:00.000Z');
  assert.ok(h.items.some((i) => i.instance_id === inst.id && i.status_at_handover === 'belum'));
  assert.equal(h.can_acknowledge, false, 'pembuat tidak bisa menerima sendiri');
  assert.equal((await crew.post(`/api/handovers/${h.id}/acknowledge`)).status, 403);
  // Shift 1 lain (kasir) tidak mendapat banner; Shift 2 mendapat.
  assert.equal((await kasir.get('/api/my-tasks')).body.handovers.length, 0);
  ctx.setTime('2026-11-02', '15:05');
  const my = await crew5.get('/api/my-tasks');
  const banner = my.body.handovers.find((x) => x.id === h.id);
  assert.ok(banner);
  assert.equal(banner.open_items >= 1, true);
  const view = await crew5.get(`/api/handovers/${h.id}`);
  assert.equal(view.body.stock_issues, 'Susu tinggal 2 liter');
  assert.equal(view.body.can_acknowledge, true);
  const ack = await crew5.post(`/api/handovers/${h.id}/acknowledge`);
  assert.equal(ack.body.acknowledged_by_name, 'Gita (Crew Bar Shift 2)');
  assert.equal((await crew5.post(`/api/handovers/${h.id}/acknowledge`)).status, 409);
  assert.equal((await crew.post('/api/handovers').send({ outlet_id: k1, business_date: '2026-11-02', from_shift: 1, notes: 'ubah' })).status, 409, 'tidak bisa diubah setelah diterima');
  // Status terkini tugas ikut tampil setelah diselesaikan shift berikutnya.
  await crew5.post(`/api/instances/${inst.id}/complete`);
  const after = await crew5.get(`/api/handovers/${h.id}`);
  const item = after.body.items.find((i) => i.instance_id === inst.id);
  assert.deepEqual([item.status_at_handover, item.status, item.completed_by_name], ['belum', 'dikerjakan', 'Gita (Crew Bar Shift 2)']);
  // Shift 2 -> Shift 1 hari berikutnya; outlet lain tidak bisa melihat.
  ctx.setTime('2026-11-02', '23:20');
  const h2 = await crew5.post('/api/handovers').send({ outlet_id: k1, notes: 'Tutup aman' });
  assert.deepEqual([h2.body.from_shift, h2.body.to_shift, h2.body.to_business_date], [2, 1, '2026-11-03']);
  assert.equal((await head2.get(`/api/handovers/${h.id}`)).status, 404);
  assert.equal((await head2.get(`/api/handovers?outlet_id=${k1}`)).status, 404);
  const list = await crew.get(`/api/handovers?outlet_id=${k1}&date=2026-11-03`);
  assert.equal(list.body.handovers.length, 2);
  assert.ok(ctx.db.get("SELECT COUNT(*) AS c FROM audit_logs WHERE action = 'handover.acknowledge'").c === 1);
});

test('migrasi database lama (v1) ke versi terbaru tanpa kehilangan data', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lb-mig-')), 'old.db');
  const old = new DatabaseSync(file);
  old.exec('PRAGMA foreign_keys = ON;');
  old.exec(fs.readFileSync(path.join(__dirname, 'fixtures', 'schema-v1.sql'), 'utf8'));
  const ts = '2026-11-01T00:00:00.000Z';
  old.exec(`
    INSERT INTO roles VALUES ('crew','Crew',10,1);
    INSERT INTO role_permissions VALUES ('crew','task.complete');
    INSERT INTO users (id,name,username,password_hash,role_code,active,created_at,updated_at) VALUES (1,'A','a','x','crew',1,'${ts}','${ts}');
    INSERT INTO brands (id,name,active,created_at) VALUES (1,'B',1,'${ts}');
    INSERT INTO outlets (id,brand_id,code,name,created_at) VALUES (1,1,'O1','Outlet',  '${ts}');
    INSERT INTO user_outlets VALUES (1,1,'Bar');
    INSERT INTO task_templates (id,name,category,created_at,updated_at) VALUES (1,'T','opening','${ts}','${ts}');
    INSERT INTO task_assignments (id,template_id,outlet_id,mode,assignee_type,assignee_role,created_at,updated_at) VALUES (1,1,1,'shared','role','crew','${ts}','${ts}');
    INSERT INTO task_schedules (id,assignment_id,recurrence,start_time,due_time,created_at,updated_at) VALUES (1,1,'daily','08:00','09:00','${ts}','${ts}');
    INSERT INTO task_instances (id,schedule_id,assignment_id,template_id,outlet_id,business_date,scheduled_at,due_at,name,category,mode,assignee_type,assignee_role,status,completed_by,completed_at,created_at,updated_at)
      VALUES (1,1,1,1,1,'2026-11-01','2026-11-01T01:00:00.000Z','2026-11-01T02:00:00.000Z','T','opening','shared','role','crew','dikerjakan',1,'2026-11-01T01:30:00.000Z','${ts}','${ts}');
    INSERT INTO task_submissions (id,instance_id,submitted_by,submitted_at) VALUES (1,1,1,'2026-11-01T01:30:00.000Z');
  `);
  old.close();
  const db = openDb(file);
  assert.equal(db.get('PRAGMA user_version').user_version, 3);
  assert.ok(db.all('PRAGMA table_info(users)').some((c) => c.name === 'pin_hash'), 'kolom PIN ditambahkan');
  const inst = db.get('SELECT * FROM task_instances WHERE id = 1');
  assert.deepEqual([inst.status, inst.completed_by, inst.completed_at, inst.shift_no], ['dikerjakan', 1, '2026-11-01T01:30:00.000Z', null]);
  assert.equal(db.get('SELECT team FROM user_outlets').team, 'Bar');
  assert.equal(db.get('SELECT COUNT(*) AS c FROM task_submissions WHERE instance_id = 1').c, 1);
  assert.ok(db.get("SELECT 1 AS x FROM role_permissions WHERE role_code = 'crew' AND permission = 'handover.create'"));
  assert.equal(db.all('PRAGMA foreign_key_check').length, 0);
  // Constraint baru berlaku setelah migrasi.
  db.run("INSERT INTO task_assignments (template_id,outlet_id,mode,assignee_type,shift_no,created_at,updated_at) VALUES (1,1,'shared','shift',2,?,?)", ts, ts);
  assert.throws(() => db.run("INSERT INTO task_assignments (template_id,outlet_id,mode,assignee_type,created_at,updated_at) VALUES (1,1,'shared','shift',?,?)", ts, ts));
  db.close();
  // Membuka ulang tidak menjalankan migrasi lagi.
  const again = openDb(file);
  assert.equal(again.get('SELECT COUNT(*) AS c FROM task_instances').c, 1);
  again.close();
});
