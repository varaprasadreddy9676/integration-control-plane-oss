const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');

const { getDb } = require('../mongodb');
const { log, logError } = require('../logger');
const { getScheduledJobWorker } = require('../processor/scheduled-job-worker');
const { executeDataSource } = require('../services/data-source-executor');
const { setSecret, getSecret, deleteSecret } = require('../services/gateway-secrets');
const {
  installDependencies,
  validateDependencies,
  normalizeDependencies,
  getJobDir,
} = require('../services/node-script-runner');
const cron = require('node-cron');
const { auditScheduledJob } = require('../middleware/audit');
const { captureRevision } = require('../data/integration-revisions');
const { maskIntegrationSecrets, restoreMaskedSecrets, containsSecretMask } = require('../utils/integration-secrets');
const { requirePermission, requireSuperAdmin } = require('../middleware/permission');
const { applyCursorHint } = require('../utils/index-hints');

function buildOrgScopeQuery(orgId) {
  return { orgId };
}

const ENV_VAR_KEY_RE = /^[A-Z_][A-Z0-9_]*$/;
const MAX_SCRIPT_JOB_ENV_VARS = 100;

function sanitizeJobForResponse(rawJob) {
  if (!rawJob) return rawJob;
  // Credentials (auth tokens, data source passwords, keys inside URLs) are masked
  // like every other integration response; a save sending the mask back keeps them.
  const job = maskIntegrationSecrets(rawJob);
  if (!Array.isArray(job.environmentVariables)) return job;
  return {
    ...job,
    environmentVariables: job.environmentVariables.map(({ key, secretKey, hasValue, updatedAt, createdAt }) => ({
      key,
      secretKey,
      hasValue: hasValue !== false,
      updatedAt,
      createdAt,
    })),
  };
}

async function prepareScriptJobEnvironmentVariables({ rows, orgId, jobId, existingRows = [] }) {
  if (rows === undefined || rows === null) {
    return existingRows;
  }

  if (!Array.isArray(rows)) {
    const err = new Error('environmentVariables must be an array');
    err.statusCode = 400;
    throw err;
  }

  if (rows.length > MAX_SCRIPT_JOB_ENV_VARS) {
    const err = new Error(`A Script Job can define at most ${MAX_SCRIPT_JOB_ENV_VARS} environment variables`);
    err.statusCode = 400;
    throw err;
  }

  const existingByKey = new Map(
    existingRows
      .filter((row) => row && row.key && row.secretKey)
      .map((row) => [String(row.key).trim().toUpperCase(), row])
  );
  const seen = new Set();
  const prepared = [];

  for (const rawRow of rows) {
    const key = String(rawRow?.key || '')
      .trim()
      .toUpperCase();
    if (!key && !rawRow?.value) continue;

    if (!ENV_VAR_KEY_RE.test(key)) {
      const err = new Error(`Invalid environment variable key: ${key || '(blank)'}`);
      err.statusCode = 400;
      throw err;
    }
    if (seen.has(key)) {
      const err = new Error(`Duplicate environment variable key: ${key}`);
      err.statusCode = 400;
      throw err;
    }
    seen.add(key);

    const existing = existingByKey.get(key);
    const secretKey = existing?.secretKey || `script-job:${jobId}:${key}`;
    const hasNewValue =
      Object.hasOwn(rawRow, 'value') && rawRow.value !== undefined && rawRow.value !== null && rawRow.value !== '';

    if (hasNewValue) {
      await setSecret(secretKey, String(rawRow.value), orgId);
    } else if (!existing) {
      const err = new Error(`Environment variable ${key} needs a value before saving`);
      err.statusCode = 400;
      throw err;
    }

    prepared.push({
      key,
      secretKey,
      hasValue: true,
      updatedAt: hasNewValue ? new Date() : existing?.updatedAt,
      createdAt: existing?.createdAt || new Date(),
    });
  }

  // Clean up secrets for keys that were removed from the row list on this save.
  for (const [key, existing] of existingByKey) {
    if (!seen.has(key) && existing?.secretKey) {
      await deleteSecret(existing.secretKey, orgId).catch((err) => {
        log('warn', 'Failed to delete orphaned Script Job env var secret', {
          secretKey: existing.secretKey,
          error: err.message,
        });
      });
    }
  }

  return prepared;
}

