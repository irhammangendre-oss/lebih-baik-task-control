// Helper DOM kecil + komponen UI bersama.
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'multiple' || k === 'required') el[k] = !!v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el) => { el.replaceChildren(); return el; };

let toastTimer;
export function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

/** Bottom sheet (modal). Mengembalikan { el, close }. */
export function sheet(title, body, { onClose } = {}) {
  const root = document.getElementById('sheetRoot');
  const close = () => { backdrop.remove(); document.body.style.overflow = ''; onClose && onClose(); };
  const panel = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h3', {}, title), h('button', { class: 'icon-btn', 'aria-label': 'Tutup', onclick: close }, '✕')),
    body);
  const backdrop = h('div', { class: 'sheet-backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, panel);
  root.append(backdrop);
  document.body.style.overflow = 'hidden';
  return { el: panel, close };
}

/** Prompt alasan (wajib) dalam sheet. Resolve string atau null jika dibatalkan. */
export function askReason(title, { label = 'Alasan', confirmText = 'Kirim', danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const ta = h('textarea', { required: true, placeholder: 'Tulis alasan / apa yang perlu diperbaiki…' });
    const s = sheet(title, h('div', {},
      h('label', { class: 'field' }, h('span', {}, label), ta),
      h('button', { class: `btn big block ${danger ? 'danger' : 'primary'}`, onclick: () => {
        if (!ta.value.trim()) { ta.focus(); toast('Alasan wajib diisi.'); return; }
        done = true; s.close(); resolve(ta.value.trim());
      } }, confirmText)), { onClose: () => { if (!done) resolve(null); } });
    setTimeout(() => ta.focus(), 50);
  });
}

export function confirmSheet(title, message, confirmText = 'Ya, lanjutkan') {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet(title, h('div', {}, h('p', {}, message),
      h('button', { class: 'btn big block primary', onclick: () => { done = true; s.close(); resolve(true); } }, confirmText)),
    { onClose: () => { if (!done) resolve(false); } });
  });
}

export const STATUS_LABEL = {
  belum: 'Belum Dikerjakan', dikerjakan: 'Dikerjakan', menunggu_verifikasi: 'Menunggu Verifikasi',
  terverifikasi: 'Terverifikasi', perlu_perbaikan: 'Perlu Perbaikan', terlambat: 'Terlambat',
};
export const CATEGORY_LABEL = { opening: 'Opening', operasional: 'Operasional', closing: 'Closing' };

export function statusChip(t) {
  const s = t.effective_status || t.status;
  const label = s === 'terlambat' && t.status === 'perlu_perbaikan' ? 'Terlambat · Perlu Perbaikan' : STATUS_LABEL[s];
  return h('span', { class: `chip s-${s}` }, label);
}
export function lateChip(t) {
  return t.was_late && t.status !== 'belum' ? h('span', { class: 'chip s-terlambat' }, 'Selesai terlambat') : null;
}

const fmtCache = new Map();
function fmtr(tz, opts) {
  const k = tz + JSON.stringify(opts);
  if (!fmtCache.has(k)) fmtCache.set(k, new Intl.DateTimeFormat('id-ID', { timeZone: tz || 'Asia/Jakarta', ...opts }));
  return fmtCache.get(k);
}
export const fmtTime = (iso, tz) => (iso ? fmtr(tz, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '-');
export const fmtDateTime = (iso, tz) => (iso ? fmtr(tz, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : '-');
export const fmtDate = (d) => (d ? new Intl.DateTimeFormat('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`)) : '');
export function todayIn(tz = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
/** Deadline singkat: "09:00" atau "Kemarin 23:00". */
export function fmtDue(t) {
  const today = todayIn(t.timezone);
  const due = fmtr(t.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t.due_at)).split('/').reverse().join('-');
  return due === today ? fmtTime(t.due_at, t.timezone) : fmtDateTime(t.due_at, t.timezone);
}

export function lightbox(src) {
  const lb = h('div', { class: 'lightbox', onclick: () => lb.remove() }, h('img', { src, alt: 'Foto bukti' }));
  document.body.append(lb);
}

export function loading(el) { clear(el).append(h('div', { class: 'empty' }, 'Memuat…')); }
export function errorBox(el, err, retry) {
  clear(el).append(h('div', { class: 'empty' }, h('p', {}, err.message || 'Terjadi kesalahan.'),
    retry ? h('button', { class: 'btn', onclick: retry }, 'Coba lagi') : null));
}

/** Kompres foto di perangkat (maks 1600px, JPEG) agar upload cepat di jaringan seluler. */
export async function compressImage(file, max = 1600, quality = 0.8) {
  if (!file.type.startsWith('image/') || file.type === 'image/heic') return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob && blob.size < file.size ? new File([blob], 'foto.jpg', { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, h('span', {}, label), input, hint ? h('div', { class: 'small muted' }, hint) : null);
}
export function select(options, value, attrs = {}) {
  return h('select', attrs, options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value ?? '') }, l)));
}
/** Ganti isi elemen dengan children (array bersarang & null diizinkan). */
export function mount(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}
