// Kamera dalam aplikasi: foto hanya dari kamera langsung, lalu dicap nama, outlet, tanggal & jam.
import { h, toast } from './ui.js';

const MAX = 1600;
const MAX_AGE_MS = 10 * 60 * 1000; // fallback: foto harus diambil < 10 menit lalu

function stamp(canvas, lines) {
  const ctx = canvas.getContext('2d');
  const size = Math.max(16, Math.round(canvas.width * 0.03));
  const pad = Math.round(size * 0.6);
  const lh = Math.round(size * 1.3);
  const barH = pad * 2 + lh * lines.length;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, canvas.height - barH, canvas.width, barH);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = `${i === 0 ? '700' : '500'} ${size}px system-ui, sans-serif`;
    ctx.fillText(t, pad, canvas.height - barH + pad + i * lh, canvas.width - pad * 2);
  });
}

function draw(source, sw, sh, lines) {
  const scale = Math.min(1, MAX / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.round(sw * scale);
  c.height = Math.round(sh * scale);
  c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
  stamp(c, lines());
  return new Promise((r) => c.toBlob((b) => r(new File([b], `foto-${Date.now()}.jpg`, { type: 'image/jpeg' })), 'image/jpeg', 0.82));
}

/** Kamera langsung di dalam aplikasi (butuh HTTPS atau localhost). */
function liveCamera(lines) {
  return new Promise((resolve, reject) => {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 } }, audio: false }).then((stream) => {
      const video = h('video', { autoplay: true, playsinline: true, muted: true });
      video.srcObject = stream;
      const stop = () => { stream.getTracks().forEach((t) => t.stop()); overlay.remove(); };
      const shutter = h('button', { class: 'shutter', 'aria-label': 'Ambil foto', onclick: async () => {
        if (!video.videoWidth) return;
        shutter.disabled = true;
        const file = await draw(video, video.videoWidth, video.videoHeight, lines);
        stop();
        resolve(file);
      } });
      const overlay = h('div', { class: 'camera' }, video,
        h('div', { class: 'camera-bar' },
          h('button', { class: 'btn ghost cam-cancel', onclick: () => { stop(); resolve(null); } }, 'Batal'),
          shutter, h('span', { class: 'cam-cancel' })));
      document.body.append(overlay);
    }).catch(reject);
  });
}

/** Cadangan jika kamera langsung tidak tersedia: buka kamera HP, tolak foto lama dari galeri. */
function fallbackCamera(lines) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    input.addEventListener('change', async () => {
      const f = input.files[0];
      input.remove();
      if (!f) return resolve(null);
      if (Date.now() - f.lastModified > MAX_AGE_MS) {
        toast('Foto harus diambil langsung dari kamera, bukan foto lama dari galeri.');
        return resolve(null);
      }
      try {
        const bmp = await createImageBitmap(f);
        resolve(await draw(bmp, bmp.width, bmp.height, lines));
      } catch {
        toast('Foto tidak dapat dibaca. Coba ambil ulang.');
        resolve(null);
      }
    });
    document.body.append(input);
    input.click();
  });
}

/** Ambil satu foto bercap. lines() dipanggil saat foto diambil (agar jam akurat). */
export async function takeStampedPhoto(lines) {
  if (navigator.mediaDevices?.getUserMedia && window.isSecureContext) {
    try { return await liveCamera(lines); } catch (e) {
      if (e && e.name === 'NotAllowedError') { toast('Izinkan akses kamera di browser untuk mengambil foto.'); return null; }
    }
  }
  return fallbackCamera(lines);
}