// Fire-and-forget: npm install can take a while, so don't block the save request on it.
// The job's depsStatus/depsInstallLog fields are updated in Mongo once install finishes.
function triggerDependencyInstall(db, job) {
  if (job.runtime !== 'NODE_PROCESS') return;

  const collection = db.collection('integration_configs');
  collection.updateOne({ _id: job._id }, { $set: { depsStatus: 'installing' } }).catch(() => {});

  installDependencies(job)
    .then(async (result) => {
      if (!result.success) {
        return collection.updateOne(
          { _id: job._id },
          {
            $set: {
              depsStatus: 'failed',
              depsInstallLog: result.output,
              depsValidation: null,
              depsInstalledAt: new Date(),
            },
          }
        );
      }

      // npm install succeeding doesn't guarantee the packages actually load under
      // this server's Node binary (e.g. a transitive dependency requiring a newer
      // Node than production's). Probe each declared package with a real require()
      // so incompatibilities surface here instead of at the next cron run.
      const validation = await validateDependencies(job);
      return collection.updateOne(
        { _id: job._id },
        {
          $set: {
            depsStatus: validation.success ? 'installed' : 'failed',
            depsInstallLog: result.output,
            depsValidation: validation.results,
            depsNodeVersion: validation.nodeVersion,
            depsInstalledAt: new Date(),
          },
        }
      );
    })
    .catch((err) => {
      log('error', 'Node Script Job dependency install failed unexpectedly', {
        jobId: job._id.toString(),
        error: err.message,
      });
      collection
        .updateOne(
          { _id: job._id },
          { $set: { depsStatus: 'failed', depsInstallLog: err.message, depsInstalledAt: new Date() } }
        )
        .catch(() => {});
    });
}

/**
 * Scheduled Jobs API Routes
 * Manage cron-based and interval-based batch integrations
 */

/**
 * GET /scheduled-jobs
 * List all scheduled jobs for an organization
 */
router.get('/', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const jobs = await collection
      .find({
        direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
        ...buildOrgScopeQuery(orgId),
      })
      .sort({ createdAt: -1 })
      .toArray();

    // Batch-fetch latest execution per job — one aggregation instead of N findOne calls
    if (jobs.length > 0) {
      const logsCollection = db.collection('scheduled_job_logs');
      const jobIds = jobs.map((j) => j._id);

      const latestLogs = await logsCollection
        .aggregate(
          [
            { $match: { integrationId: { $in: jobIds } } },
            // DESC sort matches job_started_idx {integrationId:1, startedAt:-1}
            { $sort: { integrationId: 1, startedAt: -1 } },
            {
              $group: {
                _id: '$integrationId',
                status: { $first: '$status' },
                startedAt: { $first: '$startedAt' },
                completedAt: { $first: '$completedAt' },
                durationMs: { $first: '$durationMs' },
                recordsFetched: { $first: '$recordsFetched' },
              },
            },
          ],
          { hint: 'job_started_idx', allowDiskUse: false }
        )
        .toArray();

      const latestLogMap = new Map(latestLogs.map((l) => [l._id.toString(), l]));

      for (const job of jobs) {
        const latestLog = latestLogMap.get(job._id.toString());
        job.lastExecution = latestLog
          ? {
              status: latestLog.status,
              startedAt: latestLog.startedAt,
              completedAt: latestLog.completedAt,
              durationMs: latestLog.durationMs,
              recordsFetched: latestLog.recordsFetched,
            }
          : null;
      }
    } else {
      for (const job of jobs) {
        job.lastExecution = null;
      }
    }

    res.json(jobs.map(sanitizeJobForResponse));
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs' });
    res.status(500).json({ error: 'Failed to fetch scheduled jobs' });
  }
});

/**
 * POST /scheduled-jobs
 * Create a new scheduled job
 */
