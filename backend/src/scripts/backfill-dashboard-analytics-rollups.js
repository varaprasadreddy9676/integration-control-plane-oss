'use strict';

if (!Object.hasOwn) {
  Object.hasOwn = (obj, prop) => Object.prototype.hasOwnProperty.call(obj, prop);
}

const mongodb = require('../mongodb');
const {
  BUCKET_TYPE_DAY,
  BUCKET_TYPE_HOUR,
  ensureIndexes,
  rebuildRollupForOrg,
} = require('../services/dashboard-analytics-rollups');

function parseArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : null;
}

function parseDays() {
  const value = Number(parseArg('days') || 100);
  if (!Number.isFinite(value) || value <= 0 || value > 730) throw new Error('--days must be between 1 and 730');
  return value;
}

function getBucketTypes() {
  const value = (parseArg('bucket') || 'both').toLowerCase();
  if (value === 'hour') return [BUCKET_TYPE_HOUR];
  if (value === 'day') return [BUCKET_TYPE_DAY];
  if (value === 'both') return [BUCKET_TYPE_HOUR, BUCKET_TYPE_DAY];
  throw new Error('--bucket must be hour, day, or both');
}

async function main() {
  const requestedOrgId = parseArg('orgId');
  const days = parseDays();
  const bucketTypes = getBucketTypes();
  const db = await mongodb.connect();
  await ensureIndexes(db);

  const orgIds = requestedOrgId
    ? [Number.isNaN(Number(requestedOrgId)) ? requestedOrgId : Number(requestedOrgId)]
    : await db.collection('execution_logs').distinct('orgId');
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  for (const orgId of orgIds) {
    for (const bucketType of bucketTypes) {
      const result = await rebuildRollupForOrg(db, orgId, {
        start,
        end,
        bucketType,
        logger: (level, message, details) => console.error(JSON.stringify({ level, message, ...details })),
      });
      console.log(JSON.stringify(result));
    }
  }
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() =>
    mongodb.close().catch(() => {
      // The process is exiting; there is no recovery action for close failures.
    })
  );
