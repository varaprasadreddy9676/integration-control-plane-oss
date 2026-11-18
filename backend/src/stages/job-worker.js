'use strict';

/**
 * Runs due deferred stages (stage_jobs; see store/jobs.js for the claim, fenced
 * commit and projection), and repairs what a crash left behind: delivery logs
 * with outbox work (outbox.js) and committed jobs not yet projected.
 *
 * Before running, a job is checked against the integration as it is now, even
 * though it runs its pinned definition: a deleted stage cancels the job; a
 * disabled stage or integration, or a kill switch, pauses it; work past its
 * window expires. Org fairness: one org holds at most `maxPerOrg` of this
 * worker's slots.
 */

const config = require('../config');
const mongodb = require('../mongodb');
const { log } = require('../logger');
const store = require('./store');
const jobs = require('./store/jobs');
const outbox = require('./outbox');
const { executeStage, executeDeps } = require('./executor');
const { findStage, stageRunsNow } = require('./targets');
const { normalizeStage } = require('./config');
const { nextJobState, isExpired, finalState } = require('./schedule');

const POLL_MS = 2000;
const REPAIR_MS = 30000;
const INTEGRATION_CACHE_MS = 5000;

function defaultLoadIntegration() {
  const cache = new Map();
  return async (orgId, integrationId) => {
    const key = `${orgId}:${integrationId}`;
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await require('../data/integrations').getOrgIntegration(orgId, integrationId);
    cache.set(key, { value, until: Date.now() + INTEGRATION_CACHE_MS });
    return value;
  };
}

function scopeFor(job, stage, integration) {
  const input = job.input || {};
  const schedule = stage.schedule || {};
  return {
    event: input.event || {},
    delivery: {
      request: input.request || null,
      response: input.response || null,
      attempt: input.attempt || null,
      status: input.status || null,
      errorMessage: input.errorMessage || null,
      failureSeq: job.trigger === 'failure' ? job.failureSeq : null,
      acceptedAt: job.acceptedAt,
    },
    stages: input.stages || {},
    vars: integration.variables || {},
    run: {
      seq: job.seq,
      executionAttempt: job.executionAttempt,
      lastStatus: job.lastStatus || null,
      ...(schedule.checkAfterSeconds ? { of: schedule.checkAfterSeconds.length } : {}),
    },
  };
}

/** Process one claimed job. Resolves to the state it committed (or null when stale). */
async function processJob(job, { deps, loadIntegration, onDeadLetter = () => {} }) {
  const now = new Date();
  const definition = await store.definitions.getDefinition(job.orgId, job.claimedDefinitionHash);
  if (!definition) {
    await jobs.commit(job, finalState('FAILED', now, { lastError: 'The stage definition is missing' }));
    return 'FAILED';
  }
  const integration = await loadIntegration(job.orgId, job.integrationId);
  const found = findStage(integration, job.stageId);
  const current = found && found.stage;
  if (!current) {
    const { committed } = await jobs.commit(job, finalState('CANCELLED', now, { lastError: 'The stage or integration was deleted' }));
    return committed ? 'CANCELLED' : null;
  }
  if (!stageRunsNow(integration, current)) {
    const { committed } = await jobs.commit(job, { state: 'PAUSED', pausedAt: now, lease: null });
    return committed ? 'PAUSED' : null;
  }

  // The pinned definition runs; the current name is what people see.
  const stage = normalizeStage({ ...definition, id: current.id, name: current.name });
  if (isExpired(stage, job, now)) {
    const { committed } = await jobs.commit(job, finalState('EXPIRED', now));
    return committed ? 'EXPIRED' : null;
  }

  const result = await executeStage({
    stage,
    integration,
    scope: scopeFor(job, stage, integration),
    deadline: Date.now() + stage.timeoutMs,
    meta: {
      orgId: job.orgId,
      deliveryId: job.deliveryId,
      integrationId: job.integrationId,
      integrationRevision: job.integrationRevision,
      definitionHash: job.claimedDefinitionHash,
      seq: job.trigger === 'failure' ? job.failureSeq : job.seq,
      executionAttempt: job.executionAttempt,
      jobId: String(job._id),
      acceptedAt: job.acceptedAt,
      shadow: job.shadow === true,
    },
    deps,
  });

  const { set, record } = nextJobState({ job, stage, result, now: new Date() });
  if (record) set.projection = result.record;
  const { committed } = await jobs.commit(job, set);
  if (!committed) {
    // Our lease ran out and someone else holds the job now; this run is discarded.
    log('warn', 'Stage job commit lost its lease', { jobId: String(job._id), stageId: job.stageId });
    return null;
  }
  if (record) {
    await store.projectRun(result.record);
    await jobs.clearProjection(job._id, result.record.runId);
  }
  if (set.state === 'DEAD') onDeadLetter({ job, stage, integration, record: result.record });
  return set.state;
}

