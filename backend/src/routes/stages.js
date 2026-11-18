'use strict';

/**
 * Pipeline stage API for the console: what can be built (runners with their form
 * schemas, templates), checking and testing a stage, what stages did (runs and
 * latest states of a delivery, results), and the controls (replay, re-pin, job
 * counts, quota, runtime status). Everything is scoped to the caller's org.
 *
 * Saving stages is part of saving the integration (outbound-integrations PUT/POST).
 */

const express = require('express');
const asyncHandler = require('../utils/async-handler');
const mongodb = require('../mongodb');
const { requirePermission } = require('../middleware/permission');
const { logAudit } = require('../services/audit-logger');
const { ValidationError, NotFoundError } = require('../utils/errors');
const runners = require('../stages/runners');
const store = require('../stages/store');
const jobs = require('../stages/store/jobs');
const templates = require('../stages/templates');
const { validateStages, validateIntegrationStages, normalizeStage } = require('../stages/config');
const { findStage, mapTargets } = require('../stages/targets');
const { executeStage, executeDeps } = require('../stages/executor');
const { replayRun, ReplayError } = require('../stages/replay');
const { checkAndReplay } = require('../stages/verified-replay');
const { flowStats } = require('../stages/flow-stats');
const { saveImpact } = require('../stages/save-impact');
const { stageOutcomes } = require('../stages/outcomes');
const { buildGuide } = require('../stages/authoring-guide');
const { newFollowUpStage } = require('../stages/migration/plan');
const { getStageRuntime } = require('../stages/runtime');
const { usageToday } = require('../stages/limits');
const config = require('../config');

const router = express.Router();

const MAX_STUB_RESPONSES = 25;
const TEST_DEADLINE_MS = 30000;

const loadIntegration = (orgId, integrationId) => require('../data/integrations').getOrgIntegration(orgId, integrationId);

/** A stand-in for HTTP in tests: answers each call with the next given response (default 200 {}). */
function stubTransport(responses = []) {
  let index = 0;
  return async ({ url }) => {
    const answer = responses[Math.min(index, responses.length - 1)] || { status: 200, body: {} };
    index += 1;
    const body = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body === undefined ? {} : answer.body);
    return { status: answer.status || 200, headers: answer.headers || { 'content-type': 'application/json' }, body, redirects: [], finalUrl: url, durationMs: 0 };
  };
}

const audit = (req, entry) =>
  logAudit({ ...entry, user: req.user, orgId: req.orgId, ipAddress: req.ip, userAgent: req.headers['user-agent'] });

router.get('/runners', (_req, res) => {
  res.json({
    runners: runners.list().map(({ type, label, description, hooks, configSchema, presentation }) => ({ type, label, description, hooks, configSchema, presentation: presentation || {} })),
  });
});

router.get(
  '/templates',
  asyncHandler(async (req, res) => {
    const integration = req.query.integrationId ? await loadIntegration(req.orgId, req.query.integrationId) : null;
    res.json({ templates: templates.listTemplates(integration) });
  })
);

/**
 * The follow-up step for an integration that runs on steps and has none, from what the classic tab holds.
 * Body: { integrationId?, integration?: { targetUrl }, script?, checkAfterSeconds? }.
 */
router.post(
  '/follow-up-step',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const existing = body.integrationId ? await loadIntegration(req.orgId, body.integrationId) : null;
    const stage = newFollowUpStage({ ...(existing || {}), ...(body.integration || {}) }, { script: body.script, checkAfterSeconds: body.checkAfterSeconds });
    if (!stage) throw new ValidationError('Write the check\'s script: there is no provider script to start from');
    res.json({ stage });
  })
);

router.post('/templates/:templateId/stage', (req, res) => {
  const stage = templates.stageFromTemplate(req.params.templateId, { id: req.body && req.body.id, name: req.body && req.body.name });
  if (!stage) throw new NotFoundError('Template not found');
  res.json({ stage });
});

/**
 * Check one delivery's stages (and Send bindings) as the integration would be
 * saved, without saving: the integration's own (actionIndex absent) or one
 * action's. Errors are relative to that delivery (stages[0].name, send...).
 */
router.post(
  '/validate',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const existing = body.integrationId ? await loadIntegration(req.orgId, body.integrationId) : null;
    const actionIndex = Number.isInteger(body.actionIndex) ? body.actionIndex : null;
    const edited = mapTargets({ ...(existing || {}), ...(body.integration || {}) }, (_value, target) =>
      target.actionIndex === actionIndex ? { stages: body.stages, send: body.send } : {}
    );
    const result = validateIntegrationStages(edited, { runners });
    const prefix = actionIndex === null ? '' : `actions[${actionIndex}].`;
    const mine = (path) => (prefix ? path.startsWith(prefix) : !path.startsWith('actions['));
    const errors = result.errors.filter((error) => mine(error.path)).map((error) => ({ ...error, path: error.path.slice(prefix.length) }));
    const stages = actionIndex === null ? result.integration.stages : ((result.integration.actions || [])[actionIndex] || {}).stages;
    res.json({ ok: errors.length === 0, errors, stages: stages || [] });
  })
);

