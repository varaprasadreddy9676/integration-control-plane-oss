'use strict';

/** Every stage collection's indexes, created by mongodb.ensureIndexes (and tests). */

const { ensureStageIndexes } = require('./store');
const { ensureJobIndexes } = require('./store/jobs');
const { ensureOutboxIndexes } = require('./outbox');
const { ensureLimitIndexes } = require('./limits');

async function ensureAllStageIndexes(db, safeCreateIndexes) {
  await ensureStageIndexes(db, safeCreateIndexes);
  await ensureJobIndexes(db, safeCreateIndexes);
  await ensureOutboxIndexes(db, safeCreateIndexes);
  await ensureLimitIndexes(db, safeCreateIndexes);
}

module.exports = { ensureAllStageIndexes };
