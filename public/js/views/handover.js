import { api } from '../api.js';
import { h, mount, loading, errorBox, toast, sheet, field, select, statusChip, fmtDateTime, fmtTime, fmtDate } from '../ui.js';
import { state, can } from '../state.js';

let outletId = null;

const shiftRange = (w, tz) => `${fmtTime(w.start_at, tz)}–${fmtTime(w.end_at, tz)}`;

/** Detail serah terima (dipakai juga dari banner Tugas Saya). */
export async function openHandover(id, onChange) {
  let d;
  try { d = await api(`/handovers/${id}`); } catch (e) { return toast(e.message); }
  const tz = d.timezone;
  const block = (title, text) => (text ? h('div', { class: 'card', style: { marginBottom: '8px' } }, h('div', { class: 'small muted' }, title), h('div', { style: { whiteSpace: 'pre-wrap', fontWeight: 600 } }, text)) : null);
  const s = sheet(`Serah Terima Shift ${d.from_shift} → Shift ${d.to_shift}`, h('div', { class: 'stack' },
    h('div', { class: 'small muted' }, `${d.outlet_name} · ${fmtDate(d.business_date)}`),
    h('div', { class: 'small' }, 'Dibuat oleh ', h('b', {}, d.created_by_name), ` · ${fmtDateTime(d.created_at, tz)}`,
      d.updated_at !== d.created_at ? ` (diubah ${d.updated_by_name} ${fmtDateTime(d.updated_at, tz)})` : ''),
    d.acknowledged_at
      ? h('div', { class: 'notice info' }, '✔ Diterima oleh ', h('b', {}, d.acknowledged_by_name), ` · ${fmtDateTime(d.acknowledged_at, tz)}`)
      : h('div', { class: 'notice warn' }, 'Belum diterima shift berikutnya.'),
    block('📦 Masalah stok', d.stock_issues),
    block('🔧 Masalah peralatan', d.equipment_issues),
    block('📝 Catatan penting', d.notes),
    !d.stock_issues && !d.equipment_issues && !d.notes ? h('div', { class: 'muted small' }, 'Tidak ada catatan tambahan.') : null,
    h('h2', {}, `Tugas belum selesai saat serah terima (${d.items.length})`),
    d.items.length ? h('div', { class: 'card' }, d.items.map((it) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, it.name),
        h('div', { class: 'small muted' }, `${it.assignee_label} · deadline ${fmtDateTime(it.due_at, it.timezone)}`,
          it.completed_by_name ? ` · diselesaikan ${it.completed_by_name} ${fmtDateTime(it.completed_at, it.timezone)}` : '')),
      statusChip(it)))) : h('div', { class: 'muted small' }, 'Semua tugas sudah selesai. 👍'),
    d.can_acknowledge ? h('button', { class: 'btn primary big block', onclick: async () => {
      try { await api(`/handovers/${d.id}/acknowledge`, { method: 'POST' }); toast('Serah terima diterima ✔'); s.close(); onChange && onChange(); } catch (e) { toast(e.message); }
    } }, '✔ Saya sudah baca & terima') : null));
}