const COMPARE_GIVE_UP_MS = 3 * 24 * 3600 * 1000;

/**
 * Finished shadow follow-ups, compared with the old follow-up of the same
 * delivery once that one has finished too: the final status is what counts.
 */
async function compareShadowFollowUps({ limit = 100 } = {}) {
  const db = await mongodb.getDbSafe();
  const { recordComparison } = require('./migration/shadow');
  const finished = await db
    .collection(jobs.COLLECTION)
    .find({ shadow: true, compared: false, state: { $in: jobs.FINAL_STATES } })
    .limit(limit)
    .toArray();
  for (const job of finished) {
    const id = mongodb.toObjectId(job.deliveryId);
    const logDoc = id ? await db.collection('execution_logs').findOne({ _id: id, orgId: job.orgId }, { projection: { followUp: 1 } }) : null;
    const legacy = logDoc && logDoc.followUp;
    const settled = legacy && legacy.done;
    const tooLong = Date.now() - new Date(job.finishedAt || job.updatedAt).getTime() > COMPARE_GIVE_UP_MS;
    if (legacy && !settled && !tooLong) continue; // the old one is still checking
    if (settled) {
      const [state] = (await store.state.getStates(job.orgId, job.deliveryId)).filter((s) => s.stageId === job.stageId);
      await recordComparison({
        orgId: job.orgId,
        integrationId: job.integrationId,
        source: 'deliveryFollowUp',
        deliveryId: job.deliveryId,
        legacy: { decision: 'done', status: legacy.status },
        shadow: { decision: 'done', status: state ? state.status : null },
      });
    }
    await db.collection(jobs.COLLECTION).updateOne({ _id: job._id }, { $set: { compared: true } });
  }
}

/**
 * Project committed runs a crash left on their jobs, drain left-behind outboxes,
 * and resume paused work whose integration and stage are switched on again
 * (whichever path switched them: an edit, a bulk enable, a restore).
 */
async function repair({ loadIntegration = defaultLoadIntegration() } = {}) {
  for (const job of await jobs.findUnprojected()) {
    await store.projectRun(job.projection);
    await jobs.clearProjection(job._id, job.projection.runId);
  }
  for (const pending of await outbox.findPendingLogs()) {
    await outbox.drainLog(pending.orgId, pending._id);
  }
  await compareShadowFollowUps();
  // Follow-up checks of switched integrations still waiting to be handed over.
  await require('./migration').sweepHandovers();
  if ((config.stages || {}).disabled) return;
  for (const group of await jobs.pausedGroups()) {
    const integration = await loadIntegration(group.orgId, group.integrationId);
    const found = findStage(integration, group.stageId);
    if (found && stageRunsNow(integration, found.stage)) {
      await jobs.resumeJobs(group.orgId, group.integrationId, group.stageId);
    }
  }
}

function createJobWorker({ concurrency = 4, maxPerOrg = 2, deps = executeDeps(), loadIntegration = defaultLoadIntegration(), onDeadLetter } = {}) {
  let running = 0;
  const perOrg = new Map();
  let pollTimer = null;
  let repairTimer = null;
  let ticking = false;
  let stopped = false;

  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      while (!stopped && running < concurrency) {
        const busyOrgs = [...perOrg].filter(([, count]) => count >= maxPerOrg).map(([orgId]) => orgId);
        const job = await jobs.claimDue({ excludeOrgs: busyOrgs });
        if (!job) break;
        running += 1;
        perOrg.set(job.orgId, (perOrg.get(job.orgId) || 0) + 1);
        processJob(job, { deps, loadIntegration, onDeadLetter })
          .catch((error) => log('error', 'Stage job failed to process', { jobId: String(job._id), error: error.message }))
          .finally(() => {
            running -= 1;
            const left = (perOrg.get(job.orgId) || 1) - 1;
            if (left > 0) perOrg.set(job.orgId, left);
            else perOrg.delete(job.orgId);
          });
      }
    } catch (error) {
      log('warn', 'Stage job worker tick failed', { error: error.message });
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (pollTimer) return;
      stopped = false;
      pollTimer = setInterval(tick, POLL_MS);
      repairTimer = setInterval(
        () => repair({ loadIntegration }).catch((error) => log('warn', 'Stage repair failed', { error: error.message })),
        REPAIR_MS
      );
    },
    stop() {
      stopped = true;
      clearInterval(pollTimer);
      clearInterval(repairTimer);
      pollTimer = null;
      repairTimer = null;
    },
    tick,
    get running() {
      return running;
    },
  };
}

module.exports = { createJobWorker, processJob, repair, scopeFor, compareShadowFollowUps };
