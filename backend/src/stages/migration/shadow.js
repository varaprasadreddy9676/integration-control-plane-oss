'use strict';

/**
 * Shadow comparisons: while an integration is migrating, each migrated stage
 * runs alongside the old path without effects, and every outcome is compared
 * with what the old path decided (stage_shadow, kept 30 days). Ownership switches
 * only when enough comparisons matched and none differed.
 */

const mongodb = require('../../mongodb');

const COLLECTION = 'stage_shadow';
const KEEP_DAYS = 30;

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

/** What the two paths decided, reduced to what is compared. */
function sameOutcome(legacy, shadow) {
  return legacy.decision === shadow.decision && (legacy.message || null) === (shadow.message || null) && (legacy.status || null) === (shadow.status || null);
}

async function recordComparison({ orgId, integrationId, source, deliveryId = null, legacy, shadow }) {
  const col = await collection();
  const at = new Date();
  await col.insertOne({
    orgId,
    integrationId: String(integrationId),
    source,
    deliveryId: deliveryId ? String(deliveryId) : null,
    at,
    legacy,
    shadow,
    match: sameOutcome(legacy, shadow),
    expiresAt: new Date(at.getTime() + KEEP_DAYS * 24 * 3600 * 1000),
  });
}

/** Per source: comparisons, matches, mismatches, and a few recent mismatches to look at. */
async function shadowReport(orgId, integrationId, { since } = {}) {
  const col = await collection();
  const match = { orgId, integrationId: String(integrationId), ...(since ? { at: { $gte: new Date(since) } } : {}) };
  const rows = await col
    .aggregate([{ $match: match }, { $group: { _id: '$source', total: { $sum: 1 }, matches: { $sum: { $cond: ['$match', 1, 0] } } } }])
    .toArray();
  const report = {};
  for (const row of rows) {
    const mismatches = await col
      .find({ ...match, source: row._id, match: false }, { projection: { _id: 0, deliveryId: 1, at: 1, legacy: 1, shadow: 1 } })
      .sort({ at: -1 })
      .limit(5)
      .toArray();
    report[row._id] = { total: row.total, matches: row.matches, mismatches: row.total - row.matches, recentMismatches: mismatches };
  }
  return report;
}

async function ensureShadowIndexes(db, safeCreateIndexes = (c, specs) => c.createIndexes(specs)) {
  await safeCreateIndexes(db.collection(COLLECTION), [
    { key: { orgId: 1, integrationId: 1, source: 1, at: -1 }, name: 'org_integration_source_at_idx' },
    { key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'expires_ttl_idx' },
  ]);
}

module.exports = { recordComparison, shadowReport, sameOutcome, ensureShadowIndexes, COLLECTION };
