'use strict';

const PERMISSIONS = {
  'task.complete': 'Menyelesaikan tugas yang ditugaskan kepadanya / timnya',
  'task.complete_any': 'Menyelesaikan tugas siapa pun di outletnya',
  'checklist.view': 'Melihat Checklist Outlet',
  'monitor.team': 'Monitoring tugas area/shift sendiri',
  'monitor.outlet': 'Monitoring seluruh tugas outlet',
  'monitor.multi': 'Monitoring beberapa outlet (perbandingan & tugas sering terlewat)',
  'monitor.all': 'Monitoring semua brand & outlet',
  'task.verify': 'Memverifikasi (setujui / tolak) bukti tugas',
  'task.reopen': 'Membuka ulang tugas yang hasilnya kurang baik',
  'template.manage': 'Mengelola Task Library, penugasan & jadwal',
  'org.manage': 'Mengelola brand, outlet & karyawan',
  'escalation.manage': 'Mengatur aturan eskalasi',
  'role.manage': 'Mengatur izin per peran',
  'audit.view': 'Melihat log audit',
  'scope.all': 'Akses data semua outlet',
};

const ROLES = [
  { code: 'crew', name: 'Crew', level: 10, is_operational: 1 },
  { code: 'kasir', name: 'Kasir', level: 10, is_operational: 1 },
  { code: 'pic', name: 'PIC', level: 20, is_operational: 0 },
  { code: 'head', name: 'Head / Store Leader', level: 30, is_operational: 0 },
  { code: 'spv', name: 'SPV', level: 40, is_operational: 0 },
  { code: 'admin', name: 'Management / Admin', level: 50, is_operational: 0 },
];

// Default saja; dapat diubah Management lewat menu "Peran & Izin".
// Catatan: Kasir TIDAK otomatis membawahi Crew.
const DEFAULT_ROLE_PERMISSIONS = {
  crew: ['task.complete', 'checklist.view'],
  kasir: ['task.complete', 'checklist.view'],
  pic: ['task.complete', 'checklist.view', 'monitor.team', 'task.reopen'],
  head: ['task.complete', 'task.complete_any', 'checklist.view', 'monitor.team', 'monitor.outlet', 'task.verify', 'task.reopen'],
  spv: ['checklist.view', 'monitor.team', 'monitor.outlet', 'monitor.multi', 'task.verify', 'task.reopen'],
  admin: Object.keys(PERMISSIONS),
};

const CATEGORIES = { opening: 'Opening', operasional: 'Operasional', closing: 'Closing' };

const STATUS = {
  belum: 'Belum Dikerjakan',
  dikerjakan: 'Dikerjakan',
  menunggu_verifikasi: 'Menunggu Verifikasi',
  terverifikasi: 'Terverifikasi',
  perlu_perbaikan: 'Perlu Perbaikan',
  terlambat: 'Terlambat',
};
const OPEN_STATUSES = ['belum', 'perlu_perbaikan'];
const DONE_STATUSES = ['dikerjakan', 'menunggu_verifikasi', 'terverifikasi'];

const DEFAULT_ESCALATION_RULES = [
  { code: 'default', name: 'Tugas biasa', stage1_after_minutes: 0, stage2_after_minutes: 60, stage3_after_minutes: 240, repeat_threshold: 3, repeat_window_days: 7 },
  { code: 'critical', name: 'Tugas kritis (keamanan pangan & keamanan)', stage1_after_minutes: 0, stage2_after_minutes: 15, stage3_after_minutes: 60, repeat_threshold: 2, repeat_window_days: 7 },
];

module.exports = {
  PERMISSIONS, ROLES, DEFAULT_ROLE_PERMISSIONS, CATEGORIES, STATUS, OPEN_STATUSES, DONE_STATUSES,
  DEFAULT_ESCALATION_RULES,
};
