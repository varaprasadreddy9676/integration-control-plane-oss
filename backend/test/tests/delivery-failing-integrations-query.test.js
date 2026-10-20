'use strict';

/**
 * The query the delivery-failure watcher polls: active outbound integrations
 * currently failing, plus any previously-tracked one (so the watcher can see
 * it stopped failing — a tracked id simply absent means deactivated/deleted).
 */

const mockDocs = [];
const mockCollection = {
  find: jest.fn(() => ({ toArray: async () => mockDocs })),
};
const mockDb = { collection: jest.fn(() => mockCollection) };

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => `object:${id}`),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/utils/index-hints', () => ({ applyCursorHint: (cursor) => cursor }));

const { listFailingOrTrackedIntegrations } = require('../../src/data/delivery');

describe('listFailingOrTrackedIntegrations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDocs.length = 0;
  });

  it('queries active outbound integrations that are failing or tracked', async () => {
    mockDocs.push({
      _id: { toString: () => 'int-1' },
      name: 'NCX - Appointment Confirmation',
      orgId: 812,
      consecutiveFailures: 12,
      lastSuccessAt: null,
      lastCircuitError: 'Auth error: 401',
    });

    const result = await listFailingOrTrackedIntegrations(['int-2']);

    expect(mockCollection.find).toHaveBeenCalledWith(
      {
        direction: 'OUTBOUND',
        isActive: true,
        $or: [{ consecutiveFailures: { $gt: 0 } }, { _id: { $in: ['object:int-2'] } }],
      },
      expect.objectContaining({ projection: expect.any(Object) })
    );
    expect(result).toEqual([
      { id: 'int-1', orgId: 812, name: 'NCX - Appointment Confirmation', consecutiveFailures: 12, lastSuccessAt: null, lastCircuitError: 'Auth error: 401' },
    ]);
  });

  it('omits the tracked-id clause entirely when nothing is tracked yet', async () => {
    await listFailingOrTrackedIntegrations([]);
    const [filter] = mockCollection.find.mock.calls[0];
    expect(filter.$or).toEqual([{ consecutiveFailures: { $gt: 0 } }]);
  });

  it('does not throw when Mongo is unreachable', async () => {
    mockCollection.find.mockImplementationOnce(() => {
      throw new Error('connection lost');
    });
    await expect(listFailingOrTrackedIntegrations([])).resolves.toEqual([]);
  });

  it('returns nothing when Mongo is not connected (matches every other data/ function\'s fallback)', async () => {
    require('../../src/mongodb').isConnected.mockReturnValueOnce(false);
    await expect(listFailingOrTrackedIntegrations([])).resolves.toEqual([]);
    expect(mockCollection.find).not.toHaveBeenCalled();
  });
});
