'use strict';

/**
 * Delivery log search: which strategy a search uses and how long it may run.
 *
 * A $text search reads every log of the org that contains the word before the
 * date filter applies, so a common word in a large org ran for minutes (even
 * for a day with no logs). A date-bounded substring search is instant when the
 * window holds little data. The search picks per query and is always time-capped.
 */

describe('delivery log search strategy', () => {
  let countLogs;
  let listLogs;
  let mockCollection;
  const DAY = 24 * 60 * 60 * 1000;
  const recentRange = () => ({
    startDate: new Date(Date.now() - DAY).toISOString(),
    endDate: new Date().toISOString(),
  });

  // A find cursor that records the options it is given.
  const cursorResolving = (docs, calls) => {
    const cursor = {
      hint: () => cursor,
      sort: () => cursor,
      skip: () => cursor,
      limit: () => cursor,
      maxTimeMS: (ms) => {
        calls.maxTimeMS = ms;
        return cursor;
      },
      toArray: async () => docs,
    };
    return cursor;
  };

  beforeEach(() => {
    jest.resetModules();
    mockCollection = { find: jest.fn(), countDocuments: jest.fn(), aggregate: jest.fn() };
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
    ({ countLogs, listLogs } = require('../../src/data/logs'));
  });

  const searchedQuery = () => mockCollection.find.mock.calls[0][0];

  it('searches by substring when the date window holds little data', async () => {
    mockCollection.countDocuments.mockResolvedValueOnce(120); // window size probe
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'success', ...recentRange() });

    expect(searchedQuery().$text).toBeUndefined();
    expect(JSON.stringify(searchedQuery().$and)).toContain('"$regex":"success"');
  });

  it('uses text search when the date window is large', async () => {
    mockCollection.countDocuments.mockResolvedValueOnce(50_001);
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'success', ...recentRange() });

    expect(searchedQuery().$text).toEqual({ $search: 'success' });
  });

  it('uses text search when there is no start date, without probing the window', async () => {
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'success' });

    expect(searchedQuery().$text).toEqual({ $search: 'success' });
    expect(mockCollection.countDocuments).not.toHaveBeenCalled();
  });

  it('probes the window by index with a cap, never counting it all', async () => {
    mockCollection.countDocuments.mockResolvedValueOnce(10);
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'success', ...recentRange() });

    const [probeQuery, options] = mockCollection.countDocuments.mock.calls[0];
    expect(probeQuery.orgId).toBe(145);
    expect(probeQuery.$text).toBeUndefined();
    expect(options.limit).toBeGreaterThan(0);
    expect(options.limit).toBeLessThanOrEqual(50_001);
    expect(options.maxTimeMS).toBeGreaterThan(0);
  });

  it('falls back to text search when the window probe itself is too slow', async () => {
    const slow = new Error('operation exceeded time limit');
    slow.code = 50;
    mockCollection.countDocuments.mockRejectedValueOnce(slow);
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'success', ...recentRange() });

    expect(searchedQuery().$text).toEqual({ $search: 'success' });
  });

  it('time-caps every search, and only searches', async () => {
    const calls = {};
    mockCollection.countDocuments.mockResolvedValueOnce(10);
    mockCollection.find.mockReturnValue(cursorResolving([], calls));
    await listLogs(145, { search: 'success', ...recentRange() });
    expect(calls.maxTimeMS).toBeGreaterThan(0);

    const plain = {};
    mockCollection.find.mockReturnValue(cursorResolving([], plain));
    await listLogs(145, { status: 'FAILED' });
    expect(plain.maxTimeMS).toBeUndefined();
  });

  it('turns a search that runs out of time into a clear 400', async () => {
    const timeout = new Error('Executor error during find command :: caused by :: operation exceeded time limit');
    timeout.code = 50;
    mockCollection.find.mockReturnValue({
      hint: function () { return this; },
      sort: function () { return this; },
      skip: function () { return this; },
      limit: function () { return this; },
      maxTimeMS: function () { return this; },
      toArray: async () => { throw timeout; },
    });

    await expect(listLogs(145, { search: 'success' })).rejects.toMatchObject({
      statusCode: 400,
      code: 'SEARCH_TOO_BROAD',
      message: expect.stringMatching(/narrow the date range/i),
    });
  });

  it('escapes the search word in substring search', async () => {
    mockCollection.countDocuments.mockResolvedValueOnce(10);
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, { search: 'order(1', ...recentRange() });

    expect(JSON.stringify(searchedQuery().$and)).toContain('"$regex":"order\\\\(1"');
  });

  it('caches the window probe so the page, its count and the stats share one', async () => {
    mockCollection.countDocuments.mockResolvedValue(10);
    const filters = { search: 'success', ...recentRange() };
    mockCollection.find.mockReturnValue(cursorResolving([], {}));

    await listLogs(145, filters);
    await countLogs(145, filters);

    const probes = mockCollection.countDocuments.mock.calls.filter(([q]) => q.$and === undefined && q.createdAt);
    expect(probes).toHaveLength(1);
  });
});
