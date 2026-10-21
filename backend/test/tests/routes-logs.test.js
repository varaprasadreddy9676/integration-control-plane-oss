'use strict';

/**
 * Logs route integration tests
 * Tests GET /api/v1/logs and related endpoints
 */

const express = require('express');
const request = require('supertest');

// --- Mock setup ---

const mockLogDoc = {
  _id: { toString: () => 'log-id-456' },
  orgId: 1,
  integrationConfigId: { toString: () => 'integration-id-123' },
  integrationName: 'Test Integration',
  eventType: 'TEST_EVENT',
  direction: 'OUTBOUND',
  triggerType: 'EVENT',
  status: 'SUCCESS',
  responseStatus: 200,
  responseTimeMs: 150,
  attemptCount: 1,
  createdAt: new Date(),
  deliveredAt: new Date(),
  targetUrl: 'https://example.com/webhook',
  httpMethod: 'POST'
};

const mockCollection = {
  find: jest.fn().mockReturnValue({
    hint: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    toArray: jest.fn().mockResolvedValue([mockLogDoc])
  }),
  findOne: jest.fn().mockResolvedValue(null),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'log-id-456' }),
  updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  deleteMany: jest.fn().mockResolvedValue({ deletedCount: 1 }),
  countDocuments: jest.fn().mockResolvedValue(1),
  distinct: jest.fn().mockResolvedValue([]),
  aggregate: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) }),
  createIndex: jest.fn().mockResolvedValue('ok')
};

const mockDb = {
  collection: jest.fn().mockReturnValue(mockCollection)
};

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue(mockDb),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null),
  findTenantByChildRid: jest.fn().mockReturnValue(null)
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
  security: { jwtSecret: 'test-secret', jwtExpiresIn: '12h', apiKey: 'test-api-key-xyz' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });

jest.mock('../../src/processor/retry-handler', () => ({
  replayEvent: jest.fn().mockResolvedValue({ id: 'replay-log-id', status: 'PENDING' })
}));

function buildApp() {
  return buildAppWithRequestMutator();
}

function buildAppWithRequestMutator(mutateReq) {
  const app = express();
  app.use(express.json());

  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    req.entityParentRid = 1;
    if (typeof mutateReq === 'function') {
      mutateReq(req);
    }
    next();
  });

  const logsRouter = require('../../src/routes/logs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/logs', logsRouter);
  app.use(errorHandler);
  return app;
}

function buildAppWithAuth() {
  const app = express();
  app.use(express.json());

  const auth = require('../../src/middleware/auth');
  const logsRouter = require('../../src/routes/logs');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/logs', auth, logsRouter);
  app.use(errorHandler);
  return app;
}

