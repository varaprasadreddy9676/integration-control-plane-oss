'use strict';

/**
 * Integration history: list the saved revisions of an outbound, inbound or
 * scheduled integration, compare them, and restore an earlier configuration.
 *
 *   GET  /integration-history/:id/revisions
 *   GET  /integration-history/:id/revisions/:revision
 *   GET  /integration-history/:id/revisions/:revision/diff?against=current|<revision>
 *   POST /integration-history/:id/revisions/:revision/restore
 *
 * Every response masks credentials. A restore changes configuration only, never
 * whether the integration is active.
 */

const express = require('express');
const { ObjectId } = require('mongodb');
const mongodb = require('../mongodb');
const { log, logError } = require('../logger');
const history = require('../data/integration-revisions');
const { userHasPermission } = require('../rbac/permissions');
const { auditIntegration, auditScheduledJob } = require('../middleware/audit');
const { maskIntegrationSecrets } = require('../utils/integration-secrets');

const router = express.Router();

const SCHEDULED_DIRECTIONS = new Set(['SCHEDULED', 'SCRIPT_JOB']);
const VIEW_PERMISSION = 'integration:version_history';
const editPermissionFor = (direction) => (SCHEDULED_DIRECTIONS.has(direction) ? 'scheduled:edit' : 'integration:edit');

/** The integration in the caller's organization, or an error already sent. */
async function loadIntegration(req, res) {
  if (!req.orgId) {
    res.status(400).json({ error: 'orgId is required' });
    return null;
  }
  if (!userHasPermission(req.user, VIEW_PERMISSION)) {
    res.status(403).json({ error: 'You do not have permission to view integration history' });
    return null;
  }
  if (!ObjectId.isValid(req.params.integrationId)) {
    res.status(400).json({ error: 'Invalid integration id' });
    return null;
  }
  const db = await mongodb.getDbSafe();
  const integration = await db
    .collection('integration_configs')
    .findOne({ _id: new ObjectId(req.params.integrationId), orgId: req.orgId });
  if (!integration) {
    res.status(404).json({ error: 'Integration not found' });
    return null;
  }
  return integration;
}

const parseRevision = (value) => {
  const revision = Number(value);
  return Number.isInteger(revision) && revision > 0 ? revision : null;
};

router.get('/:integrationId/revisions', async (req, res) => {
  try {
    const integration = await loadIntegration(req, res);
    if (!integration) return;
    const revisions = await history.listRevisions(req.orgId, integration._id, { limit: req.query.limit });
    res.json({
      integration: { id: String(integration._id), name: integration.name, direction: integration.direction },
      revisions,
    });
  } catch (error) {
    logError(error, { scope: 'GET /integration-history/:id/revisions' });
    res.status(500).json({ error: 'Failed to load integration history' });
  }
});

router.get('/:integrationId/revisions/:revision', async (req, res) => {
  try {
    const integration = await loadIntegration(req, res);
    if (!integration) return;
    const revision = parseRevision(req.params.revision);
    const found = revision && (await history.getRevision(req.orgId, integration._id, revision));
    if (!found) return res.status(404).json({ error: 'Revision not found' });
    res.json({ ...found, snapshot: maskIntegrationSecrets(found.snapshot) });
  } catch (error) {
    logError(error, { scope: 'GET /integration-history/:id/revisions/:revision' });
    res.status(500).json({ error: 'Failed to load revision' });
  }
});

router.get('/:integrationId/revisions/:revision/diff', async (req, res) => {
  try {
    const integration = await loadIntegration(req, res);
    if (!integration) return;
    const revision = parseRevision(req.params.revision);
    const against = req.query.against === undefined || req.query.against === 'current' ? 'current' : parseRevision(req.query.against);
    if (!revision || !against) return res.status(400).json({ error: 'Invalid revision' });
    const diff = await history.diffRevision(req.orgId, integration._id, revision, against);
    if (!diff) return res.status(404).json({ error: 'Revision not found' });
    res.json(diff);
  } catch (error) {
    logError(error, { scope: 'GET /integration-history/:id/revisions/:revision/diff' });
    res.status(500).json({ error: 'Failed to compare revisions' });
  }
});

/** Make the restored configuration take effect the way a normal save would. */
function applyRestoreSideEffects(before, after) {
  if (!SCHEDULED_DIRECTIONS.has(after.direction)) return;
  const { getScheduledJobWorker } = require('../processor/scheduled-job-worker');
  const worker = getScheduledJobWorker();
  if (after.isActive) worker.scheduleJob(after);
  else worker.unscheduleJob(String(after._id));

  const depsChanged =
    JSON.stringify(before.dependencies || null) !== JSON.stringify(after.dependencies || null) ||
    before.script !== after.script;
  if (after.direction === 'SCRIPT_JOB' && depsChanged) {
    const { triggerDependencyInstall } = require('./scheduled-jobs');
    mongodb.getDbSafe().then((db) => triggerDependencyInstall(db, after));
  }
}

router.post('/:integrationId/revisions/:revision/restore', async (req, res) => {
  try {
    const integration = await loadIntegration(req, res);
    if (!integration) return;
    if (!userHasPermission(req.user, editPermissionFor(integration.direction))) {
      return res.status(403).json({ error: 'You do not have permission to change this integration' });
    }
    const revision = parseRevision(req.params.revision);
    const result = revision && (await history.restoreRevision(req.orgId, integration._id, revision));
    if (!result) return res.status(404).json({ error: 'Revision not found' });

    applyRestoreSideEffects(result.before, result.after);

    const changes = {
      before: maskIntegrationSecrets(result.before),
      after: maskIntegrationSecrets(result.after),
      restoredFromRevision: revision,
    };
    if (SCHEDULED_DIRECTIONS.has(integration.direction)) {
      await auditScheduledJob.updated(req, String(integration._id), changes);
    } else {
      await auditIntegration.updated(req, String(integration._id), changes);
    }
    log('info', 'Integration restored from history', {
      integrationId: String(integration._id),
      orgId: req.orgId,
      restoredFrom: revision,
    });

    res.json({ restoredFrom: revision, revision: result.revision?.revision || null });
  } catch (error) {
    logError(error, { scope: 'POST /integration-history/:id/revisions/:revision/restore' });
    res.status(500).json({ error: 'Failed to restore revision' });
  }
});

module.exports = router;
