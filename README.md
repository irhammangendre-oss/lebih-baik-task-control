# Lebih Baik Task Control

Aplikasi checklist tugas operasional outlet F&B (multi-brand), mobile-first, berbahasa Indonesia.

- **Tugas Saya**: tugas individu dan tugas bersama tim/peran, dengan satu tombol besar **"Selesaikan Tugas"** (wajib foto jika dikonfigurasi).
- **Checklist Outlet**: Opening / Operasional / Closing per outlet & tanggal, termasuk tugas berulang (mis. inspeksi toilet tiap jam).
- **Monitoring**: isinya menyesuaikan izin (PIC → area/shift, Head → outlet + verifikasi, SPV → outlet yang diawasi + tugas sering terlewat, Management → semua brand/outlet + perbandingan + masalah berulang).
- Menu ☰ (khusus yang berizin): Task Library & Penugasan, Brand/Outlet/Karyawan, Aturan Eskalasi, Peran & Izin, Log Audit.

## Teknologi

| Bagian | Pilihan | Alasan |
|---|---|---|
| Server | Node.js ≥ 22.13 + Express 5 | sederhana, satu proses |
| Database | SQLite bawaan Node (`node:sqlite`), mode WAL | tanpa server DB terpisah & tanpa kompilasi native |
| Frontend | HTML/CSS/JS modul (tanpa build step) | cepat dimuat di HP, mudah dirawat |
| Job terjadwal | interval internal tiap 60 dtk **atau** `npm run jobs` via cron | tanpa infrastruktur tambahan |

> Proyek awal kosong, jadi tidak ada framework/DB/auth lama yang dapat dipakai ulang. Semua query ada di satu lapisan (`src/db.js` + service), sehingga pindah ke PostgreSQL nanti cukup mengganti lapisan tersebut.

## Menjalankan (lokal)

```bash
npm install
```

```bash
npm run seed:demo
```

```bash
npm start
```

Buka `http://localhost:3000`. Akun demo (password **demo1234**):

| Username | Peran | Outlet |
|---|---|---|
| `admin` | Management / Admin | semua |
| `spv` | SPV | Demo Kopi Kemang & Depok |
| `spv2` | SPV | Demo Bakmi Tebet |
| `head`, `head2`, `head3` | Head / Store Leader | Kemang, Depok, Tebet |
| `pic` (tim Bar), `pic2` (tim Dapur) | PIC | Kemang |
| `crew` (Bar), `crew2` (Dapur), `kasir` | Crew / Kasir | Kemang |
| `crew3`, `crew4` | Crew | Depok, Tebet |

Untuk produksi **jangan** pakai `seed:demo`. Jalankan `npm run seed` (atau langsung `npm start`) — akun `admin` dibuat dengan password dari `ADMIN_PASSWORD`, atau password acak yang dicetak sekali di log. Starter Task Library (14 template F&B) ikut dibuat, **tanpa** ditugaskan ke outlet mana pun.

## Konfigurasi (environment variable)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | |
| `NODE_ENV` | – | set `production` agar cookie sesi `Secure` (wajib HTTPS) |
| `DB_PATH` | `data/app.db` | file database SQLite |
| `UPLOAD_DIR` | `data/uploads` | foto bukti & gambar referensi (privat, di luar folder publik) |
| `ADMIN_PASSWORD` | acak | password admin pertama |
| `JOB_INTERVAL_SECONDS` | `60` | interval generate tugas + eskalasi; `0` = matikan (pakai cron) |
| `NOTIFY_WEBHOOK_URL` | – | opsional: setiap notifikasi baru di-POST (JSON) ke URL ini, mis. gateway WhatsApp/Telegram |
| `MAX_UPLOAD_MB` | `8` | ukuran maks per foto (foto dikompres di HP ke ±1600px sebelum upload) |
| `SESSION_DAYS` | `14` | umur sesi login |

## Deployment (langkah yang perlu Anda lakukan)

1. Siapkan VPS/VM kecil (1 vCPU / 1 GB cukup untuk puluhan outlet) dengan Node.js 22.13+.
2. Salin kode, jalankan `npm ci --omit=dev`, set `NODE_ENV=production`, `ADMIN_PASSWORD`, `DB_PATH`, `UPLOAD_DIR` (di disk persisten).
3. Jalankan sebagai service (systemd/pm2) dengan `npm start`. **Jalankan satu proses saja** (SQLite + scheduler internal).
4. Pasang reverse proxy HTTPS (Caddy/Nginx). HTTPS **wajib** agar kamera HP & cookie aman berfungsi.
5. **Backup harian** `DB_PATH` (pakai `sqlite3 app.db ".backup backup.db"`) dan folder `UPLOAD_DIR`.
6. Opsional: jika ingin job lewat cron alih-alih interval internal, set `JOB_INTERVAL_SECONDS=0` lalu:
   ```
   * * * * * cd /opt/lebih-baik && DB_PATH=... UPLOAD_DIR=... npm run jobs >> jobs.log 2>&1
   ```
7. Notifikasi saat ini **in-app** (ikon 🔔). Untuk WhatsApp/Telegram, isi `NOTIFY_WEBHOOK_URL` dengan endpoint gateway pilihan Anda (perlu akun provider — keputusan Anda).

Contoh unit systemd:

```ini
[Service]
WorkingDirectory=/opt/lebih-baik
Environment=NODE_ENV=production PORT=3000 DB_PATH=/var/lib/lebih-baik/app.db UPLOAD_DIR=/var/lib/lebih-baik/uploads
ExecStart=/usr/bin/npm start
Restart=always
User=lebihbaik
```

