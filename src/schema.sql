-- Lebih Baik Task Control - skema database (SQLite)
-- Semua timestamp disimpan sebagai ISO-8601 UTC ('YYYY-MM-DDTHH:MM:SS.sssZ').
-- business_date = tanggal lokal outlet ('YYYY-MM-DD').

CREATE TABLE IF NOT EXISTS roles (
  code            TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  level           INTEGER NOT NULL,
  is_operational  INTEGER NOT NULL DEFAULT 0 CHECK (is_operational IN (0,1))
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_code   TEXT NOT NULL REFERENCES roles(code) ON DELETE CASCADE,
  permission  TEXT NOT NULL,
  PRIMARY KEY (role_code, permission)
);

CREATE TABLE IF NOT EXISTS users (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  pin_hash            TEXT,  -- PIN 6 angka (opsional) untuk login cepat karyawan outlet
  role_code           TEXT NOT NULL REFERENCES roles(code),
  reports_to_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active              INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  CHECK (reports_to_user_id IS NULL OR reports_to_user_id <> id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS brands (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outlets (
  id          INTEGER PRIMARY KEY,
  brand_id    INTEGER NOT NULL REFERENCES brands(id),
  code        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL DEFAULT 'Asia/Jakarta',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_outlets_brand ON outlets(brand_id);

-- Penempatan karyawan di outlet. team = area/shift opsional (mis. "Dapur", "Bar", "Shift Pagi").
CREATE TABLE IF NOT EXISTS user_outlets (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id  INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  team       TEXT,
  shift_no   INTEGER CHECK (shift_no IS NULL OR shift_no IN (1,2)),  -- shift tetap karyawan di outlet ini
  PRIMARY KEY (user_id, outlet_id)
);
CREATE INDEX IF NOT EXISTS idx_user_outlets_outlet ON user_outlets(outlet_id);

-- Task Library: template tugas yang dapat dipakai ulang (+ jadwal & penanggung jawab default).
CREATE TABLE IF NOT EXISTS task_templates (
  id                     INTEGER PRIMARY KEY,
  name                   TEXT NOT NULL,
  instructions           TEXT NOT NULL DEFAULT '',
  category               TEXT NOT NULL CHECK (category IN ('opening','operasional','closing')),
  is_critical            INTEGER NOT NULL DEFAULT 0 CHECK (is_critical IN (0,1)),
  requires_photo         INTEGER NOT NULL DEFAULT 0 CHECK (requires_photo IN (0,1)),
  requires_verification  INTEGER NOT NULL DEFAULT 0 CHECK (requires_verification IN (0,1)),
  sop_text               TEXT,
  reference_url          TEXT,
  reference_image_file   TEXT,
  reference_image_mime   TEXT,
  recurrence             TEXT NOT NULL DEFAULT 'daily' CHECK (recurrence IN ('daily','weekly','interval')),
  days_of_week           TEXT,
  start_time             TEXT NOT NULL DEFAULT '08:00',
  due_time               TEXT,
  end_time               TEXT,
  interval_minutes       INTEGER CHECK (interval_minutes IS NULL OR interval_minutes >= 15),
  due_after_minutes      INTEGER CHECK (due_after_minutes IS NULL OR due_after_minutes > 0),
  default_assignee_role  TEXT REFERENCES roles(code),
  default_shift_no       INTEGER CHECK (default_shift_no IS NULL OR default_shift_no IN (1,2)),
  active                 INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by             INTEGER REFERENCES users(id),
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL
);

-- Brand yang boleh memakai template. Kosong = berlaku untuk semua brand.
CREATE TABLE IF NOT EXISTS template_brands (
  template_id  INTEGER NOT NULL REFERENCES task_templates(id) ON DELETE CASCADE,
  brand_id     INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  PRIMARY KEY (template_id, brand_id)
);

-- Penugasan template ke outlet tertentu + siapa yang bertanggung jawab.
CREATE TABLE IF NOT EXISTS task_assignments (
  id                INTEGER PRIMARY KEY,
  template_id       INTEGER NOT NULL REFERENCES task_templates(id),
  outlet_id         INTEGER NOT NULL REFERENCES outlets(id),
  mode              TEXT NOT NULL CHECK (mode IN ('individual','shared')),
  assignee_type     TEXT NOT NULL CHECK (assignee_type IN ('role','team','user','shift')),
  assignee_role     TEXT REFERENCES roles(code),
  assignee_team     TEXT,
  assignee_user_id  INTEGER REFERENCES users(id),
  -- Shift tugas (1/2). Wajib untuk assignee_type='shift'; untuk peran/tim membatasi ke karyawan di shift tsb.
  shift_no          INTEGER CHECK (shift_no IS NULL OR shift_no IN (1,2)),
  active            INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_by        INTEGER REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  CHECK (
    (assignee_type = 'role' AND assignee_role IS NOT NULL AND mode = 'shared') OR
    (assignee_type = 'team' AND assignee_team IS NOT NULL AND mode = 'shared') OR
    (assignee_type = 'user' AND assignee_user_id IS NOT NULL AND mode = 'individual') OR
    (assignee_type = 'shift' AND shift_no IS NOT NULL AND mode = 'shared')
  )
);
CREATE INDEX IF NOT EXISTS idx_assignments_outlet ON task_assignments(outlet_id);
CREATE INDEX IF NOT EXISTS idx_assignments_template ON task_assignments(template_id);

-- Jadwal berulang untuk sebuah penugasan.
--  daily/weekly: satu kejadian per hari, tampil mulai start_time, deadline due_time
--                (due_time <= start_time berarti melewati tengah malam).
--  interval:     kejadian setiap interval_minutes dari start_time s.d. end_time,
--                deadline = waktu kejadian + due_after_minutes.
CREATE TABLE IF NOT EXISTS task_schedules (
  id                 INTEGER PRIMARY KEY,
  assignment_id      INTEGER NOT NULL REFERENCES task_assignments(id) ON DELETE CASCADE,
  recurrence         TEXT NOT NULL CHECK (recurrence IN ('daily','weekly','interval')),
  days_of_week       TEXT,
  start_time         TEXT NOT NULL,
  due_time           TEXT,
  end_time           TEXT,
  interval_minutes   INTEGER CHECK (interval_minutes IS NULL OR interval_minutes >= 15),
  due_after_minutes  INTEGER CHECK (due_after_minutes IS NULL OR due_after_minutes > 0),
  start_date         TEXT,
  end_date           TEXT,
  active             INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  CHECK (
    (recurrence IN ('daily','weekly') AND due_time IS NOT NULL) OR
    (recurrence = 'interval' AND end_time IS NOT NULL AND interval_minutes IS NOT NULL)
  ),
  CHECK (recurrence <> 'weekly' OR days_of_week IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_schedules_assignment ON task_schedules(assignment_id);

-- Kejadian tugas terjadwal. Snapshot atribut penting saat dibuat supaya histori tetap akurat.
-- UNIQUE(schedule_id, scheduled_at) mencegah duplikasi.
CREATE TABLE IF NOT EXISTS task_instances (
  id                     INTEGER PRIMARY KEY,
  schedule_id            INTEGER NOT NULL REFERENCES task_schedules(id),
  assignment_id          INTEGER NOT NULL REFERENCES task_assignments(id),
  template_id            INTEGER NOT NULL REFERENCES task_templates(id),
  outlet_id              INTEGER NOT NULL REFERENCES outlets(id),
  business_date          TEXT NOT NULL,
  scheduled_at           TEXT NOT NULL,
  due_at                 TEXT NOT NULL,
  name                   TEXT NOT NULL,
  category               TEXT NOT NULL CHECK (category IN ('opening','operasional','closing')),
  is_critical            INTEGER NOT NULL DEFAULT 0,
  requires_photo         INTEGER NOT NULL DEFAULT 0,
  requires_verification  INTEGER NOT NULL DEFAULT 0,
  mode                   TEXT NOT NULL CHECK (mode IN ('individual','shared')),
  assignee_type          TEXT NOT NULL CHECK (assignee_type IN ('role','team','user','shift')),
  assignee_role          TEXT,
  assignee_team          TEXT,
  assignee_user_id       INTEGER REFERENCES users(id),
  shift_no               INTEGER CHECK (shift_no IS NULL OR shift_no IN (1,2)),
  shift_end_at           TEXT,  -- akhir shift pemilik tugas (snapshot); lewat dari ini = tugas dioper ke shift berikutnya
  status                 TEXT NOT NULL DEFAULT 'belum'
                         CHECK (status IN ('belum','dikerjakan','menunggu_verifikasi','terverifikasi','perlu_perbaikan')),
  completed_by           INTEGER REFERENCES users(id),
  completed_at           TEXT,
  was_late               INTEGER NOT NULL DEFAULT 0 CHECK (was_late IN (0,1)),
  verified_by            INTEGER REFERENCES users(id),
  verified_at            TEXT,
  escalation_stage       INTEGER NOT NULL DEFAULT 0,
  last_escalated_at      TEXT,
  created_at             TEXT NOT NULL,
  updated_at             TEXT NOT NULL,
  UNIQUE (schedule_id, scheduled_at),
  CHECK (due_at > scheduled_at)
);
CREATE INDEX IF NOT EXISTS idx_instances_outlet_date ON task_instances(outlet_id, business_date);
CREATE INDEX IF NOT EXISTS idx_instances_status_due ON task_instances(status, due_at);
CREATE INDEX IF NOT EXISTS idx_instances_template ON task_instances(template_id, outlet_id, business_date);

-- Setiap pengiriman (submit) tugas, termasuk pengiriman ulang setelah ditolak.
CREATE TABLE IF NOT EXISTS task_submissions (
  id            INTEGER PRIMARY KEY,
  instance_id   INTEGER NOT NULL REFERENCES task_instances(id),
  submitted_by  INTEGER NOT NULL REFERENCES users(id),
  submitted_at  TEXT NOT NULL,
  note          TEXT,
  was_late      INTEGER NOT NULL DEFAULT 0 CHECK (was_late IN (0,1)),
  shift_no      INTEGER  -- shift si pengirim pada hari itu (akuntabilitas)
);
CREATE INDEX IF NOT EXISTS idx_submissions_instance ON task_submissions(instance_id);

-- Bukti foto. File disimpan di luar folder publik dan hanya disajikan lewat endpoint terotorisasi.
CREATE TABLE IF NOT EXISTS task_evidence (
  id             INTEGER PRIMARY KEY,
  submission_id  INTEGER NOT NULL REFERENCES task_submissions(id),
  instance_id    INTEGER NOT NULL REFERENCES task_instances(id),
  stored_name    TEXT NOT NULL UNIQUE,
  original_name  TEXT,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  sha256         TEXT NOT NULL,
  uploaded_by    INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_instance ON task_evidence(instance_id);

CREATE TABLE IF NOT EXISTS verification_records (
  id             INTEGER PRIMARY KEY,
  instance_id    INTEGER NOT NULL REFERENCES task_instances(id),
  submission_id  INTEGER REFERENCES task_submissions(id),
  verifier_id    INTEGER NOT NULL REFERENCES users(id),
  decision       TEXT NOT NULL CHECK (decision IN ('approved','rejected','reopened')),
  reason         TEXT,
  created_at     TEXT NOT NULL,
  CHECK (decision = 'approved' OR (reason IS NOT NULL AND length(trim(reason)) > 0))
);
CREATE INDEX IF NOT EXISTS idx_verifications_instance ON verification_records(instance_id);

-- Aturan eskalasi (dapat diatur Management). code: 'default' atau 'critical'.
CREATE TABLE IF NOT EXISTS escalation_rules (
  code                  TEXT PRIMARY KEY,
  name                  TEXT NOT NULL,
  stage1_after_minutes  INTEGER NOT NULL CHECK (stage1_after_minutes >= 0),
  stage2_after_minutes  INTEGER NOT NULL,
  stage3_after_minutes  INTEGER NOT NULL,
  repeat_threshold      INTEGER NOT NULL CHECK (repeat_threshold >= 2),
  repeat_window_days    INTEGER NOT NULL CHECK (repeat_window_days >= 1),
  updated_by            INTEGER REFERENCES users(id),
  updated_at            TEXT NOT NULL,
  CHECK (stage2_after_minutes >= stage1_after_minutes AND stage3_after_minutes >= stage2_after_minutes)
);

-- Riwayat notifikasi. dedupe_key UNIQUE mencegah notifikasi berulang yang tidak perlu.
CREATE TABLE IF NOT EXISTS notifications (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instance_id  INTEGER REFERENCES task_instances(id),
  kind         TEXT NOT NULL,
  stage        INTEGER,
  message      TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  read_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at);

CREATE TABLE IF NOT EXISTS audit_logs (
  id           INTEGER PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id),
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    INTEGER,
  details      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);

-- ===== Shift & serah terima (v2) =====

-- Setiap outlet punya tepat dua shift standar. Jam dapat berbeda per outlet.
-- end_time <= start_time berarti shift berakhir keesokan harinya.
CREATE TABLE IF NOT EXISTS outlet_shifts (
  outlet_id   INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  shift_no    INTEGER NOT NULL CHECK (shift_no IN (1,2)),
  start_time  TEXT NOT NULL,
  end_time    TEXT NOT NULL,
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (outlet_id, shift_no),
  CHECK (start_time <> end_time)
);

-- Pengecualian jadwal per tanggal (mis. tukar shift). Tanpa baris = pakai user_outlets.shift_no.
CREATE TABLE IF NOT EXISTS shift_rosters (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  outlet_id   INTEGER NOT NULL REFERENCES outlets(id) ON DELETE CASCADE,
  work_date   TEXT NOT NULL,
  shift_no    INTEGER NOT NULL CHECK (shift_no IN (1,2)),
  updated_by  INTEGER REFERENCES users(id),
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (user_id, outlet_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_rosters_outlet_date ON shift_rosters(outlet_id, work_date);

-- Serah terima shift: satu catatan per outlet, tanggal bisnis, dan shift asal.
CREATE TABLE IF NOT EXISTS shift_handovers (
  id                INTEGER PRIMARY KEY,
  outlet_id         INTEGER NOT NULL REFERENCES outlets(id),
  business_date     TEXT NOT NULL,
  from_shift        INTEGER NOT NULL CHECK (from_shift IN (1,2)),
  to_shift          INTEGER NOT NULL CHECK (to_shift IN (1,2)),
  to_business_date  TEXT NOT NULL,
  stock_issues      TEXT,
  equipment_issues  TEXT,
  notes             TEXT,
  created_by        INTEGER NOT NULL REFERENCES users(id),
  created_at        TEXT NOT NULL,
  updated_by        INTEGER REFERENCES users(id),
  updated_at        TEXT NOT NULL,
  acknowledged_by   INTEGER REFERENCES users(id),
  acknowledged_at   TEXT,
  UNIQUE (outlet_id, business_date, from_shift),
  CHECK (from_shift <> to_shift)
);
CREATE INDEX IF NOT EXISTS idx_handovers_to ON shift_handovers(outlet_id, to_business_date, to_shift);

-- Snapshot tugas yang belum selesai saat serah terima dibuat.
CREATE TABLE IF NOT EXISTS shift_handover_items (
  handover_id         INTEGER NOT NULL REFERENCES shift_handovers(id) ON DELETE CASCADE,
  instance_id         INTEGER NOT NULL REFERENCES task_instances(id),
  status_at_handover  TEXT NOT NULL,
  PRIMARY KEY (handover_id, instance_id)
);
