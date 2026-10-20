'use strict';

const mockExecutionLogsCollection = {
  insertOne: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
};

const mockDb = {
  collection: jest.fn(() => mockExecutionLogsCollection),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  toObjectId: jest.fn((value) => (value ? `oid:${value}` : null)),
  ObjectId: class MockObjectId {},
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/utils/runtime', () => ({
  uuidv4: jest.fn(() => '12345678-1234-1234-1234-1234567890ab'),
}));

const executionLogsData = require('../../src/data/execution-logs');

describe('execution-logs data layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockReturnValue(mockExecutionLogsCollection);
    mockExecutionLogsCollection.insertOne.mockResolvedValue({ insertedId: 'db-log-1' });
    mockExecutionLogsCollection.findOne.mockResolvedValue({ startedAt: new Date(0) });
    mockExecutionLogsCollection.updateOne.mockResolvedValue({ matchedCount: 1 });
  });

  it('returns both traceId and executionLogId when creating a log', async () => {
    const result = await executionLogsData.createExecutionLog({
      traceId: 'trc-explicit-1',
      orgId: 812,
      direction: 'OUTBOUND',
      triggerType: 'EVENT',
      status: 'PENDING',
    });

    expect(result).toEqual({
      traceId: 'trc-explicit-1',
      executionLogId: 'db-log-1',
    });
  });

  it('updates and appends steps by execution log id when provided', async () => {
    const ref = {
      executionLogId: 'db-log-1',
      traceId: 'trc-explicit-1',
      orgId: 812,
    };
    const finishedAt = new Date(5000);

    await executionLogsData.updateExecutionLog(ref, {
      status: 'success',
      finishedAt,
    });
    await executionLogsData.addExecutionStep(ref, {
      name: 'delivery',
      status: 'success',
    });

    expect(mockExecutionLogsCollection.findOne).toHaveBeenCalledWith({ _id: 'oid:db-log-1' });
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenNthCalledWith(
      1,
      { _id: 'oid:db-log-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'SUCCESS',
          durationMs: 5000,
        }),
      })
    );
    expect(mockExecutionLogsCollection.updateOne).toHaveBeenNthCalledWith(
      2,
      { _id: 'oid:db-log-1' },
      expect.objectContaining({
        $push: expect.objectContaining({
          steps: expect.objectContaining({
            name: 'delivery',
          }),
        }),
      })
    );
  });

  describe('getExecutionTrace across a fallback org', () => {
    const cfgId = 'cfg-1';
    const ownerDoc = {
      _id: 'own-1',
      orgId: 33,
      traceId: 'trc-1',
      direction: 'INBOUND',
      status: 'SUCCESS',
      integrationConfigId: cfgId,
      createdAt: new Date('2026-10-06T05:42:33.580Z'),
      steps: [],
    };
    const callerDoc = {
      _id: 'caller-1',
      orgId: 1053,
      request: { headers: { authorization: 'Bearer caller-secret' }, body: { patient: 'x' } },
      traceId: 'trc-1',
      direction: 'INBOUND',
      status: 'SUCCESS',
      integrationConfigId: cfgId,
      createdAt: new Date('2026-10-06T05:42:30.296Z'),
      steps: [
        { name: 'request_policy', timestamp: new Date('2026-10-06T05:42:30.299Z'), status: 'success' },
        { name: 'http_request', timestamp: new Date('2026-10-06T05:42:33.574Z'), status: 'success' },
      ],
    };

    const queryResult = (docs) => ({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(docs),
    });

    it("includes the caller org's steps when the integration belongs to the requesting org", async () => {
      mockExecutionLogsCollection.find.mockImplementation((query) =>
        queryResult(
          query.orgId === 33
            ? [ownerDoc]
            : query.orgId && query.orgId.$ne === 33 && query.integrationConfigId.$in.includes(cfgId)
              ? [callerDoc]
              : []
        )
      );

      const trace = await executionLogsData.getExecutionTrace('trc-1', 33);

      const names = trace.timeline.map((step) => step.name);
      expect(names).toEqual(expect.arrayContaining(['request_policy', 'http_request']));
      expect(JSON.stringify(trace)).not.toContain('caller-secret');
    });

    it('does not reach into other orgs when the requesting org has no record', async () => {
      mockExecutionLogsCollection.find.mockImplementation(() => queryResult([]));

      expect(await executionLogsData.getExecutionTrace('trc-1', 33)).toBeNull();
      expect(mockExecutionLogsCollection.find).toHaveBeenCalledTimes(1);
    });
  });
});
