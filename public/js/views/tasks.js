import { api } from '../api.js';
import { h, fmtTime, loading, errorBox, toast, mount, lightbox } from '../ui.js';
import { openHandover } from './handover.js';
import { state } from '../state.js';
import { openInstance, completeFlow, openPhotoForm } from './instance.js';

const OPEN = ['belum', 'perlu_perbaikan'];

/**
 * Baris tugas sederhana: [centang] nama tugas [foto].
 * Ketuk nama -> deskripsi lengkap. Centang -> selesaikan (tugas wajib foto membuka kamera dulu).
 */
export function taskRow(t, reload) {
  const open = OPEN.includes(t.status);
  const state = !open ? (t.status === 'menunggu_verifikasi' ? 'wait' : 'done') : t.status === 'perlu_perbaikan' ? 'fix' : t.is_overdue ? 'late' : '';
  const mark = { done: '✔', wait: '⏳', fix: '!', late: '', '': '' }[state];
  const tip = !open ? `Sudah dikerjakan${t.completed_by_name ? ` oleh ${t.completed_by_name} (${fmtTime(t.completed_at, t.timezone)})` : ''}${t.status === 'menunggu_verifikasi' ? ' · menunggu verifikasi' : ''}`
    : t.is_upcoming ? `Belum waktunya. Bisa dikerjakan mulai pukul ${fmtTime(t.available_at, t.timezone)}.`
      : !t.can_complete ? 'Tugas ini bukan tanggung jawab Anda.' : null;
  const check = h('button', {
    class: `tcheck ${state}`, 'aria-label': open ? `Selesaikan: ${t.name}` : `Sudah selesai: ${t.name}`, 'aria-pressed': open ? 'false' : 'true',
    onclick: async (e) => {
      e.stopPropagation();
      if (tip) return toast(tip);
      check.disabled = true;
      await completeFlow(t, () => reload());
      check.disabled = false;
    },
  }, mark);
  if (open && (t.is_upcoming || !t.can_complete)) check.classList.add('off');
  const photo = !t.requires_photo ? h('span', { class: 'tphoto none' })
    : t.last_evidence_id ? h('img', { class: 'tphoto', src: `/api/evidence/${t.last_evidence_id}`, alt: 'Foto bukti', loading: 'lazy', onclick: (e) => { e.stopPropagation(); lightbox(`/api/evidence/${t.last_evidence_id}`); } })
      : h('button', { class: 'tphoto cam', 'aria-label': `Ambil foto: ${t.name}`, onclick: (e) => { e.stopPropagation(); if (tip) return toast(tip); openPhotoForm(t, () => reload()); } }, '📷');
  return h('div', { class: `trow ${state} ${open && t.is_upcoming ? 'soon' : ''}` },
    check,
    h('button', { class: 'tname', onclick: () => openInstance(t.id, { onChange: reload }) }, t.name),
    photo);
}

const list = (rows, reload) => h('div', { class: 'card tlist' }, rows.map((t) => taskRow(t, reload)));

export async function renderMyTasks(el) {
  loading(el);
  let data;
  try { data = await api('/my-tasks'); } catch (e) { return errorBox(el, e, () => renderMyTasks(el)); }
  const reload = () => renderMyTasks(el);
  const { tasks, summary, shifts = [], handovers = [] } = data;
  const shiftLine = shifts.length ? h('div', { class: 'small muted', style: { margin: '-6px 0 12px' } }, shifts.map((s) =>
    `${shifts.length > 1 ? `${s.outlet_name}: ` : ''}${s.my_shift ? `Anda Shift ${s.my_shift}` : 'Shift fleksibel'}${s.current ? ` · sekarang Shift ${s.current.shift_no} (s.d. ${fmtTime(s.current.end_at, s.timezone)})` : ' · di luar jam shift'}`).join(' | ')) : null;
  const banners = handovers.map((x) => h('button', { class: `notice ${x.acknowledged_at ? 'info' : 'warn'}`, style: { display: 'block', width: '100%', textAlign: 'left', border: 0, marginBottom: '10px', cursor: 'pointer' }, onclick: () => openHandover(x.id, reload) },
    h('b', {}, x.acknowledged_at ? '📝 Serah terima' : '📝 Serah terima baru'), ` dari Shift ${x.from_shift} (${x.created_by_name})`,
    x.open_items ? ` · ${x.open_items} tugas belum selesai` : '', h('span', { style: { float: 'right' } }, 'Lihat ›')));
  const now = tasks.filter((t) => !t.is_upcoming && ['belum', 'perlu_perbaikan'].includes(t.status));
  const later = tasks.filter((t) => t.is_upcoming && ['belum', 'perlu_perbaikan'].includes(t.status));
  const done = tasks.filter((t) => !['belum', 'perlu_perbaikan'].includes(t.status));
  const section = (title, rows) => (rows.length ? [h('h2', {}, `${title} (${rows.length})`), list(rows, reload)] : []);
  mount(el, 
    h('h1', {}, `Halo, ${state.me.name.split(' ')[0]} 👋`),
    shiftLine,
    banners,
    h('div', { class: 'summary' },
      h('div', { class: 'stat' }, h('div', { class: 'n' }, summary.total), h('div', { class: 'l' }, 'Tugas saat ini')),
      h('div', { class: 'stat good' }, h('div', { class: 'n' }, summary.done), h('div', { class: 'l' }, 'Selesai')),
      h('div', { class: `stat ${summary.overdue ? 'bad' : ''}` }, h('div', { class: 'n' }, summary.overdue), h('div', { class: 'l' }, 'Terlambat'))),
    !state.me.outlets.length ? h('div', { class: 'notice warn' }, 'Anda belum ditempatkan di outlet mana pun. Hubungi admin.') : null,
    tasks.length ? h('div', { class: 'small muted', style: { marginBottom: '6px' } }, '☐ Centang untuk menyelesaikan · ketuk nama tugas untuk melihat detail') : null,
    now.length ? section('Perlu dikerjakan', now) : h('div', { class: 'card empty' }, '🎉 Tidak ada tugas yang perlu dikerjakan saat ini.'),
    ...section('Akan datang', later),
    ...section('Sudah dikerjakan', done));
  if (summary.overdue) toast(`${summary.overdue} tugas terlambat!`);
}