router.post('/', requirePermission('scheduled:create'), async (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const jobConfig = req.body;

    // Validate required fields
    if (!jobConfig.name) {
      return res.status(400).json({ error: 'Job name is required' });
    }

    if (!jobConfig.schedule || !jobConfig.schedule.type) {
      return res.status(400).json({ error: 'Schedule configuration is required' });
    }

    const isScriptJob = jobConfig.direction === 'SCRIPT_JOB' || jobConfig.jobType === 'SCRIPT_JOB';

    if (isScriptJob && (!jobConfig.script || !String(jobConfig.script).trim())) {
      return res.status(400).json({ error: 'Script is required for SCRIPT_JOB' });
    }

    if (!isScriptJob && (!jobConfig.dataSource || !jobConfig.dataSource.type)) {
      return res.status(400).json({ error: 'Data source configuration is required' });
    }

    if (!isScriptJob && !jobConfig.targetUrl) {
      return res.status(400).json({ error: 'Target URL is required' });
    }

    // Validate cron expression if type is CRON
    if (jobConfig.schedule.type === 'CRON') {
      if (!cron.validate(jobConfig.schedule.expression)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Validate interval if type is INTERVAL
    if (jobConfig.schedule.type === 'INTERVAL') {
      if (!jobConfig.schedule.intervalMs || jobConfig.schedule.intervalMs < 60000) {
        return res.status(400).json({
          error: 'Interval must be at least 60000ms (1 minute)',
        });
      }
    }

    const jobId = new ObjectId();
    const environmentVariables = isScriptJob
      ? await prepareScriptJobEnvironmentVariables({
          rows: jobConfig.environmentVariables,
          orgId,
          jobId: jobId.toString(),
          existingRows: [],
        })
      : undefined;

    const isNodeProcess = isScriptJob && jobConfig.runtime === 'NODE_PROCESS';

    // Set defaults
    const newJob = {
      ...jobConfig,
      _id: jobId,
      direction: isScriptJob ? 'SCRIPT_JOB' : 'SCHEDULED',
      orgId,
      isActive: jobConfig.isActive !== undefined ? jobConfig.isActive : true,
      httpMethod: isScriptJob ? undefined : jobConfig.httpMethod || 'POST',
      environmentVariables: isScriptJob ? environmentVariables : undefined,
      dependencies: isNodeProcess
        ? Object.entries(normalizeDependencies(jobConfig.dependencies)).map(([name, version]) => ({ name, version }))
        : undefined,
      depsStatus: isNodeProcess ? 'pending' : undefined,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save to database
    const db = await getDb();
    const collection = db.collection('integration_configs');

    await collection.insertOne(newJob);
    await captureRevision({ integrationId: newJob._id, source: 'CREATED' });
    triggerDependencyInstall(db, newJob);

    // Schedule the job if active
    if (newJob.isActive) {
      const worker = getScheduledJobWorker();
      worker.scheduleJob(newJob);
    }

    log('info', 'Scheduled job created', {
      jobId: newJob._id.toString(),
      name: newJob.name,
      orgId,
    });

    await auditScheduledJob.created(req, newJob);

    res.status(201).json(sanitizeJobForResponse(newJob));
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs' });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Failed to create scheduled job',
    });
  }
});

/**
 * GET /scheduled-jobs/:id
 * Get scheduled job details
 */
router.get('/:id', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const collection = db.collection('integration_configs');

    const job = await collection.findOne({
      _id: new ObjectId(id),
      direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    res.json(sanitizeJobForResponse(job));
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id' });
    res.status(500).json({ error: 'Failed to fetch scheduled job' });
  }
});

/**
 * PUT /scheduled-jobs/:id
 * Update scheduled job
 */
