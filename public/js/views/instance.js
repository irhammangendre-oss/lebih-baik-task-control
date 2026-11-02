import { api } from '../api.js';
import { h, sheet, toast, statusChip, lateChip, fmtDateTime, fmtTime, fmtDue, CATEGORY_LABEL, lightbox, askReason, compressImage } from '../ui.js';

function notify() { window.dispatchEvent(new Event('lb:refresh-bell')); }

/** Satu aksi "Selesaikan Tugas": langsung kirim jika tanpa foto, atau buka form foto jika wajib foto. */
export async function completeFlow(t, onDone) {
  if (t.requires_photo) return openPhotoForm(t, onDone);
  try {
    const r = await api(`/instances/${t.id}/complete`, { method: 'POST', form: new FormData() });
    toast(r.status === 'menunggu_verifikasi' ? 'Terkirim. Menunggu verifikasi.' : 'Tugas selesai ✔');
    onDone && onDone(r);
  } catch (e) { toast(e.message); onDone && onDone(null); }
}

export function openPhotoForm(t, onDone) {
  const files = [];
  const previews = h('div', { class: 'photo-grid' });
  const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
  const note = h('textarea', { placeholder: 'Catatan (opsional)' });
  const submit = h('button', { class: 'btn primary big block', disabled: true }, 'Kirim & Selesaikan');
  const pick = h('button', { class: 'photo-pick', type: 'button', onclick: () => input.click() }, h('span', { style: { fontSize: '30px' } }, '📷'), 'Ambil / Unggah Foto');
  const refresh = () => {
    previews.replaceChildren(...files.map((f, i) => {
      const url = URL.createObjectURL(f);
      return h('div', { style: { position: 'relative' } }, h('img', { src: url, alt: `Foto ${i + 1}`, onclick: () => lightbox(url) }),
        h('button', { class: 'chip s-terlambat', style: { position: 'absolute', top: '4px', right: '4px' }, onclick: () => { files.splice(i, 1); refresh(); } }, '✕'));
    }));
    submit.disabled = files.length === 0;
    pick.hidden = files.length >= 3;
  };
  input.addEventListener('change', async () => {
    for (const f of input.files) if (files.length < 3) files.push(await compressImage(f));
    input.value = '';
    refresh();
  });
  submit.addEventListener('click', async () => {
    if (!files.length) return toast('Foto bukti wajib diunggah.');
    submit.disabled = true;
    submit.textContent = 'Mengirim…';
    const form = new FormData();
    files.forEach((f, i) => form.append('photos', f, f.name || `foto-${i + 1}.jpg`));
    if (note.value.trim()) form.append('note', note.value.trim());
    try {
      const r = await api(`/instances/${t.id}/complete`, { method: 'POST', form });
      s.close();
      toast(r.status === 'menunggu_verifikasi' ? 'Terkirim. Menunggu verifikasi.' : 'Tugas selesai ✔');
      onDone && onDone(r);
    } catch (e) {
      toast(e.message);
      submit.disabled = false;
      submit.textContent = 'Kirim & Selesaikan';
    }
  });
  const s = sheet(t.name, h('div', { class: 'stack' },
    h('div', { class: 'notice info' }, 'Tugas ini wajib foto bukti. Ambil foto hasil pekerjaan sebelum mengirim.'),
    t.instructions ? h('p', { class: 'small' }, t.instructions) : null,
    input, pick, previews, note, submit));
}

