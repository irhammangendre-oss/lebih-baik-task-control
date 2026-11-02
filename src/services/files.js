'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../config');
const { bad } = require('../errors');

/** Validasi berdasarkan isi file (magic bytes), bukan hanya ekstensi/mime dari klien. */
function sniffImage(buf) {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: '.jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: '.png' };
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { mime: 'image/webp', ext: '.webp' };
  if (buf.toString('ascii', 4, 8) === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(buf.toString('ascii', 8, 12))) return { mime: 'image/heic', ext: '.heic' };
  return null;
}

/** Simpan file gambar (dari multer memoryStorage) ke folder privat. Mengembalikan metadata. */
function storeImages(files, subdir = 'evidence') {
  const dir = path.join(config.uploadDir, subdir);
  fs.mkdirSync(dir, { recursive: true });
  const typed = (files || []).map((f) => {
    const t = sniffImage(f.buffer);
    if (!t) throw bad('File harus berupa foto (JPG, PNG, WEBP, atau HEIC).');
    return { f, t };
  });
  const stored = [];
  try {
    for (const { f, t } of typed) {
      const name = `${crypto.randomUUID()}${t.ext}`;
      fs.writeFileSync(path.join(dir, name), f.buffer, { flag: 'wx', mode: 0o600 });
      stored.push({
        stored_name: `${subdir}/${name}`, original_name: f.originalname ? String(f.originalname).slice(0, 200) : null,
        mime_type: t.mime, size_bytes: f.buffer.length, sha256: crypto.createHash('sha256').update(f.buffer).digest('hex'),
      });
    }
  } catch (e) {
    removeFiles(stored);
    throw e;
  }
  return stored;
}

function removeFiles(stored) {
  for (const s of stored) fs.rmSync(path.join(config.uploadDir, s.stored_name), { force: true });
}

function absolutePath(storedName) {
  const base = path.resolve(config.uploadDir);
  const p = path.resolve(base, storedName);
  if (!p.startsWith(base + path.sep)) throw bad('Path tidak valid.');
  return p;
}

module.exports = { storeImages, removeFiles, absolutePath, sniffImage };