router.put('/:id', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    let updates = req.body;
    // Validate cron expression if being updated
    if (updates.schedule?.type === 'CRON' && updates.schedule?.expression) {
      if (!cron.validate(updates.schedule.expression)) {
        return res.status(400).json({ error: 'Invalid cron expression' });
      }
    }

    // Validate interval if being updated
    if (updates.schedule?.type === 'INTERVAL' && updates.schedule?.intervalMs) {
      if (updates.schedule.intervalMs < 60000) {
        return res.status(400).json({
          error: 'Interval must be at least 60000ms (1 minute)',
        });
      }
    }

    const db = await getDb();
    const collection = db.collection('integration_configs');

    const beforeJob = await collection.findOne({
      _id: new ObjectId(id),
      direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
      ...buildOrgScopeQuery(orgId),
    });

    if (!beforeJob) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Masked credentials sent back by the edit form keep their stored values.
    updates = restoreMaskedSecrets(updates || {}, beforeJob);
    if (containsSecretMask(updates)) {
      return res.status(400).json({
        error: 'A hidden value could not be matched to the stored one. Enter the full value again (for example the whole URL).',
      });
    }

    // Remove fields that shouldn't be updated
    delete updates._id;
    delete updates.direction;
    if (Object.hasOwn(updates, 'tenantId')) {
      return res.status(400).json({ error: 'tenantId is not supported. Use orgId.' });
    }
    delete updates.createdAt;

    if (beforeJob.direction === 'SCRIPT_JOB' && Object.hasOwn(updates, 'environmentVariables')) {
      updates.environmentVariables = await prepareScriptJobEnvironmentVariables({
        rows: updates.environmentVariables,
        orgId,
        jobId: beforeJob._id.toString(),
        existingRows: beforeJob.environmentVariables || [],
      });
    } else if (beforeJob.direction !== 'SCRIPT_JOB') {
      delete updates.environmentVariables;
    }

    const willBeNodeProcess =
      beforeJob.direction === 'SCRIPT_JOB' && (updates.runtime || beforeJob.runtime) === 'NODE_PROCESS';
    // Only reset depsStatus when dependencies/script actually changed, not merely
    // because the field was present in the PUT body — the edit form resubmits the
    // whole job on every save (e.g. just editing an environment variable), so a
    // bare Object.hasOwn() check here wiped a validated "installed" status on every
    // unrelated save, forcing a needless reinstall/revalidate despite node_modules
    // being untouched.
    // Order-independent: dependency arrays are unordered sets from the caller's
    // perspective (the form may resubmit them in a different order than stored).
    const canonicalDependencies = (deps) =>
      JSON.stringify(Object.entries(normalizeDependencies(deps)).sort(([a], [b]) => a.localeCompare(b)));
    const dependenciesActuallyChanged =
      Object.hasOwn(updates, 'dependencies') &&
      canonicalDependencies(updates.dependencies) !== canonicalDependencies(beforeJob.dependencies);
    const scriptActuallyChanged =
      Object.hasOwn(updates, 'script') && willBeNodeProcess && updates.script !== beforeJob.script;
    const depsOrScriptChanged = dependenciesActuallyChanged || scriptActuallyChanged;

    if (willBeNodeProcess && Object.hasOwn(updates, 'dependencies')) {
      updates.dependencies = Object.entries(normalizeDependencies(updates.dependencies)).map(([name, version]) => ({
        name,
        version,
      }));
    }
    if (willBeNodeProcess && depsOrScriptChanged) {
      updates.depsStatus = 'pending';
    }

    updates.updatedAt = new Date();

    const updateResult = await collection.findOneAndUpdate(
      {
        _id: new ObjectId(id),
        direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
        ...buildOrgScopeQuery(orgId),
      },
      { $set: updates },
      { returnDocument: 'after' }
    );
    // mongodb driver 4.x findOneAndUpdate returns { value, lastErrorObject, ok } —
    // not the document itself. Every other call site in this codebase unwraps
    // `.value`; this one didn't, so `result.isActive` was always undefined and
    // every PUT silently unscheduled the job instead of rescheduling it, with no
    // error anywhere (this is what caused Tailspin/HTTP Transfer Report to go silent).
    const result = updateResult?.value || null;

    if (!result) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }
    await captureRevision({ integrationId: result._id, source: 'UPDATED', previous: beforeJob });

    if (willBeNodeProcess && depsOrScriptChanged) {
      triggerDependencyInstall(db, result);
    }

    // Reschedule the job
    const worker = getScheduledJobWorker();

    if (result.isActive) {
      worker.scheduleJob(result);
    } else {
      worker.unscheduleJob(id);
    }

    log('info', 'Scheduled job updated', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.updated(req, id, { before: beforeJob, after: result });

    res.json(sanitizeJobForResponse(result));
  } catch (error) {
    logError(error, { scope: 'PUT /scheduled-jobs/:id' });
    res.status(error.statusCode || 500).json({
      error: error.statusCode ? error.message : 'Failed to update scheduled job',
    });
  }
});

/**
 * DELETE /scheduled-jobs/:id
 * Delete scheduled job
 */