/**
 * Run one stage once and show what it did, with the same record as production.
 * HTTP is stubbed unless `live` is set (needs stages:test_live; audited). A test
 * never schedules work, never changes a delivery, and is not stored.
 */
router.post(
  '/test',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const integration = body.integrationId ? await loadIntegration(req.orgId, body.integrationId) : null;
    if (body.integrationId && !integration) throw new NotFoundError('Integration not found');
    const checked = validateStages([body.stage], { runners });
    if (!checked.ok) throw new ValidationError('The stage is not valid', checked.errors);
    const stage = checked.stages[0];

    const live = body.live === true;
    if (live) {
      const { userHasPermission } = require('../rbac/permissions');
      if (!userHasPermission(req.user, 'stages:test_live')) {
        return res.status(403).json({ error: 'Testing against live APIs needs the stages:test_live permission', code: 'FORBIDDEN' });
      }
    }
    const stubs = Array.isArray(body.stubResponses) ? body.stubResponses.slice(0, MAX_STUB_RESPONSES) : [];

    let scope = body.sample || {};
    if (body.deliveryId) {
      const db = await mongodb.getDbSafe();
      const logId = mongodb.toObjectId(body.deliveryId);
      const logDoc = logId ? await db.collection('execution_logs').findOne({ _id: logId, orgId: req.orgId }) : null;
      if (!logDoc) throw new NotFoundError('Delivery not found');
      const { scopeFromLog } = require('../stages/replay');
      scope = scopeFromLog(logDoc, integration, { stage: { hook: stage.hook }, seq: 1, runId: null });
    }
    const deps = { ...executeDeps(), ...(live ? {} : { request: stubTransport(stubs), admit: undefined }) };
    const result = await executeStage({
      stage,
      integration: integration || {},
      scope: { event: {}, delivery: {}, stages: {}, vars: (integration && integration.variables) || {}, ...scope },
      deadline: Date.now() + Math.min(stage.timeoutMs, TEST_DEADLINE_MS),
      meta: { orgId: req.orgId, deliveryId: body.deliveryId || null, integrationId: body.integrationId || null, seq: 1 },
      deps,
    });
    if (live) {
      await audit(req, {
        action: 'stage_tested_live',
        resourceType: 'stage',
        resourceId: `${body.integrationId || 'new'}:${stage.id}`,
        metadata: { calls: result.record.calls.length, outcome: result.outcome },
      });
    }
    res.json({ live, record: result.record, decision: result.decision });
  })
);

/** What the stages did for one delivery: latest states and every run (masked). */
router.get(
  '/deliveries/:deliveryId',
  asyncHandler(async (req, res) => {
    const [states, runs] = await Promise.all([
      store.state.getStates(req.orgId, req.params.deliveryId),
      store.runs.listRuns(req.orgId, req.params.deliveryId),
    ]);
    res.json({ states, runs });
  })
);

router.get(
  '/runs/:runId',
  asyncHandler(async (req, res) => {
    const run = await store.runs.getRun(req.orgId, req.params.runId);
    if (!run) throw new NotFoundError('Stage run not found');
    res.json({ run });
  })
);

router.post(
  '/runs/:runId/replay',
  requirePermission('stages:replay'),
  asyncHandler(async (req, res) => {
    try {
      const record = await replayRun(
        req.orgId,
        req.params.runId,
        { useCurrentRevision: req.body && req.body.useCurrentRevision === true, user: req.user, reason: req.body && req.body.reason },
        { loadIntegration, executeDeps: executeDeps(), audit: (entry) => audit(req, entry) }
      );
      res.json({ run: record });
    } catch (error) {
      if (error instanceof ReplayError) return res.status(error.status).json({ error: error.message, code: error.code });
      throw error;
    }
  })
);

/**
 * Send a failed delivery again only if the provider does not have it: runs the
 * delivery's verifying check first (see stages/verified-replay.js). Refused with 409
 * when the provider has the message, or when that cannot be confirmed unless
 * `acceptUnverified` is set (audited).
 */
