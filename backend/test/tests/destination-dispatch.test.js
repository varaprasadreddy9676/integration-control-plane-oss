'use strict';

/**
 * ScheduledJobWorker.dispatchToDestination — Tests
 *
 * Tests the four destination types:
 *   HTTP_API       — existing axios delivery (default)
 *   INTERNAL_EVENT — push to in-process event queue
 *   SQL_WRITE      — execute INSERT/UPDATE via MySQL connection
 *   MONGODB_WRITE  — insert/upsert into MongoDB collection
 */

// ---------------------------------------------------------------------------
// Mocks (all hoisted before require)
// ---------------------------------------------------------------------------

const mockAxios = jest.fn();
jest.mock('axios', () => (...args) => mockAxios(...args));

const mockQueuePush = jest.fn();
jest.mock('../../src/data/queue', () => ({ push: (...args) => mockQueuePush(...args) }));

const mockGetConnection = jest.fn();
jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => true),
  getConnection: (...args) => mockGetConnection(...args),
}));

const mockFindOne = jest.fn();
jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({
    collection: jest.fn(() => ({
      findOne: (...args) => mockFindOne(...args),
      updateOne: jest.fn().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 }),
      insertOne: jest.fn().mockResolvedValue({ insertedId: 'new-doc-id' }),
      find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: { _id: 'job-1', owner: 'test-uuid', lockedUntil: new Date(Date.now() + 60000) } }),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    })),
  })),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => id),
}));

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({ Authorization: 'Bearer test-token' })),
}));

jest.mock('../../src/worker-heartbeat', () => ({
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
  updateHeartbeat: jest.fn(),
}));

jest.mock('../../src/utils/runtime', () => ({ uuidv4: jest.fn(() => 'test-uuid') }));

jest.mock('../../src/services/data-source-executor', () => ({
  executeDataSource: jest.fn(),
  replaceVariables: jest.fn((str) => str),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(),
  getTransformationSkipReason: jest.fn(() => null),
  isTransformationSkipped: jest.fn(() => false),
}));

jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: jest.fn(() => ({
    start: jest.fn(async () => {}),
    addStep: jest.fn(async () => {}),
    updateStatus: jest.fn(async () => {}),
    success: jest.fn(async () => {}),
    fail: jest.fn(async () => {}),
  })),
}));