router.delete('/:id', requirePermission('scheduled:delete'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const collection = db.collection('integration_configs');

    const beforeJob = await collection.findOne({
      _id: new ObjectId(id),
      direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
      ...buildOrgScopeQuery(orgId),
    });

    const result = await collection.deleteOne({
      _id: new ObjectId(id),
      direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
      ...buildOrgScopeQuery(orgId),
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Clean up any env var secrets owned by this Script Job
    if (beforeJob?.direction === 'SCRIPT_JOB' && Array.isArray(beforeJob.environmentVariables)) {
      for (const row of beforeJob.environmentVariables) {
        if (row?.secretKey) {
          await deleteSecret(row.secretKey, orgId).catch((err) => {
            log('warn', 'Failed to delete Script Job env var secret on job deletion', {
              secretKey: row.secretKey,
              error: err.message,
            });
          });
        }
      }
    }

    // Clean up the on-disk script + node_modules directory for Node Process jobs
    if (beforeJob?.runtime === 'NODE_PROCESS') {
      require('fs').rm(getJobDir(id), { recursive: true, force: true }, (err) => {
        if (err) log('warn', 'Failed to clean up Node Script Job directory', { jobId: id, error: err.message });
      });
    }

    // Unschedule the job
    const worker = getScheduledJobWorker();
    worker.unscheduleJob(id);

    log('info', 'Scheduled job deleted', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.deleted(req, id, beforeJob);

    res.json({ message: 'Scheduled job deleted successfully' });
  } catch (error) {
    logError(error, { scope: 'DELETE /scheduled-jobs/:id' });
    res.status(500).json({ error: 'Failed to delete scheduled job' });
  }
});

/**
 * POST /scheduled-jobs/:id/execute
 * Manually trigger job execution
 */
router.post('/:id/execute', requirePermission('scheduled:execute'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const collection = db.collection('integration_configs');

    const job = await collection.findOne({
      _id: new ObjectId(id),
      direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    // Execute job immediately
    const worker = getScheduledJobWorker();
    const executionOptions = {
      dryRun: req.body?.dryRun === true,
      reason: typeof req.body?.reason === 'string' ? req.body.reason.trim() : null,
      triggeredBy: req.user?.id || req.user?.email || null,
      trigger: 'MANUAL',
    };
    worker.executeJob(job, executionOptions); // Fire and forget

    log('info', 'Scheduled job manually triggered', {
      jobId: id,
      orgId,
    });

    await auditScheduledJob.executed(req, id);

    res.json({
      message: executionOptions.dryRun ? 'Dry-run job execution triggered' : 'Job execution triggered',
      dryRun: executionOptions.dryRun,
    });
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs/:id/execute' });
    res.status(500).json({ error: 'Failed to trigger job execution' });
  }
});

/**
 * POST /scheduled-jobs/:id/install-deps
 * Manually re-trigger npm install for a Node Process Script Job
 */
router.post('/:id/install-deps', requirePermission('scheduled:edit'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const collection = db.collection('integration_configs');

    const job = await collection.findOne({
      _id: new ObjectId(id),
      direction: 'SCRIPT_JOB',
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }
    if (job.runtime !== 'NODE_PROCESS') {
      return res.status(400).json({ error: 'Dependency install only applies to NODE_PROCESS runtime jobs' });
    }

    triggerDependencyInstall(db, job);
    res.json({ message: 'Dependency install triggered', depsStatus: 'installing' });
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs/:id/install-deps' });
    res.status(500).json({ error: 'Failed to trigger dependency install' });
  }
});

/**
 * GET /scheduled-jobs/:id/environment-variables/:key/reveal
 * Decrypt and return a single Script Job environment variable's current value.
 *
 * These values are never included in the job GET response (sanitizeJobForResponse
 * strips them), which is right for real secrets — but for non-sensitive rows like
 * an EMAIL_TO address, it means the user can't see what's already saved before
 * editing it (e.g. appending a second recipient), and has no way to avoid
 * accidentally clobbering the existing value. Gated to Super Admin only, since
 * these can include DB passwords and other credentials.
 */
router.get('/:id/environment-variables/:key/reveal', requireSuperAdmin, async (req, res) => {
  try {
    const { id, key } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const job = await db.collection('integration_configs').findOne({
      _id: new ObjectId(id),
      direction: 'SCRIPT_JOB',
      ...buildOrgScopeQuery(orgId),
    });

    if (!job) {
      return res.status(404).json({ error: 'Scheduled job not found' });
    }

    const row = (job.environmentVariables || []).find((r) => r.key === key);
    if (!row || !row.secretKey) {
      return res.status(404).json({ error: 'Environment variable not found' });
    }

    const value = await getSecret(row.secretKey, orgId);
    if (value === null) {
      return res.status(404).json({ error: 'Value not found' });
    }

    res.json({ key, value });
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id/environment-variables/:key/reveal' });
    res.status(500).json({ error: 'Failed to reveal environment variable' });
  }
});

/**
 * GET /scheduled-jobs/:id/logs
 * Get execution logs for a job
 */
router.get('/:id/logs', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const { id } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const { limit = 50, offset = 0, status } = req.query;

    const db = await getDb();
    const logsCollection = db.collection('scheduled_job_logs');

    const filter = {
      integrationId: new ObjectId(id),
      orgId,
    };

    if (status) {
      filter.status = status;
    }

    const [logs, total] = await Promise.all([
      applyCursorHint(logsCollection.find(filter), 'job_started_idx')
        .sort({ startedAt: -1 })
        .skip(parseInt(offset, 10))
        .limit(parseInt(limit, 10))
        .toArray(),
      logsCollection.countDocuments(filter, { hint: 'job_started_idx' }),
    ]);

    res.set('X-Total-Count', total.toString());
    res.json(logs);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id/logs' });
    res.status(500).json({ error: 'Failed to fetch execution logs' });
  }
});

/**
 * GET /scheduled-jobs/:id/logs/:logId
 * Get single execution log detail
 */
router.get('/:id/logs/:logId', requirePermission('scheduled:view'), async (req, res) => {
  try {
    const { id, logId } = req.params;
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    const db = await getDb();
    const logsCollection = db.collection('scheduled_job_logs');

    const log = await logsCollection.findOne({
      _id: new ObjectId(logId),
      integrationId: new ObjectId(id),
      orgId,
    });

    if (!log) {
      return res.status(404).json({ error: 'Execution log not found' });
    }

    res.json(log);
  } catch (error) {
    logError(error, { scope: 'GET /scheduled-jobs/:id/logs/:logId' });
    res.status(500).json({ error: 'Failed to fetch execution log' });
  }
});

/**
 * POST /scheduled-jobs/test-datasource
 * Test data source configuration and return sample data
 */
router.post('/test-datasource', requirePermission('scheduled:create'), async (req, res) => {
  try {
    const orgId = req.orgId;
    if (!orgId) {
      return res.status(400).json({ error: 'orgId is required' });
    }
    let { dataSource } = req.body;

    if (!dataSource || !dataSource.type) {
      return res.status(400).json({ error: 'Data source configuration is required' });
    }

    // Testing a saved job from its edit form: hidden values come from the stored job.
    if (req.body.jobId && ObjectId.isValid(req.body.jobId)) {
      const db = await getDb();
      const stored = await db.collection('integration_configs').findOne({
        _id: new ObjectId(req.body.jobId),
        direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
        ...buildOrgScopeQuery(orgId),
      });
      if (stored) dataSource = restoreMaskedSecrets({ dataSource }, { dataSource: stored.dataSource }).dataSource;
    }
    if (containsSecretMask({ dataSource })) {
      return res.status(400).json({ error: 'A hidden value could not be filled in. Enter it again to test.' });
    }

    // Create a mock integration config for testing
    const mockIntegrationConfig = {
      orgId,
      name: 'Test Data Source',
      _id: 'test',
    };

    log('info', 'Testing data source', {
      type: dataSource.type,
      orgId,
    });

    // Execute data source with 30 second timeout
    let timeoutHandle;
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error('Data source test timed out after 30 seconds')), 30000);
    });

    const executePromise = executeDataSource(dataSource, mockIntegrationConfig);

    // Same leak class fixed in src/utils/timeout.js: Promise.race never cancels
    // the loser, so every successful test (the common case) left this 30s timer
    // running in the background.
    const result = await Promise.race([executePromise, timeout]).finally(() => clearTimeout(timeoutHandle));

    // Limit result size for response
    let sampleData = result;
    const totalRecords = Array.isArray(result) ? result.length : 1;
    let limitedRecords = false;

    if (Array.isArray(result) && result.length > 10) {
      sampleData = result.slice(0, 10);
      limitedRecords = true;
    }

    // Check data size and truncate if needed
    const dataString = JSON.stringify(sampleData);
    if (dataString.length > 100000) {
      // Truncate large data
      sampleData = { message: 'Data too large to display', size: dataString.length };
      limitedRecords = true;
    }

    log('info', 'Data source test successful', {
      type: dataSource.type,
      recordsFetched: totalRecords,
      orgId,
    });

    res.json({
      success: true,
      message: 'Data source connected successfully',
      recordsFetched: totalRecords,
      sampleData,
      limitedRecords,
    });
  } catch (error) {
    logError(error, { scope: 'POST /scheduled-jobs/test-datasource' });

    // Return detailed error information
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to test data source',
      details: {
        code: error.code,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      },
    });
  }
});

module.exports = router;
// Integration history reuses it when a restore changes a script job's dependencies.
module.exports.triggerDependencyInstall = triggerDependencyInstall;
