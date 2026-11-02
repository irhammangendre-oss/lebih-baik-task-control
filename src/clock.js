'use strict';
// Sumber waktu tunggal supaya bisa dikendalikan di test.
let override = null;
module.exports = {
  now: () => (override ? new Date(override()) : new Date()),
  nowIso: () => module.exports.now().toISOString(),
  set: (fn) => { override = fn; },
  reset: () => { override = null; },
};
