'use strict';
class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const bad = (msg, d) => new HttpError(400, msg, d);
const forbidden = (msg = 'Anda tidak memiliki akses.') => new HttpError(403, msg);
const notFound = (msg = 'Data tidak ditemukan.') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);
module.exports = { HttpError, bad, forbidden, notFound, conflict };
