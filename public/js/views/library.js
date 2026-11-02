import { api } from '../api.js';
import { h, clear, loading, errorBox, toast, sheet, field, select, CATEGORY_LABEL, confirmSheet, mount } from '../ui.js';
import { state } from '../state.js';

const DAYS = [[1, 'Sen'], [2, 'Sel'], [3, 'Rab'], [4, 'Kam'], [5, 'Jum'], [6, 'Sab'], [7, 'Min']];

export function scheduleSummary(s) {
  if (!s) return '-';
  const days = s.days_of_week ? ` (${s.days_of_week.split(',').map((d) => DAYS[d - 1][1]).join(', ')})` : '';
  if (s.recurrence === 'interval') return `Tiap ${s.interval_minutes} mnt, ${s.start_time}–${s.end_time}, batas ${s.due_after_minutes || s.interval_minutes} mnt${days}`;
  return `${s.recurrence === 'weekly' ? 'Mingguan' : 'Harian'}${days}, mulai ${s.start_time}, deadline ${s.due_time}`;
}

/** Input jadwal yang dipakai ulang (template & penugasan). */
export function scheduleFields(init = {}) {
  const rec = select([['daily', 'Harian'], ['weekly', 'Mingguan (hari tertentu)'], ['interval', 'Berulang tiap X menit (mis. inspeksi toilet)']], init.recurrence || 'daily');
  const start = h('input', { type: 'time', value: init.start_time || '08:00' });
  const due = h('input', { type: 'time', value: init.due_time || '09:00' });
  const end = h('input', { type: 'time', value: init.end_time || '21:00' });
  const interval = h('input', { type: 'number', min: 15, step: 15, value: init.interval_minutes || 60 });
  const dueAfter = h('input', { type: 'number', min: 5, step: 5, value: init.due_after_minutes || 30 });
  const daySet = new Set((init.days_of_week || '').split(',').filter(Boolean).map(Number));
  const days = h('div', { class: 'row wrap' }, DAYS.map(([v, l]) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: v, checked: daySet.has(v) }), l)));
  const dueWrap = field('Deadline', due, 'Jika lebih awal dari jam mulai, dianggap hari berikutnya (closing lewat tengah malam).');
  const intervalWrap = h('div', {}, h('div', { class: 'grid2' }, field('Sampai jam', end), field('Interval (menit)', interval)), field('Batas waktu tiap kejadian (menit)', dueAfter));
  const daysWrap = field('Hari', days);
  const sync = () => {
    dueWrap.hidden = rec.value === 'interval';
    intervalWrap.hidden = rec.value !== 'interval';
    daysWrap.hidden = rec.value !== 'weekly';
  };
  rec.addEventListener('change', sync);
  sync();
  return {
    el: h('div', {}, field('Pengulangan', rec), field(rec.value === 'interval' ? 'Mulai jam' : 'Mulai jam (tugas tampil)', start), dueWrap, intervalWrap, daysWrap),
    value: () => ({
      recurrence: rec.value, start_time: start.value,
      due_time: rec.value === 'interval' ? null : due.value,
      end_time: rec.value === 'interval' ? end.value : null,
      interval_minutes: rec.value === 'interval' ? Number(interval.value) : null,
      due_after_minutes: rec.value === 'interval' ? Number(dueAfter.value) : null,
      days_of_week: rec.value === 'weekly' ? [...days.querySelectorAll('input:checked')].map((i) => Number(i.value)) : null,
    }),
  };
}

const roleOptions = () => state.me.meta.roles.map((r) => [r.code, r.name]);