router.post(
  '/deliveries/:deliveryId/check-and-replay',
  requirePermission('stages:replay'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    try {
      const result = await checkAndReplay(
        req.orgId,
        req.params.deliveryId,
        { reason: body.reason, acceptUnverified: body.acceptUnverified === true, user: req.user },
        {
          loadIntegration,
          executeDeps: executeDeps(),
          audit: (entry) => audit(req, entry),
          replay: (...args) => require('../processor/retry-handler').replayEvent(...args),
        }
      );
      res.json(result);
    } catch (error) {
      if (error instanceof ReplayError) return res.status(error.status).json({ error: error.message, code: error.code, ...(error.details ? { check: error.details } : {}) });
      throw error;
    }
  })
);

/** Move a stage's scheduled, not yet started work to its current definition (audited). */
router.post(
  '/integrations/:integrationId/stages/:stageId/repin',
  requirePermission('stages:replay'),
  asyncHandler(async (req, res) => {
    const integration = await loadIntegration(req.orgId, req.params.integrationId);
    const found = findStage(integration, req.params.stageId);
    if (!found) throw new NotFoundError('Stage not found');
    const current = found.stage;
    const hash = await store.definitions.saveDefinition(req.orgId, normalizeStage(current));
    const moved = await jobs.repinJobs(req.orgId, req.params.integrationId, req.params.stageId, hash);
    await audit(req, {
      action: 'stage_jobs_repinned',
      resourceType: 'stage',
      resourceId: `${req.params.integrationId}:${req.params.stageId}`,
      metadata: { definitionHash: hash, jobs: moved, reason: (req.body && req.body.reason) || null },
    });
    res.json({ moved, definitionHash: hash });
  })
);

router.get(
  '/integrations/:integrationId/stages/:stageId/jobs',
  asyncHandler(async (req, res) => {
    res.json({ byState: await jobs.countByState(req.orgId, req.params.integrationId, req.params.stageId) });
  })
);

/** Delivery outcomes per stage (latest states) and execution metrics (runs), kept apart. */
router.get(
  '/results',
  asyncHandler(async (req, res) => {
    const filters = { integrationId: req.query.integrationId, stageId: req.query.stageId, from: req.query.from, to: req.query.to };
    const [outcomes, executions] = await Promise.all([
      store.state.outcomeCounts(req.orgId, filters),
      store.runs.executionMetrics(req.orgId, filters),
    ]);
    res.json({ outcomes, executions, dated: { outcomes: 'accepted-send time', executions: 'run time' } });
  })
);

/**
 * How an integration's deliveries and stages ended over the last `hours` (default 24):
 * the numbers on the canvas's branches. Facts only; see stages/flow-stats.js.
 */
router.get(
  '/flow-stats',
  asyncHandler(async (req, res) => {
    if (!req.query.integrationId) throw new ValidationError('integrationId is required');
    const integration = await loadIntegration(req.orgId, req.query.integrationId);
    if (!integration) throw new NotFoundError('Integration not found');
    res.json(await flowStats(req.orgId, integration, { hours: req.query.hours }));
  })
);

/**
 * What saving a draft would do to scheduled checks already waiting (keep their
 * version, pause, resume, cancel). Body: { integrationId, integration: the draft's
 * stages / actions }. Nothing is saved.
 */
router.post(
  '/save-impact',
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    if (!body.integrationId) throw new ValidationError('integrationId is required');
    const existing = await loadIntegration(req.orgId, body.integrationId);
    if (!existing) throw new NotFoundError('Integration not found');
    const draft = { ...existing, ...(body.integration || {}) };
    const checked = validateIntegrationStages(draft, { runners });
    if (!checked.ok) throw new ValidationError('The draft stages are not valid', checked.errors);
    const rows = await jobs.hashCounts(req.orgId, body.integrationId);
    const hashOf = (stage) => store.definitions.definitionHash(req.orgId, normalizeStage(stage));
    res.json(saveImpact(existing, checked.integration, rows, hashOf));
  })
);

/** The statuses, skips and failures a stage can end with, read from its configuration. Body: { stage }. */
router.post('/outcomes', (req, res) => {
  const stage = req.body && req.body.stage;
  if (!stage || typeof stage !== 'object') throw new ValidationError('A stage is required');
  res.json({ outcomes: stageOutcomes(stage, runners) });
});

/** What a step at a hook sees, may do and must return: the guide an AI (or a person) writes against. */
router.get('/authoring-guide', (req, res) => {
  res.json(buildGuide({ hook: req.query.hook }));
});

router.get(
  '/usage',
  asyncHandler(async (req, res) => {
    res.json(await usageToday(req.orgId));
  })
);

router.get('/runtime', (_req, res) => {
  const { ready, mode, isolated, checks, problems } = getStageRuntime();
  res.json({ ready, mode, isolated, checks, problems, switchedOff: Boolean((config.stages || {}).disabled) });
});

module.exports = router;
