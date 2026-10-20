'use strict';

const mockLocks = new Map();

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({
    collection: () => ({
      updateOne: async (query, update) => {
        const key = query._id;
        const existing = mockLocks.get(key) || { _id: key };
        if (update.$setOnInsert && !mockLocks.has(key)) {
          Object.assign(existing, update.$setOnInsert);
        }
        if (update.$set) Object.assign(existing, update.$set);
        if (update.$unset) {
          for (const field of Object.keys(update.$unset)) {
            delete existing[field];
          }
        }
        mockLocks.set(key, existing);
        return { acknowledged: true };
      },
      findOneAndUpdate: async (query, update) => {
        const existing = mockLocks.get(query._id) || { _id: query._id };
        const now = new Date();
        const canAcquire =
          !existing.ownerId ||
          existing.ownerId === query.ownerId ||
          !existing.lockedUntil ||
          existing.lockedUntil <= now ||
          (query.$or || []).some((condition) => {
            if (condition.ownerId) return existing.ownerId === condition.ownerId;
            if (condition.lockedUntil?.$lte) return existing.lockedUntil <= condition.lockedUntil.$lte;
            if (condition.lockedUntil?.$exists === false) return !existing.lockedUntil;
            return false;
          });

        if (!canAcquire) return { value: existing };
        if (update.$set) Object.assign(existing, update.$set);
        mockLocks.set(query._id, existing);
        return { value: existing };
      },
    }),
  })),
}));

const {
  acquireListenerLock,
  refreshListenerLock,
  releaseListenerLock,
} = require('../../src/services/hl7/listener-lock');

describe('HL7 listener lock', () => {
  beforeEach(() => {
    mockLocks.clear();
  });

  it('allows only one owner to acquire an active listener lock', async () => {
    const first = await acquireListenerLock('hl7:812:2575', 'owner-1', 30000);
    const second = await acquireListenerLock('hl7:812:2575', 'owner-2', 30000);

    expect(first.ownerId).toBe('owner-1');
    expect(second).toBeNull();
  });

  it('allows the owner to refresh and release the lock', async () => {
    await acquireListenerLock('hl7:812:2575', 'owner-1', 30000);

    await expect(refreshListenerLock('hl7:812:2575', 'owner-1', 30000)).resolves.toBe(true);
    await releaseListenerLock('hl7:812:2575', 'owner-1');
    const next = await acquireListenerLock('hl7:812:2575', 'owner-2', 30000);

    expect(next.ownerId).toBe('owner-2');
  });
});