export async function renderTemplates(el) {
  loading(el);
  let rows;
  try { rows = await api('/templates'); } catch (e) { return errorBox(el, e); }
  const byCat = { opening: [], operasional: [], closing: [] };
  for (const t of rows) byCat[t.category].push(t);
  mount(el, 
    h('div', { class: 'row' }, h('h1', { class: 'grow' }, 'Task Library'), h('a', { class: 'btn primary', href: '#/kelola/library/new' }, '+ Template')),
    h('p', { class: 'muted small' }, 'Template tidak otomatis ditugaskan ke outlet. Buka template lalu pilih "Tugaskan ke outlet".'),
    Object.entries(byCat).map(([k, list]) => [h('h2', {}, `${CATEGORY_LABEL[k]} (${list.length})`),
      h('div', { class: 'card' }, list.length ? list.map((t) => h('a', { class: 'list-row', href: `#/kelola/library/${t.id}`, style: { color: 'inherit', textDecoration: 'none', opacity: t.active ? 1 : 0.55 } },
        h('div', { class: 'grow' },
          h('div', { style: { fontWeight: 600 } }, t.is_critical ? '⚠ ' : '', t.name),
          h('div', { class: 'small muted' }, scheduleSummary(t), ` · ${t.active_assignments} outlet`)),
        h('div', { class: 'tags' }, t.requires_photo ? h('span', { class: 'chip photo' }, '📷') : null,
          t.requires_verification ? h('span', { class: 'chip' }, '✔ verif') : null, !t.active ? h('span', { class: 'chip' }, 'Nonaktif') : null))) : h('div', { class: 'empty' }, 'Belum ada.'))]));
}

