import { api } from '../api.js';
import { h, clear, loading, errorBox, select, statusChip, lateChip, fmtTime, fmtDateTime, fmtDate, STATUS_LABEL, CATEGORY_LABEL, mount } from '../ui.js';
import { openInstance } from './instance.js';

const f = { date: '', brand_id: '', outlet_id: '', status: '' };
const LEVEL_LABEL = { team: 'Area / shift Anda', outlet: 'Outlet Anda', multi: 'Outlet yang Anda awasi', all: 'Semua brand & outlet' };

function stat(n, label, cls = '', onclick) {
  return h('div', { class: `stat ${cls}`, style: onclick ? { cursor: 'pointer' } : null, onclick }, h('div', { class: 'n' }, n), h('div', { class: 'l' }, label));
}

export function instanceRow(t, reload) {
  return h('div', { class: 'list-row', onclick: () => openInstance(t.id, { onChange: reload }) },
    h('div', { class: 'grow' },
      h('div', { class: 'ellipsis', style: { fontWeight: 600 } }, t.is_critical ? '⚠ ' : '', t.name),
      h('div', { class: 'small muted ellipsis' },
        `${t.outlet_name} · ${CATEGORY_LABEL[t.category]} · deadline ${fmtTime(t.due_at, t.timezone)} · ${t.assignee_label}`,
        t.completed_by_name ? ` · oleh ${t.completed_by_name} ${fmtTime(t.completed_at, t.timezone)}` : '',
        t.evidence_count ? ` · 📷${t.evidence_count}` : '',
        t.is_overdue && t.escalation_stage ? ` · eskalasi tahap ${t.escalation_stage}` : '')),
    h('div', { style: { textAlign: 'right' } }, statusChip(t), h('div', {}, lateChip(t))));
}

export async function renderMonitoring(el) {
  loading(el);
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
  let d;
  try { d = await api(`/monitoring?${qs}`); } catch (e) { return errorBox(el, e, () => renderMonitoring(el)); }
  f.date = d.date;
  const reload = () => renderMonitoring(el);
  const set = (k) => (e) => { f[k] = e.target.value; if (k === 'brand_id') f.outlet_id = ''; reload(); };
  const outlets = d.outlets.filter((o) => !f.brand_id || o.brand_id === Number(f.brand_id));
  const c = d.cards;
  const rate = c.total ? Math.round((c.completed / c.total) * 100) : 0;

  const filters = h('div', { class: 'filters' },
    h('input', { type: 'date', value: d.date, onchange: set('date'), 'aria-label': 'Tanggal' }),
    select([['', 'Semua status'], ...Object.entries(STATUS_LABEL)], f.status, { onchange: set('status'), 'aria-label': 'Status' }),
    d.brands.length > 1 ? select([['', 'Semua brand'], ...d.brands.map((b) => [b.id, b.name])], f.brand_id, { onchange: set('brand_id'), 'aria-label': 'Brand' }) : null,
    outlets.length > 1 ? select([['', 'Semua outlet'], ...outlets.map((o) => [o.id, o.name])], f.outlet_id, { onchange: set('outlet_id'), 'aria-label': 'Outlet' }) : null);

  const filterStatus = (s) => () => { f.status = f.status === s ? '' : s; reload(); };

  mount(el, 
    h('h1', {}, 'Monitoring'),
    h('div', { class: 'muted small', style: { marginBottom: '10px' } }, `${LEVEL_LABEL[d.level]} · ${fmtDate(d.date)}`),
    filters,
    h('div', { class: 'summary wide' },
      stat(c.total, 'Total terjadwal', '', filterStatus('')),
      stat(c.completed, 'Selesai', 'good'),
      stat(c.verified, 'Terverifikasi', 'good', filterStatus('terverifikasi')),
      stat(c.incomplete, 'Belum selesai', c.incomplete ? '' : 'good', filterStatus('belum')),
      stat(c.overdue, 'Terlambat', c.overdue ? 'bad' : '', filterStatus('terlambat')),
      stat(c.rejected, 'Ditolak', c.rejected ? 'bad' : ''),
      stat(c.waiting_verification, 'Menunggu verifikasi', '', filterStatus('menunggu_verifikasi')),
      stat(c.late_completed, 'Selesai terlambat'),
      stat(`${rate}%`, 'Tingkat penyelesaian', rate >= 90 ? 'good' : rate < 60 && c.total ? 'bad' : '')),

    d.verification_queue.length ? [
      h('h2', {}, `Menunggu verifikasi (${d.verification_queue.length})`),
      h('div', { class: 'card' }, d.verification_queue.map((t) => instanceRow(t, reload)))] : null,

    f.status ? [
      h('h2', {}, `Tugas: ${STATUS_LABEL[f.status]} (${d.instances.length})`),
      h('div', { class: 'card' }, d.instances.length ? d.instances.map((t) => instanceRow(t, reload)) : h('div', { class: 'empty' }, 'Tidak ada.'))] : null,

    !f.status && d.overdue.length ? [
      h('h2', {}, `Terlambat (${d.overdue.length})`),
      h('div', { class: 'card' }, d.overdue.map((t) => instanceRow(t, reload)))] : null,

    d.by_outlet.length ? [
      h('h2', {}, 'Penyelesaian per outlet'),
      h('div', { class: 'card' }, d.by_outlet.map((o) => h('div', { class: 'list-row', onclick: () => { location.hash = `#/monitoring/outlet/${o.outlet_id}?date=${d.date}`; } },
        h('div', { class: 'grow' },
          h('div', { class: 'row' }, h('b', { class: 'grow ellipsis' }, o.outlet_name), h('b', {}, o.completion_rate === null ? '–' : `${o.completion_rate}%`)),
          h('div', { class: 'progress', style: { margin: '6px 0' } }, h('div', { style: { width: `${o.completion_rate || 0}%` } })),
          h('div', { class: 'small muted' }, `${o.brand_name} · ${o.completed}/${o.total} selesai · ${o.overdue} terlambat · ${o.waiting_verification} menunggu verifikasi`)),
        h('span', { class: 'muted' }, '›'))))] : null,

    d.repeated.length ? [
      h('h2', {}, 'Masalah berulang (7 hari)'),
      h('div', { class: 'card' }, d.repeated.map((g) => h('div', { class: 'list-row', onclick: () => { location.hash = `#/monitoring/outlet/${g.outlet_id}?date=${d.date}`; } },
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 600 } }, g.is_critical ? '⚠ ' : '', g.name),
          h('div', { class: 'small muted' }, `${g.outlet_name} · terakhir ${fmtDateTime(g.last_missed)}`)),
        h('span', { class: 'chip s-terlambat' }, `${g.missed}/${g.occurrences} terlewat`))))] : null,

    !f.status && d.level === 'team' ? [
      h('h2', {}, `Semua tugas area Anda (${d.instances.length})`),
      h('div', { class: 'card' }, d.instances.length ? d.instances.map((t) => instanceRow(t, reload)) : h('div', { class: 'empty' }, 'Tidak ada tugas.'))] : null,

    !f.status && d.level === 'outlet' && d.by_outlet.length === 1 ? h('a', { class: 'btn block', style: { marginTop: '16px' }, href: `#/monitoring/outlet/${d.by_outlet[0].outlet_id}?date=${d.date}` }, 'Lihat semua tugas outlet ›') : null,
  );
}

