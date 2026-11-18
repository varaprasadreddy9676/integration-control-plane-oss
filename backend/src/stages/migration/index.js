'use strict';

/**
 * Moving one integration from its legacy configuration to stages, with exactly
 * one owner of each piece of work at every moment:
 *
 *   plan      what its stages would be, and what cannot move     nothing changes
 *   shadow    the stages are added as shadows: they run beside the old path
 *             without effects, and their outcomes are compared   the old path owns
 *   switch    only when every source was compared enough times without a single
 *             difference (or explicitly forced, with a reason, audited): the
 *             stages act, the legacy fields are cleared (kept for rollback), and
 *             pending follow-up checks are handed over where they were
 *                                                                the stages own
 *   rollback  the legacy fields come back, pending stage checks are handed back
 *             where they were, the migrated stages are removed   the old path owns
 *
 * Handover is two-phase and can be run again: the receiving side is created
 * first in a state nobody runs (HANDOVER), the giving side is retired only if no
 * worker holds it, then the receiving side is switched on. Work a worker holds is
 * reported as in flight and picked up by the next run (or the repair pass).
 */

const mongodb = require('../../mongodb');
const integrations = require('../../data/integrations');
const jobs = require('../store/jobs');
const store = require('../store');
const { normalizeStage } = require('../config');
const { firstRunAt, lastRunBy } = require('../schedule');
const { planMigration, followUpOriginsFromHistory, SOURCES } = require('./plan');
const { shadowReport } = require('./shadow');

const QUEUE = 'delivery_follow_ups';
const DEFAULT_MIN_COMPARISONS = 20;

class MigrationError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function load(orgId, integrationId) {
  const integration = await integrations.getIntegration(integrationId);
  if (!integration || integration.orgId !== orgId) throw new MigrationError(404, 'Integration not found');
  return integration;
}

async function audit(action, { orgId, integrationId, user, metadata }) {
  const { logAudit } = require('../../services/audit-logger');
  await logAudit({ action, resourceType: 'integration', resourceId: String(integrationId), user, orgId, metadata });
}

/** What the integration's stages would be. Changes nothing. */
async function planFor(orgId, integrationId, { followUpOrigins } = {}) {
  const integration = await load(orgId, integrationId);
  const origins = followUpOrigins || (await followUpOriginsFromHistory(orgId, integrationId));
  return { integration, ...planMigration(integration, { followUpOrigins: origins }) };
}

/** Add the planned stages as shadows. */
async function startShadow(orgId, integrationId, { user = null, followUpOrigins } = {}) {
  const { integration, stages, unsupported, notes, sources } = await planFor(orgId, integrationId, { followUpOrigins });
  const state = integration.stageMigration && integration.stageMigration.state;
  if (state === 'SHADOW' || state === 'SWITCHED') throw new MigrationError(409, `The migration is already ${state.toLowerCase()}`);
  if (stages.length === 0) return { started: false, unsupported, notes };

  const taken = new Set((integration.stages || []).map((stage) => stage.id));
  const shadows = stages.map((stage) => ({ ...stage, id: taken.has(stage.id) ? `${stage.id}Migrated` : stage.id, shadow: true }));
  await integrations.updateIntegration(orgId, integrationId, {
    stages: [...(integration.stages || []), ...shadows],
    stageMigration: {
      state: 'SHADOW',
      sources,
      stageIds: shadows.map((stage) => stage.id),
      unsupported,
      notes,
      shadowSince: new Date(),
      by: user ? user.id || null : null,
    },
  });
  await audit('stage_migration_shadow', { orgId, integrationId, user, metadata: { sources, unsupported } });
  return { started: true, stages: shadows, unsupported, notes };
}

