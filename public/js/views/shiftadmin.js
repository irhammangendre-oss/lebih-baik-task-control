import { api } from '../api.js';
import { h, mount, loading, errorBox, toast, field, select, todayIn, fmtDate } from '../ui.js';
import { state } from '../state.js';

const cur = { outlet: null, date: null };

export async function renderShiftAdmin(el) {
  loading(el);
  cur.outlet = cur.outlet || state.me.outlets[0]?.outlet_id;
  const o = state.me.outlets.find((x) => x.outlet_id === Number(cur.outlet));
  cur.date = cur.date || todayIn(o?.timezone);
  let d;
  try { d = await api(`/shifts/roster?outlet_id=${cur.outlet}&date=${cur.date}`); } catch (e) { return errorBox(el, e); }
  const reload = () => renderShiftAdmin(el);
  const times = d.shifts.map((s) => ({ n: s.shift_no, start: h('input', { type: 'time', value: s.start_time }), end: h('input', { type: 'time', value: s.end_time }) }));
  const setShift = async (userId, shift, date) => {
    try { await api('/shifts/roster', { method: 'PUT', body: { outlet_id: cur.outlet, user_id: userId, shift_no: shift, date } }); toast('Jadwal disimpan.'); reload(); } catch (e) { toast(e.message); }
  };
  mount(el,
    h('h1', {}, 'Shift & Jadwal'),
    h('p', { class: 'muted small' }, 'Hanya untuk tanggung jawab tugas & serah terima — bukan absensi atau penggajian.'),
    state.me.outlets.length > 1 ? h('div', { style: { marginBottom: '10px' } }, select(state.me.outlets.map((x) => [x.outlet_id, x.outlet_name]), cur.outlet, { onchange: (e) => { cur.outlet = Number(e.target.value); cur.date = null; reload(); } })) : null,
    h('h2', {}, 'Jam shift outlet'),
    h('div', { class: 'card' },
      times.map((t) => h('div', { class: 'grid2' }, field(`Shift ${t.n} mulai`, t.start), field(`Shift ${t.n} selesai`, t.end))),
      h('div', { class: 'small muted', style: { marginBottom: '8px' } }, 'Jam selesai lebih awal dari jam mulai = berakhir keesokan hari. Perubahan berlaku untuk tugas yang dibuat berikutnya.'),
      h('button', { class: 'btn primary block', onclick: async () => {
        try {
          await api(`/shifts/outlets/${cur.outlet}`, { method: 'PUT', body: { shifts: times.map((t) => ({ shift_no: t.n, start_time: t.start.value, end_time: t.end.value })) } });
          toast('Jam shift disimpan.');
        } catch (e) { toast(e.message); }
      } }, 'Simpan jam shift')),
    h('div', { class: 'row', style: { marginTop: '20px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, 'Jadwal karyawan'),
      h('input', { type: 'date', value: d.date, style: { width: 'auto' }, onchange: (e) => { cur.date = e.target.value; reload(); } })),
    h('div', { class: 'small muted', style: { margin: '4px 0 8px' } }, `${fmtDate(d.date)}. Ketuk S1/S2 untuk mengubah shift khusus tanggal ini.`),
    h('div', { class: 'card' }, d.staff.length ? d.staff.map((s) => h('div', { class: 'list-row', style: { cursor: 'default' } },
      h('div', { class: 'grow' }, h('b', {}, s.name), h('div', { class: 'small muted' }, s.role_name, s.team ? ` · ${s.team}` : '', ' · tetap: ',
        select([['', '–'], [1, 'Shift 1'], [2, 'Shift 2']], s.default_shift, { style: { width: 'auto', minHeight: '32px', padding: '2px 6px' }, 'aria-label': 'Shift tetap', onchange: (e) => setShift(s.id, e.target.value || null) }),
        s.date_shift ? h('span', { class: 'chip s-menunggu_verifikasi', style: { marginLeft: '6px' } }, 'khusus hari ini') : null)),
      h('div', { class: 'row' }, [1, 2].map((n) => h('button', {
        class: `btn ${s.shift_no === n ? 'primary' : ''}`, style: { minWidth: '52px', padding: '8px 10px' },
        onclick: () => setShift(s.id, s.date_shift === n ? null : n, d.date),
      }, `S${n}`))))) : h('div', { class: 'empty' }, 'Belum ada karyawan.')));
}