export async function renderOutletDetail(el, { params, query }) {
  loading(el);
  const id = params[0];
  const date = query.get('date') || '';
  let d;
  try { d = await api(`/monitoring/outlets/${id}?date=${encodeURIComponent(date)}`); } catch (e) { return errorBox(el, e); }
  const reload = () => renderOutletDetail(el, { params, query });
  const groups = { opening: [], operasional: [], closing: [] };
  for (const t of d.instances) groups[t.category].push(t);
  const c = d.cards;
  mount(el, 
    h('a', { href: '#/monitoring', class: 'small' }, '‹ Kembali ke Monitoring'),
    h('h1', {}, d.outlet.outlet_name),
    h('div', { class: 'row', style: { marginBottom: '10px' } },
      h('input', { type: 'date', value: d.date, onchange: (e) => { location.hash = `#/monitoring/outlet/${id}?date=${e.target.value}`; } }),
      h('span', { class: 'muted small' }, d.outlet.brand_name)),
    h('div', { class: 'summary wide' },
      stat(c.total, 'Total'), stat(c.completed, 'Selesai', 'good'), stat(c.verified, 'Terverifikasi', 'good'),
      stat(c.overdue, 'Terlambat', c.overdue ? 'bad' : ''), stat(c.waiting_verification, 'Menunggu verifikasi'), stat(c.rejected, 'Ditolak', c.rejected ? 'bad' : '')),
    Object.entries(groups).map(([k, list]) => (list.length ? [h('h2', {}, `${CATEGORY_LABEL[k]} (${list.filter((t) => !['belum', 'perlu_perbaikan'].includes(t.status)).length}/${list.length})`),
      h('div', { class: 'card' }, list.map((t) => instanceRow(t, reload)))] : null)),
    !d.instances.length ? h('div', { class: 'card empty' }, 'Tidak ada tugas terjadwal pada tanggal ini.') : null,
    h('h2', {}, `Tim outlet (${d.staff.length})`),
    h('div', { class: 'card' }, d.staff.map((s) => h('div', { class: 'list-row' }, h('div', { class: 'grow' }, h('b', {}, s.name), h('div', { class: 'small muted' }, s.role_name, s.team ? ` · Tim ${s.team}` : ''))))),
  );
}