## Alur penggunaan (MVP)

1. **Admin** → ☰ Task Library → buat/ubah template (instruksi, kategori, brand yang berlaku, jadwal & deadline default, penanggung jawab default, wajib foto, perlu verifikasi, kritis, SOP/link/gambar contoh).
2. Buka template → **Tugaskan ke outlet**: pilih outlet, penanggung jawab (peran = tugas bersama, tim/area = tugas bersama, karyawan = tugas individu), jadwal default atau khusus.
3. Scheduler membuat kejadian tugas untuk hari ini → muncul di **Checklist Outlet** & **Tugas Saya**.
4. Karyawan menekan **Selesaikan Tugas** (ambil foto bila wajib). Sistem mencatat siapa & kapan, serta terlambat atau tidak.
5. Tugas yang perlu verifikasi muncul di **Monitoring → Menunggu verifikasi** untuk Head/SPV → Setujui atau Tolak (alasan wajib) → karyawan memperbaiki & kirim ulang.
6. Tugas terlambat dieskalasi sesuai aturan (☰ Aturan Eskalasi).

## Aturan bisnis penting

- **Status**: Belum Dikerjakan, Dikerjakan, Menunggu Verifikasi, Terverifikasi, Perlu Perbaikan; **Terlambat** = belum selesai & lewat deadline (dihitung otomatis). Tugas yang diselesaikan terlambat tidak lagi muncul sebagai "belum selesai", tetapi tetap ditandai **Selesai terlambat** (`was_late`) di laporan.
- **Tugas bersama** cukup diselesaikan sekali per kejadian; anggota lain mendapat pesan "sudah diselesaikan oleh …" (dicegah juga di level database).
- **Foto wajib** ditegakkan di server (bukan hanya UI); file divalidasi dari isinya (JPG/PNG/WEBP/HEIC), maks 3 foto.
- Tugas tidak bisa diselesaikan **sebelum jam mulainya** (agar inspeksi per jam tidak dikerjakan sekaligus).
- Verifikator tidak bisa memverifikasi pekerjaannya sendiri. PIC hanya bisa membuka ulang tugas di area/shift-nya.
- **Eskalasi** (dapat diatur, aturan terpisah untuk tugas kritis):
  - Tahap 1: terlambat ≥ X menit → karyawan yang ditugaskan + PIC (tim yang sama) + atasan langsungnya.
  - Tahap 2: terlambat ≥ Y menit → Head outlet.
  - Tahap 3: terlambat ≥ Z menit **atau** tugas yang sama sudah terlewat ≥ N kali dalam D hari → SPV outlet.
  - Tahap 4: Management melihat **Masalah berulang** di Monitoring.
  - Default: biasa 0/60/240 menit, ambang 3x/7 hari; kritis 0/15/60 menit, ambang 2x/7 hari. Setiap tahap hanya dikirim **sekali** per tugas per orang.
- **Peran & izin** dapat diubah per peran (☰ Peran & Izin). Kasir **tidak** otomatis membawahi Crew; hubungan atasan diatur per karyawan ("Melapor ke").
- **Otorisasi di backend**: setiap endpoint memeriksa izin + outlet. Data outlet lain dibalas 404 (keberadaannya tidak bocor).
- Template/penugasan **dinonaktifkan**, tidak dihapus. Menghentikan penugasan hanya menghapus kejadian yang belum jatuh tempo & belum dikerjakan; histori tetap ada.
- Semua angka dashboard dihitung dari record database.

## Keamanan

Password di-hash scrypt; sesi berupa token acak (disimpan sebagai hash) di cookie HttpOnly/SameSite=Lax; proteksi CSRF via header wajib `X-Requested-With`; pembatasan percobaan login; CSP ketat; foto disajikan hanya melalui endpoint terotorisasi; pencegahan eskalasi hak akses (non-Management tidak bisa membuat/mengubah user setingkat atau di atasnya); audit log untuk login, template, penugasan, penyelesaian, verifikasi, perubahan user/izin/eskalasi.

## Struktur kode

```
src/
  schema.sql            skema & constraint database
  db.js                 koneksi SQLite + transaksi
  auth.js, access.js    autentikasi, izin, cakupan outlet/tim
  services/             scheduler, escalation, tasks, notify, files, audit, jobs
  routes/               auth, tasks (Tugas Saya/Checklist/aksi), monitoring, library, org, admin
  seed.js               data dasar + data demo; starter-templates.js
public/                 SPA mobile (js/views/*)
test/                   node:test + supertest
```

## Pengujian

```bash
npm test
```

22 tes otomatis, termasuk alur penerimaan lengkap (template → penugasan → checklist → penyelesaian + foto wajib → verifikasi tolak/setujui → eskalasi bertahap tanpa duplikasi → monitoring per peran → histori → isolasi data antar outlet), serta tes izin tim/PIC, tugas individu, aturan kritis, ambang pengulangan, CSRF/sesi, pencegahan eskalasi hak akses, dan idempotensi pembuatan tugas.

## Batasan MVP & pengembangan berikutnya

- SQLite cocok untuk satu server; untuk banyak instance/skala besar pindahkan ke PostgreSQL.
- Notifikasi push/WhatsApp memerlukan provider eksternal (sudah ada hook webhook).
- Belum ada mode offline; aplikasi butuh koneksi saat mengirim tugas.
- Jika tugas dibuka ulang setelah deadline, tugas langsung berstatus Terlambat dan masuk eskalasi.
- Tidak termasuk (sesuai brief): analitik lanjutan, gamifikasi, rantai persetujuan bertingkat.
