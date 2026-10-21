'use strict';

const express = require('express');
const request = require('supertest');

const executionCollection = {
  aggregate: jest.fn(),
};

const integrationConfigCollection = {
  find: jest.fn(),
};

const rollupMetaCollection = {
  findOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'execution_logs') return executionCollection;
    if (name === 'integration_configs') return integrationConfigCollection;
    if (name === 'dashboard_analytics_rollup_meta') return rollupMetaCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
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
  worker: {},
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

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 1;
    next();
  });

  const analyticsRouter = require('../../src/routes/analytics');
  const errorHandler = require('../../src/middleware/error-handler');
  app.use('/api/v1/analytics', analyticsRouter);
  app.use(errorHandler);
  return app;
}

describe('Analytics Routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    rollupMetaCollection.findOne.mockResolvedValue(null);

    executionCollection.aggregate.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        {
          statusAgg: [
            { _id: 'SUCCESS', count: 2 },
            { _id: 'FAILED', count: 1 },
          ],
          totalAgg: [{ total: 3 }],
          eventTypeAgg: [
            {
              _id: 'APPOINTMENT_CONFIRMATION',
              total: 3,
              successful: 2,
              failed: 1,
              responseTimeSum: 120,
              responseTimeCount: 2,
            },
          ],
          integrationAgg: [
            {
              _id: { toString: () => 'integration-1' },
              integrationName: null,
              total: 3,
              successful: 2,
              failed: 1,
              responseTimeSum: 120,
              responseTimeCount: 2,
            },
          ],
          responseAgg: [{ avgResponseTime: 60, responseTimeCount: 2 }],
          bucketAgg: [],
        },
      ]),
    });

    integrationConfigCollection.find.mockReturnValue({
      toArray: jest.fn().mockResolvedValue([
        { _id: { toString: () => 'integration-1' }, name: 'Resolved Integration Name' },
      ]),
    });
  });

  it('resolves integration names from integration_configs when analytics rows are missing names', async () => {
    const res = await request(app).get('/api/v1/analytics/overview?days=1');

    expect(res.status).toBe(200);
    expect(res.body.integrationPerformance).toHaveLength(1);
    expect(res.body.integrationPerformance[0]).toMatchObject({
      integrationConfigId: 'integration-1',
      integrationName: 'Resolved Integration Name',
      total: 3,
      successful: 2,
      failed: 1,
    });
    expect(res.body.eventTypes).toMatchObject({
      APPOINTMENT_CONFIRMATION: {
        total: 3,
        successful: 2,
        failed: 1,
        avgResponseTime: 60,
      },
    });
    expect(executionCollection.aggregate).toHaveBeenCalledTimes(1);
    expect(integrationConfigCollection.find).toHaveBeenCalled();
  });

  it('does not keep serving an empty overview once the first deliveries arrive', async () => {
    const emptyAgg = [{ statusAgg: [], totalAgg: [], eventTypeAgg: [], integrationAgg: [], responseAgg: [], bucketAgg: [] }];
    executionCollection.aggregate.mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue(emptyAgg) });

    const first = await request(app).get('/api/v1/analytics/overview?days=3');
    expect(first.body.summary.total).toBe(0);

    // A delivery happens; the next dashboard refresh must see it, not a cached zero.
    const second = await request(app).get('/api/v1/analytics/overview?days=3');
    expect(second.body.summary.total).toBe(3);
  });

  it('keeps the raw path available for a wide range before rollup coverage exists', async () => {
    const res = await request(app).get('/api/v1/analytics/overview?days=90');

    expect(res.status).toBe(200);
    expect(executionCollection.aggregate).toHaveBeenCalledTimes(1);
    expect(rollupMetaCollection.findOne).toHaveBeenCalled();
  });

  it('filters analytics by the provider tag on integration configurations', async () => {
    const providerIntegrationId = { toString: () => 'provider-integration-1', _bsontype: 'ObjectId' };
    integrationConfigCollection.find
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([{ _id: providerIntegrationId }]) })
      .mockReturnValueOnce({ toArray: jest.fn().mockResolvedValue([]) });

    const res = await request(app).get('/api/v1/analytics/overview?days=1&provider=ClevrTap');

    expect(res.status).toBe(200);
    const matchStage = executionCollection.aggregate.mock.calls[0][0][0].$match;
    expect(matchStage.$and).toEqual(
      expect.arrayContaining([
        {
          integrationConfigId: {
            $in: expect.arrayContaining([providerIntegrationId, 'provider-integration-1']),
          },
        },
      ])
    );
    expect(integrationConfigCollection.find.mock.calls[0][0]).toMatchObject({
      orgId: 1,
      provider: { $options: 'i' },
    });
  });
});