function createSheet(draft, onDone) {
  const tz = draft.outlet.timezone;
  const stock = h('textarea', { placeholder: 'mis. Susu tinggal 2 liter, cup besar habis' });
  const equip = h('textarea', { placeholder: 'mis. Grinder bunyi aneh, AC bocor' });
  const notes = h('textarea', { placeholder: 'mis. Ada pesanan katering jam 17:00' });
  const ex = draft.existing;
  if (ex) { stock.value = ex.stock_issues || ''; equip.value = ex.equipment_issues || ''; notes.value = ex.notes || ''; }
  const s = sheet(`Serah Terima Shift ${draft.from_shift} → Shift ${draft.to_shift}`, h('div', {},
    h('div', { class: 'small muted', style: { marginBottom: '8px' } }, `${draft.outlet.outlet_name} · Shift ${draft.from_shift} (${shiftRange(draft.window, tz)}) · ${fmtDate(draft.business_date)}`),
    ex ? h('div', { class: 'notice info', style: { marginBottom: '10px' } }, `Memperbarui serah terima yang dibuat ${ex.created_by_name}.`) : null,
    h('h2', {}, `Tugas belum selesai (${draft.items.length})`),
    h('div', { class: 'small muted' }, 'Otomatis tercatat & tetap terlihat oleh shift berikutnya.'),
    draft.items.length ? h('div', { class: 'card', style: { margin: '8px 0 12px' } }, draft.items.map((it) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, it.name), h('div', { class: 'small muted' }, `${it.assignee_label} · deadline ${fmtTime(it.due_at, it.timezone)}`)),
      statusChip(it)))) : h('div', { class: 'notice info', style: { margin: '8px 0 12px' } }, 'Semua tugas sudah selesai 👍'),
    field('📦 Masalah stok', stock), field('🔧 Masalah peralatan', equip), field('📝 Catatan penting', notes),
    h('button', { class: 'btn primary big block', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        await api('/handovers', { method: 'POST', body: { outlet_id: draft.outlet.outlet_id, business_date: draft.business_date, from_shift: draft.from_shift, stock_issues: stock.value, equipment_issues: equip.value, notes: notes.value } });
        toast('Serah terima tersimpan ✔'); s.close(); onDone();
      } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
    } }, 'Simpan serah terima')));
}

export async function renderHandovers(el) {
  loading(el);
  outletId = outletId || state.me.outlets[0]?.outlet_id;
  let d;
  try { d = await api(`/handovers?outlet_id=${outletId}`); } catch (e) { return errorBox(el, e); }
  const reload = () => renderHandovers(el);
  const tz = d.outlet.timezone;
  const cur = d.shift.current;
  mount(el,
    h('a', { href: '#/checklist', class: 'small' }, '‹ Checklist Outlet'),
    h('h1', {}, 'Serah Terima Shift'),
    state.me.outlets.length > 1 ? h('div', { style: { marginBottom: '10px' } }, select(state.me.outlets.map((o) => [o.outlet_id, o.outlet_name]), outletId, { onchange: (e) => { outletId = Number(e.target.value); reload(); } })) : null,
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      cur ? h('div', {}, h('b', {}, `Sekarang: Shift ${cur.shift_no}`), h('span', { class: 'muted' }, ` · ${shiftRange(cur, tz)}`))
        : h('div', { class: 'muted' }, 'Di luar jam shift'),
      h('div', { class: 'small muted' }, d.shift.shifts.map((s) => `Shift ${s.shift_no}: ${s.start_time}–${s.end_time}`).join(' · '))),
    can('handover.create') ? h('button', { class: 'btn primary big block', onclick: async () => {
      try { createSheet(await api(`/handovers/draft?outlet_id=${outletId}`), reload); } catch (e) { toast(e.message); }
    } }, '📝 Buat serah terima shift') : null,
    h('h2', {}, 'Riwayat 7 hari'),
    d.handovers.length ? h('div', { class: 'card' }, d.handovers.map((x) => h('div', { class: 'list-row', onclick: () => openHandover(x.id, reload) },
      h('div', { class: 'grow' },
        h('div', { style: { fontWeight: 600 } }, `Shift ${x.from_shift} → Shift ${x.to_shift} · ${fmtDate(x.business_date)}`),
        h('div', { class: 'small muted' }, `oleh ${x.created_by_name} ${fmtTime(x.created_at, tz)} · ${x.item_count} tugas belum selesai`, x.has_stock ? ' · 📦' : '', x.has_equipment ? ' · 🔧' : '')),
      x.acknowledged_at ? h('span', { class: 'chip s-terverifikasi' }, 'Diterima') : h('span', { class: 'chip s-perlu_perbaikan' }, 'Belum diterima')))) : h('div', { class: 'card empty' }, 'Belum ada serah terima.'));
}
