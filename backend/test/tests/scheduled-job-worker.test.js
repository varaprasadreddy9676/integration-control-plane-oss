'use strict';

const { createMockDb } = require('./helpers/mock-mongodb');

const mockDb = createMockDb();
const mockExecuteDataSource = jest.fn();
const mockApplyTransform = jest.fn();
const mockAxios = jest.fn();
const mockExecutionLogger = {
  start: jest.fn(async () => {}),
  addStep: jest.fn(async () => {}),
  updateStatus: jest.fn(async () => {}),
  success: jest.fn(async () => {}),
  fail: jest.fn(async () => {})
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => mockDb)
}));

jest.mock('../../src/services/data-source-executor', () => ({
  executeDataSource: (...args) => mockExecuteDataSource(...args)
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: (...args) => mockApplyTransform(...args),
  getTransformationSkipReason: jest.fn(() => null),
  isTransformationSkipped: jest.fn(() => false)
}));

jest.mock('axios', () => (...args) => mockAxios(...args));

jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: jest.fn(() => mockExecutionLogger)
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer secret-token' }))
}));

jest.mock('../../src/worker-heartbeat', () => ({
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
  updateHeartbeat: jest.fn()
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn()
}));

jest.mock('../../src/utils/runtime', () => ({
  uuidv4: jest.fn(() => 'trace-1')
}));

const mockCronTask = { stop: jest.fn() };
const mockCron = {
  validate: jest.fn(() => true),
  schedule: jest.fn(() => mockCronTask)
};

jest.mock('node-cron', () => ({
  validate: (...args) => mockCron.validate(...args),
  schedule: (...args) => mockCron.schedule(...args)
}));

const mockRunNodeScriptJob = jest.fn();
const mockRunScriptJob = jest.fn();

jest.mock('../../src/services/node-script-runner', () => ({
  runNodeScriptJob: (...args) => mockRunNodeScriptJob(...args)
}));

jest.mock('../../src/services/script-job-runner', () => ({
  runScriptJob: (...args) => mockRunScriptJob(...args)
}));

const baseJob = {
  _id: { toString: () => 'job-1' },
  orgId: 1,
  name: 'Daily Automation',
  direction: 'SCHEDULED',
  schedule: { type: 'CRON', expression: '0 0 * * *' },
  dataSource: { type: 'SQL', query: 'SELECT id FROM users' },
  transformation: { mode: 'SCRIPT', script: 'return payload.data' },
  targetUrl: 'https://example.com/import',
  httpMethod: 'POST',
  isActive: true
};