// Mock operation-templates so we can test dispatch in isolation
jest.mock('../../src/services/operation-templates', () => ({
  applyProviderRef: jest.fn(async (_orgId, config) => config),
  hasProviderRef: jest.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const BASE_JOB = {
  _id: { toString: () => 'job-1' },
  orgId: 10,
  name: 'Test Job',
  targetUrl: 'https://api.example.com/webhook',
  httpMethod: 'POST',
  timeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ScheduledJobWorker.dispatchToDestination', () => {
  let worker;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    const { ScheduledJobWorker } = require('../../src/processor/scheduled-job-worker');
    worker = new ScheduledJobWorker();
  });

  // ── HTTP_API ───────────────────────────────────────────────────────────────

  describe('HTTP_API (default)', () => {
    it('posts to targetUrl via axios', async () => {
      mockAxios.mockResolvedValueOnce({ status: 200, headers: {}, data: { ok: true } });

      const result = await worker.dispatchToDestination({
        destinationType: 'HTTP_API',
        jobConfig: BASE_JOB,
        payload: { records: [1, 2, 3] },
        correlationId: 'c1',
      });

      expect(result.status).toBe(200);
      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'POST', url: 'https://api.example.com/webhook' })
      );
    });

    it('defaults to HTTP_API when destinationType is undefined', async () => {
      mockAxios.mockResolvedValueOnce({ status: 201, headers: {}, data: {} });

      const result = await worker.dispatchToDestination({
        destinationType: undefined,
        jobConfig: BASE_JOB,
        payload: {},
        correlationId: 'c2',
      });

      expect(mockAxios).toHaveBeenCalled();
      expect(result.status).toBe(201);
    });

    it('returns httpRequest and curlCommand for debugging', async () => {
      mockAxios.mockResolvedValueOnce({ status: 200, headers: {}, data: {} });

      const result = await worker.dispatchToDestination({
        destinationType: 'HTTP_API',
        jobConfig: BASE_JOB,
        payload: { test: true },
        correlationId: 'c3',
      });

      expect(result.httpRequest).toBeDefined();
      expect(result.httpRequest.url).toBe('https://api.example.com/webhook');
      expect(typeof result.curlCommand).toBe('string');
      expect(result.curlCommand).toContain('https://api.example.com/webhook');
    });

    it('includes auth headers from buildAuthHeaders in the axios call', async () => {
      const { buildAuthHeaders } = require('../../src/processor/auth-helper');
      buildAuthHeaders.mockResolvedValueOnce({ Authorization: 'raw-partnerhub-token' });
      mockAxios.mockResolvedValueOnce({ status: 200, headers: {}, data: {} });

      await worker.dispatchToDestination({
        destinationType: 'HTTP_API',
        jobConfig: BASE_JOB,
        payload: {},
        correlationId: 'c4',
      });

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'raw-partnerhub-token' }),
        })
      );
    });
  });

  // ── INTERNAL_EVENT ─────────────────────────────────────────────────────────

  describe('INTERNAL_EVENT', () => {
    it('pushes event to the in-process queue with 202 status', async () => {
      const result = await worker.dispatchToDestination({
        destinationType: 'INTERNAL_EVENT',
        jobConfig: { ...BASE_JOB, destination: { eventType: 'PARTNERHUB_QUEUE_SYNC' } },
        payload: { patients: [{ id: 1 }] },
        correlationId: 'c5',
      });

      expect(result.status).toBe(202);
      expect(result.data.queued).toBe(true);
      expect(result.data.eventType).toBe('PARTNERHUB_QUEUE_SYNC');
      expect(mockQueuePush).toHaveBeenCalledWith(
        expect.objectContaining({
          event_type: 'PARTNERHUB_QUEUE_SYNC',
          source: 'SCHEDULED_JOB',
          payload: { patients: [{ id: 1 }] },
          orgId: 10,
        })
      );
      expect(mockAxios).not.toHaveBeenCalled();
    });

    it('falls back to jobConfig.eventType when destination.eventType is absent', async () => {
      await worker.dispatchToDestination({
        destinationType: 'INTERNAL_EVENT',
        jobConfig: { ...BASE_JOB, eventType: 'PATIENT_SYNC' },
        payload: {},
        correlationId: 'c6',
      });

      expect(mockQueuePush).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: 'PATIENT_SYNC' })
      );
    });

    it('generates a fallback eventType from jobId when neither field is set', async () => {
      await worker.dispatchToDestination({
        destinationType: 'INTERNAL_EVENT',
        jobConfig: BASE_JOB, // no eventType, no destination.eventType
        payload: {},
        correlationId: 'c7',
      });

      expect(mockQueuePush).toHaveBeenCalledWith(
        expect.objectContaining({ event_type: expect.stringContaining('SCHEDULED_JOB_') })
      );
    });
  });

  // ── SQL_WRITE ──────────────────────────────────────────────────────────────

  describe('SQL_WRITE', () => {
    it('executes the destination query and returns affectedRows', async () => {
      const mockQuery = jest.fn().mockResolvedValue([{ affectedRows: 3, insertId: null }]);
      mockGetConnection.mockResolvedValueOnce({ query: mockQuery });

      const result = await worker.dispatchToDestination({
        destinationType: 'SQL_WRITE',
        jobConfig: { ...BASE_JOB, destination: { query: 'INSERT INTO sync_log (data) VALUES (?)' } },
        payload: { data: 'test' },
        correlationId: 'c8',
      });

      expect(result.status).toBe(200);
      expect(result.data.affectedRows).toBe(3);
      expect(mockQuery).toHaveBeenCalled();
      expect(mockAxios).not.toHaveBeenCalled();
    });

    it('throws when destination.query is missing', async () => {
      await expect(
        worker.dispatchToDestination({
          destinationType: 'SQL_WRITE',
          jobConfig: { ...BASE_JOB, destination: {} },
          payload: {},
          correlationId: 'c9',
        })
      ).rejects.toThrow('SQL_WRITE destination requires destination.query');
    });
  });

  // ── MONGODB_WRITE ──────────────────────────────────────────────────────────

  describe('MONGODB_WRITE', () => {
    it('inserts a document into the configured collection', async () => {
      const result = await worker.dispatchToDestination({
        destinationType: 'MONGODB_WRITE',
        jobConfig: {
          ...BASE_JOB,
          destination: { collection: 'partnerhub_queue', operation: 'insert' },
        },
        payload: { patientId: 'P001', abhaNo: '123456789012' },
        correlationId: 'c10',
      });

      expect(result.status).toBe(200);
      expect(result.data.operation).toBe('insert');
      expect(mockAxios).not.toHaveBeenCalled();
    });

    it('upserts when operation=upsert with a filter', async () => {
      const result = await worker.dispatchToDestination({
        destinationType: 'MONGODB_WRITE',
        jobConfig: {
          ...BASE_JOB,
          destination: {
            collection: 'partnerhub_queue',
            operation: 'upsert',
            filter: { patientId: 'P001' },
          },
        },
        payload: { patientId: 'P001', status: 'linked' },
        correlationId: 'c11',
      });

      expect(result.status).toBe(200);
      expect(result.data.operation).toBe('upsert');
    });

    it('throws when destination.collection is missing', async () => {
      await expect(
        worker.dispatchToDestination({
          destinationType: 'MONGODB_WRITE',
          jobConfig: { ...BASE_JOB, destination: {} },
          payload: {},
          correlationId: 'c12',
        })
      ).rejects.toThrow('MONGODB_WRITE destination requires destination.collection');
    });

    it('throws when upsert has no filter', async () => {
      await expect(
        worker.dispatchToDestination({
          destinationType: 'MONGODB_WRITE',
          jobConfig: {
            ...BASE_JOB,
            destination: { collection: 'test_col', operation: 'upsert' },
          },
          payload: {},
          correlationId: 'c13',
        })
      ).rejects.toThrow('MONGODB_WRITE upsert requires destination.filter');
    });
  });
});
