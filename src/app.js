'use strict';
const path = require('node:path');
const express = require('express');
const multer = require('multer');
const config = require('./config');
const { authenticate, csrfGuard } = require('./auth');
const { HttpError } = require('./errors');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
    });
    next();
  });

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  const api = express.Router();
  api.use(express.json({ limit: '200kb' }));
  api.use(authenticate(db));
  api.use(csrfGuard);
  api.use(require('./routes/auth')(db));
  api.use(require('./routes/tasks')(db));
  api.use(require('./routes/monitoring')(db));
  api.use(require('./routes/org')(db));
  api.use(require('./routes/admin')(db));
  api.use(require('./routes/library')(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'Endpoint tidak ditemukan.')));
  app.use('/api', api);

  app.use(express.static(config.publicDir, { index: 'index.html', maxAge: 0 }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(config.publicDir, 'index.html')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    let status = err.status || err.statusCode || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? `Ukuran foto maksimal ${config.maxUploadMb} MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? 'Jumlah/jenis file tidak sesuai (maks. 3 foto).' : 'Upload gagal.';
    } else if (err.type === 'entity.parse.failed') {
      status = 400; message = 'Format data tidak valid.';
    } else if (status >= 500) {
      console.error(err);
      message = 'Terjadi kesalahan pada server.';
    }
    res.status(status).json({ error: message, details: err.details });
  });

  return app;
}

module.exports = { createApp };
