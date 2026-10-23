'use strict';
/**
 * Move integrations from their legacy configuration (pre-delivery checks,
 * response transform, delivery follow-up) to pipeline stages, one step at a time
 * (see src/stages/migration):
 *
 *   node src/scripts/stage-migration.js --org=33 --integration=<id> --plan
 *   node src/scripts/stage-migration.js --org=33 --all --plan
 *   ... --shadow                      add the stages as shadows (the old path still owns)
 *   ... --report                      shadow comparisons per source
 *   ... --switch [--min=20]           let the stages own, if the comparisons are conclusive
 *   ... --switch --force --reason="..."
 *   ... --rollback --reason="..."     give the work back to the old path
 *
 * --plan and --report change nothing. --all takes every single-delivery outbound
 * integration of the org that has something to migrate. A step that leaves work
 * in flight says so; run it again.
 */

const mongodb = require('../mongodb');
const migration = require('../stages/migration');
const { shadowReport } = require('../stages/migration/shadow');

const arg = (name) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(name.length + 3) : true;
};

async function targets(orgId) {
  if (arg('integration')) return [String(arg('integration'))];
  if (!arg('all')) throw new Error('Give --integration=<id> or --all');
  const db = await mongodb.getDbSafe();
  const docs = await db
    .collection('integration_configs')
    .find(
      {
        orgId,
        direction: { $in: ['OUTBOUND', null] },
        $and: [
          { $or: [{ actions: null }, { actions: { $size: 0 } }, { actions: { $exists: false } }] },
          { $or: [{ 'preDeliveryChecks.0': { $exists: true } }, { responseTransformation: { $ne: null } }, { deliveryFollowUp: { $ne: null } }] },
        ],
      },
      { projection: { _id: 1 } }
    )
    .toArray();
  return docs.map((doc) => String(doc._id));
}

async function step(orgId, integrationId) {
  if (arg('plan')) {
    const { integration, stages, unsupported, notes } = await migration.planFor(orgId, integrationId);
    return {
      name: integration.name,
      stages: stages.map((stage) => `${stage.id} (${stage.contract}${stage.enabled === false ? ', off' : ''})`),
      unsupported,
      notes,
    };
  }
  if (arg('shadow')) {
    const result = await migration.startShadow(orgId, integrationId, {});
    return { ...result, stages: (result.stages || []).map((stage) => stage.id) };
  }
  if (arg('report')) return shadowReport(orgId, integrationId);
  if (arg('switch')) {
    return migration.switchToStages(orgId, integrationId, {
      minComparisons: arg('min') ? Number(arg('min')) : undefined,
      force: Boolean(arg('force')),
      reason: typeof arg('reason') === 'string' ? arg('reason') : undefined,
    });
  }
  if (arg('rollback')) return migration.rollback(orgId, integrationId, { reason: typeof arg('reason') === 'string' ? arg('reason') : undefined });
  throw new Error('Choose one of --plan, --shadow, --report, --switch, --rollback');
}

async function main() {
  const orgId = Number(arg('org'));
  if (!Number.isInteger(orgId) || orgId <= 0) throw new Error('Give --org=<orgId>');
  await mongodb.connect();
  let failed = 0;
  for (const integrationId of await targets(orgId)) {
    try {
      const result = await step(orgId, integrationId);
      console.log(JSON.stringify({ integrationId, ok: true, result }, null, 2));
    } catch (error) {
      failed += 1;
      console.log(JSON.stringify({ integrationId, ok: false, error: error.message, details: error.details || undefined }, null, 2));
    }
  }
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => mongodb.close().catch(() => {}));
