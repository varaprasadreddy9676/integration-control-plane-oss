'use strict';

const mockExecutionLogsCollection = {
  find: jest.fn(),
  updateOne: jest.fn(),
  insertOne: jest.fn(),
};

const mockIntegrationConfigsCollection = {
  findOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'execution_logs') return mockExecutionLogsCollection;
    if (name === 'integration_configs') return mockIntegrationConfigsCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
};

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/mongodb', () => ({
  ObjectId: class ObjectId {},
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => {
    if (typeof value === 'string' && value.startsWith('integration-')) return value;
    return null;
  }),
}));

jest.mock('../../src/data/helpers', () => ({
  useMongo: jest.fn(() => true),
  normalizeOrgId: jest.fn((orgId) => Number(orgId)),
  buildOrgScopeQuery: jest.fn(() => ({})),
  addOrgScope: jest.fn((query) => query),
  fallbackDisabledError: jest.fn(),
  mapLogFromMongo: jest.fn((value) => value),
  mapIntegrationFromMongo: jest.fn((value) => value),
}));

const { recordLog } = require('../../src/data/logs');

describe('recordLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExecutionLogsCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([{ _id: 'latest-doc-id' }]),
    });
    mockExecutionLogsCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
    mockExecutionLogsCollection.insertOne.mockResolvedValue({ insertedId: 'new-doc-id' });
    mockIntegrationConfigsCollection.findOne.mockResolvedValue(null);
  });

  it('resolves duplicate trace ids to a concrete latest execution log before updating', async () => {
    await recordLog(812, {
      id: 'trace-duplicate-1',
      traceId: 'trace-duplicate-1',
      status: 'FAILED',
      responseStatus: 500,
      responseBody: 'server error',
      requestPayload: { ok: false },
    });

    expect(mockExecutionLogsCollection.find).toHaveBeenCalledWith({
      traceId: 'trace-duplicate-1',
      orgId: 812,
    });
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'latest-doc-id', orgId: 812 },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'FAILED',
          traceId: 'trace-duplicate-1',
        }),
      })
    );
    expect(mockExecutionLogsCollection.insertOne).not.toHaveBeenCalled();
  });

  it('scopes correlation-id updates by integration config id so sibling integrations do not collide', async () => {
    mockExecutionLogsCollection.find
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      })
      .mockReturnValueOnce({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
      });
    mockExecutionLogsCollection.updateOne
      .mockResolvedValueOnce({ matchedCount: 0 })
      .mockResolvedValueOnce({ matchedCount: 0 });

    await recordLog(812, {
      correlationId: 'corr-shared-1',
      __KEEP___KEEP_integrationConfig__Id__: 'integration-1',
      __KEEP_integrationName__: 'Reminder 1',
      eventType: 'APPOINTMENT_CONFIRMATION',
      status: 'SKIPPED',
      responseStatus: 204,
      errorMessage: 'Skipped scheduling: reason mismatch',
    });

    await recordLog(812, {
      correlationId: 'corr-shared-1',
      __KEEP___KEEP_integrationConfig__Id__: 'integration-2',
      __KEEP_integrationName__: 'Reminder 2',
      eventType: 'APPOINTMENT_CONFIRMATION',
      status: 'SKIPPED',
      responseStatus: 204,
      errorMessage: 'Skipped scheduling: reason mismatch',
    });

    expect(mockExecutionLogsCollection.find).toHaveBeenNthCalledWith(1, {
      orgId: 812,
      $or: [{ traceId: 'corr-shared-1' }, { correlationId: 'corr-shared-1' }],
      $and: [
        {
          $or: [
            { integrationConfigId: 'integration-1' },
            { __KEEP___KEEP_integrationConfig__Id__: 'integration-1' },
          ],
        },
      ],
    });
    expect(mockExecutionLogsCollection.find).toHaveBeenNthCalledWith(2, {
      orgId: 812,
      $or: [{ traceId: 'corr-shared-1' }, { correlationId: 'corr-shared-1' }],
      $and: [
        {
          $or: [
            { integrationConfigId: 'integration-2' },
            { __KEEP___KEEP_integrationConfig__Id__: 'integration-2' },
          ],
        },
      ],
    });
    expect(mockExecutionLogsCollection.insertOne).toHaveBeenCalledTimes(2);
  });

  it('keeps the stored caller headers and execution trace when a later write does not carry them', async () => {
    await recordLog(812, {
      id: 'trace-keep-1',
      traceId: 'trace-keep-1',
      status: 'SUCCESS',
      responseStatus: 200,
      requestPayload: { ok: true },
    });

    const set = mockExecutionLogsCollection.updateOne.mock.calls[0][1].$set;
    expect(set).not.toHaveProperty('inboundRequestHeaders');
    expect(set).not.toHaveProperty('executionTrace');
  });

  it('writes the caller headers and execution trace when the call has them', async () => {
    const inboundRequestHeaders = { partnerid: 'IN1', partnername: 'Hospital' };
    const executionTrace = [{ name: 'http_request', kind: 'HTTP', status: 'ok' }];
    await recordLog(812, {
      id: 'trace-set-1',
      traceId: 'trace-set-1',
      status: 'SUCCESS',
      responseStatus: 200,
      requestPayload: { ok: true },
      inboundRequestHeaders,
      executionTrace,
    });

    const set = mockExecutionLogsCollection.updateOne.mock.calls[0][1].$set;
    expect(set.inboundRequestHeaders).toEqual(inboundRequestHeaders);
    expect(set.executionTrace).toEqual(executionTrace);
  });

  it('stores the resolved client IP as its own field, and keeps it on later writes without one', async () => {
    await recordLog(812, { id: 'trace-ip-1', traceId: 'trace-ip-1', status: 'FAILED', clientIp: '203.0.113.61' });
    expect(mockExecutionLogsCollection.updateOne.mock.calls[0][1].$set.clientIp).toBe('203.0.113.61');

    await recordLog(812, { id: 'trace-ip-1', traceId: 'trace-ip-1', status: 'SUCCESS' });
    expect(mockExecutionLogsCollection.updateOne.mock.calls[1][1].$set).not.toHaveProperty('clientIp');
  });

  it('also stores caller headers, client IP and trace when it has to create the log document', async () => {
    mockExecutionLogsCollection.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue([]),
    });
    const inboundRequestHeaders = { 'x-forwarded-for': '203.0.113.61, 10.0.1.5', 'user-agent': 'curl/8.7.1' };
    const executionTrace = [{ name: 'http_request', kind: 'HTTP', status: 'ok' }];

    await recordLog(812, {
      status: 'SUCCESS',
      responseStatus: 200,
      requestPayload: { ok: true },
      inboundRequestHeaders,
      clientIp: '203.0.113.61',
      executionTrace,
    });

    expect(mockExecutionLogsCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ inboundRequestHeaders, clientIp: '203.0.113.61', executionTrace })
    );
  });
});
