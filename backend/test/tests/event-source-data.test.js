'use strict';

const mockCollection = {
  insertOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  updateMany: jest.fn(),
};
const mockDb = { collection: jest.fn(() => mockCollection) };

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => mockDb),
  toObjectId: jest.fn((id) => `object:${id}`),
}));

jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const eventSourceData = require('../../src/data/event-sources');

describe('HTTP push event queue data layer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollection.insertOne.mockResolvedValue({ insertedId: 'inserted-id' });
    mockCollection.findOneAndUpdate.mockResolvedValue(null);
    mockCollection.updateOne.mockResolvedValue({ modifiedCount: 1 });
    mockCollection.updateMany.mockResolvedValue({ modifiedCount: 0 });
  });

  test('new events are immediately available with zero attempts', async () => {
    await eventSourceData.enqueuePushEvent({
      orgId: 33,
      eventId: 'push-1',
      eventType: 'ORDER_CREATED',
      payload: { orderId: 42 },
    });

    expect(mockCollection.insertOne).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', attempts: 0, availableAt: expect.any(Date) })
    );
  });

  test('claiming respects organization and delayed availability and increments attempts', async () => {
    mockCollection.findOneAndUpdate
      .mockResolvedValueOnce({ value: { _id: 'event-1', attempts: 1 } })
      .mockResolvedValueOnce({ value: null });

    const claimed = await eventSourceData.claimPendingEvents(33, 5);

    expect(claimed).toHaveLength(1);
    expect(mockCollection.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 33,
        status: 'pending',
        $or: expect.arrayContaining([expect.objectContaining({ availableAt: expect.any(Object) })]),
      }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'processing', claimedAt: expect.any(Date) }),
        $inc: { attempts: 1 },
      }),
      expect.objectContaining({ sort: { createdAt: 1 }, returnDocument: 'after' })
    );
  });

  test('upsert returns the saved config rather than the MongoDB result wrapper', async () => {
    const saved = { orgId: 33, type: 'http_push', config: {}, isActive: true };
    mockCollection.findOneAndUpdate.mockResolvedValueOnce({ value: saved, ok: 1 });

    await expect(eventSourceData.upsertConfig(33, { type: 'http_push', config: {} })).resolves.toEqual(saved);
  });

  test('requeue records a future availability time and clears the claim', async () => {
    const before = Date.now();
    await eventSourceData.requeuePendingEvent('event-1', 12_000, 'temporary failure');

    expect(mockCollection.updateOne).toHaveBeenCalledWith(
      { _id: 'object:event-1' },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'pending',
          availableAt: expect.any(Date),
          lastError: 'temporary failure',
        }),
        $unset: { claimedAt: '' },
      })
    );
    const update = mockCollection.updateOne.mock.calls[0][1];
    expect(update.$set.availableAt.getTime()).toBeGreaterThanOrEqual(before + 12_000);
  });

  test('stale recovery is scoped to one organization', async () => {
    await eventSourceData.resetStalePendingEvents(90_000, 33);

    expect(mockCollection.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 33, status: 'processing', claimedAt: expect.any(Object) }),
      expect.objectContaining({
        $set: expect.objectContaining({ status: 'pending', availableAt: expect.any(Date) }),
        $unset: { claimedAt: '' },
      })
    );
  });
});
