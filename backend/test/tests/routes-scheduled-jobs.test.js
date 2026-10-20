'use strict';

/**
 * Scheduled Jobs route integration tests
 * Tests CRUD operations for /api/v1/scheduled-jobs
 */

const express = require('express');
const request = require('supertest');
const { createMockDb, resetMockCollection } = require('./helpers/mock-mongodb');

// Valid ObjectId format (24 hex chars) — required by the native mongodb driver
const VALID_JOB_ID = '507f1f77bcf86cd799439011';
const VALID_LOG_ID = '507f1f77bcf86cd799439022';

const mockJobDoc = {
  _id: { toString: () => VALID_JOB_ID },
  orgId: 1,
  name: 'Daily Export',
  direction: 'SCHEDULED',
  schedule: { type: 'CRON', expression: '0 0 * * *' },
  dataSource: { type: 'MySQL', host: 'localhost' },
  targetUrl: 'https://webhook.example.com',
  httpMethod: 'POST',
  isActive: true,
  createdAt: new Date()
};

const mockDb = createMockDb();

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(async () => mockDb),
  getDbSafe: jest.fn(async () => mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
}));

// Saving a script job with changed dependencies starts an install in the
// background. Left real, it ran npm install over the network and wrote to the
// mocked DB in the middle of later tests, which made them fail at random.
jest.mock('../../src/services/node-script-runner', () => ({
  ...jest.requireActual('../../src/services/node-script-runner'),
  installDependencies: jest.fn(async () => ({ success: true, output: '' })),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/middleware/audit', () => ({
  auditScheduledJob: {
    created: jest.fn(async () => {}),
    updated: jest.fn(async () => {}),
    deleted: jest.fn(async () => {}),
    executed: jest.fn(async () => {})
  }
}));

jest.mock('node-cron', () => ({
  validate: jest.fn((expr) => expr && expr.length > 0)
}));

const mockScheduledJobWorker = {
  scheduleJob: jest.fn(),
  unscheduleJob: jest.fn(),
  executeJob: jest.fn()
};

jest.mock('../../src/processor/scheduled-job-worker', () => ({
  getScheduledJobWorker: jest.fn(() => mockScheduledJobWorker)
}));

jest.mock('../../src/services/data-source-executor', () => ({
  executeDataSource: jest.fn(async () => [{ id: 1, name: 'Record 1' }])
}));

jest.mock('../../src/services/gateway-secrets', () => ({
  setSecret: jest.fn(async () => {}),
  getSecret: jest.fn(async () => null),
}));

function buildApp(user = { id: 'user-1', role: 'ORG_ADMIN' }) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.orgId = 1;
    req.entityParentRid = 1;
    req.user = user;
    next();
  });

  const scheduledJobsRouter = require('../../src/routes/scheduled-jobs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/scheduled-jobs', scheduledJobsRouter);
  app.use(errorHandler);
  return app;
}