describe('ScheduledJobWorker execution', () => {
  let worker;
  let logsCollection;
  let locksCollection;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    logsCollection = mockDb.collection('scheduled_job_logs');
    locksCollection = mockDb.collection('scheduled_job_locks');

    logsCollection.insertOne.mockResolvedValue({ insertedId: 'log-1' });
    logsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    locksCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        _id: 'job-1',
        owner: 'trace-1',
        lockedUntil: new Date(Date.now() + 60000)
      }
    });
    locksCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    mockExecuteDataSource.mockResolvedValue([{ id: 1 }]);
    mockApplyTransform.mockResolvedValue({ records: [{ id: 1 }] });
    mockAxios.mockResolvedValue({ status: 200, headers: {}, data: { ok: true } });

    const { ScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');
    worker = new ScheduledJobWorker();
  });

  it('persists scheduled job logs for successful executions', async () => {
    const result = await worker.executeJob(baseJob);

    expect(result.status).toBe('SUCCESS');
    expect(logsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationId: baseJob._id,
        orgId: 1,
        correlationId: 'trace-1',
        status: 'RUNNING'
      })
    );
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'SUCCESS',
          recordsFetched: 1,
          responseStatus: 200
        })
      })
    );
  });

  it('logs the transformed payload as the request body, not an empty object', async () => {
    await worker.executeJob(baseJob);

    expect(mockExecutionLogger.success).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          url: 'https://example.com/import',
          method: 'POST',
          body: { records: [{ id: 1 }] }
        })
      })
    );
  });

  it('records the delivery time so Delivery Logs can show it', async () => {
    await worker.executeJob(baseJob);

    expect(mockExecutionLogger.success).toHaveBeenCalledWith(
      expect.objectContaining({ responseTimeMs: expect.any(Number) })
    );
  });

  it('dry-runs without delivering to the target URL', async () => {
    const result = await worker.executeJob(baseJob, { dryRun: true, reason: 'Preview changes' });

    expect(result.status).toBe('DRY_RUN');
    expect(mockAxios).not.toHaveBeenCalled();
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'DRY_RUN',
          dryRun: true,
          responseStatus: 204
        })
      })
    );
  });

  it('skips execution when a job lock is already held', async () => {
    locksCollection.findOneAndUpdate.mockResolvedValueOnce({ value: null });
    locksCollection.insertOne.mockRejectedValueOnce(Object.assign(new Error('duplicate key'), { code: 11000 }));

    const result = await worker.executeJob(baseJob);

    expect(result.status).toBe('SKIPPED_LOCKED');
    expect(mockExecuteDataSource).not.toHaveBeenCalled();
    expect(logsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('passes full job config object to buildAuthHeaders (not just type/config)', async () => {
    const { buildAuthHeaders } = require('../../src/processor/auth-helper');

    await worker.executeJob(baseJob);

    // Must be called with the full jobConfig as first arg, not just outgoingAuthType
    expect(buildAuthHeaders).toHaveBeenCalledWith(
      expect.objectContaining({ _id: baseJob._id, targetUrl: baseJob.targetUrl }),
      baseJob.httpMethod || 'POST',
      baseJob.targetUrl
    );
  });

  it('includes resolved auth headers in the axios request (awaits buildAuthHeaders)', async () => {
    const { buildAuthHeaders } = require('../../src/processor/auth-helper');
    buildAuthHeaders.mockResolvedValueOnce({ 'X-Custom-Token': 'partnerhub-token-123' });

    await worker.executeJob(baseJob);

    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Custom-Token': 'partnerhub-token-123' })
      })
    );
  });

  it('handles CUSTOM auth type with empty tokenHeaderPrefix (PartnerHub pattern)', async () => {
    const { buildAuthHeaders } = require('../../src/processor/auth-helper');
    // Simulate PartnerHub: Authorization header with raw token, no "Bearer" prefix
    buildAuthHeaders.mockResolvedValueOnce({ Authorization: 'raw-partnerhub-token' });

    const partnerhubJob = {
      ...baseJob,
      outgoingAuthType: 'CUSTOM',
      outgoingAuthConfig: {
        tokenEndpoint: 'https://api.partnerhub.example/api/generate-token',
        tokenRequestMethod: 'POST',
        tokenRequestBody: JSON.stringify({ username: 'connector', password: 'connector' }),
        tokenResponsePath: 'data.token',
        tokenHeaderName: 'Authorization',
        tokenHeaderPrefix: '' // no "Bearer" prefix
      }
    };

    const result = await worker.executeJob(partnerhubJob);

    expect(result.status).toBe('SUCCESS');
    expect(mockAxios).toHaveBeenCalledWith(
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'raw-partnerhub-token' })
      })
    );
  });
});