/** Pending old follow-up checks of a switched integration, handed to its stage where they were. */
async function handOverFollowUps(orgId, integration) {
  const migration = integration.stageMigration || {};
  const stage = (integration.stages || []).find((candidate) => candidate.migratedFrom === 'deliveryFollowUp');
  if (!stage) return { moved: 0, inFlight: 0, finishedByOld: 0 };
  const normalized = normalizeStage(stage);
  const definitionHash = await store.definitions.saveDefinition(orgId, normalized);
  const db = await mongodb.getDbSafe();
  const queue = db.collection(QUEUE);
  const integrationId = String(integration.id || integration._id);
  const now = new Date();
  const open = await queue.find({ orgId, integrationId, status: { $in: ['PENDING', 'MIGRATING'] } }).toArray();

  let moved = 0;
  let inFlight = 0;
  let finishedByOld = 0;
  for (const old of open) {
    const key = { orgId, deliveryId: String(old.logId), stageId: stage.id, trigger: 'accepted', failureSeq: 0 };
    const sentAt = new Date(old.sentAt || old.createdAt || now);
    const checksDone = old.checkIndex || 0;
    await jobs.createJob({
      ...key,
      integrationId,
      definitionHash,
      acceptedAt: sentAt,
      firstRunAt: old.nextCheckAt ? new Date(old.nextCheckAt) : firstRunAt(normalized, sentAt),
      lastRunBy: lastRunBy(normalized, sentAt),
      input: {
        event: {},
        request: null,
        response: { status: (old.delivery && old.delivery.statusCode) || null, headers: {}, body: (old.delivery && old.delivery.response) || null },
        attempt: null,
        status: 'SUCCESS',
        stages: {},
      },
      state: 'HANDOVER',
      seq: checksDone + 1,
      checksDone,
      lastStatus: old.deliveryStatus && old.deliveryStatus !== 'PENDING' ? old.deliveryStatus : null,
    });
    const retired = await queue.updateOne(
      { _id: old._id, status: { $in: ['PENDING', 'MIGRATING'] }, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { status: 'MIGRATED', migratedAt: now, lockedUntil: null } }
    );
    const jobsCol = db.collection(jobs.COLLECTION);
    if (retired.modifiedCount === 1) {
      await jobsCol.updateOne({ ...key, state: 'HANDOVER' }, { $set: { state: 'PENDING', handedOverAt: now, updatedAt: now } });
      moved += 1;
      continue;
    }
    const current = await queue.findOne({ _id: old._id }, { projection: { status: 1 } });
    if (current && current.status === 'DONE') {
      // The old worker finished it meanwhile: nothing to hand over.
      await jobsCol.updateOne({ ...key, state: 'HANDOVER' }, { $set: { state: 'CANCELLED', input: null, updatedAt: now, lastError: 'Finished by the old follow-up' } });
      finishedByOld += 1;
    } else {
      inFlight += 1; // a check is running right now; the next run takes it
    }
  }
  if (migration.state === 'SWITCHED') {
    // Shadow checks of deliveries the stage now owns would only repeat its calls.
    await db.collection(jobs.COLLECTION).updateMany(
      { orgId, integrationId, trigger: 'shadow', state: { $in: ['PENDING', 'PAUSED'] } },
      { $set: { state: 'CANCELLED', input: null, updatedAt: now, compared: true } }
    );
  }
  return { moved, inFlight, finishedByOld };
}

/**
 * Let the stages own the work. Refused unless each source was compared at least
 * `minComparisons` times with no difference, or `force` with a reason.
 */
async function switchToStages(orgId, integrationId, { user = null, minComparisons = DEFAULT_MIN_COMPARISONS, force = false, reason } = {}) {
  const integration = await load(orgId, integrationId);
  const migration = integration.stageMigration || {};
  if (migration.state === 'SWITCHED') {
    // Already switched: finish any handover left in flight.
    return { switched: true, ...(await handOverFollowUps(orgId, integration)) };
  }
  if (migration.state !== 'SHADOW') throw new MigrationError(409, 'Start the shadow comparison first');

  const report = await shadowReport(orgId, integrationId, { since: migration.shadowSince });
  const shortfalls = (migration.sources || [])
    .filter((source) => {
      const stage = (integration.stages || []).find((candidate) => candidate.migratedFrom === source);
      return stage && stage.enabled !== false; // a stage created switched off has nothing to compare
    })
    .map((source) => ({ source, ...(report[source] || { total: 0, matches: 0, mismatches: 0 }) }))
    .filter((row) => row.mismatches > 0 || row.total < minComparisons);
  if (shortfalls.length && !force) {
    throw new MigrationError(409, 'The shadow comparison is not conclusive yet', { shortfalls, minComparisons });
  }
  if (force && !(reason && String(reason).trim())) throw new MigrationError(400, 'Say why the switch is forced');

  const previous = {};
  const cleared = {};
  for (const source of migration.sources || []) {
    previous[source] = integration[source] === undefined ? null : integration[source];
    cleared[source] = null;
  }
  const migrated = new Set(migration.stageIds || []);
  await integrations.updateIntegration(orgId, integrationId, {
    ...cleared,
    stages: (integration.stages || []).map((stage) => (migrated.has(stage.id) ? { ...stage, shadow: false } : stage)),
    stageMigration: { ...migration, state: 'SWITCHED', switchedAt: new Date(), previous, forced: Boolean(force && shortfalls.length) },
  });
  await audit('stage_migration_switch', { orgId, integrationId, user, metadata: { report, forced: Boolean(force && shortfalls.length), reason: reason || null } });
  const handover = await handOverFollowUps(orgId, await load(orgId, integrationId));
  return { switched: true, report, ...handover };
}

