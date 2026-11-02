import { api } from '../api.js';
import { h, clear, loading, errorBox, toast, field, fmtDateTime, mount } from '../ui.js';
import { state } from '../state.js';

export async function renderEscalation(el) {
  loading(el);
  let rules;
  try { rules = await api('/admin/escalation'); } catch (e) { return errorBox(el, e); }
  const num = (v) => h('input', { type: 'number', min: 0, value: v });
  mount(el, 
    h('h1', {}, 'Aturan Eskalasi'),
    !state.me.features?.notifications ? h('div', { class: 'notice warn', style: { marginBottom: '12px' } }, 'Fitur notifikasi sedang dimatikan. Tahap eskalasi tetap dihitung dan terlihat di Monitoring, tetapi tidak ada notifikasi yang dikirim.') : null,
    h('div', { class: 'card small', style: { marginBottom: '12px' } },
      h('div', {}, h('b', {}, 'Tahap 1'), ' — tugas terlambat: notifikasi ke karyawan yang ditugaskan + PIC.'),
      h('div', {}, h('b', {}, 'Tahap 2'), ' — masih belum selesai: notifikasi ke Head / Store Leader.'),
      h('div', {}, h('b', {}, 'Tahap 3'), ' — melewati batas waktu, atau tugas yang sama sering terlewat: notifikasi ke SPV.'),
      h('div', {}, h('b', {}, 'Tahap 4'), ' — Management melihat masalah berulang di Monitoring.'),
      h('div', { class: 'muted', style: { marginTop: '6px' } }, 'Setiap tahap dikirim satu kali per tugas (tidak berulang). Tugas yang diselesaikan terlambat berhenti dieskalasi, namun tetap tercatat "selesai terlambat".')),
    rules.map((r) => {
      const s1 = num(r.stage1_after_minutes), s2 = num(r.stage2_after_minutes), s3 = num(r.stage3_after_minutes);
      const rt = num(r.repeat_threshold), rw = num(r.repeat_window_days);
      return h('div', { class: 'card', style: { marginBottom: '12px' } },
        h('h2', { style: { marginTop: 0 } }, r.name),
        h('div', { class: 'grid2' },
          field('Tahap 1: menit setelah deadline', s1), field('Tahap 2: menit setelah deadline', s2),
          field('Tahap 3: menit setelah deadline', s3), h('div', {}),
          field('Tahap 3 juga jika terlewat ≥ (kali)', rt), field('dalam periode (hari)', rw)),
        h('button', { class: 'btn primary block', onclick: async () => {
          try {
            await api(`/admin/escalation/${r.code}`, { method: 'PUT', body: {
              stage1_after_minutes: Number(s1.value), stage2_after_minutes: Number(s2.value), stage3_after_minutes: Number(s3.value),
              repeat_threshold: Number(rt.value), repeat_window_days: Number(rw.value) } });
            toast('Aturan disimpan.');
          } catch (e) { toast(e.message); }
        } }, 'Simpan'));
    }),
    h('button', { class: 'btn block', onclick: async () => {
      try { const r = await api('/admin/run-jobs', { method: 'POST' }); toast(`Selesai: ${r.created} tugas baru diperiksa.`); } catch (e) { toast(e.message); }
    } }, 'Jalankan pengecekan sekarang'));
}

export async function renderRoles(el) {
  loading(el);
  let d;
  try { d = await api('/admin/roles'); } catch (e) { return errorBox(el, e); }
  mount(el, 
    h('h1', {}, 'Peran & Izin'),
    h('p', { class: 'muted small' }, 'Atur izin tiap peran. Akses data tetap dibatasi pada outlet tempat karyawan ditempatkan (kecuali izin "Akses data semua outlet").'),
    d.roles.map((r) => {
      const set = new Set(r.permissions);
      const boxes = Object.entries(d.permissions).map(([k, label]) => h('label', { class: 'check small' }, h('input', { type: 'checkbox', value: k, checked: set.has(k) }), label));
      const wrap = h('div', {}, boxes);
      return h('details', { class: 'card', style: { marginBottom: '10px' } },
        h('summary', { style: { fontWeight: 700, cursor: 'pointer', minHeight: '28px' } }, `${r.name} `, h('span', { class: 'muted small' }, `(${r.permissions.length} izin)`)),
        wrap,
        h('button', { class: 'btn primary block', style: { marginTop: '8px' }, onclick: async () => {
          try {
            await api(`/admin/roles/${r.code}/permissions`, { method: 'PUT', body: { permissions: [...wrap.querySelectorAll('input:checked')].map((i) => i.value) } });
            toast('Izin disimpan. Berlaku saat pengguna memuat ulang aplikasi.');
          } catch (e) { toast(e.message); }
        } }, 'Simpan izin'));
    }));
}

export async function renderAudit(el) {
  loading(el);
  let rows;
  try { rows = await api('/admin/audit?limit=200'); } catch (e) { return errorBox(el, e); }
  mount(el, h('h1', {}, 'Log Audit'),
    h('div', { class: 'card scroll-x' }, h('table', { class: 'tbl' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Waktu'), h('th', {}, 'Pengguna'), h('th', {}, 'Aksi'), h('th', {}, 'Data'))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, fmtDateTime(r.created_at)), h('td', {}, r.user_name || '-'), h('td', {}, r.action),
        h('td', { class: 'small muted' }, `${r.entity_type || ''} ${r.entity_id || ''}`)))))));
}

export function renderAccount(el) {
  const cur = h('input', { type: 'password', autocomplete: 'current-password' });
  const next = h('input', { type: 'password', autocomplete: 'new-password' });
  mount(el, h('h1', {}, 'Akun Saya'),
    h('div', { class: 'card' },
      h('div', { class: 'meta' }, 'Nama', h('b', {}, state.me.name), 'Username', h('b', {}, state.me.username), 'Peran', h('b', {}, state.me.role_name),
        'Outlet', h('b', {}, state.me.outlets.map((o) => o.outlet_name).join(', ') || '-')),
      h('h2', {}, 'Ganti password'), field('Password lama', cur), field('Password baru (min. 8 karakter)', next),
      h('button', { class: 'btn primary block', onclick: async () => {
        try { await api('/me/password', { method: 'POST', body: { current_password: cur.value, new_password: next.value } }); toast('Password diganti.'); cur.value = ''; next.value = ''; } catch (e) { toast(e.message); }
      } }, 'Simpan password')));
}