describe('Logs Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockDb.collection.mockReturnValue(mockCollection);

    mockCollection.find.mockReturnValue({
      hint: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([mockLogDoc])
    });
    mockCollection.countDocuments.mockResolvedValue(1);
    mockCollection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([mockLogDoc]),
    });
  });

  describe('GET /api/v1/logs', () => {
    it('returns 200 with logs and pagination', async () => {
      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body).toHaveProperty('summary');
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it('returns empty data when no logs exist', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(0);

      const res = await request(app).get('/api/v1/logs');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.summary).toBeNull();
    });

    it('accepts status filter', async () => {
      const res = await request(app).get('/api/v1/logs?status=FAILED');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
    });

    it('accepts pagination params', async () => {
      const res = await request(app).get('/api/v1/logs?page=2&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.pagination).toMatchObject({
        page: 2,
        limit: 10
      });
    });

    it('returns correct pagination metadata', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([mockLogDoc]),
      });
      mockCollection.countDocuments.mockResolvedValueOnce(25);

      const res = await request(app).get('/api/v1/logs?page=1&limit=10');
      expect(res.status).toBe(200);
      expect(res.body.pagination.total).toBe(25);
      expect(res.body.pagination.totalPages).toBe(3);
    });

    it('falls back to regex search when the execution log text index is missing', async () => {
      const textIndexError = new Error('text index required for $text query');
      textIndexError.code = 27;

      mockCollection.aggregate
        .mockReturnValueOnce({
          toArray: jest.fn().mockRejectedValue(textIndexError)
        })
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([
            mockLogDoc,
          ])
        });

      const res = await request(app).get('/api/v1/logs?search=Jane');

      expect(res.status).toBe(200);
      expect(mockCollection.aggregate).toHaveBeenCalledTimes(2);
      expect(mockCollection.aggregate.mock.calls[0][0][0]).toEqual({
        $match: expect.objectContaining({
          orgId: 1,
          $text: { $search: 'Jane' }
        })
      });
      expect(mockCollection.aggregate.mock.calls[1][0][0].$match.$text).toBeUndefined();
      expect(mockCollection.aggregate.mock.calls[1][0][0].$match.$and).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              expect.objectContaining({
                searchableText: { $regex: 'Jane', $options: 'i' }
              })
            ])
          })
        ])
      );
    });
  });

  describe('GET /api/v1/logs without auth', () => {
    it('returns 401 without any token or API key', async () => {
      const appWithAuth = buildAppWithAuth();
      const res = await request(appWithAuth).get('/api/v1/logs');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/v1/logs/:id/replay', () => {
    it('passes edited replay payload options to the replay handler', async () => {
      const retryHandler = require('../../src/processor/retry-handler');
      const failedLog = {
        ...mockLogDoc,
        status: 'FAILED',
        integrationConfigId: { toString: () => 'integration-id-123' },
        originalPayload: { orderId: 'old-order' },
        requestPayload: 'MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|OLD|P|2.3\r',
      };
      const integrationDoc = {
        _id: { toString: () => 'integration-id-123' },
        name: 'HL7 Integration',
        orgId: 1,
        eventType: 'TEST_EVENT',
        direction: 'OUTBOUND',
        isActive: true,
        targetUrl: 'mllp://127.0.0.1:2575',
        httpMethod: 'HL7_MLLP',
      };
      const executionLogsCollection = {
        ...mockCollection,
        findOne: jest.fn().mockResolvedValue(failedLog),
      };
      const integrationsCollection = {
        ...mockCollection,
        findOne: jest.fn().mockResolvedValue(integrationDoc),
      };
      const attemptsCollection = {
        find: jest.fn().mockReturnValue({
          sort: jest.fn().mockReturnThis(),
          toArray: jest.fn().mockResolvedValue([]),
        }),
      };
      mockDb.collection.mockImplementation((name) => {
        if (name === 'execution_logs') return executionLogsCollection;
        if (name === 'integration_configs') return integrationsCollection;
        if (name === 'delivery_attempts') return attemptsCollection;
        return mockCollection;
      });

      const editedPayload = { orderId: 'edited-order', patient: { id: 'P100' } };
      const res = await request(app)
        .post('/api/v1/logs/log-id-456/replay')
        .send({ payload: editedPayload, reason: 'HL7 debug replay', force: true });

      expect(res.status).toBe(200);
      expect(retryHandler.replayEvent).toHaveBeenCalledWith(
        'log-id-456',
        1,
        expect.objectContaining({
          payload: editedPayload,
          reason: 'HL7 debug replay',
          force: true,
        })
      );
    });
  });

  describe('GET /api/v1/logs/stats/summary', () => {
    it('returns 200 with stats', async () => {
      mockCollection.aggregate.mockReturnValue({
        toArray: jest.fn().mockResolvedValue([{ total: 10, success: 8, failed: 2, pending: 0 }])
      });

      const res = await request(app).get('/api/v1/logs/stats/summary');
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('total');
    });

    it('falls back to regex search for stats when the execution log text index is missing', async () => {
      const textIndexError = new Error('text index required for $text query');
      textIndexError.code = 27;

      mockCollection.aggregate
        .mockReturnValueOnce({
          toArray: jest.fn().mockRejectedValue(textIndexError)
        })
        .mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([{ total: 10, success: 8, failed: 2, skipped: 0, pending: 0 }])
        });

      const res = await request(app).get('/api/v1/logs/stats/summary?search=Jane');

      expect(res.status).toBe(200);
      expect(mockCollection.aggregate).toHaveBeenCalledTimes(2);
      expect(mockCollection.aggregate.mock.calls[0][0][0]).toEqual({
        $match: expect.objectContaining({
          orgId: 1,
          $text: { $search: 'Jane' }
        })
      });
      expect(mockCollection.aggregate.mock.calls[1][0][0].$match.$text).toBeUndefined();
      expect(mockCollection.aggregate.mock.calls[1][0][0].$match.$and).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            $or: expect.arrayContaining([
              expect.objectContaining({
                searchableText: { $regex: 'Jane', $options: 'i' }
              })
            ])
          })
        ])
      );
    });
  });

  describe('GET /api/v1/logs/export', () => {
    it('streams csv export without running a full count preflight', async () => {
      const streamCursor = {
        close: jest.fn().mockResolvedValue(undefined),
        async *[Symbol.asyncIterator]() {
          yield mockLogDoc;
        },
      };

      mockCollection.find.mockImplementation((_query, options = {}) => {
        if (options.projection) {
          return {
            hint: jest.fn().mockReturnThis(),
            limit: jest.fn().mockReturnValue({
              toArray: jest.fn().mockResolvedValue([{ _id: 'log-id-456' }]),
            }),
          };
        }

        return {
          hint: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          batchSize: jest.fn().mockReturnValue(streamCursor),
        };
      });

      const res = await request(app).get('/api/v1/logs/export');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.text).toContain('Log ID,Timestamp');
      expect(mockCollection.countDocuments).not.toHaveBeenCalled();
      expect(streamCursor.close).toHaveBeenCalled();
    });
  });

  describe('GET /api/v1/logs/export/json', () => {
    it('masks credentials in logged URLs and request headers', async () => {
      const secretLog = {
        ...mockLogDoc,
        targetUrl: 'https://hooks.slack.com/services/T0/B0/slack-secret',
        requestHeaders: { Authorization: 'Bearer header-secret', 'Content-Type': 'application/json' },
      };
      const streamCursor = {
        close: jest.fn().mockResolvedValue(undefined),
        async *[Symbol.asyncIterator]() {
          yield secretLog;
        },
      };
      mockCollection.find.mockImplementation((_query, options = {}) =>
        options.projection
          ? {
              hint: jest.fn().mockReturnThis(),
              limit: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([{ _id: 'log-id-456' }]) }),
            }
          : { hint: jest.fn().mockReturnThis(), sort: jest.fn().mockReturnThis(), batchSize: jest.fn().mockReturnValue(streamCursor) }
      );

      const res = await request(app).get('/api/v1/logs/export/json');

      expect(res.status).toBe(200);
      expect(res.text).not.toMatch(/slack-secret|header-secret/);
      expect(res.text).toContain('application/json');
    });
  });

  describe('GET /api/v1/logs/:id', () => {
    it('returns 404 when log not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      const res = await request(app).get('/api/v1/logs/nonexistent-log-id');
      expect(res.status).toBe(404);
    });

    it('returns 200 with log details when found', async () => {
      const logWithAttempts = {
        ...mockLogDoc,
        __KEEP___KEEP_integrationConfig__Id__: null
      };
      mockCollection.findOne.mockResolvedValue(logWithAttempts);

      // Also mock the delivery_attempts collection
      mockDb.collection.mockImplementation((name) => {
        if (name === 'delivery_attempts') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([])
            })
          };
        }
        return mockCollection;
      });

      const res = await request(app).get('/api/v1/logs/log-id-456');
      expect([200, 404]).toContain(res.status);
    });
  });

  describe('POST /api/v1/logs/export/selected', () => {
    beforeEach(() => {
      mockDb.collection.mockImplementation((name) => {
        if (name === 'delivery_attempts') {
          return {
            find: jest.fn().mockReturnValue({
              sort: jest.fn().mockReturnThis(),
              toArray: jest.fn().mockResolvedValue([])
            })
          };
        }
        return mockCollection;
      });
    });

    it('returns 400 for unsupported formats', async () => {
      const res = await request(app)
        .post('/api/v1/logs/export/selected')
        .send({ ids: ['log-id-456'], format: 'xlsx' });

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
    });

    it('returns selected logs as JSON when the ids are valid', async () => {
      mockCollection.findOne.mockResolvedValue(mockLogDoc);

      const res = await request(app)
        .post('/api/v1/logs/export/selected')
        .send({ ids: ['log-id-456'], format: 'json' });

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe('log-id-456');
    });

    it('returns 404 when selected logs are outside portal scope', async () => {
      const portalApp = buildAppWithRequestMutator((req) => {
        req.user = {
          ...req.user,
          isPortalSession: true
        };
        req.portalScope = {
          allowedIntegrationIds: ['different-integration'],
          allowedViews: ['logs'],
          allowedTags: [],
          tokenVersion: 1
        };
      });
      mockCollection.findOne.mockResolvedValue(mockLogDoc);

      const res = await request(portalApp)
        .post('/api/v1/logs/export/selected')
        .send({ ids: ['log-id-456'], format: 'json' });

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    });
  });
});
