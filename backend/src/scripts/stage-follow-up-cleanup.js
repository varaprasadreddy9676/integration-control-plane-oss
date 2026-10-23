'use strict';
/**
 * Remove the request/response bodies and headers the old delivery follow-up kept
 * on delivery logs; checks younger than 30 days are copied, masked, into
 * stage_runs first (see src/stages/migration/cleanup.js). Idempotent.
 *
 *   node src/scripts/stage-follow-up-cleanup.js --org=33            count only
 *   node src/scripts/stage-follow-up-cleanup.js --org=33 --commit   clean
 *   node src/scripts/stage-follow-up-cleanup.js --all --commit [--limit=10000]
 */

const mongodb = require('../mongodb');
const { cleanFollowUpBodies } = require('../stages/migration/cleanup');

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

async function main() {
  const orgId = arg('org') ? Number(arg('org')) : null;
  if (!arg('all') && !(Number.isInteger(orgId) && orgId > 0)) throw new Error('Give --org=<orgId> or --all');
  await mongodb.connect();
  const totals = await cleanFollowUpBodies({
    orgId: arg('all') ? undefined : orgId,
    commit: Boolean(arg('commit')),
    limit: arg('limit') ? Number(arg('limit')) : Infinity,
  });
  console.log(`${arg('commit') ? 'Cleaned' : 'Would clean'}: ${JSON.stringify(totals)}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongodb.close().catch(() => {}));
