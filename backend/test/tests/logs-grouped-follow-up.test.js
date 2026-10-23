'use strict';

/**
 * The delivery list is grouped by message, and that query names every field it
 * returns, so the follow-up outcome has to be named too or it never reaches the list.
 */

describe('grouped delivery list carries the follow-up outcome', () => {
  let getLogsPageGroupedByMessage;
  let mockCollection;

  beforeEach(() => {
    jest.resetModules();
    mockCollection = { aggregate: jest.fn() };
    jest.doMock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
    jest.doMock('../../src/mongodb', () => ({
      getDbSafe: jest.fn().mockResolvedValue({ collection: () => mockCollection }),
      toObjectId: jest.fn(() => null),
      ObjectId: class {},
    }));
    jest.doMock('../../src/data/helpers', () => ({
      useMongo: jest.fn(() => true),
      normalizeOrgId: jest.fn((orgId) => Number(orgId)),
      buildOrgScopeQuery: jest.fn((orgId) => ({ orgId })),
      addOrgScope: jest.fn((query, orgId) => ({ ...query, orgId: Number(orgId) })),
      fallbackDisabledError: jest.fn(),
      mapLogFromMongo: jest.fn((value) => value),
      mapIntegrationFromMongo: jest.fn((value) => value),
    }));
    jest.doMock('../../src/utils/index-hints', () => ({ applyCursorHint: (cursor) => cursor }));
    ({ getLogsPageGroupedByMessage } = require('../../src/data/logs'));
  });

  const followUp = { status: 'READ', done: true, checks: 3, readAt: new Date('2026-10-22T10:00:40Z') };

  it('asks for the latest attempt’s follow-up and returns it on the row', async () => {
    mockCollection.aggregate.mockReturnValue({
      toArray: async () => [{ data: [{ _id: 'm1', docId: 'log1', status: 'SUCCESS', totalAttempts: 1, followUp }], totalCount: [{ total: 1 }] }],
    });

    const page = await getLogsPageGroupedByMessage(145, {});

    const pipeline = mockCollection.aggregate.mock.calls[0][0];
    const group = pipeline.find((stage) => stage.$group).$group;
    expect(group.followUp).toEqual({ $first: '$followUp' });
    expect(page.data[0].followUp).toEqual(followUp);
  });

  it('is null for a delivery that is not followed up', async () => {
    mockCollection.aggregate.mockReturnValue({
      toArray: async () => [{ data: [{ _id: 'm2', docId: 'log2', status: 'SUCCESS', totalAttempts: 1 }], totalCount: [{ total: 1 }] }],
    });
    const page = await getLogsPageGroupedByMessage(145, {});
    expect(page.data[0].followUp).toBeNull();
  });
});
