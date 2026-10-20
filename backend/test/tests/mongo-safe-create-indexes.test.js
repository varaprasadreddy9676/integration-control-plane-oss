'use strict';

/**
 * createIndexes() is all-or-nothing for the specs it is sent. One conflicting
 * spec (a same-key index under an older name, or a unique index the data
 * violates) used to drop every other index in that collection's batch —
 * production ran without most of execution_logs', event_audit's and
 * failed_deliveries' indexes that way. A failed batch now falls back to one
 * index at a time.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { log } = require('../../src/logger');
const { safeCreateIndexes } = require('../../src/mongodb');

const mongoError = (code, message) => Object.assign(new Error(message), { code });

const fakeCollection = (rejectName) => {
  const created = [];
  return {
    collectionName: 'execution_logs',
    created,
    async indexes() {
      return [{ name: 'conflicting-old', key: { status: 1 } }];
    },
    async createIndexes(specs) {
      const bad = specs.find((spec) => rejectName[spec.name]);
      if (bad) throw rejectName[bad.name];
      created.push(...specs.map((spec) => spec.name));
      return specs.map((spec) => spec.name);
    },
  };
};

const specs = [
  { key: { orgId: 1 }, name: 'a' },
  { key: { status: 1 }, name: 'conflicting' },
  { key: { createdAt: 1 }, name: 'c' },
];

describe('safeCreateIndexes', () => {
  beforeEach(() => log.mockClear());

  it('creates the rest of the batch when one index conflicts', async () => {
    const collection = fakeCollection({ conflicting: mongoError(86, 'Index must have unique name') });
    await safeCreateIndexes(collection, specs);
    expect(collection.created).toEqual(['a', 'c']);
    expect(log).toHaveBeenCalledWith(
      'warn',
      'MongoDB index creation warning',
      expect.objectContaining({ collection: 'execution_logs', index: 'conflicting' })
    );
  });

  it('treats a same-key index under another name as already present', async () => {
    const collection = fakeCollection({ conflicting: mongoError(85, 'already exists with a different name') });
    await safeCreateIndexes(collection, specs);
    expect(collection.created).toEqual(['a', 'c']);
    expect(log).not.toHaveBeenCalledWith('warn', expect.anything(), expect.anything());
  });

  it('sends one batch when nothing conflicts', async () => {
    const collection = fakeCollection({});
    const spy = jest.spyOn(collection, 'createIndexes');
    await safeCreateIndexes(collection, specs);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(collection.created).toEqual(['a', 'conflicting', 'c']);
  });

  describe('an older index with the same name but a different definition', () => {
    const staleCollection = ({ existing, rejectCode }) => {
      const state = { existing: [...existing], dropped: [], created: [] };
      return {
        collectionName: 'execution_logs',
        state,
        async indexes() {
          return state.existing;
        },
        async dropIndex(name) {
          state.dropped.push(name);
          state.existing = state.existing.filter((index) => index.name !== name);
        },
        async createIndexes(specsToCreate) {
          for (const spec of specsToCreate) {
            if (state.existing.some((index) => index.name === spec.name)) {
              throw mongoError(rejectCode, 'Index must have unique name');
            }
          }
          state.created.push(...specsToCreate.map((spec) => spec.name));
          state.existing.push(...specsToCreate);
          return specsToCreate.map((spec) => spec.name);
        },
      };
    };

    it('is replaced with the definition the code asks for', async () => {
      const collection = staleCollection({
        existing: [{ name: 'retry_query_idx', key: { status: 1, lastAttemptAt: -1 } }],
        rejectCode: 86,
      });
      await safeCreateIndexes(collection, [{ key: { status: 1, updatedAt: -1 }, name: 'retry_query_idx' }]);
      expect(collection.state.dropped).toEqual(['retry_query_idx']);
      expect(collection.state.created).toEqual(['retry_query_idx']);
      expect(collection.state.existing.find((index) => index.name === 'retry_query_idx').key).toEqual({
        status: 1,
        updatedAt: -1,
      });
    });

    it('is replaced for text indexes whose options differ (code 85, same name)', async () => {
      const collection = staleCollection({
        existing: [{ name: 'search_text_idx', key: { _fts: 'text', _ftsx: 1 } }],
        rejectCode: 85,
      });
      await safeCreateIndexes(collection, [{ key: { integrationName: 'text' }, name: 'search_text_idx' }]);
      expect(collection.state.dropped).toEqual(['search_text_idx']);
    });

    it('is never auto-replaced for unique indexes', async () => {
      const collection = staleCollection({
        existing: [{ name: 'email_unique_idx', key: { mail: 1 }, unique: true }],
        rejectCode: 86,
      });
      await safeCreateIndexes(collection, [{ key: { email: 1 }, name: 'email_unique_idx', unique: true }]);
      expect(collection.state.dropped).toEqual([]);
      expect(log).toHaveBeenCalledWith(
        'warn',
        'MongoDB index creation warning',
        expect.objectContaining({ index: 'email_unique_idx' })
      );
    });
  });
});