/** Pending stage checks of a migrated follow-up, handed back to the old queue where they were. */
async function handBackFollowUps(orgId, integration) {
  const stage = (integration.stages || []).find((candidate) => candidate.migratedFrom === 'deliveryFollowUp');
  if (!stage) return { handedBack: 0, inFlight: 0 };
  const db = await mongodb.getDbSafe();
  const jobsCol = db.collection(jobs.COLLECTION);
  const queue = db.collection(QUEUE);
  const integrationId = String(integration.id || integration._id);
  const now = new Date();
  const pending = await jobsCol.find({ orgId, integrationId, stageId: stage.id, trigger: 'accepted', state: { $in: ['PENDING', 'PAUSED', 'RUNNING', 'HANDOVER'] } }).toArray();
  let handedBack = 0;
  let inFlight = 0;
  for (const job of pending) {
    const taken = await jobsCol.updateOne({ _id: job._id, state: { $in: ['PENDING', 'PAUSED', 'HANDOVER'] }, lease: null }, { $set: { state: 'HANDOVER', updatedAt: now } });
    if (taken.modifiedCount !== 1) {
      inFlight += 1;
      continue;
    }
    const response = (job.input && job.input.response) || {};
    await queue.updateOne(
      { orgId, logId: String(job.deliveryId), integrationId },
      {
        $set: {
          status: 'PENDING',
          checkIndex: Math.max(0, (job.seq || 1) - 1),
          nextCheckAt: job.nextRunAt || now,
          deliveryStatus: job.lastStatus || 'PENDING',
          delivery: { statusCode: response.status === undefined ? null : response.status, response: response.body === undefined ? null : response.body },
          sentAt: job.acceptedAt,
          lockedUntil: null,
          handedBackAt: now,
        },
        $setOnInsert: { createdAt: now, history: [], expiresAt: new Date(now.getTime() + 30 * 24 * 3600 * 1000) },
      },
      { upsert: true }
    );
    await jobsCol.updateOne({ _id: job._id, state: 'HANDOVER' }, { $set: { state: 'CANCELLED', input: null, finishedAt: now, updatedAt: now, lastError: 'Handed back to the old follow-up' } });
    handedBack += 1;
  }
  return { handedBack, inFlight };
}

/** Give the work back to the old path. Can be run again until nothing is in flight. */
async function rollback(orgId, integrationId, { user = null, reason } = {}) {
  if (!(reason && String(reason).trim())) throw new MigrationError(400, 'Say why the migration is rolled back');
  let integration = await load(orgId, integrationId);
  const migration = integration.stageMigration || {};
  if (!['SHADOW', 'SWITCHED', 'ROLLING_BACK'].includes(migration.state)) throw new MigrationError(409, 'Nothing to roll back');
  const migrated = new Set(migration.stageIds || []);

  if (migration.state === 'SWITCHED') {
    // 1. The old path owns new deliveries again; the stages go back to shadows.
    await integrations.updateIntegration(orgId, integrationId, {
      ...(migration.previous || {}),
      stages: (integration.stages || []).map((stage) => (migrated.has(stage.id) ? { ...stage, shadow: true } : stage)),
      stageMigration: { ...migration, state: 'ROLLING_BACK' },
    });
    integration = await load(orgId, integrationId);
  }
  // 2. Pending checks go back to the old queue where they were.
  const { handedBack, inFlight } = await handBackFollowUps(orgId, integration);
  if (inFlight > 0) return { rolledBack: false, handedBack, inFlight };

  // 3. The migrated stages are removed (their shadow work is cancelled with them).
  await integrations.updateIntegration(orgId, integrationId, {
    stages: (integration.stages || []).filter((stage) => !migrated.has(stage.id)),
    stageMigration: { ...integration.stageMigration, state: 'ROLLED_BACK', rolledBackAt: new Date(), reason: String(reason) },
  });
  await audit('stage_migration_rollback', { orgId, integrationId, user, metadata: { reason: String(reason), handedBack, from: migration.state } });
  return { rolledBack: true, handedBack, inFlight: 0 };
}

/** For the repair pass: finish handovers of switched integrations (old jobs parked as MIGRATING). */
async function sweepHandovers({ limit = 20 } = {}) {
  const db = await mongodb.getDbSafe();
  const groups = await db
    .collection(QUEUE)
    .aggregate([{ $match: { status: 'MIGRATING' } }, { $group: { _id: { orgId: '$orgId', integrationId: '$integrationId' } } }, { $limit: limit }])
    .toArray();
  for (const { _id } of groups) {
    const integration = await integrations.getIntegration(_id.integrationId);
    if (integration && integration.orgId === _id.orgId && integration.stageMigration && integration.stageMigration.state === 'SWITCHED') {
      await handOverFollowUps(_id.orgId, integration);
    }
  }
}

module.exports = { planFor, startShadow, switchToStages, rollback, handOverFollowUps, handBackFollowUps, sweepHandovers, MigrationError, SOURCES };
