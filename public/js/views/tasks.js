import { api } from '../api.js';
import { h, clear, statusChip, lateChip, fmtDue, fmtTime, loading, errorBox, toast, mount, shiftChips } from '../ui.js';
import { openHandover } from './handover.js';
import { state } from '../state.js';
import { openInstance, completeFlow } from './instance.js';

export function taskCard(t, reload, { showButton = true } = {}) {
  const open = ['belum', 'perlu_perbaikan'].includes(t.status);
  const btn = showButton && open && t.can_complete
    ? (t.is_upcoming
      ? h('button', { class: 'btn block', disabled: true }, `Mulai ${fmtTime(t.scheduled_at, t.timezone)}`)
      : h('button', { class: 'btn primary big block', onclick: async (e) => {
        e.stopPropagation();
        e.currentTarget.disabled = true;
        await completeFlow(t, () => reload());
      } }, t.requires_photo ? '📷 Selesaikan Tugas' : '✔ Selesaikan Tugas'))
    : null;
  return h('article', { class: `card task ${t.is_overdue ? 'overdue' : ''} ${open ? '' : 'done'}`, onclick: () => openInstance(t.id, { onChange: reload }) },
    h('div', { class: 'row' }, h('h3', { class: 'task-title grow' }, t.name), statusChip(t)),
    h('div', { class: 'meta' },
      'Outlet', h('b', {}, t.outlet_name),
      'Deadline', h('b', {}, fmtDue(t)),
      'Penanggung jawab', h('b', {}, t.assignee_label),
      'Foto', h('b', {}, t.requires_photo ? '📷 Wajib foto' : 'Tidak perlu'),
      t.completed_by_name ? 'Oleh' : null, t.completed_by_name ? h('b', {}, `${t.completed_by_name} · ${fmtTime(t.completed_at, t.timezone)}`) : null),
    h('div', { class: 'tags', style: { marginBottom: btn ? '10px' : '0' } }, shiftChips(t), lateChip(t), t.is_critical ? h('span', { class: 'chip crit' }, 'Kritis') : null,
      t.requires_verification ? h('span', { class: 'chip' }, 'Perlu verifikasi') : null),
    btn);
}

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
  const section = (title, list, opts) => (list.length ? [h('h2', {}, `${title} (${list.length})`), ...list.map((t) => taskCard(t, reload, opts))] : []);
  mount(el, 
    h('h1', {}, `Halo, ${state.me.name.split(' ')[0]} 👋`),
    shiftLine,
    banners,
    h('div', { class: 'summary' },
      h('div', { class: 'stat' }, h('div', { class: 'n' }, summary.total), h('div', { class: 'l' }, 'Tugas saat ini')),
      h('div', { class: 'stat good' }, h('div', { class: 'n' }, summary.done), h('div', { class: 'l' }, 'Selesai')),
      h('div', { class: `stat ${summary.overdue ? 'bad' : ''}` }, h('div', { class: 'n' }, summary.overdue), h('div', { class: 'l' }, 'Terlambat'))),
    !state.me.outlets.length ? h('div', { class: 'notice warn' }, 'Anda belum ditempatkan di outlet mana pun. Hubungi admin.') : null,
    now.length ? section('Perlu dikerjakan', now) : h('div', { class: 'card empty' }, '🎉 Tidak ada tugas yang perlu dikerjakan saat ini.'),
    ...section('Akan datang', later),
    ...section('Sudah dikerjakan', done, { showButton: false }));
  if (summary.overdue) toast(`${summary.overdue} tugas terlambat!`);
}