/** Detail tugas: info, instruksi/SOP, riwayat, bukti, dan aksi sesuai izin. */
export async function openInstance(id, { onChange } = {}) {
  let d;
  try { d = await api(`/instances/${id}`); } catch (e) { return toast(e.message); }
  const tz = d.timezone;
  const changed = () => { s.close(); notify(); onChange && onChange(); };
  const upcoming = d.scheduled_at > new Date().toISOString();

  const actions = [];
  if (d.can_complete) {
    actions.push(upcoming
      ? h('div', { class: 'notice info' }, `Tugas ini bisa dikerjakan mulai pukul ${fmtTime(d.scheduled_at, tz)}.`)
      : h('button', { class: 'btn primary big block', onclick: () => { s.close(); completeFlow(d, () => { notify(); onChange && onChange(); }); } },
        d.requires_photo ? '📷 Selesaikan Tugas' : '✔ Selesaikan Tugas'));
  }
  if (d.can_verify) {
    actions.push(h('div', { class: 'grid2' },
      h('button', { class: 'btn primary big', onclick: async () => {
        try { await api(`/instances/${d.id}/verify`, { method: 'POST', body: { decision: 'approve' } }); toast('Disetujui ✔'); changed(); } catch (e) { toast(e.message); }
      } }, 'Setujui'),
      h('button', { class: 'btn danger big', onclick: async () => {
        const reason = await askReason('Tolak & minta perbaikan', { confirmText: 'Tolak', danger: true });
        if (!reason) return;
        try { await api(`/instances/${d.id}/verify`, { method: 'POST', body: { decision: 'reject', reason } }); toast('Ditolak, dikembalikan untuk perbaikan.'); changed(); } catch (e) { toast(e.message); }
      } }, 'Tolak')));
  }
  if (d.can_reopen) {
    actions.push(h('button', { class: 'btn block', onclick: async () => {
      const reason = await askReason('Buka ulang tugas', { confirmText: 'Buka ulang' });
      if (!reason) return;
      try { await api(`/instances/${d.id}/reopen`, { method: 'POST', body: { reason } }); toast('Tugas dibuka ulang.'); changed(); } catch (e) { toast(e.message); }
    } }, '↺ Buka ulang (hasil kurang baik)'));
  }

  const history = [];
  for (const sub of d.submissions) {
    history.push(h('div', {},
      h('div', {}, h('b', {}, sub.submitted_by_name), ` mengirim · ${fmtDateTime(sub.submitted_at, tz)}`, sub.was_late ? h('span', { class: 'chip s-terlambat', style: { marginLeft: '6px' } }, 'Terlambat') : null),
      sub.note ? h('div', { class: 'muted' }, `“${sub.note}”`) : null,
      sub.evidence.length ? h('div', { class: 'photo-grid', style: { marginTop: '6px' } }, sub.evidence.map((e) => h('img', { src: e.url, alt: 'Foto bukti', loading: 'lazy', onclick: () => lightbox(e.url) }))) : null));
  }
  for (const v of d.verifications) {
    const label = { approved: 'menyetujui', rejected: 'menolak', reopened: 'membuka ulang' }[v.decision];
    history.push(h('div', {}, h('b', {}, v.verifier_name), ` ${label} · ${fmtDateTime(v.created_at, tz)}`, v.reason ? h('div', { class: 'muted' }, `Alasan: ${v.reason}`) : null));
  }

  const s = sheet(d.name, h('div', { class: 'stack' },
    h('div', { class: 'tags' }, statusChip(d), lateChip(d), d.is_critical ? h('span', { class: 'chip crit' }, 'Kritis') : null,
      d.requires_photo ? h('span', { class: 'chip photo' }, '📷 Wajib foto') : null,
      d.requires_verification ? h('span', { class: 'chip' }, 'Perlu verifikasi') : null),
    d.last_rejection ? h('div', { class: 'notice warn' }, h('b', {}, 'Perlu perbaikan: '), d.last_rejection.reason) : null,
    h('div', { class: 'meta' },
      'Outlet', h('b', {}, d.outlet_name),
      'Kategori', h('b', {}, CATEGORY_LABEL[d.category]),
      'Mulai', h('b', {}, fmtDateTime(d.scheduled_at, tz)),
      'Deadline', h('b', {}, fmtDue(d)),
      'Penanggung jawab', h('b', {}, d.assignee_label, d.mode === 'shared' ? ' (tugas bersama)' : ''),
      d.completed_by_name ? 'Dikerjakan oleh' : null, d.completed_by_name ? h('b', {}, `${d.completed_by_name} · ${fmtDateTime(d.completed_at, tz)}`) : null,
      d.verified_by_name ? 'Diverifikasi' : null, d.verified_by_name ? h('b', {}, `${d.verified_by_name} · ${fmtDateTime(d.verified_at, tz)}`) : null),
    ...actions,
    d.instructions ? h('div', {}, h('h2', {}, 'Instruksi'), h('p', { style: { whiteSpace: 'pre-wrap', margin: 0 } }, d.instructions)) : null,
    d.sop_text || d.reference_url || d.has_reference_image ? h('div', {}, h('h2', {}, 'SOP / Referensi'),
      d.sop_text ? h('p', { style: { whiteSpace: 'pre-wrap' } }, d.sop_text) : null,
      d.reference_url ? h('a', { href: d.reference_url, target: '_blank', rel: 'noopener' }, 'Buka dokumen SOP ↗') : null,
      d.has_reference_image ? h('div', { class: 'photo-grid' }, h('img', { src: `/api/templates/${d.template_id}/reference-image`, alt: 'Contoh hasil', onclick: () => lightbox(`/api/templates/${d.template_id}/reference-image`) })) : null) : null,
    history.length ? h('div', {}, h('h2', {}, 'Riwayat'), h('div', { class: 'timeline' }, history)) : null));
}
