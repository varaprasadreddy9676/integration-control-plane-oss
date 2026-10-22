'use strict';

describe('probeLogsThreshold', () => {
  let probeLogsThreshold;
  let mockCollection;
  let mockDb;

  beforeEach(() => {
    jest.resetModules();

    mockCollection = {
      find: jest.fn(),
    };

    mockDb = {
      collection: jest.fn(() => mockCollection),
    };

    jest.doMock('../../src/logger', () => ({
      log: jest.fn(),
      logError: jest.fn(),
    }));

    jest.doMock('../../src/mongodb', () => {
      class FakeObjectId {
        constructor(value) {
          this.value = value;
        }

        toString() {
          return this.value;
        }
      }

      return {
        getDbSafe: jest.fn().mockResolvedValue(mockDb),
        toObjectId: jest.fn((value) => {
          if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) {
            return new FakeObjectId(value.toLowerCase());
          }
          return null;
        }),
        ObjectId: FakeObjectId,
      };
    });

    jest.doMock('../../src/data/helpers', () => ({
      useMongo: jest.fn(() => true),
      normalizeOrgId: jest.fn((orgId) => Number(orgId)),
      buildOrgScopeQuery: jest.fn((orgId) => ({ orgId })),
      addOrgScope: jest.fn((query, orgId) => ({ ...query, orgId: Number(orgId) })),
      fallbackDisabledError: jest.fn(),
      mapLogFromMongo: jest.fn((value) => value),
      mapIntegrationFromMongo: jest.fn((value) => value),
    }));

    ({ probeLogsThreshold } = require('../../src/data/logs'));
  });

  it('returns the exact count when matches stay within the threshold', async () => {
    const toArray = jest.fn().mockResolvedValue([{ _id: '1' }, { _id: '2' }]);
    const limit = jest.fn().mockReturnValue({ toArray });
    mockCollection.find.mockReturnValue({ limit });

    const result = await probeLogsThreshold(145, { status: 'SUCCESS' }, 5);

    expect(result).toEqual({
      exceedsThreshold: false,
      exactCount: 2,
    });
    expect(mockCollection.find).toHaveBeenCalledWith(
      { orgId: 145, status: 'SUCCESS' },
      { projection: { _id: 1 } }
    );
    expect(limit).toHaveBeenCalledWith(6);
  });

  it('stops at threshold plus one when the export is large', async () => {
    const toArray = jest.fn().mockResolvedValue(Array.from({ length: 6 }, (_, index) => ({ _id: String(index) })));
    const limit = jest.fn().mockReturnValue({ toArray });
    mockCollection.find.mockReturnValue({ limit });

    const result = await probeLogsThreshold(145, { status: 'FAILED' }, 5);

    expect(result).toEqual({
      exceedsThreshold: true,
      exactCount: null,
    });
    expect(limit).toHaveBeenCalledWith(6);
  });

  it('falls back to regex search when the text index is unavailable', async () => {
    const textIndexError = new Error('text index required for $text query');
    textIndexError.code = 27;

    const firstToArray = jest.fn().mockRejectedValue(textIndexError);
    const secondToArray = jest.fn().mockResolvedValue([{ _id: '1' }]);

    // Searches are time-capped, so the cursor takes maxTimeMS like a real one.
    const searchCursor = (toArray) => {
      const cursor = { toArray, maxTimeMS: jest.fn(() => cursor) };
      return { limit: jest.fn().mockReturnValue(cursor) };
    };
    mockCollection.find
      .mockReturnValueOnce(searchCursor(firstToArray))
      .mockReturnValueOnce(searchCursor(secondToArray));

    const result = await probeLogsThreshold(145, { search: 'Jane Doe' }, 5);

    expect(result).toEqual({
      exceedsThreshold: false,
      exactCount: 1,
    });
    expect(mockCollection.find).toHaveBeenCalledTimes(2);
    expect(mockCollection.find.mock.calls[0][0]).toEqual({
      orgId: 145,
      $text: { $search: 'Jane Doe' },
    });
    expect(mockCollection.find.mock.calls[1][0].$text).toBeUndefined();
    expect(mockCollection.find.mock.calls[1][0].$and).toEqual([
      {
        $or: expect.arrayContaining([
          { searchableText: { $regex: 'Jane Doe', $options: 'i' } },
        ]),
      },
    ]);
  });
});
