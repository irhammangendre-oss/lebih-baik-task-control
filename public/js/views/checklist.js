import { api } from '../api.js';
import { h, clear, loading, errorBox, select, CATEGORY_LABEL, fmtDate, mount } from '../ui.js';
import { state } from '../state.js';
import { taskCard } from './tasks.js';

let current = { outlet_id: null, date: null, tab: null, shift: '' };

export async function renderChecklist(el) {
  loading(el);
  const qs = new URLSearchParams();
  if (current.outlet_id) qs.set('outlet_id', current.outlet_id);
  if (current.date) qs.set('date', current.date);
  if (current.shift) qs.set('shift', current.shift);
  let d;
  try { d = await api(`/checklist?${qs}`); } catch (e) { return errorBox(el, e, () => renderChecklist(el)); }
  if (!d.outlet) return mount(el, h('h1', {}, 'Checklist Outlet'), h('div', { class: 'card empty' }, 'Anda belum ditempatkan di outlet.'));
  current.outlet_id = d.outlet.outlet_id;
  current.date = d.date;
  if (!current.tab) {
    current.tab = ['opening', 'operasional', 'closing'].find((k) => d.counts[k].total > d.counts[k].done) || 'opening';
  }
  const reload = () => renderChecklist(el);
  const outletSel = state.me.outlets.length > 1
    ? select(state.me.outlets.map((o) => [o.outlet_id, `${o.outlet_name}`]), d.outlet.outlet_id, { onchange: (e) => { current.outlet_id = e.target.value; reload(); }, 'aria-label': 'Outlet' })
    : null;
  const dateIn = h('input', { type: 'date', value: d.date, 'aria-label': 'Tanggal', onchange: (e) => { current.date = e.target.value; reload(); } });
  const list = d.groups[current.tab];
  const c = d.counts[current.tab];
  const all = Object.values(d.counts).reduce((a, x) => ({ total: a.total + x.total, done: a.done + x.done, overdue: a.overdue + x.overdue }), { total: 0, done: 0, overdue: 0 });
  mount(el, 
    h('h1', {}, 'Checklist Outlet'),
    h('div', { class: 'filters' }, outletSel || h('div', { class: 'card', style: { padding: '10px 12px' } }, h('b', {}, d.outlet.outlet_name)), dateIn),
    h('div', { class: 'muted small', style: { marginBottom: '8px' } }, fmtDate(d.date),
      d.shift?.current ? ` · sekarang Shift ${d.shift.current.shift_no}` : ''),
    h('div', { class: 'tabs' }, [['', 'Semua shift'], ...d.shift.shifts.map((s) => [String(s.shift_no), `Shift ${s.shift_no} · ${s.start_time}–${s.end_time}`])].map(([v, l]) => h('button', {
      class: current.shift === v ? 'active' : '', onclick: () => { current.shift = v; reload(); },
    }, l))),
    h('a', { class: 'btn block', href: '#/serah-terima', style: { marginBottom: '12px' } }, '📝 Serah Terima Shift'),
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'row' }, h('b', { class: 'grow' }, `${all.done}/${all.total} selesai`), all.overdue ? h('span', { class: 'chip s-terlambat' }, `${all.overdue} terlambat`) : null),
      h('div', { class: 'progress', style: { marginTop: '8px' } }, h('div', { style: { width: `${all.total ? (all.done / all.total) * 100 : 0}%` } }))),
    h('div', { class: 'tabs', role: 'tablist' }, ['opening', 'operasional', 'closing'].map((k) => h('button', {
      class: current.tab === k ? 'active' : '', role: 'tab', onclick: () => { current.tab = k; reload(); },
    }, CATEGORY_LABEL[k], h('span', { class: 'cnt' }, `${d.counts[k].done}/${d.counts[k].total}`), d.counts[k].overdue ? ' ⚠' : ''))),
    c.overdue ? h('div', { class: 'notice danger', style: { marginBottom: '10px' } }, `${c.overdue} tugas ${CATEGORY_LABEL[current.tab]} terlambat.`) : null,
    list.length ? list.map((t) => taskCard(t, reload)) : h('div', { class: 'card empty' }, 'Tidak ada tugas di kategori ini.'));
}