export async function renderTemplateDetail(el, { params }) {
  loading(el);
  const isNew = params[0] === 'new';
  let t = { category: 'opening', recurrence: 'daily', start_time: '08:00', due_time: '09:00', brand_ids: [], assignments: [], active: 1 };
  let brands = [];
  try {
    [brands, t] = await Promise.all([api('/org/brands'), isNew ? t : api(`/templates/${params[0]}`)]);
  } catch (e) { return errorBox(el, e); }
  const reload = () => renderTemplateDetail(el, { params });

  const name = h('input', { type: 'text', value: t.name || '', maxlength: 120, required: true });
  const category = select(Object.entries(CATEGORY_LABEL), t.category);
  const instructions = h('textarea', { value: t.instructions || '' });
  const crit = h('input', { type: 'checkbox', checked: !!t.is_critical });
  const photo = h('input', { type: 'checkbox', checked: !!t.requires_photo });
  const verif = h('input', { type: 'checkbox', checked: !!t.requires_verification });
  const role = select([['', '— pilih saat menugaskan —'], ...roleOptions()], t.default_assignee_role);
  const dshift = select([['', 'Tanpa shift (semua shift)'], [1, 'Shift 1'], [2, 'Shift 2']], t.default_shift_no);
  const sop = h('textarea', { value: t.sop_text || '', placeholder: 'Langkah-langkah SOP (opsional)' });
  const refUrl = h('input', { type: 'url', value: t.reference_url || '', placeholder: 'https://… (opsional)' });
  const sched = scheduleFields(t);
  const brandSet = new Set(t.brand_ids);
  const brandBox = h('div', {}, brands.map((b) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: b.id, checked: brandSet.has(b.id) }), b.name)));

  const save = async () => {
    const body = {
      name: name.value, category: category.value, instructions: instructions.value, is_critical: crit.checked,
      requires_photo: photo.checked, requires_verification: verif.checked, default_assignee_role: role.value || null,
      default_shift_no: dshift.value ? Number(dshift.value) : null,
      sop_text: sop.value, reference_url: refUrl.value,
      brand_ids: [...brandBox.querySelectorAll('input:checked')].map((i) => Number(i.value)), ...sched.value(),
    };
    try {
      const r = await api(isNew ? '/templates' : `/templates/${t.id}`, { method: isNew ? 'POST' : 'PUT', body });
      toast('Template disimpan.');
      if (isNew) location.hash = `#/kelola/library/${r.id}`; else reload();
    } catch (e) { toast(e.message); }
  };

  const refInput = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async (e) => {
    const fd = new FormData();
    fd.append('image', e.target.files[0]);
    try { await api(`/templates/${t.id}/reference-image`, { method: 'POST', form: fd }); toast('Gambar referensi disimpan.'); reload(); } catch (err) { toast(err.message); }
  } });

  mount(el, 
    h('a', { href: '#/kelola/library', class: 'small' }, '‹ Task Library'),
    h('h1', {}, isNew ? 'Template baru' : t.name),
    !isNew && !t.active ? h('div', { class: 'notice warn', style: { marginBottom: '10px' } }, 'Template nonaktif — tidak ada tugas baru yang dibuat.') : null,
    h('div', { class: 'card' },
      field('Nama tugas', name),
      field('Kategori', category),
      field('Instruksi', instructions),
      h('label', { class: 'check' }, photo, 'Wajib foto bukti'),
      h('label', { class: 'check' }, verif, 'Perlu verifikasi atasan'),
      h('label', { class: 'check' }, crit, 'Tugas kritis (keamanan pangan / keamanan) — eskalasi lebih ketat'),
      h('h2', {}, 'Jadwal & deadline default'), sched.el,
      field('Penanggung jawab default', role),
      field('Shift default', dshift, 'Mis. Opening → Shift 1, Closing → Shift 2.'),
      h('h2', {}, 'Berlaku untuk brand'), h('div', { class: 'small muted' }, 'Kosongkan = boleh dipakai semua brand.'), brandBox,
      h('h2', {}, 'SOP / referensi'), field('Teks SOP', sop), field('Link dokumen SOP', refUrl),
      !isNew ? h('div', { class: 'row wrap', style: { marginBottom: '12px' } },
        t.has_reference_image ? h('img', { src: `/api/templates/${t.id}/reference-image?v=${Date.now()}`, alt: 'Referensi', style: { width: '96px', height: '96px', objectFit: 'cover', borderRadius: '10px' } }) : null,
        refInput, h('button', { class: 'btn', onclick: () => refInput.click() }, t.has_reference_image ? 'Ganti gambar contoh' : '+ Gambar contoh hasil'),
        t.has_reference_image ? h('button', { class: 'btn ghost', onclick: async () => { await api(`/templates/${t.id}/reference-image`, { method: 'DELETE' }); reload(); } }, 'Hapus') : null) : null,
      h('button', { class: 'btn primary big block', onclick: save }, 'Simpan template'),
      !isNew ? h('button', { class: 'btn block', style: { marginTop: '8px' }, onclick: async () => {
        if (t.active && !(await confirmSheet('Nonaktifkan template?', 'Tugas yang belum lewat deadline dari template ini akan dihapus dari checklist. Riwayat tetap tersimpan.', 'Nonaktifkan'))) return;
        await api(`/templates/${t.id}/active`, { method: 'POST', body: { active: !t.active } });
        toast(t.active ? 'Template dinonaktifkan.' : 'Template diaktifkan.');
        reload();
      } }, t.active ? 'Nonaktifkan template' : 'Aktifkan template') : null),
    !isNew ? [
      h('div', { class: 'row', style: { marginTop: '20px' } }, h('h2', { class: 'grow', style: { margin: 0 } }, `Penugasan outlet (${t.assignments.length})`),
        t.active ? h('button', { class: 'btn primary', onclick: () => assignSheet(t, null, reload) }, '+ Tugaskan ke outlet') : null),
      h('div', { class: 'card', style: { marginTop: '8px' } }, t.assignments.length ? t.assignments.map((a) => {
        const s = a.schedules.find((x) => x.active) || a.schedules.at(-1);
        const who = (a.assignee_type === 'user' ? `👤 ${a.assignee_user_name} (individu)` : a.assignee_type === 'team' ? `👥 Tim ${a.assignee_team} (bersama)`
          : a.assignee_type === 'shift' ? '👥 Semua karyawan (bersama)' : `👥 Semua ${a.assignee_role_name} (bersama)`) + (a.shift_no ? ` · Shift ${a.shift_no}` : '');
        return h('div', { class: 'list-row', style: { opacity: a.active ? 1 : 0.55 } },
          h('div', { class: 'grow' }, h('b', {}, a.outlet_name), h('div', { class: 'small muted' }, who), h('div', { class: 'small muted' }, scheduleSummary(s))),
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => assignSheet(t, a, reload) }, 'Ubah'),
            h('button', { class: 'btn ghost', onclick: async () => {
              await api(`/assignments/${a.id}/active`, { method: 'POST', body: { active: !a.active } });
              toast(a.active ? 'Penugasan dihentikan.' : 'Penugasan diaktifkan.');
              reload();
            } }, a.active ? 'Stop' : 'Aktifkan')));
      }) : h('div', { class: 'empty' }, 'Belum ditugaskan ke outlet mana pun.'))] : null);
}

