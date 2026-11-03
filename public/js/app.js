import { api } from './api.js';
import { h, clear, sheet, toast, fmtDateTime, mount } from './ui.js';
import { state, can, canAny } from './state.js';
import { renderMyTasks } from './views/tasks.js';
import { renderChecklist } from './views/checklist.js';
import { renderMonitoring, renderOutletDetail } from './views/monitoring.js';
import { renderTemplates, renderTemplateDetail } from './views/library.js';
import { renderOrg } from './views/org.js';
import { renderEscalation, renderRoles, renderAudit, renderAccount } from './views/settings.js';
import { openInstance } from './views/instance.js';
import { renderHandovers } from './views/handover.js';
import { renderShiftAdmin } from './views/shiftadmin.js';

const view = document.getElementById('view');

const routes = [
  { re: /^\/tugas$/, tab: 'tugas', render: renderMyTasks },
  { re: /^\/checklist$/, tab: 'checklist', render: renderChecklist, perm: ['checklist.view'] },
  { re: /^\/serah-terima$/, tab: 'checklist', render: renderHandovers, perm: ['checklist.view', 'handover.create'] },
  { re: /^\/kelola\/shift$/, render: renderShiftAdmin, perm: ['shift.manage'] },
  { re: /^\/monitoring$/, tab: 'monitoring', render: renderMonitoring, perm: ['monitor.team', 'monitor.outlet', 'monitor.multi', 'monitor.all'] },
  { re: /^\/monitoring\/outlet\/(\d+)$/, tab: 'monitoring', render: renderOutletDetail, perm: ['monitor.team', 'monitor.outlet', 'monitor.multi', 'monitor.all'] },
  { re: /^\/kelola\/library$/, render: renderTemplates, perm: ['template.manage'] },
  { re: /^\/kelola\/library\/(new|\d+)$/, render: renderTemplateDetail, perm: ['template.manage'] },
  { re: /^\/kelola\/organisasi$/, render: renderOrg, perm: ['org.manage'] },
  { re: /^\/kelola\/eskalasi$/, render: renderEscalation, perm: ['escalation.manage'] },
  { re: /^\/kelola\/peran$/, render: renderRoles, perm: ['role.manage'] },
  { re: /^\/kelola\/audit$/, render: renderAudit, perm: ['audit.view'] },
  { re: /^\/akun$/, render: renderAccount },
];

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/tugas';
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

async function route() {
  if (!state.me) return renderLogin();
  document.querySelectorAll('.sheet-backdrop').forEach((s) => s.remove());
  document.body.style.overflow = '';
  const { path, query } = parseHash();
  const r = routes.find((x) => x.re.test(path));
  if (!r || (r.perm && !canAny(...r.perm))) { location.hash = '#/tugas'; return; }
  document.querySelectorAll('.bottomnav a').forEach((a) => a.classList.toggle('active', a.dataset.tab === r.tab));
  window.scrollTo(0, 0);
  const params = path.match(r.re).slice(1);
  await r.render(view, { params, query });
}

const notifOn = () => !!state.me?.features?.notifications;

function setChrome(loggedIn) {
  document.getElementById('topbar').hidden = !loggedIn;
  document.getElementById('bellBtn').hidden = !loggedIn || !notifOn();
  document.getElementById('bottomnav').hidden = !loggedIn;
  if (loggedIn) {
    const mon = document.querySelector('[data-tab=monitoring]');
    mon.hidden = !state.me.monitor_level;
    document.querySelector('[data-tab=checklist]').hidden = !can('checklist.view');
  }
}