// Regression: scheduleJob() had no `else` branch for an unrecognized schedule.type.
// unscheduleJob() at the top always tore down the job's existing cron/interval task
// first; if schedule.type then didn't match 'CRON' or 'INTERVAL' exactly, execution
// fell through the whole if/else chain with zero logging, leaving the job silently
// unscheduled forever with no error anywhere to explain why. Combined with a separate
// bug in the PUT route (see routes-scheduled-jobs.test.js), this is exactly how the
// real "Tailspin Daily Sync Report" job went dark in production. These tests cover every
// branch of scheduleJob() so a future regression here can't hide silently again.
describe('ScheduledJobWorker.scheduleJob', () => {
  let worker;
  let logMock;

  const cronJob = {
    _id: { toString: () => 'job-cron-1' },
    name: 'Tailspin Daily Sync Report',
    schedule: { type: 'CRON', expression: '0 6 * * *', timezone: 'Asia/Kolkata' }
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockCron.validate.mockReturnValue(true);
    mockCron.schedule.mockReturnValue(mockCronTask);

    const { ScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');
    worker = new ScheduledJobWorker();
    logMock = require('../../src/logger').log;
  });

  it('schedules a valid CRON job and registers the task', () => {
    worker.scheduleJob(cronJob);

    expect(mockCron.validate).toHaveBeenCalledWith('0 6 * * *');
    expect(mockCron.schedule).toHaveBeenCalledWith(
      '0 6 * * *',
      expect.any(Function),
      expect.objectContaining({ scheduled: true, timezone: 'Asia/Kolkata' })
    );
    expect(worker.scheduledTasks.get('job-cron-1')).toBe(mockCronTask);
    expect(logMock).toHaveBeenCalledWith(
      'info',
      'Job scheduled with cron',
      expect.objectContaining({ jobId: 'job-cron-1', expression: '0 6 * * *' })
    );
  });

  it('logs an error and does not register a task for an invalid CRON expression', () => {
    mockCron.validate.mockReturnValue(false);

    worker.scheduleJob(cronJob);

    expect(mockCron.schedule).not.toHaveBeenCalled();
    expect(worker.scheduledTasks.has('job-cron-1')).toBe(false);
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Invalid cron expression',
      expect.objectContaining({ jobId: 'job-cron-1' })
    );
  });

  it('schedules a valid INTERVAL job with setInterval and registers the task', () => {
    jest.useFakeTimers();
    try {
      const intervalJob = {
        _id: { toString: () => 'job-interval-1' },
        name: 'Every 5 minutes',
        schedule: { type: 'INTERVAL', intervalMs: 300000 }
      };

      worker.scheduleJob(intervalJob);

      expect(worker.scheduledTasks.has('job-interval-1')).toBe(true);
      expect(logMock).toHaveBeenCalledWith(
        'info',
        'Job scheduled with interval',
        expect.objectContaining({ jobId: 'job-interval-1', intervalMs: 300000 })
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('logs an error and does not register a task when intervalMs is below the 1 minute minimum', () => {
    const tooFastJob = {
      _id: { toString: () => 'job-interval-2' },
      name: 'Too Fast',
      schedule: { type: 'INTERVAL', intervalMs: 5000 }
    };

    worker.scheduleJob(tooFastJob);

    expect(worker.scheduledTasks.has('job-interval-2')).toBe(false);
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Interval too short (minimum 1 minute)',
      expect.objectContaining({ jobId: 'job-interval-2', intervalMs: 5000 })
    );
  });

  it('logs an error (not a silent no-op) for an unrecognized schedule.type, leaving the job unscheduled', () => {
    const corruptJob = {
      _id: { toString: () => 'job-corrupt-1' },
      name: 'Corrupt Schedule',
      schedule: { type: 'WEEKLY', expression: 'nonsense' }
    };

    expect(() => worker.scheduleJob(corruptJob)).not.toThrow();

    expect(mockCron.schedule).not.toHaveBeenCalled();
    expect(worker.scheduledTasks.has('job-corrupt-1')).toBe(false);
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Unknown schedule.type — job left unscheduled after teardown',
      expect.objectContaining({ jobId: 'job-corrupt-1' })
    );
  });

  it('tears down any existing task before registering the new one (unschedule-then-reschedule)', () => {
    worker.scheduleJob(cronJob);
    const firstTask = worker.scheduledTasks.get('job-cron-1');
    expect(firstTask.stop).not.toHaveBeenCalled();

    const secondTask = { stop: jest.fn() };
    mockCron.schedule.mockReturnValueOnce(secondTask);
    worker.scheduleJob(cronJob);

    expect(firstTask.stop).toHaveBeenCalledTimes(1);
    expect(worker.scheduledTasks.get('job-cron-1')).toBe(secondTask);
  });

  it('catches a synchronous throw from cron.schedule and logs it instead of crashing the process', () => {
    mockCron.schedule.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    expect(() => worker.scheduleJob(cronJob)).not.toThrow();
    expect(worker.scheduledTasks.has('job-cron-1')).toBe(false);
    expect(logMock).toHaveBeenCalledWith(
      'error',
      'Failed to schedule job',
      expect.objectContaining({ jobId: 'job-cron-1', error: 'boom' })
    );
  });
});

// Regression: a real FAILED "Tailspin Daily Sync Report" Script Job execution rendered a
// completely empty details panel in the UI (no console output, no error text). The bug
// spanned two layers: (1) ExecutionLogger.fail() dropped `metadata` entirely (fixed —
// see execution-logger.test.js), and (2) this needed a test proving executeScriptJob
// actually *passes* scriptLogs/error through to both executionLogger.fail() and the
// scheduled_job_logs document on every terminal status, for both runtimes.
describe('ScheduledJobWorker.executeScriptJob', () => {
  let worker;
  let logsCollection;
  let locksCollection;

  const baseScriptJob = {
    _id: { toString: () => 'script-job-1' },
    orgId: 33,
    name: 'Tailspin Daily Sync Report',
    direction: 'SCRIPT_JOB',
    runtime: 'NODE_PROCESS',
    schedule: { type: 'CRON', expression: '0 6 * * *' },
    script: 'console.log("hi")',
    isActive: true
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();

    logsCollection = mockDb.collection('scheduled_job_logs');
    locksCollection = mockDb.collection('scheduled_job_locks');

    logsCollection.insertOne.mockResolvedValue({ insertedId: 'script-log-1' });
    logsCollection.updateOne.mockResolvedValue({ matchedCount: 1, modifiedCount: 1 });
    locksCollection.findOneAndUpdate.mockResolvedValue({
      value: {
        _id: 'script-job-1',
        owner: 'trace-1',
        lockedUntil: new Date(Date.now() + 60000)
      }
    });
    locksCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const { ScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');
    worker = new ScheduledJobWorker();
  });

  it('on SUCCESS: passes scriptLogs to executionLogger.success() and the scheduled_job_logs document', async () => {
    const scriptLogs = [{ level: 'info', message: 'Query results Patient Details: 2727', ts: 'now' }];
    mockRunNodeScriptJob.mockResolvedValue({ status: 'SUCCESS', scriptLogs, error: null });

    const result = await worker.executeScriptJob(baseScriptJob);

    expect(result.status).toBe('SUCCESS');
    expect(mockExecutionLogger.success).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { scriptLogs, attempts: 1 } })
    );
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'script-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'SUCCESS', scriptLogs })
      })
    );
  });

  it('on FAILED: passes scriptLogs AND the error message to executionLogger.fail() (this was the actual bug)', async () => {
    const scriptLogs = [
      { level: 'info', message: 'Query results Patient Details: 2727', ts: 'now' },
      { level: 'error', message: 'Email send failed: connect ETIMEDOUT', ts: 'now' }
    ];
    mockRunNodeScriptJob.mockResolvedValue({
      status: 'FAILED',
      scriptLogs,
      error: 'Email send failed: connect ETIMEDOUT'
    });

    const result = await worker.executeScriptJob(baseScriptJob);

    expect(result.status).toBe('FAILED');
    expect(mockExecutionLogger.fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Email send failed: connect ETIMEDOUT' }),
      expect.objectContaining({ metadata: { scriptLogs, attempts: 1 } })
    );
    // The scheduled_job_logs document (read by the UI's "Script Output" tab / error
    // banner) must carry both the console output and the error, not just a bare status.
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'script-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'FAILED',
          scriptLogs,
          error: expect.objectContaining({ message: 'Email send failed: connect ETIMEDOUT' })
        })
      })
    );
  });

  it('on FAILED with no captured scriptLogs (e.g. crash before any console output): still records the error', async () => {
    mockRunNodeScriptJob.mockResolvedValue({ status: 'FAILED', scriptLogs: [], error: 'Cannot find module node:buffer' });

    const result = await worker.executeScriptJob(baseScriptJob);

    expect(result.status).toBe('FAILED');
    expect(mockExecutionLogger.fail).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Cannot find module node:buffer' }),
      expect.objectContaining({ metadata: { scriptLogs: [], attempts: 1 } })
    );
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'script-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          error: expect.objectContaining({ message: 'Cannot find module node:buffer' })
        })
      })
    );
  });

  it('on SKIPPED: does not call executionLogger.fail() and marks the log SKIPPED', async () => {
    mockRunNodeScriptJob.mockResolvedValue({ status: 'SKIPPED', scriptLogs: [], reason: 'No new records since last run' });

    const result = await worker.executeScriptJob(baseScriptJob);

    expect(result.status).toBe('SKIPPED');
    expect(mockExecutionLogger.fail).not.toHaveBeenCalled();
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'script-log-1' },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'SKIPPED' }) })
    );
  });

  it('an uncaught exception from the script runner itself is still logged with a real error message', async () => {
    mockRunNodeScriptJob.mockRejectedValue(new Error('runner crashed'));

    const result = await worker.executeScriptJob(baseScriptJob);

    expect(result.status).toBe('FAILED');
    expect(mockExecutionLogger.fail).toHaveBeenCalledWith(expect.objectContaining({ message: 'runner crashed' }), {});
    expect(logsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'script-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({ error: expect.objectContaining({ message: 'runner crashed' }) })
      })
    );
  });

  it('routes VM_SANDBOX runtime jobs through runScriptJob, not runNodeScriptJob', async () => {
    mockRunScriptJob.mockResolvedValue({ status: 'SUCCESS', scriptLogs: [] });

    await worker.executeScriptJob({ ...baseScriptJob, runtime: 'VM_SANDBOX' });

    expect(mockRunScriptJob).toHaveBeenCalledTimes(1);
    expect(mockRunNodeScriptJob).not.toHaveBeenCalled();
  });

  // Regression: the real "Tailspin Daily Sync Report" job silently missed its 6am run in
  // production (script hung, killed by the 60s job timeout) with no automatic retry —
  // the DLQ entry it created can never succeed for SCRIPT_JOB direction (unsupported),
  // so the failure would have sat unresolved until DLQ auto-abandons after 7 days.
  // retryOnFailure gives individual jobs an opt-in, in-process retry loop instead.
  describe('runScriptWithRetries (opt-in automatic retry)', () => {
    it('does NOT retry by default, even after repeated failures — off unless a job opts in', async () => {
      mockRunNodeScriptJob.mockResolvedValue({ status: 'FAILED', scriptLogs: [], error: 'DB unreachable' });

      const result = await worker.executeScriptJob(baseScriptJob);

      expect(result.status).toBe('FAILED');
      expect(mockRunNodeScriptJob).toHaveBeenCalledTimes(1);
    });

    it('retries after a transient failure and succeeds, reporting the real attempt count', async () => {
      mockRunNodeScriptJob
        .mockResolvedValueOnce({ status: 'FAILED', scriptLogs: [], error: 'connect ETIMEDOUT' })
        .mockResolvedValueOnce({ status: 'FAILED', scriptLogs: [], error: 'connect ETIMEDOUT' })
        .mockResolvedValueOnce({ status: 'SUCCESS', scriptLogs: [{ level: 'info', message: 'Report sent', ts: 'now' }] });

      const result = await worker.executeScriptJob({
        ...baseScriptJob,
        retryOnFailure: { maxAttempts: 3, delayMs: 1 }
      });

      expect(result.status).toBe('SUCCESS');
      expect(mockRunNodeScriptJob).toHaveBeenCalledTimes(3);
      expect(mockExecutionLogger.success).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ attempts: 3 }) })
      );
      // The transiently-failed attempts must never reach fail() / create a DLQ entry —
      // only the final outcome should be recorded.
      expect(mockExecutionLogger.fail).not.toHaveBeenCalled();
    });

    it('gives up after maxAttempts and reports FAILED with the last error', async () => {
      mockRunNodeScriptJob.mockResolvedValue({ status: 'FAILED', scriptLogs: [], error: 'DB unreachable' });

      const result = await worker.executeScriptJob({
        ...baseScriptJob,
        retryOnFailure: { maxAttempts: 3, delayMs: 1 }
      });

      expect(result.status).toBe('FAILED');
      expect(mockRunNodeScriptJob).toHaveBeenCalledTimes(3);
      expect(mockExecutionLogger.fail).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'DB unreachable' }),
        expect.objectContaining({ metadata: expect.objectContaining({ attempts: 3 }) })
      );
    });

    it('does not retry a SKIPPED result even with retryOnFailure enabled', async () => {
      mockRunNodeScriptJob.mockResolvedValue({ status: 'SKIPPED', scriptLogs: [], reason: 'No new records' });

      const result = await worker.executeScriptJob({
        ...baseScriptJob,
        retryOnFailure: { maxAttempts: 3, delayMs: 1 }
      });

      expect(result.status).toBe('SKIPPED');
      expect(mockRunNodeScriptJob).toHaveBeenCalledTimes(1);
    });
  });
});
