const cron = require('node-cron');
const { uuidv4 } = require('../utils/runtime');
const { log } = require('../logger');
const { getDbSafe } = require('../mongodb');
const { executeDataSource } = require('../services/data-source-executor');
const transformer = require('../services/transformer');
const { buildAuthHeaders } = require('./auth-helper');
const { applyProviderRef } = require('../services/operation-templates');
const axios = require('axios');
const { createExecutionLogger } = require('../utils/execution-logger');
const {
  markWorkerRunError,
  markWorkerRunStart,
  markWorkerRunSuccess,
  setWorkerState,
  stopWorker,
  updateHeartbeat,
} = require('../worker-heartbeat');
const { applyTransform } = transformer;
const getTransformationSkipReason = transformer.getTransformationSkipReason || (() => null);
const isTransformationSkipped = transformer.isTransformationSkipped || (() => false);
const { runScriptJob } = require('../services/script-job-runner');
const { runNodeScriptJob } = require('../services/node-script-runner');

/**
 * Scheduled Job Worker
 * Manages cron-based and interval-based scheduled jobs
 * Reuses existing transformation, authentication, and delivery logic
 */

class ScheduledJobWorker {
  constructor() {
    this.scheduledTasks = new Map(); // jobId -> cron task
    this.runningJobs = new Set(); // jobId -> in-process overlap guard
    this.isRunning = false;
    this.heartbeatTimer = null;
  }

  /**
   * Initialize worker and load all active scheduled jobs
   */
  async start() {
    if (this.isRunning) {
      log('warn', 'Scheduled job worker already running');
      return;
    }

    this.isRunning = true;
    setWorkerState('scheduledJobWorker', {
      enabled: true,
      running: true,
      startedAt: new Date(),
      thresholdMs: 180000,
      meta: {
        scheduledTaskCount: this.scheduledTasks.size,
      },
    });
    this.startHeartbeat();
    log('info', 'Starting scheduled job worker');

    try {
      await this.loadActiveJobs();
      log('info', 'Scheduled job worker started successfully');
    } catch (error) {
      log('error', 'Failed to start scheduled job worker', { error: error.message });
      this.isRunning = false;
      markWorkerRunError('scheduledJobWorker', error);
      throw error;
    }
  }

  startHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }

    updateHeartbeat('scheduledJobWorker', {
      running: this.isRunning,
      meta: {
        scheduledTaskCount: this.scheduledTasks.size,
      },
    });

    this.heartbeatTimer = setInterval(() => {
      updateHeartbeat('scheduledJobWorker', {
        running: this.isRunning,
        meta: {
          scheduledTaskCount: this.scheduledTasks.size,
        },
      });
    }, 30000);
  }

  /**
   * Load all active SCHEDULED integrations from database
   */
  async loadActiveJobs() {
    try {
      const db = await getDbSafe();
      const collection = db.collection('integration_configs');

      const scheduledJobs = await collection
        .find({
          direction: { $in: ['SCHEDULED', 'SCRIPT_JOB'] },
          isActive: true,
        })
        .toArray();

      log('info', `Found ${scheduledJobs.length} active scheduled jobs`);

      for (const job of scheduledJobs) {
        this.scheduleJob(job);
      }
    } catch (error) {
      log('error', 'Failed to load active jobs', { error: error.message });
      throw error;
    }
  }

  /**
   * Schedule a single job using cron or interval
   */
  scheduleJob(jobConfig) {
    const jobId = jobConfig._id.toString();

    // Remove existing schedule if present
    this.unscheduleJob(jobId);

    try {
      const { schedule } = jobConfig;

      if (schedule.type === 'CRON') {
        // Validate cron expression
        if (!cron.validate(schedule.expression)) {
          log('error', 'Invalid cron expression', {
            jobId,
            expression: schedule.expression,
          });
          return;
        }

        // Schedule with node-cron
        const task = cron.schedule(schedule.expression, () => this.executeJob(jobConfig), {
          scheduled: true,
          timezone: schedule.timezone || 'UTC',
        });

        this.scheduledTasks.set(jobId, task);
        updateHeartbeat('scheduledJobWorker', {
          meta: {
            scheduledTaskCount: this.scheduledTasks.size,
          },
        });

        log('info', 'Job scheduled with cron', {
          jobId,
          name: jobConfig.name,
          expression: schedule.expression,
          timezone: schedule.timezone || 'UTC',
        });
      } else if (schedule.type === 'INTERVAL') {
        // Schedule with setInterval
        const intervalMs = schedule.intervalMs;

        if (intervalMs < 60000) {
          log('error', 'Interval too short (minimum 1 minute)', {
            jobId,
            intervalMs,
          });
          return;
        }

        const intervalId = setInterval(() => this.executeJob(jobConfig), intervalMs);

        this.scheduledTasks.set(jobId, intervalId);
        updateHeartbeat('scheduledJobWorker', {
          meta: {
            scheduledTaskCount: this.scheduledTasks.size,
          },
        });

        log('info', 'Job scheduled with interval', {
          jobId,
          name: jobConfig.name,
          intervalMs,
        });
      } else {
        // Previously a silent no-op: unscheduleJob() above had already torn down
        // the job's prior cron task, and if schedule.type didn't match 'CRON' or
        // 'INTERVAL' exactly, execution fell through this whole if/else chain
        // with zero logging — the job was left permanently unscheduled with no
        // error anywhere to explain why. This is exactly how the real
        // "Tailspin Daily Sync Report" job went silent in production: its cron task
        // was torn down by an unrelated env-var save and never came back, with
        // no log line pointing at the cause until now.
        log('error', 'Unknown schedule.type — job left unscheduled after teardown', {
          jobId,
          name: jobConfig.name,
          schedule: JSON.stringify(schedule),
        });
      }
    } catch (error) {
      log('error', 'Failed to schedule job', {
        jobId,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Unschedule a job
   */
  unscheduleJob(jobId) {
    const task = this.scheduledTasks.get(jobId);

    if (task) {
      if (typeof task.stop === 'function') {
        // node-cron task
        task.stop();
      } else {
        // setInterval
        clearInterval(task);
      }

      this.scheduledTasks.delete(jobId);
      updateHeartbeat('scheduledJobWorker', {
        meta: {
          scheduledTaskCount: this.scheduledTasks.size,
        },
      });

      log('info', 'Job unscheduled', { jobId });
    }
  }

  async acquireExecutionLock(db, jobId, owner, ttlMs = 30 * 60 * 1000) {
    const now = new Date();
    const lockedUntil = new Date(now.getTime() + ttlMs);
    const result = await db.collection('scheduled_job_locks').findOneAndUpdate(
      {
        _id: jobId,
        $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }, { owner }],
      },
      {
        $set: {
          owner,
          lockedAt: now,
          lockedUntil,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
        },
      },
      { returnDocument: 'after' }
    );
    const lockDoc = result?.value || result;
    if (lockDoc && lockDoc.owner === owner) return true;

    try {
      await db.collection('scheduled_job_locks').insertOne({
        _id: jobId,
        owner,
        lockedAt: now,
        lockedUntil,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    } catch (error) {
      if (error?.code === 11000) return false;
      throw error;
    }
  }

  async releaseExecutionLock(db, jobId, owner) {
    try {
      await db.collection('scheduled_job_locks').deleteOne({ _id: jobId, owner });
    } catch (error) {
      log('warn', 'Failed to release scheduled job lock', { jobId, error: error.message });
    }
  }

  async createScheduledJobLog(db, executionLog) {
    const result = await db.collection('scheduled_job_logs').insertOne(executionLog);
    return result.insertedId;
  }

  async updateScheduledJobLog(db, logId, patch) {
    if (!logId) return;
    await db.collection('scheduled_job_logs').updateOne(
      { _id: logId },
      {
        $set: {
          ...patch,
          updatedAt: new Date(),
        },
      }
    );
  }

  redactHeaders(headers = {}) {
    const redacted = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (/authorization|api[-_]?key|token|secret|password|cookie/i.test(key)) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  /**
   * Execute a scheduled job
   * REUSES existing transformation, auth, and delivery logic
   */
  async executeJob(jobConfig, options = {}) {
    if (jobConfig.direction === 'SCRIPT_JOB') {
      return this.executeScriptJob(jobConfig, options);
    }

    const correlationId = uuidv4();
    const jobId = jobConfig._id.toString();
    const startTime = Date.now();
    const dryRun = options.dryRun === true || jobConfig.dryRun === true || jobConfig.safety?.dryRun === true;
    const trigger = options.trigger || 'SCHEDULE';
    const reason = options.reason || null;

    if (this.runningJobs.has(jobId)) {
      log('warn', 'Scheduled job already running in this process, skipping overlap', { jobId, correlationId });
      return { status: 'SKIPPED_LOCKED', jobId, correlationId };
    }

    const db = await getDbSafe();
    const lockAcquired = await this.acquireExecutionLock(
      db,
      jobId,
      correlationId,
      jobConfig.lockTtlMs || 30 * 60 * 1000
    );
    if (!lockAcquired) {
      log('warn', 'Scheduled job lock already held, skipping execution', { jobId, correlationId });
      return { status: 'SKIPPED_LOCKED', jobId, correlationId };
    }

    this.runningJobs.add(jobId);
    markWorkerRunStart('scheduledJobWorker', {
      meta: {
        lastJobId: jobId,
        lastJobName: jobConfig.name,
        scheduledTaskCount: this.scheduledTasks.size,
      },
    });

    log('info', 'Executing scheduled job', {
      jobId,
      name: jobConfig.name,
      correlationId,
      dryRun,
    });

    // Create execution logger for scheduled jobs
    const executionLogger = createExecutionLogger({
      traceId: correlationId,
      direction: 'SCHEDULED',
      triggerType: 'SCHEDULE',
      integrationConfigId: jobConfig._id,
      // These fields are used by the Delivery Logs UI. Without them scheduled
      // logs show blank "Integration" / "Event" labels.
      integrationName: jobConfig.name,
      eventType: jobConfig.eventType || jobConfig.type || null,
      orgId: jobConfig.orgId,
      messageId: `job_${jobConfig._id}_${Date.now()}`,
      request: {
        url: jobConfig.targetUrl,
        method: jobConfig.httpMethod || 'POST',
        headers: {},
        body: {},
      },
    });

    // Start execution logging
    await executionLogger.start().catch((err) => {
      log('warn', 'Failed to start execution logger', { error: err.message, correlationId });
    });

    const executionLog = {
      integrationId: jobConfig._id,
      integrationName: jobConfig.name,
      orgId: jobConfig.orgId,
      correlationId,
      startedAt: new Date(),
      trigger,
      dryRun,
      reason,
      triggeredBy: options.triggeredBy || null,
      status: 'RUNNING',
    };
    let scheduledLogId = null;

    try {
      scheduledLogId = await this.createScheduledJobLog(db, {
        ...executionLog,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Step 1: Execute data source query (NEW - only part unique to SCHEDULED)
      const queryStart = Date.now();
      const queryResult = await executeDataSource(jobConfig.dataSource, jobConfig);

      executionLog.recordsFetched = Array.isArray(queryResult) ? queryResult.length : 1;
      executionLog.queryExecutedAt = new Date();

      // Store the actual data fetched (with size limit for logging)
      const dataFetchedForLog = JSON.stringify(queryResult);
      executionLog.dataFetched =
        dataFetchedForLog.length > 50000 ? `${dataFetchedForLog.substring(0, 50000)}...(truncated)` : queryResult;

      // Log data source execution
      await executionLogger
        .addStep('data_source_query', {
          status: 'success',
          durationMs: Date.now() - queryStart,
          metadata: {
            recordsFetched: executionLog.recordsFetched,
            dataSourceType: jobConfig.dataSource?.type,
            sampleData: Array.isArray(queryResult) ? queryResult.slice(0, 3) : queryResult,
          },
        })
        .catch(() => {});

      log('info', 'Data source executed', {
        correlationId,
        recordsFetched: executionLog.recordsFetched,
      });

      // Step 2: Apply transformation (REUSE - existing transformer service)
      const transformStart = Date.now();
      const eventPayload = {
        data: queryResult,
        metadata: {
          jobId: jobConfig._id.toString(),
          jobName: jobConfig.name,
          executedAt: new Date().toISOString(),
          recordCount: executionLog.recordsFetched,
        },
      };

      const transformedPayload = await applyTransform(jobConfig, eventPayload);
      const transformedIsSkipped = transformedPayload === null || isTransformationSkipped(transformedPayload);
      const transformationSkipReason = getTransformationSkipReason(transformedPayload);

      executionLog.transformedAt = new Date();

      // Store the transformed payload (with size limit for logging)
      const transformedForLog = JSON.stringify(transformedIsSkipped ? null : transformedPayload);
      executionLog.transformedPayload =
        transformedForLog.length > 50000
          ? `${transformedForLog.substring(0, 50000)}...(truncated)`
          : transformedIsSkipped
            ? null
            : transformedPayload;

      // Log transformation
      await executionLogger
        .addStep('transformation', {
          status: transformedIsSkipped ? 'warning' : 'success',
          durationMs: Date.now() - transformStart,
          metadata: {
            payloadSize: transformedForLog.length,
            ...(transformedIsSkipped ? { skipReason: transformationSkipReason || 'transformation returned null' } : {}),
          },
        })
        .catch(() => {});

      if (transformedIsSkipped) {
        executionLog.status = 'SKIPPED';
        executionLog.responseStatus = 204;
        executionLog.responseBody = null;
        executionLog.error = {
          message: `Skipping delivery: ${transformationSkipReason || 'transformation returned null'}`,
          timestamp: new Date(),
        };
        await executionLogger.updateStatus('skipped').catch(() => {});
        await this.updateScheduledJobLog(db, scheduledLogId, {
          ...executionLog,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        log('info', 'Scheduled job skipped by transformation', {
          correlationId,
          reason: transformationSkipReason || 'transformation returned null',
        });
        markWorkerRunSuccess('scheduledJobWorker', {
          meta: {
            lastJobId: jobConfig._id.toString(),
            lastJobName: jobConfig.name,
            lastDurationMs: Date.now() - startTime,
            lastRecordsFetched: executionLog.recordsFetched || 0,
            scheduledTaskCount: this.scheduledTasks.size,
            lastResult: 'SKIPPED',
          },
        });
        return { status: 'SKIPPED', jobId, correlationId, logId: scheduledLogId };
      }

      log('info', 'Transformation applied', { correlationId });

      if (dryRun) {
        executionLog.deliveredAt = null;
        executionLog.responseStatus = 204;
        executionLog.responseBody = { dryRun: true, message: 'Delivery skipped because dry-run mode is enabled' };
        executionLog.status = 'DRY_RUN';
        await executionLogger
          .addStep('dry_run', {
            status: 'success',
            durationMs: 0,
            metadata: {
              recordsFetched: executionLog.recordsFetched,
              reason,
            },
          })
          .catch(() => {});
        await executionLogger.updateStatus('skipped').catch(() => {});
        await this.updateScheduledJobLog(db, scheduledLogId, {
          ...executionLog,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        markWorkerRunSuccess('scheduledJobWorker', {
          meta: {
            lastJobId: jobId,
            lastJobName: jobConfig.name,
            lastDurationMs: Date.now() - startTime,
            lastRecordsFetched: executionLog.recordsFetched || 0,
            scheduledTaskCount: this.scheduledTasks.size,
            lastResult: 'DRY_RUN',
          },
        });
        return { status: 'DRY_RUN', jobId, correlationId, logId: scheduledLogId };
      }

      // Step 3: Resolve provider operation template if the job references one.
      // This merges PartnerHub (or any other provider) auth + URL config into the
      // effective job config without requiring it to be duplicated per integration.
      const resolvedConfig = await applyProviderRef(jobConfig.orgId, jobConfig).catch((err) => {
        log('warn', 'Failed to resolve providerRef, falling back to raw job config', {
          correlationId,
          error: err.message,
          providerRef: jobConfig.providerRef,
        });
        return jobConfig;
      });

      // Step 4: Dispatch to the configured destination type.
      // Default is HTTP_API (backward-compatible). Additional types allow
      // writing to internal queues, SQL, or MongoDB without a separate service.
      const destinationType = resolvedConfig.destinationType || jobConfig.destinationType || 'HTTP_API';
      const deliveryResult = await this.dispatchToDestination({
        destinationType,
        jobConfig: resolvedConfig,
        payload: transformedPayload,
        correlationId,
        executionLogger,
      });

      executionLog.deliveredAt = new Date();
      executionLog.destinationType = destinationType;
      executionLog.responseStatus = deliveryResult.status;
      executionLog.responseBody = deliveryResult.data;
      executionLog.status = deliveryResult.status >= 200 && deliveryResult.status < 300 ? 'SUCCESS' : 'FAILED';

      if (deliveryResult.httpRequest) {
        executionLog.httpRequest = deliveryResult.httpRequest;
        executionLog.curlCommand = deliveryResult.curlCommand;
      }

      // Log delivery step
      await executionLogger
        .addStep(`${destinationType.toLowerCase()}_delivery`, {
          status: executionLog.status === 'SUCCESS' ? 'success' : 'failed',
          durationMs: deliveryResult.durationMs || 0,
          metadata: {
            destinationType,
            statusCode: deliveryResult.status,
            ...(deliveryResult.httpRequest
              ? {
                  method: deliveryResult.httpRequest.method,
                  url: deliveryResult.httpRequest.url,
                  requestHeaders: deliveryResult.httpRequest.headers,
                  responseHeaders: deliveryResult.headers || {},
                }
              : {}),
          },
        })
        .catch(() => {});

      if (executionLog.status === 'FAILED') {
        const errMsg = `Delivery failed with status ${deliveryResult.status}`;
        executionLog.error = { message: errMsg, timestamp: new Date() };
        await executionLogger
          .fail(new Error(errMsg), {
            statusCode: deliveryResult.status,
            metadata: {
              destinationType,
              recordsFetched: executionLog.recordsFetched,
              transformedPayload: executionLog.transformedPayload,
            },
          })
          .catch(() => {});
        await this.updateScheduledJobLog(db, scheduledLogId, {
          ...executionLog,
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        markWorkerRunError('scheduledJobWorker', new Error(errMsg), {
          meta: {
            lastJobId: jobId,
            lastJobName: jobConfig.name,
            lastDurationMs: Date.now() - startTime,
            scheduledTaskCount: this.scheduledTasks.size,
          },
        });
        return { status: 'FAILED', jobId, correlationId, logId: scheduledLogId };
      }

      // Mark execution as successful with detailed execution data
      await executionLogger
        .success({
          ...(executionLog.httpRequest ? { request: executionLog.httpRequest } : {}),
          response: {
            statusCode: deliveryResult.status,
            headers: deliveryResult.headers,
            body: deliveryResult.data,
          },
          metadata: {
            destinationType,
            recordsFetched: executionLog.recordsFetched,
            dataFetched: executionLog.dataFetched,
            transformedPayload: executionLog.transformedPayload,
            httpRequest: executionLog.httpRequest,
            curlCommand: executionLog.curlCommand,
          },
        })
        .catch(() => {});

      log('info', 'Job executed successfully', {
        correlationId,
        duration: Date.now() - startTime,
        status: deliveryResult.status,
      });
      await this.updateScheduledJobLog(db, scheduledLogId, {
        ...executionLog,
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });
      markWorkerRunSuccess('scheduledJobWorker', {
        meta: {
          lastJobId: jobId,
          lastJobName: jobConfig.name,
          lastDurationMs: Date.now() - startTime,
          lastRecordsFetched: executionLog.recordsFetched || 0,
          scheduledTaskCount: this.scheduledTasks.size,
        },
      });
      return { status: 'SUCCESS', jobId, correlationId, logId: scheduledLogId };
    } catch (error) {
      executionLog.status = 'FAILED';
      executionLog.error = {
        message: error.message,
        stack: error.stack,
        code: error.code,
        details: error.details || {},
        timestamp: new Date(),
      };

      // Store what we had so far for debugging
      if (executionLog.httpRequest) {
        executionLog.errorContext = {
          stage: 'http_delivery',
          request: executionLog.httpRequest,
        };
      } else if (executionLog.transformedPayload) {
        executionLog.errorContext = {
          stage: 'transformation',
          transformedPayload: executionLog.transformedPayload,
        };
      } else if (executionLog.dataFetched) {
        executionLog.errorContext = {
          stage: 'data_fetch',
          dataFetched: executionLog.dataFetched,
        };
      }

      // Mark execution as failed with DLQ entry
      const err = new Error(error.message);
      err.code = error.code || 'JOB_EXECUTION_ERROR';
      err.stack = error.stack;
      err.statusCode = error.statusCode || 500;
      await executionLogger
        .fail(err, {
          ...(executionLog.httpRequest ? { request: executionLog.httpRequest } : {}),
          payload: executionLog,
          statusCode: err.statusCode,
          metadata: {
            recordsFetched: executionLog.recordsFetched,
            dataFetched: executionLog.dataFetched,
            transformedPayload: executionLog.transformedPayload,
            httpRequest: executionLog.httpRequest,
            curlCommand: executionLog.curlCommand,
            errorContext: executionLog.errorContext,
          },
        })
        .catch(() => {});
      await this.updateScheduledJobLog(db, scheduledLogId, {
        ...executionLog,
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });

      log('error', 'Job execution failed', {
        correlationId,
        error: error.message,
        errorStage: executionLog.errorContext?.stage,
        duration: Date.now() - startTime,
      });
      markWorkerRunError('scheduledJobWorker', error, {
        meta: {
          lastJobId: jobConfig._id.toString(),
          lastJobName: jobConfig.name,
          lastDurationMs: Date.now() - startTime,
          scheduledTaskCount: this.scheduledTasks.size,
        },
      });
      return { status: 'FAILED', jobId, correlationId, logId: scheduledLogId, error: error.message };
    } finally {
      executionLog.completedAt = new Date();
      executionLog.durationMs = Date.now() - startTime;
      this.runningJobs.delete(jobId);
      await this.releaseExecutionLock(db, jobId, correlationId);
    }
  }

  /**
   * Run a Script Job, retrying on failure if the job opts in via
   * `jobConfig.retryOnFailure = { maxAttempts, delayMs }`. Off by default (maxAttempts
   * defaults to 1 — no retry) so this doesn't change behavior for existing script jobs
   * that may have non-idempotent side effects; a job must explicitly enable it.
   *
   * Safe to retry blindly for jobs whose only side effect (e.g. sending an email) is
   * the last statement in the script — a failure can only happen before that side
   * effect runs, never after, so a retry can't double it up. Jobs with side effects
   * earlier in the script that aren't safe to repeat should NOT enable this.
   */
  async runScriptWithRetries(jobConfig) {
    const jobId = jobConfig._id.toString();
    const retryConfig = jobConfig.retryOnFailure || {};
    const maxAttempts = Math.max(1, Number(retryConfig.maxAttempts) || 1);
    const delayMs = Number(retryConfig.delayMs) > 0 ? Number(retryConfig.delayMs) : 60000;

    let runResult;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      runResult =
        jobConfig.runtime === 'NODE_PROCESS' ? await runNodeScriptJob(jobConfig) : await runScriptJob(jobConfig);

      if (runResult.status === 'SUCCESS' || runResult.status === 'SKIPPED') {
        return { ...runResult, attempts: attempt };
      }

      if (attempt < maxAttempts) {
        log('warn', 'Script Job attempt failed, retrying', {
          jobId,
          attempt,
          maxAttempts,
          status: runResult.status,
          error: runResult.error,
          retryInMs: delayMs,
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    return { ...runResult, attempts: maxAttempts };
  }

  /**
   * Execute a SCRIPT_JOB — user-authored JS script with managed helpers.
   * Reuses the same execution log infrastructure as regular scheduled jobs.
   */
  async executeScriptJob(jobConfig, options = {}) {
    const correlationId = uuidv4();
    const jobId = jobConfig._id.toString();
    const startTime = Date.now();
    const dryRun = options.dryRun === true || jobConfig.dryRun === true;

    if (this.runningJobs.has(jobId)) {
      return { status: 'SKIPPED_LOCKED', jobId, correlationId };
    }

    const db = await getDbSafe();
    const lockAcquired = await this.acquireExecutionLock(
      db,
      jobId,
      correlationId,
      jobConfig.lockTtlMs || 30 * 60 * 1000
    );
    if (!lockAcquired) {
      return { status: 'SKIPPED_LOCKED', jobId, correlationId };
    }

    this.runningJobs.add(jobId);
    log('info', 'Executing Script Job', { jobId, name: jobConfig.name, correlationId, dryRun });

    const executionLogger = createExecutionLogger({
      traceId: correlationId,
      direction: 'SCRIPT_JOB',
      triggerType: 'SCHEDULE',
      integrationConfigId: jobConfig._id,
      integrationName: jobConfig.name,
      eventType: jobConfig.eventType || 'SCRIPT_JOB',
      orgId: jobConfig.orgId,
      messageId: `scriptjob_${jobConfig._id}_${Date.now()}`,
      request: { url: null, method: null, headers: {}, body: {} },
    });
    await executionLogger.start().catch(() => {});

    let scheduledLogId = null;
    try {
      scheduledLogId = await this.createScheduledJobLog(db, {
        integrationId: jobConfig._id,
        integrationName: jobConfig.name,
        orgId: jobConfig.orgId,
        correlationId,
        startedAt: new Date(),
        trigger: options.trigger || 'SCHEDULE',
        dryRun,
        status: 'RUNNING',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      if (dryRun) {
        await executionLogger.updateStatus('skipped').catch(() => {});
        await this.updateScheduledJobLog(db, scheduledLogId, {
          status: 'DRY_RUN',
          completedAt: new Date(),
          durationMs: Date.now() - startTime,
        });
        return { status: 'DRY_RUN', jobId, correlationId, logId: scheduledLogId };
      }

      const runResult = await this.runScriptWithRetries(jobConfig);

      await executionLogger
        .addStep('script_execution', {
          status: runResult.status === 'SUCCESS' ? 'success' : runResult.status === 'SKIPPED' ? 'warning' : 'failed',
          durationMs: Date.now() - startTime,
          metadata: { scriptLogs: runResult.scriptLogs, reason: runResult.reason, attempts: runResult.attempts },
        })
        .catch(() => {});

      const finalStatus =
        runResult.status === 'SUCCESS' ? 'SUCCESS' : runResult.status === 'SKIPPED' ? 'SKIPPED' : 'FAILED';

      if (finalStatus === 'SUCCESS') {
        await executionLogger
          .success({ metadata: { scriptLogs: runResult.scriptLogs, attempts: runResult.attempts } })
          .catch(() => {});
      } else if (finalStatus === 'SKIPPED') {
        await executionLogger.updateStatus('skipped').catch(() => {});
      } else {
        await executionLogger
          .fail(new Error(runResult.error || 'Script job failed'), {
            metadata: { scriptLogs: runResult.scriptLogs, attempts: runResult.attempts },
          })
          .catch(() => {});
      }

      await this.updateScheduledJobLog(db, scheduledLogId, {
        status: finalStatus,
        scriptLogs: runResult.scriptLogs,
        attempts: runResult.attempts,
        error: runResult.error ? { message: runResult.error, timestamp: new Date() } : undefined,
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });

      log('info', 'Script Job completed', {
        jobId,
        status: finalStatus,
        duration: Date.now() - startTime,
        attempts: runResult.attempts,
      });
      return { status: finalStatus, jobId, correlationId, logId: scheduledLogId };
    } catch (error) {
      await executionLogger.fail(error, {}).catch(() => {});
      await this.updateScheduledJobLog(db, scheduledLogId, {
        status: 'FAILED',
        error: { message: error.message, timestamp: new Date() },
        completedAt: new Date(),
        durationMs: Date.now() - startTime,
      });
      log('error', 'Script Job execution error', { jobId, error: error.message });
      return { status: 'FAILED', jobId, correlationId, error: error.message };
    } finally {
      this.runningJobs.delete(jobId);
      await this.releaseExecutionLock(db, jobId, correlationId);
    }
  }

  /**
   * Dispatch transformed payload to the configured destination.
   *
   * destinationType:
   *   HTTP_API       — POST/PUT/GET to a URL (default, backward-compatible)
   *   INTERNAL_EVENT — Push to the in-process event queue for other integrations
   *   SQL_WRITE      — Execute an INSERT/UPDATE via the shared MySQL connection
   *   MONGODB_WRITE  — Insert/upsert into a MongoDB collection
   *
   * Always returns { status, data, headers?, durationMs, httpRequest?, curlCommand? }
   */
  async dispatchToDestination({ destinationType, jobConfig, payload, correlationId }) {
    const start = Date.now();
    const type = String(destinationType || 'HTTP_API').toUpperCase();

    switch (type) {
      case 'HTTP_API': {
        const authHeaders = await buildAuthHeaders(jobConfig, jobConfig.httpMethod || 'POST', jobConfig.targetUrl);
        const requestHeaders = {
          'Content-Type': 'application/json',
          ...authHeaders,
          ...(jobConfig.customHeaders || {}),
        };
        const redacted = this.redactHeaders(requestHeaders);
        const method = jobConfig.httpMethod || 'POST';
        const url = jobConfig.targetUrl;

        const deliveryResult = await this.deliverIntegration({
          targetUrl: url,
          httpMethod: method,
          headers: requestHeaders,
          payload,
          timeout: jobConfig.timeoutMs || 10000,
        });

        const curlHeaders = Object.entries(redacted)
          .map(([k, v]) => `-H "${k}: ${v}"`)
          .join(' ');

        return {
          ...deliveryResult,
          durationMs: Date.now() - start,
          httpRequest: { method, url, headers: redacted, body: payload },
          curlCommand: `curl -X ${method} ${curlHeaders} -d '${JSON.stringify(payload).replace(/'/g, "'\\''")}' "${url}"`,
        };
      }

      case 'INTERNAL_EVENT': {
        // Push to the in-process event queue so other integrations can react.
        // jobConfig.destination.eventType or jobConfig.eventType determines the event type.
        const queue = require('../data/queue');
        const eventType = jobConfig.destination?.eventType || jobConfig.eventType || `SCHEDULED_JOB_${jobConfig._id}`;
        const orgId = jobConfig.orgId;

        const event = {
          id: correlationId,
          event_type: eventType,
          payload,
          orgId,
          orgUnitRid: jobConfig.orgUnitRid || orgId,
          source: 'SCHEDULED_JOB',
          jobId: String(jobConfig._id),
        };

        queue.push(event);

        log('info', 'Scheduled job pushed INTERNAL_EVENT', {
          correlationId,
          eventType,
          orgId,
        });

        return {
          status: 202,
          data: { queued: true, eventType, correlationId },
          durationMs: Date.now() - start,
        };
      }

      case 'SQL_WRITE': {
        // Execute a write query against the shared MySQL connection pool.
        // jobConfig.destination must supply: query (parameterised), params (array)
        const { getConnection } = require('../db');
        const dest = jobConfig.destination || {};
        const query = dest.query;

        if (!query) {
          throw new Error('SQL_WRITE destination requires destination.query');
        }

        // Allow {{field}} substitution in the query from the payload
        const { replaceVariables } = require('../services/data-source-executor');
        const resolvedQuery = replaceVariables(query, {
          config: { orgId: jobConfig.orgId },
          payload,
        });

        const params = Array.isArray(dest.params) ? dest.params : [];
        const connection = await getConnection();
        const [result] = await connection.query(resolvedQuery, params);

        log('info', 'Scheduled job SQL_WRITE completed', {
          correlationId,
          affectedRows: result.affectedRows,
        });

        return {
          status: 200,
          data: { affectedRows: result.affectedRows, insertId: result.insertId },
          durationMs: Date.now() - start,
        };
      }

      case 'MONGODB_WRITE': {
        // Insert or upsert a document into a MongoDB collection.
        // jobConfig.destination must supply: collection, operation (insert|upsert), filter (for upsert)
        const { getDbSafe: getDb } = require('../mongodb');
        const dest = jobConfig.destination || {};
        const collectionName = dest.collection;

        if (!collectionName) {
          throw new Error('MONGODB_WRITE destination requires destination.collection');
        }

        const mongoDb = await getDb();
        const col = mongoDb.collection(collectionName);
        const operation = String(dest.operation || 'insert').toLowerCase();
        let result;

        if (operation === 'upsert') {
          if (!dest.filter) {
            throw new Error('MONGODB_WRITE upsert requires destination.filter');
          }
          result = await col.updateOne(
            dest.filter,
            { $set: { ...payload, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
            { upsert: true }
          );
          log('info', 'Scheduled job MONGODB_WRITE upsert completed', {
            correlationId,
            matched: result.matchedCount,
            upserted: result.upsertedCount,
          });
        } else {
          result = await col.insertOne({ ...payload, createdAt: new Date(), _jobId: String(jobConfig._id) });
          log('info', 'Scheduled job MONGODB_WRITE insert completed', {
            correlationId,
            insertedId: result.insertedId?.toString(),
          });
        }

        return {
          status: 200,
          data: {
            operation,
            insertedId: result.insertedId?.toString() || null,
            matchedCount: result.matchedCount || 0,
            upsertedCount: result.upsertedCount || 0,
          },
          durationMs: Date.now() - start,
        };
      }

      default:
        throw new Error(`Unsupported scheduled job destination type: ${type}`);
    }
  }

  /**
   * Deliver integration using axios
   * REUSES existing delivery logic pattern
   */
  async deliverIntegration({ targetUrl, httpMethod, headers, payload, timeout }) {
    try {
      const response = await axios({
        method: httpMethod,
        url: targetUrl,
        headers,
        data: payload,
        timeout,
        validateStatus: () => true, // Don't throw on non-2xx
      });

      return {
        status: response.status,
        headers: response.headers,
        data: response.data,
      };
    } catch (error) {
      // If axios throws (network error, timeout, etc), capture details
      const errorDetails = {
        message: error.message,
        code: error.code,
        stack: error.stack,
      };

      if (error.response) {
        // Server responded with error status
        return {
          status: error.response.status,
          headers: error.response.headers,
          data: error.response.data,
        };
      }

      // Network error or timeout - throw with details
      const err = new Error(`Integration delivery failed: ${error.message}`);
      err.details = errorDetails;
      throw err;
    }
  }

  /**
   * Reload jobs (called when config changes)
   */
  async reloadJobs() {
    log('info', 'Reloading scheduled jobs');

    // Clear all existing schedules
    for (const jobId of this.scheduledTasks.keys()) {
      this.unscheduleJob(jobId);
    }

    // Load fresh jobs from database
    await this.loadActiveJobs();
  }

  /**
   * Stop worker
   */
  stop() {
    log('info', 'Stopping scheduled job worker');

    for (const jobId of this.scheduledTasks.keys()) {
      this.unscheduleJob(jobId);
    }

    this.isRunning = false;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    stopWorker('scheduledJobWorker', {
      meta: {
        scheduledTaskCount: this.scheduledTasks.size,
      },
    });
    log('info', 'Scheduled job worker stopped');
  }
}

// Singleton instance
let workerInstance = null;

const getScheduledJobWorker = () => {
  if (!workerInstance) {
    workerInstance = new ScheduledJobWorker();
  }
  return workerInstance;
};

module.exports = {
  getScheduledJobWorker,
  ScheduledJobWorker,
};