describe('Scheduled Jobs Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();

    // clearAllMocks keeps queued mockResolvedValueOnce() values; a test that
    // exits before consuming one would hand it to the next test. Reset them.
    resetMockCollection(mockDb.collection('integration_configs'));
    resetMockCollection(mockDb.collection('scheduled_job_logs'));

    const configCollection = mockDb.collection('integration_configs');
    configCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn(async () => [mockJobDoc])
    });
    configCollection.findOne.mockResolvedValue(mockJobDoc);
    configCollection.insertOne.mockResolvedValue({ insertedId: VALID_JOB_ID });
    configCollection.findOneAndUpdate.mockResolvedValue({ value: mockJobDoc, ok: 1 });
    configCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

    const logsCollection = mockDb.collection('scheduled_job_logs');
    logsCollection.findOne.mockResolvedValue(null);
    logsCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn(async () => [])
    });
    logsCollection.countDocuments.mockResolvedValue(0);
  });

  describe('GET /api/v1/scheduled-jobs', () => {
    it('returns 200 with list of jobs', async () => {
      const res = await request(app).get('/api/v1/scheduled-jobs');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('POST /api/v1/scheduled-jobs', () => {
    it('rejects create when user lacks scheduled:create', async () => {
      app = buildApp({ id: 'viewer-1', role: 'VIEWER' });

      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'New Job',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'SQL', query: 'SELECT 1' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(403);
      expect(mockDb.collection('integration_configs').insertOne).not.toHaveBeenCalled();
    });

    it('returns 201 when creating valid job', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'New Job',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL', host: 'localhost' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('name', 'New Job');
    });

    it('creates SCRIPT_JOB without dataSource or targetUrl', async () => {
      const configCollection = mockDb.collection('integration_configs');

      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'Tailspin Sync Script',
          direction: 'SCRIPT_JOB',
          schedule: { type: 'CRON', expression: '0 6 * * *' },
          script: "log.info('ok');",
        });

      expect(res.status).toBe(201);
      expect(configCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Tailspin Sync Script',
          direction: 'SCRIPT_JOB',
          orgId: 1,
          httpMethod: undefined,
        })
      );
    });

    it('stores SCRIPT_JOB environment variables as encrypted secret references', async () => {
      const { setSecret } = require('../../src/services/gateway-secrets');
      const configCollection = mockDb.collection('integration_configs');

      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'Tailspin Sync Script',
          direction: 'SCRIPT_JOB',
          schedule: { type: 'CRON', expression: '0 6 * * *' },
          script: "return env.NOVA_DB_PASSWORD;",
          environmentVariables: [
            { key: 'NOVA_DB_PASSWORD', value: 'super-secret' },
            { key: 'REPORT_TO', value: 'ops@example.com' },
          ],
        });

      expect(res.status).toBe(201);
      expect(setSecret).toHaveBeenCalledWith(expect.stringContaining(':NOVA_DB_PASSWORD'), 'super-secret', 1);
      expect(setSecret).toHaveBeenCalledWith(expect.stringContaining(':REPORT_TO'), 'ops@example.com', 1);

      const savedJob = configCollection.insertOne.mock.calls[0][0];
      expect(savedJob.environmentVariables).toEqual([
        expect.objectContaining({
          key: 'NOVA_DB_PASSWORD',
          secretKey: expect.stringContaining(':NOVA_DB_PASSWORD'),
          hasValue: true,
        }),
        expect.objectContaining({
          key: 'REPORT_TO',
          secretKey: expect.stringContaining(':REPORT_TO'),
          hasValue: true,
        }),
      ]);
      expect(JSON.stringify(savedJob)).not.toContain('super-secret');
      expect(JSON.stringify(res.body)).not.toContain('super-secret');
    });

    it('returns 400 when name is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty('error');
    });

    it('returns 400 when schedule is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'Incomplete Job',
          dataSource: { type: 'MySQL' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when dataSource is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'No Source',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          targetUrl: 'https://webhook.example.com'
        });

      expect(res.status).toBe(400);
    });

    it('returns 400 when targetUrl is missing', async () => {
      const res = await request(app)
        .post('/api/v1/scheduled-jobs')
        .send({
          name: 'No Target',
          schedule: { type: 'CRON', expression: '0 0 * * *' },
          dataSource: { type: 'MySQL' }
        });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when job exists', async () => {
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(200);
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'Scheduled job not found');
    });
  });

  describe('PUT /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when updating job', async () => {
      const res = await request(app)
        .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
        .send({ name: 'Updated Job' });

      expect(res.status).toBe(200);
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOneAndUpdate.mockResolvedValueOnce(null);
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);

      const res = await request(app)
        .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(404);
    });

    // Regression: mongodb driver 4.x's findOneAndUpdate resolves to
    // { value, lastErrorObject, ok } — never the document itself. The route used
    // to read `result.isActive` straight off that wrapper, which is always
    // undefined (falsy), so it always took the "inactive" branch and called
    // worker.unscheduleJob() instead of worker.scheduleJob() on every single save,
    // no matter what isActive/schedule actually were. This is exactly what caused
    // the real "Tailspin Daily Sync Report" and "Daily HTTP Transfer Report" jobs to
    // silently stop firing at 6am in production — confirmed via the audit log,
    // which showed isActive: true and a valid CRON schedule both before and after
    // the save that broke them. These tests pin the fix: the wrapper must be
    // unwrapped before anything touches `result`.
    describe('findOneAndUpdate result unwrapping (worker rescheduling)', () => {
      beforeEach(() => {
        // .mockReset() (not just the outer clearAllMocks()) so a once-queued
        // implementation left over from an earlier test in this file (e.g. the
        // 404 test's findOneAndUpdate.mockResolvedValueOnce(null), which is never
        // actually consumed because that test 404s earlier via findOne) can't
        // leak in and shadow this block's own mockResolvedValueOnce() calls.
        mockDb.collection('integration_configs').findOneAndUpdate.mockReset().mockResolvedValue({ value: mockJobDoc, ok: 1 });
      });

      it('reschedules with the real document when the driver returns the {value} wrapper and isActive is true', async () => {
        const activeDoc = { ...mockJobDoc, isActive: true, schedule: { type: 'CRON', expression: '0 6 * * *' } };
        mockDb
          .collection('integration_configs')
          .findOneAndUpdate.mockResolvedValueOnce({ value: activeDoc, ok: 1, lastErrorObject: { updatedExisting: true } });

        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ name: 'Updated Job' });

        expect(res.status).toBe(200);
        expect(mockScheduledJobWorker.scheduleJob).toHaveBeenCalledTimes(1);
        expect(mockScheduledJobWorker.scheduleJob).toHaveBeenCalledWith(activeDoc);
        expect(mockScheduledJobWorker.unscheduleJob).not.toHaveBeenCalled();
      });

      it('unschedules (not reschedules) when the unwrapped document has isActive: false', async () => {
        const inactiveDoc = { ...mockJobDoc, isActive: false };
        mockDb
          .collection('integration_configs')
          .findOneAndUpdate.mockResolvedValueOnce({ value: inactiveDoc, ok: 1 });

        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ isActive: false });

        expect(res.status).toBe(200);
        expect(mockScheduledJobWorker.unscheduleJob).toHaveBeenCalledTimes(1);
        expect(mockScheduledJobWorker.unscheduleJob).toHaveBeenCalledWith(VALID_JOB_ID);
        expect(mockScheduledJobWorker.scheduleJob).not.toHaveBeenCalled();
      });

      it('returns 404 (not a 200 with a malformed body) when the driver reports no match via { value: null }', async () => {
        mockDb
          .collection('integration_configs')
          .findOneAndUpdate.mockResolvedValueOnce({ value: null, ok: 1, lastErrorObject: { updatedExisting: false } });

        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ name: 'Updated' });

        expect(res.status).toBe(404);
        expect(mockScheduledJobWorker.scheduleJob).not.toHaveBeenCalled();
        expect(mockScheduledJobWorker.unscheduleJob).not.toHaveBeenCalled();
      });

      it('returns the real document in the response body, not the driver wrapper', async () => {
        const activeDoc = { ...mockJobDoc, name: 'Renamed Job', isActive: true };
        mockDb
          .collection('integration_configs')
          .findOneAndUpdate.mockResolvedValueOnce({ value: activeDoc, ok: 1 });

        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ name: 'Renamed Job' });

        expect(res.status).toBe(200);
        expect(res.body.name).toBe('Renamed Job');
        expect(res.body.isActive).toBe(true);
        // Must not leak the driver's wrapper shape into the API response
        expect(res.body.value).toBeUndefined();
        expect(res.body.lastErrorObject).toBeUndefined();
        expect(res.body.ok).toBeUndefined();
      });

      it('passes the real document (not the wrapper) to the audit log as "after"', async () => {
        const { auditScheduledJob } = require('../../src/middleware/audit');
        const activeDoc = { ...mockJobDoc, name: 'Audited Job', isActive: true };
        mockDb
          .collection('integration_configs')
          .findOneAndUpdate.mockResolvedValueOnce({ value: activeDoc, ok: 1 });

        await request(app).put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`).send({ name: 'Audited Job' });

        expect(auditScheduledJob.updated).toHaveBeenCalledTimes(1);
        const [, , changes] = auditScheduledJob.updated.mock.calls[0];
        expect(changes.after).toBe(activeDoc);
        expect(changes.after.value).toBeUndefined();
      });
    });

    // Regression: saving a NODE_PROCESS Script Job for ANY reason (e.g. just editing
    // an environment variable) resubmits the whole form including the unchanged
    // `dependencies` array. The old check was `Object.hasOwn(updates, 'dependencies')`
    // — true whenever the field was present at all, regardless of whether its
    // contents actually changed — so every save silently reset a validated
    // "installed" depsStatus back to "pending", even though node_modules on disk
    // was untouched. Caught live on the real "Tailspin Daily Sync Report" job after
    // saving an unrelated environment variable edit.
    describe('depsStatus reset only on an actual dependency/script change', () => {
      const nodeProcessJobDoc = {
        _id: { toString: () => VALID_JOB_ID },
        orgId: 1,
        name: 'Tailspin Daily Sync Report',
        direction: 'SCRIPT_JOB',
        runtime: 'NODE_PROCESS',
        script: 'console.log("hi")',
        dependencies: [
          { name: 'mysql2', version: '2.3.3' },
          { name: 'axios', version: '1.6.7' },
        ],
        depsStatus: 'installed',
      };

      beforeEach(() => {
        // .mockReset() (not just clearAllMocks() in the outer beforeEach) so a
        // once-queued implementation left over from an earlier test in this file
        // (e.g. the 404 test's findOne.mockResolvedValueOnce(null)) can't leak in
        // and shadow this describe block's default resolved value.
        const configCollection = mockDb.collection('integration_configs');
        configCollection.findOne.mockReset().mockResolvedValue(nodeProcessJobDoc);
        configCollection.findOneAndUpdate.mockReset().mockResolvedValue({ value: nodeProcessJobDoc, ok: 1 });
      });

      it('does not reset depsStatus when the resubmitted dependencies array is unchanged', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({
            environmentVariables: [],
            dependencies: [
              { name: 'mysql2', version: '2.3.3' },
              { name: 'axios', version: '1.6.7' },
            ],
          });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBeUndefined();
      });

      it('does not reset depsStatus when dependencies are resubmitted in a different order', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({
            dependencies: [
              { name: 'axios', version: '1.6.7' },
              { name: 'mysql2', version: '2.3.3' },
            ],
          });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBeUndefined();
      });

      it('resets depsStatus to pending when a dependency version actually changes', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({
            dependencies: [
              { name: 'mysql2', version: '3.15.3' },
              { name: 'axios', version: '1.6.7' },
            ],
          });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBe('pending');
      });

      it('resets depsStatus to pending when a dependency is added', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({
            dependencies: [
              { name: 'mysql2', version: '2.3.3' },
              { name: 'axios', version: '1.6.7' },
              { name: 'nodemailer', version: '6.9.0' },
            ],
          });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBe('pending');
      });

      it('does not reset depsStatus when the script is resubmitted unchanged', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ script: 'console.log("hi")' });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBeUndefined();
      });

      it('resets depsStatus to pending when the script actually changes', async () => {
        const res = await request(app)
          .put(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`)
          .send({ script: 'console.log("bye")' });

        expect(res.status).toBe(200);
        const setArg = mockDb.collection('integration_configs').findOneAndUpdate.mock.calls.at(-1)[1].$set;
        expect(setArg.depsStatus).toBe('pending');
      });
    });
  });

  describe('DELETE /api/v1/scheduled-jobs/:id', () => {
    it('returns 200 when deleting job', async () => {
      const res = await request(app).delete(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Scheduled job deleted successfully');
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').deleteOne.mockResolvedValueOnce({ deletedCount: 0 });
      const res = await request(app).delete(`/api/v1/scheduled-jobs/${VALID_JOB_ID}`);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/v1/scheduled-jobs/:id/execute', () => {
    it('rejects manual execution when user lacks scheduled:execute', async () => {
      app = buildApp({ id: 'viewer-1', role: 'VIEWER' });

      const res = await request(app).post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`);

      expect(res.status).toBe(403);
      const { getScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');
      expect(getScheduledJobWorker().executeJob).not.toHaveBeenCalled();
    });

    it('returns 200 when manually executing job', async () => {
      const res = await request(app).post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`);
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('message', 'Job execution triggered');
    });

    it('passes dryRun and reason options to manual execution', async () => {
      const { getScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');

      const res = await request(app)
        .post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`)
        .send({ dryRun: true, reason: 'Preview nightly changes' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ dryRun: true });
      expect(getScheduledJobWorker().executeJob).toHaveBeenCalledWith(
        mockJobDoc,
        expect.objectContaining({
          dryRun: true,
          reason: 'Preview nightly changes',
          triggeredBy: 'user-1'
        })
      );
    });

    it('returns 404 when job not found', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);
      const res = await request(app).post(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/execute`);
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/scheduled-jobs/:id/logs', () => {
    it('returns 200 with execution logs', async () => {
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/logs`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  // Regression: the Scheduled Job edit screen never showed a saved environment
  // variable's current value (always "Saved, leave blank to keep"), even for
  // non-sensitive rows like an EMAIL_TO address — so a user adding a second
  // recipient had no way to see what was already there without risking
  // overwriting it. This endpoint lets the UI fetch one value on demand.
  describe('GET /api/v1/scheduled-jobs/:id/environment-variables/:key/reveal', () => {
    const scriptJobDoc = {
      _id: { toString: () => VALID_JOB_ID },
      orgId: 1,
      name: 'Tailspin Daily Sync Report',
      direction: 'SCRIPT_JOB',
      runtime: 'NODE_PROCESS',
      environmentVariables: [
        { key: 'EMAIL_TO', secretKey: 'script-job:job-1:EMAIL_TO', hasValue: true },
        { key: 'EMAIL_FROM', secretKey: 'script-job:job-1:EMAIL_FROM', hasValue: true },
      ],
    };

    // Revealing a saved value can expose real credentials (DB passwords, etc.),
    // so this endpoint is Super Admin only — a plain ORG_ADMIN gets a 403.
    let superAdminApp;
    beforeEach(() => {
      superAdminApp = buildApp({ id: 'super-1', role: 'SUPER_ADMIN' });
    });

    it('returns 403 for a non-Super-Admin user', async () => {
      const res = await request(app).get(`/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/EMAIL_TO/reveal`);

      expect(res.status).toBe(403);
    });

    it('returns the decrypted value for a valid key', async () => {
      const { getSecret } = require('../../src/services/gateway-secrets');
      getSecret.mockResolvedValueOnce('dev@example.com');
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(scriptJobDoc);

      const res = await request(superAdminApp).get(
        `/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/EMAIL_TO/reveal`
      );

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ key: 'EMAIL_TO', value: 'dev@example.com' });
      expect(getSecret).toHaveBeenCalledWith('script-job:job-1:EMAIL_TO', 1);
    });

    it('returns 404 when the job does not exist', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);

      const res = await request(superAdminApp).get(
        `/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/EMAIL_TO/reveal`
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when the key does not exist on the job', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(scriptJobDoc);

      const res = await request(superAdminApp).get(
        `/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/DOES_NOT_EXIST/reveal`
      );

      expect(res.status).toBe(404);
    });

    it('returns 404 when the secret has no stored value (e.g. was deleted out of band)', async () => {
      const { getSecret } = require('../../src/services/gateway-secrets');
      getSecret.mockResolvedValueOnce(null);
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(scriptJobDoc);

      const res = await request(superAdminApp).get(
        `/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/EMAIL_TO/reveal`
      );

      expect(res.status).toBe(404);
    });

    it('never returns the value for a job scoped to a different org (findOne is org-scoped)', async () => {
      mockDb.collection('integration_configs').findOne.mockResolvedValueOnce(null);

      const res = await request(superAdminApp).get(
        `/api/v1/scheduled-jobs/${VALID_JOB_ID}/environment-variables/EMAIL_TO/reveal`
      );

      expect(res.status).toBe(404);
      expect(mockDb.collection('integration_configs').findOne).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 1, direction: 'SCRIPT_JOB' })
      );
    });
  });
});