function renderLogin() {
  setChrome(false);
  let saved = '';
  try { saved = localStorage.getItem('lb_username') || ''; } catch { /* abaikan */ }
  const user = h('input', { type: 'text', autocomplete: 'username', autocapitalize: 'none', required: true, value: saved });
  // PIN 6 angka -> keypad angka; password biasa tetap bisa diketik.
  const pass = h('input', { type: 'password', autocomplete: 'current-password', required: true, inputmode: saved ? 'numeric' : null, placeholder: 'PIN 6 angka atau password' });
  const kb = h('button', { type: 'button', class: 'btn ghost small', style: { minHeight: '32px', padding: '4px 8px' }, onclick: () => {
    pass.inputMode = pass.inputMode === 'numeric' ? 'text' : 'numeric'; kb.textContent = pass.inputMode === 'numeric' ? 'Pakai password' : 'Pakai PIN'; pass.focus();
  } }, saved ? 'Pakai password' : 'Pakai PIN');
  const btn = h('button', { class: 'btn primary big block', type: 'submit' }, 'Masuk');
  const form = h('form', { class: 'card login', onsubmit: async (e) => {
    e.preventDefault();
    btn.disabled = true;
    try {
      state.me = await api('/auth/login', { method: 'POST', body: { username: user.value, password: pass.value } });
      try { localStorage.setItem('lb_username', user.value.trim()); } catch { /* abaikan */ }
      start();
    } catch (err) { toast(err.message); } finally { btn.disabled = false; }
  } },
  h('div', { class: 'row' }, h('span', { class: 'logo' }, 'LB'), h('div', {}, h('div', { class: 'task-title' }, 'Lebih Baik'), h('div', { class: 'muted small' }, 'Task Control Outlet'))),
  h('div', { style: { height: '16px' } }),
  h('label', { class: 'field' }, h('span', {}, 'Username'), user),
  h('label', { class: 'field' }, h('span', { class: 'row' }, h('span', { class: 'grow' }, 'PIN / Password'), kb), pass),
  btn);
  mount(view, form);
  (saved ? pass : user).focus();
}

function openMenu() {
  const item = (href, icon, label, show = true) => (show ? h('a', { href, onclick: () => s.close() }, h('span', {}, icon), label) : null);
  const s = sheet('Menu', h('div', {},
    h('div', { class: 'card', style: { marginBottom: '12px' } },
      h('div', { class: 'task-title' }, state.me.name),
      h('div', { class: 'muted small' }, `${state.me.role_name} · ${state.me.outlets.map((o) => o.outlet_name).join(', ') || 'Belum ditempatkan di outlet'}`)),
    h('nav', { class: 'menu-list' },
      item('#/serah-terima', '📝', 'Serah Terima Shift', canAny('checklist.view', 'handover.create')),
      item('#/kelola/shift', '🕒', 'Shift & Jadwal Karyawan', can('shift.manage')),
      item('#/kelola/library', '📚', 'Task Library & Penugasan', can('template.manage')),
      item('#/kelola/organisasi', '🏪', 'Brand, Outlet & Karyawan', can('org.manage')),
      item('#/kelola/eskalasi', '⏰', 'Aturan Eskalasi', can('escalation.manage')),
      item('#/kelola/peran', '🔐', 'Peran & Izin', can('role.manage')),
      item('#/kelola/audit', '🧾', 'Log Audit', can('audit.view')),
      item('#/akun', '👤', 'Akun Saya'),
      h('a', { href: '#', onclick: async (e) => { e.preventDefault(); await api('/auth/logout', { method: 'POST' }).catch(() => {}); state.me = null; s.close(); location.hash = '#/tugas'; route(); } }, h('span', {}, '🚪'), 'Keluar'))));
}

async function refreshBell() {
  if (!state.me || !notifOn()) return null;
  try {
    const n = await api('/notifications');
    const b = document.getElementById('bellBadge');
    b.hidden = !n.unread;
    b.textContent = n.unread > 99 ? '99+' : n.unread;
    return n;
  } catch { return null; }
}

async function openNotifications() {
  const n = await refreshBell();
  if (!n) return;
  const list = n.items.length ? n.items.map((it) => h('div', { class: 'list-row', onclick: () => { if (it.instance_id) { s.close(); openInstance(it.instance_id, { onChange: route }); } } },
    h('div', { class: 'grow' },
      h('div', { style: { fontWeight: it.read_at ? '400' : '700' } }, it.message),
      h('div', { class: 'small muted' }, fmtDateTime(it.created_at), it.stage ? ` · Tahap ${it.stage}` : '')))) : h('div', { class: 'empty' }, 'Belum ada notifikasi.');
  const s = sheet('Notifikasi', h('div', {},
    n.unread ? h('button', { class: 'btn block', onclick: async () => { await api('/notifications/read-all', { method: 'POST' }); s.close(); refreshBell(); } }, 'Tandai semua sudah dibaca') : null,
    h('div', {}, list)));
}

function start() {
  setChrome(true);
  if (!location.hash) location.hash = '#/tugas';
  route();
  refreshBell();
}

document.getElementById('menuBtn').addEventListener('click', openMenu);
document.getElementById('bellBtn').addEventListener('click', openNotifications);
window.addEventListener('hashchange', route);
window.addEventListener('lb:unauthorized', () => { if (state.me) { state.me = null; toast('Sesi berakhir, silakan login kembali.'); route(); } });
window.addEventListener('lb:refresh-bell', refreshBell);
setInterval(refreshBell, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshBell(); });

(async () => {
  try { state.me = await api('/me'); start(); } catch { renderLogin(); }
})();
