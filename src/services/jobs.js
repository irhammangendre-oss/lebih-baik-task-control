'use strict';
const clock = require('../clock');
const { generateInstances } = require('./scheduler');
const { runEscalation } = require('./escalation');

function runJobs(db, now = clock.now()) {
  const created = generateInstances(db, now);
  const notified = runEscalation(db, now);
  return { created, notified };
}
module.exports = { runJobs };
