'use strict';

/**
 * The numbers behind the workflow canvas's branches: for each delivery target of
 * an integration (the integration itself, or each action), how its deliveries
 * ended in a time window and what each stage did. Only facts the engine records
 * are returned; the canvas names a branch from them (see the label table in
 * docs/design/workflow-canvas/README.md, section 11.2).
 *
 *   per delivery target
 *     deliveries { total, byStatus, attempts, retries }   from the delivery log; a retry is an attempt after the first
 *     stages[]   { stageId, name, hook, runs, ok, skipped, rejected, errored, timedOut, statuses, latest }
 * plus `removedStages` (runs of stages no longer configured) and `unattributed` (deliveries
 * that match no target).
 *
 * For a stage run: ok = it continued, skipped = it called skip(), rejected = it
 * called fail(), errored = it broke (an error that was not fail()), timedOut = it
 * ran out of time. `statuses` counts the status words its runs returned; `latest`
 * (checks that run after delivery only) counts deliveries by the stage's latest
 * status word.
 */

const store = require('./store');
const { stageTargets } = require('./targets');
const { deliveryCounts } = require('../data/log-insights');

const HOUR_MS = 3600 * 1000;
const MAX_HOURS = 24 * 30; // stage runs are kept 30 days
const DEFAULT_HOURS = 24;
const REJECTED_CODE = 'STAGE_FAILED';

const emptyStage = (stage, hook) => ({
  stageId: stage.id,
  name: stage.name || stage.id,
  hook: stage.hook || hook || null,
  enabled: stage.enabled !== false,
  runs: 0,
  ok: 0,
  skipped: 0,
  rejected: 0,
  errored: 0,
  timedOut: 0,
  statuses: {},
  latest: {},
});

function countRun(entry, row) {
  const next = { ...entry, runs: entry.runs + row.runs, statuses: { ...entry.statuses } };
  if (row.outcome === 'ok') {
    next.ok += row.runs;
    if (row.status) next.statuses[row.status] = (next.statuses[row.status] || 0) + row.runs;
  } else if (row.outcome === 'skipped') next.skipped += row.runs;
  else if (row.outcome === 'timeout') next.timedOut += row.runs;
  else if (row.errorCode === REJECTED_CODE) next.rejected += row.runs;
  else next.errored += row.runs;
  return next;
}

const emptyDeliveries = () => ({ total: 0, byStatus: {}, attempts: 0, retries: 0 });

function countDeliveries(entry, row) {
  return {
    total: entry.total + row.deliveries,
    byStatus: { ...entry.byStatus, [row.status]: (entry.byStatus[row.status] || 0) + row.deliveries },
    attempts: entry.attempts + row.attempts,
    retries: entry.retries + row.retries,
  };
}

/**
 * Put the raw counts together. `runRows` from stage_runs (flowCounts),
 * `deliveryRows` from the delivery log (deliveryCounts), `latestRows` from
 * stage_state (outcomeCounts). Pure.
 */
function buildFlowStats(integration, { runRows = [], deliveryRows = [], latestRows = [] }) {
  const targets = stageTargets(integration);
  const stageTarget = new Map();
  const stats = targets.map((target) => {
    const stages = target.stages.filter(Boolean).map((stage) => emptyStage(stage));
    for (const stage of stages) stageTarget.set(stage.stageId, stages);
    return { actionIndex: target.actionIndex, name: target.name, protocol: target.protocol, deliveries: emptyDeliveries(), stages };
  });
  const byIndex = new Map(stats.map((entry) => [entry.actionIndex, entry]));

  const removed = new Map();
  for (const row of runRows) {
    const list = stageTarget.get(row.stageId);
    if (list) {
      const index = list.findIndex((entry) => entry.stageId === row.stageId);
      list[index] = countRun(list[index], row);
    } else {
      removed.set(row.stageId, countRun(removed.get(row.stageId) || emptyStage({ id: row.stageId }, row.hook), row));
    }
  }
  for (const row of latestRows) {
    const list = stageTarget.get(row.stageId);
    if (!list || !row.status) continue;
    const index = list.findIndex((entry) => entry.stageId === row.stageId);
    list[index] = { ...list[index], latest: { ...list[index].latest, [row.status]: (list[index].latest[row.status] || 0) + row.deliveries } };
  }
  const unattributed = emptyDeliveries();
  for (const row of deliveryRows) {
    // A log with no delivery target of this configuration (an action since removed, an old log) has nowhere to land.
    const entry = byIndex.get(row.actionIndex);
    if (entry) entry.deliveries = countDeliveries(entry.deliveries, row);
    else Object.assign(unattributed, countDeliveries(unattributed, row));
  }
  return { targets: stats, removedStages: [...removed.values()], unattributed };
}

/** flowStats(orgId, integration, { hours, now }) -> { integrationId, since, until, hours, targets, removedStages } */
async function flowStats(orgId, integration, { hours = DEFAULT_HOURS, now = new Date() } = {}) {
  const span = Math.min(Math.max(Number(hours) || DEFAULT_HOURS, 1), MAX_HOURS);
  const window = { from: new Date(now.getTime() - span * HOUR_MS), to: now };
  const integrationId = String(integration._id || integration.id);
  const [runRows, deliveryRows, latestRows] = await Promise.all([
    store.runs.flowCounts(orgId, integrationId, window),
    deliveryCounts(orgId, integrationId, window),
    store.state.outcomeCounts(orgId, { integrationId, from: window.from, to: window.to }),
  ]);
  return { integrationId, since: window.from.toISOString(), until: window.to.toISOString(), hours: span, ...buildFlowStats(integration, { runRows, deliveryRows, latestRows }) };
}

module.exports = { flowStats, buildFlowStats, MAX_HOURS };