async function assignSheet(t, existing, onDone) {
  let outlets;
  try { outlets = await api('/org/outlets'); } catch (e) { return toast(e.message); }
  outlets = outlets.filter((o) => o.active && (!t.brand_ids.length || t.brand_ids.includes(o.brand_id)));
  const outletBox = h('div', {}, outlets.map((o) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', value: o.id, checked: existing ? existing.outlet_id === o.id : false, disabled: !!existing }), `${o.name}`, h('span', { class: 'muted small' }, ` · ${o.brand_name}`))));
  const type = select([['role', 'Semua karyawan dengan peran tertentu (bersama)'], ['team', 'Tim / area tertentu (bersama)'], ['shift', 'Semua karyawan di shift tertentu (bersama)'], ['user', 'Karyawan tertentu (individu)']], existing?.assignee_type || 'role');
  const shift = select([['', 'Tanpa shift (semua shift)'], [1, 'Shift 1'], [2, 'Shift 2']], existing ? existing.shift_no : t.default_shift_no);
  const role = select(roleOptions(), existing?.assignee_role || t.default_assignee_role || 'crew');
  const team = h('input', { type: 'text', value: existing?.assignee_team || '', placeholder: 'mis. Dapur, Bar, Shift Pagi', list: 'teamList' });
  const teamList = h('datalist', { id: 'teamList' });
  const user = h('select', {});
  const roleWrap = field('Peran', role);
  const teamWrap = field('Nama tim', h('div', {}, team, teamList), 'Harus sama dengan nama tim pada data karyawan.');
  const userWrap = field('Karyawan', user, 'Pilih tepat satu outlet untuk penugasan individu.');
  const useDefault = h('input', { type: 'checkbox', checked: !existing });
  const sched = scheduleFields(existing ? existing.schedules.find((x) => x.active) || existing.schedules.at(-1) : t);
  const selectedOutlets = () => [...outletBox.querySelectorAll('input:checked')].map((i) => Number(i.value));

  const refreshPeople = async () => {
    const ids = selectedOutlets();
    if (ids.length !== 1) { user.replaceChildren(h('option', { value: '' }, '— pilih satu outlet dulu —')); teamList.replaceChildren(); return; }
    const [users, teams] = await Promise.all([api(`/org/users?outlet_id=${ids[0]}`), api(`/org/outlets/${ids[0]}/teams`)]);
    user.replaceChildren(...users.filter((u) => u.active).map((u) => h('option', { value: u.id, selected: existing?.assignee_user_id === u.id }, `${u.name} — ${u.role_name}`)));
    teamList.replaceChildren(...teams.map((x) => h('option', { value: x })));
  };
  const sync = () => {
    roleWrap.hidden = type.value !== 'role';
    teamWrap.hidden = type.value !== 'team';
    userWrap.hidden = type.value !== 'user';
    sched.el.hidden = useDefault.checked;
  };
  type.addEventListener('change', sync);
  useDefault.addEventListener('change', sync);
  outletBox.addEventListener('change', refreshPeople);
  sync();
  refreshPeople();

  const s = sheet(existing ? `Ubah penugasan · ${existing.outlet_name}` : `Tugaskan: ${t.name}`, h('div', {},
    h('h2', {}, 'Outlet'), outlets.length ? outletBox : h('div', { class: 'notice warn' }, 'Tidak ada outlet aktif yang sesuai brand template.'),
    h('h2', {}, 'Penanggung jawab'), field('Jenis', type), roleWrap, teamWrap, userWrap,
    field('Shift', shift, 'Tugas peran/tim bershift hanya untuk karyawan di shift itu. Jika belum selesai saat shift berakhir, tugas dioper ke shift berikutnya.'),
    h('h2', {}, 'Jadwal'), h('label', { class: 'check' }, useDefault, 'Pakai jadwal default template'), sched.el,
    h('button', { class: 'btn primary big block', onclick: async () => {
      const body = {
        assignee_type: type.value, assignee_role: role.value, shift_no: shift.value ? Number(shift.value) : null, assignee_team: team.value, assignee_user_id: user.value ? Number(user.value) : null,
        schedule: useDefault.checked ? undefined : sched.value(),
      };
      try {
        if (existing) await api(`/assignments/${existing.id}`, { method: 'PUT', body });
        else await api('/assignments', { method: 'POST', body: { ...body, template_id: t.id, outlet_ids: selectedOutlets() } });
        s.close();
        toast('Penugasan disimpan. Tugas muncul di checklist outlet sesuai jadwal.');
        onDone();
      } catch (e) { toast(e.message); }
    } }, 'Simpan penugasan')));
}
