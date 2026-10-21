'use strict';

const express = require('express');
const request = require('supertest');

const makeFindCursor = (items) => ({
  sort: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  toArray: jest.fn().mockResolvedValue(items),
});

const mockAdminAuditCollection = {
  countDocuments: jest.fn(),
  find: jest.fn(),
  aggregate: jest.fn(),
  createIndex: jest.fn().mockResolvedValue(undefined),
  insertOne: jest.fn().mockResolvedValue({ insertedId: 'audit-export-1' }),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};

const makeStreamingCursor = (items) => ({
  sort: jest.fn().mockReturnThis(),
  batchSize: jest.fn().mockReturnThis(),
  close: jest.fn().mockResolvedValue(undefined),
  async *[Symbol.asyncIterator]() {
    yield* items;
  },
});
const mockIntegrationCollection = { find: jest.fn() };

const mockJobsCollection = {
  createIndex: jest.fn().mockResolvedValue(undefined),
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findOne: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'admin_audit') return mockAdminAuditCollection;
    if (name === 'admin_audit_export_jobs') return mockJobsCollection;
    if (name === 'integration_configs') return mockIntegrationCollection;
    return {
      find: jest.fn(() => makeFindCursor([])),
      aggregate: jest.fn(() => ({ toArray: jest.fn().mockResolvedValue([]) })),
      countDocuments: jest.fn().mockResolvedValue(0),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      updateMany: jest.fn().mockResolvedValue({ matchedCount: 0, modifiedCount: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      createIndex: jest.fn().mockResolvedValue(undefined),
    };
  }),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
}));

jest.mock('../../src/data', () => ({
  listUsers: jest.fn(async () => ({ users: [], total: 0 })),
  getUserById: jest.fn(async () => null),
  getSystemConfig: jest.fn(async () => null),
  updateSystemConfig: jest.fn(async () => ({})),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false),
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn(async () => {}),
  getTenant: jest.fn(() => null),
  findTenantByChildRid: jest.fn(() => null),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
  frontendUrl: 'http://localhost:5174',
  dailyReports: { apiKey: 'test-api-key' },
  worker: {},
}));

jest.mock('../../src/middleware/auth', () => ({
  requireRole: () => (_req, _res, next) => next(),
}));

jest.mock('../../src/middleware/rate-limiter', () => ({
  getRateLimitStatus: jest.fn(async () => null),
  resetRateLimit: jest.fn(async () => ({})),
}));

jest.mock('../../src/services/memory-monitor', () => ({
  MemoryMonitor: jest.fn().mockImplementation(() => ({
    forceGC: jest.fn(() => null),
  })),
}));

jest.mock('../../src/middleware/audit', () => ({
  auditUser: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditOrg: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditConfig: { rateLimitBulkApplied: jest.fn(async () => {}) },
  auditAdmin: { passwordChanged: jest.fn() },
}));

jest.mock('../../src/services/request-policy', () => ({
  normalizeRequestPolicy: jest.fn((value) => value || null),
}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', email: 'admin@example.com', role: 'SUPER_ADMIN', orgId: null };
    next();
  });
  const router = require('../../src/routes/admin');
  const errorHandler = require('../../src/middleware/error-handler');
  app.use('/api/v1/admin', router);
  app.use(errorHandler);
  return app;
};

describe('Admin audit routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockClear();
    mockAdminAuditCollection.countDocuments.mockReset();
    mockAdminAuditCollection.find.mockReset();
    mockAdminAuditCollection.aggregate.mockReset();
    mockJobsCollection.insertOne.mockClear();
    mockJobsCollection.findOneAndUpdate.mockReset();
    mockJobsCollection.findOneAndUpdate.mockResolvedValue({ value: null });
  });

  it('returns audit log summaries with an explicit day window', async () => {
    mockAdminAuditCollection.find.mockReturnValue(
      makeFindCursor([
        {
          _id: { toString: () => 'audit-1' },
          action: 'RATE_LIMITS_EXPORT',
          adminEmail: 'admin@example.com',
          adminId: 'admin-1',
          adminRole: 'SUPER_ADMIN',
          createdAt: new Date('2026-03-27T06:00:00.000Z'),
        },
      ])
    );
    mockAdminAuditCollection.countDocuments.mockResolvedValue(1);
    mockAdminAuditCollection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          total: [{ count: 1 }],
          topActions: [{ _id: 'RATE_LIMITS_EXPORT', count: 1 }],
          topAdmins: [{ _id: 'admin@example.com', count: 1 }],
          actionBreakdown: [{ _id: 'RATE_LIMITS_EXPORT', count: 1 }],
          trend: [{ _id: '2026-03-27', count: 1 }],
        },
      ]),
    });

    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/audit-logs?days=14');

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.summary.days).toBe(14);
    expect(res.body.summary.dailyCounts).toHaveLength(14);
    expect(res.body.summary.topActions).toEqual([{ action: 'RATE_LIMITS_EXPORT', count: 1 }]);
    expect(res.body.summary.topAdmins).toEqual([{ adminEmail: 'admin@example.com', count: 1 }]);

    // MongoDB rejects a $facet nested inside another $facet.
    const [pipeline] = mockAdminAuditCollection.aggregate.mock.calls[0];
    const facets = pipeline.filter((stage) => stage.$facet);
    for (const facet of facets) {
      for (const branch of Object.values(facet.$facet)) {
        expect(branch.some((stage) => stage.$facet)).toBe(false);
      }
    }
  });

  it('queues admin audit exports as async jobs', async () => {
    mockAdminAuditCollection.countDocuments.mockResolvedValue(7200);

    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/audit-logs/export?async=true');

    expect(res.status).toBe(202);
    expect(mockJobsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      status: 'QUEUED',
      format: 'csv',
      totalRecords: 7200,
    });
    expect(res.body.statusPath).toContain('/api/v1/admin/audit-logs/export/jobs/');
    expect(res.body.downloadPath).toContain('/api/v1/admin/audit-logs/export/jobs/');
  });

  it('queues admin audit trend exports as async jobs', async () => {
    mockAdminAuditCollection.countDocuments.mockResolvedValue(8100);

    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/audit-logs/export-trend?async=true&days=30');

    expect(res.status).toBe(202);
    expect(mockJobsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      status: 'QUEUED',
      format: 'csv',
      totalRecords: 30,
    });
    expect(res.body.statusPath).toContain('/api/v1/admin/audit-logs/export/jobs/');
    expect(res.body.downloadPath).toContain('/api/v1/admin/audit-logs/export/jobs/');
  });

  it('streams rate-limit CSV rows without materializing integration configs', async () => {
    mockIntegrationCollection.find.mockReturnValue(makeStreamingCursor([
      {
        _id: { toString: () => 'integration-1' },
        name: '=formula-name',
        direction: 'OUTBOUND',
        orgId: 33,
        rateLimits: { enabled: false, maxRequests: 10, windowSeconds: 60 },
        updatedAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]));
    const app = buildApp();
    const res = await request(app).get('/api/v1/admin/rate-limits/export?orgId=33');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('id,name,type');
    expect(res.text).toContain("'=formula-name");
    expect(mockIntegrationCollection.find).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 33 }),
      expect.objectContaining({ noCursorTimeout: true })
    );
  });
});
