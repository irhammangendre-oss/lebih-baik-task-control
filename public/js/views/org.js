import { api } from '../api.js';
import { h, clear, loading, errorBox, toast, sheet, field, select, mount } from '../ui.js';
import { state, can } from '../state.js';

let tab = 'users';

export async function renderOrg(el) {
  loading(el);
  let brands, outlets, users;
  try { [brands, outlets, users] = await Promise.all([api('/org/brands'), api('/org/outlets'), api('/org/users')]); } catch (e) { return errorBox(el, e); }
  const reload = () => renderOrg(el);
  const all = can('scope.all');
  const tabs = h('div', { class: 'tabs' }, [['users', `Karyawan (${users.length})`], ['outlets', `Outlet (${outlets.length})`], ['brands', `Brand (${brands.length})`]]
    .map(([k, l]) => h('button', { class: tab === k ? 'active' : '', onclick: () => { tab = k; reload(); } }, l)));
  let body;
  if (tab === 'users') {
    body = [h('button', { class: 'btn primary block', onclick: () => userSheet(null, { outlets, users }, reload) }, '+ Karyawan'),
      h('div', { class: 'card', style: { marginTop: '10px' } }, users.map((u) => h('div', { class: 'list-row', style: { opacity: u.active ? 1 : 0.5 }, onclick: () => userSheet(u, { outlets, users }, reload) },
        h('div', { class: 'grow' }, h('b', {}, u.name), h('div', { class: 'small muted' }, `@${u.username} · ${u.role_name}${u.reports_to_name ? ` · lapor ke ${u.reports_to_name}` : ''}`),
          h('div', { class: 'small muted' }, u.outlets.map((o) => `${o.outlet_name}${o.team ? ` (${o.team})` : ''}`).join(', ') || 'Belum ditempatkan')),
        !u.active ? h('span', { class: 'chip' }, 'Nonaktif') : null)))];
  } else if (tab === 'outlets') {
    body = [all ? h('button', { class: 'btn primary block', onclick: () => outletSheet(null, brands, reload) }, '+ Outlet') : null,
      h('div', { class: 'card', style: { marginTop: '10px' } }, outlets.map((o) => h('div', { class: 'list-row', style: { opacity: o.active ? 1 : 0.5 }, onclick: () => all && outletSheet(o, brands, reload) },
        h('div', { class: 'grow' }, h('b', {}, o.name), h('div', { class: 'small muted' }, `${o.code} · ${o.brand_name} · ${o.timezone} · ${o.staff_count} karyawan`)),
        !o.active ? h('span', { class: 'chip' }, 'Nonaktif') : null)))];
  } else {
    body = [all ? h('button', { class: 'btn primary block', onclick: () => brandSheet(null, reload) }, '+ Brand') : null,
      h('div', { class: 'card', style: { marginTop: '10px' } }, brands.map((b) => h('div', { class: 'list-row', style: { opacity: b.active ? 1 : 0.5 }, onclick: () => all && brandSheet(b, reload) },
        h('div', { class: 'grow' }, h('b', {}, b.name)), !b.active ? h('span', { class: 'chip' }, 'Nonaktif') : null)))];
  }
  mount(el, h('h1', {}, 'Brand, Outlet & Karyawan'), tabs, body);
}

function brandSheet(b, reload) {
  const name = h('input', { type: 'text', value: b?.name || '' });
  const active = h('input', { type: 'checkbox', checked: b ? !!b.active : true });
  const s = sheet(b ? 'Ubah brand' : 'Brand baru', h('div', {}, field('Nama brand', name), h('label', { class: 'check' }, active, 'Aktif'),
    h('button', { class: 'btn primary big block', onclick: async () => {
      try { await api(b ? `/org/brands/${b.id}` : '/org/brands', { method: b ? 'PUT' : 'POST', body: { name: name.value, active: active.checked } }); s.close(); toast('Disimpan.'); reload(); } catch (e) { toast(e.message); }
    } }, 'Simpan')));
}

function outletSheet(o, brands, reload) {
  const brand = select(brands.map((b) => [b.id, b.name]), o?.brand_id);
  const code = h('input', { type: 'text', value: o?.code || '', placeholder: 'mis. KOPI-03' });
  const name = h('input', { type: 'text', value: o?.name || '' });
  const tz = select([['Asia/Jakarta', 'WIB (Asia/Jakarta)'], ['Asia/Makassar', 'WITA (Asia/Makassar)'], ['Asia/Jayapura', 'WIT (Asia/Jayapura)']], o?.timezone || 'Asia/Jakarta');
  const active = h('input', { type: 'checkbox', checked: o ? !!o.active : true });
  const s = sheet(o ? 'Ubah outlet' : 'Outlet baru', h('div', {}, field('Brand', brand), field('Kode outlet', code), field('Nama outlet', name), field('Zona waktu', tz),
    h('label', { class: 'check' }, active, 'Aktif'),
    h('button', { class: 'btn primary big block', onclick: async () => {
      const body = { brand_id: Number(brand.value), code: code.value, name: name.value, timezone: tz.value, active: active.checked };
      try { await api(o ? `/org/outlets/${o.id}` : '/org/outlets', { method: o ? 'PUT' : 'POST', body }); s.close(); toast('Disimpan.'); reload(); } catch (e) { toast(e.message); }
    } }, 'Simpan')));
}

function userSheet(u, { outlets, users }, reload) {
  const name = h('input', { type: 'text', value: u?.name || '' });
  const username = h('input', { type: 'text', value: u?.username || '', autocapitalize: 'none' });
  const role = select(state.me.meta.roles.map((r) => [r.code, r.name]), u?.role_code || 'crew');
  const reports = select([['', '— tidak ada —'], ...users.filter((x) => x.id !== u?.id && x.active).map((x) => [x.id, `${x.name} (${x.role_name})`])], u?.reports_to_user_id);
  const pw = h('input', { type: 'password', autocomplete: 'new-password', placeholder: u ? 'Kosongkan jika tidak diubah' : 'Minimal 8 karakter (opsional jika pakai PIN)' });
  const pin = h('input', { type: 'text', inputmode: 'numeric', maxlength: 6, autocomplete: 'off', placeholder: u?.has_pin ? 'Sudah ada PIN — isi untuk mengganti' : '6 angka, mis. 482913' });
  const active = h('input', { type: 'checkbox', checked: u ? !!u.active : true });
  const current = new Map((u?.outlets || []).map((o) => [o.outlet_id, o.team]));
  const currentShift = new Map((u?.outlets || []).map((o) => [o.outlet_id, o.shift_no]));
  const rows = outlets.filter((o) => o.active).map((o) => {
    const cb = h('input', { type: 'checkbox', value: o.id, checked: current.has(o.id) });
    const team = h('input', { type: 'text', value: current.get(o.id) || '', placeholder: 'Tim/area (opsional)' });
    const shift = select([['', 'Shift fleksibel'], [1, 'Shift 1'], [2, 'Shift 2']], currentShift.get(o.id), { 'aria-label': 'Shift' });
    return { o, cb, team, shift, el: h('div', { class: 'card', style: { padding: '8px 10px', marginBottom: '6px' } }, h('label', { class: 'check' }, cb, h('b', {}, o.name)), h('div', { class: 'grid2' }, team, shift)) };
  });
  const s = sheet(u ? 'Ubah karyawan' : 'Karyawan baru', h('div', {},
    field('Nama', name), field('Username (untuk login)', username), field('Peran', role),
    field('Melapor ke (atasan langsung)', reports, 'Atur hubungan pelaporan secara bebas — Kasir tidak otomatis membawahi Crew.'),
    field('PIN login (6 angka)', pin, 'Untuk karyawan outlet: login cukup username + PIN.'),
    field(u ? 'Reset password' : 'Password', pw),
    h('h2', {}, 'Penempatan outlet'), rows.map((r) => r.el),
    h('label', { class: 'check' }, active, 'Aktif'),
    h('button', { class: 'btn primary big block', onclick: async () => {
      const body = {
        name: name.value, username: username.value, role_code: role.value, reports_to_user_id: reports.value ? Number(reports.value) : null,
        active: active.checked, pin: pin.value.trim() || undefined, outlets: rows.filter((r) => r.cb.checked).map((r) => ({ outlet_id: r.o.id, team: r.team.value, shift_no: r.shift.value ? Number(r.shift.value) : null })),
      };
      try {
        if (u) {
          await api(`/org/users/${u.id}`, { method: 'PUT', body });
          if (pw.value) await api(`/org/users/${u.id}/password`, { method: 'POST', body: { password: pw.value } });
        } else {
          await api('/org/users', { method: 'POST', body: { ...body, password: pw.value } });
        }
        s.close(); toast('Karyawan disimpan.'); reload();
      } catch (e) { toast(e.message); }
    } }, 'Simpan')));
}
