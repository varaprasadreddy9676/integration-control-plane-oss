'use strict';

const { ObjectId } = require('mongodb');

// Minimal in-memory stand-in for the two collections the module uses.
function makeCollection(name) {
  const docs = [];
  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, cond]) => {
      const value = doc[key];
      if (cond && typeof cond === 'object' && !(cond instanceof ObjectId) && '$lte' in cond) return value <= cond.$lte;
      return String(value) === String(cond);
    });
  return {
    name,
    docs,
    async findOne(filter) {
      return docs.find((d) => matches(d, filter)) || null;
    },
    find(filter, options = {}) {
      let rows = docs.filter((d) => matches(d, filter));
      const cursor = {
        sort(spec) {
          const [[key, dir]] = Object.entries(spec);
          rows = [...rows].sort((a, b) => (a[key] - b[key]) * dir);
          return cursor;
        },
        limit(n) {
          rows = rows.slice(0, n);
          return cursor;
        },
        async toArray() {
          if (!options.projection) return rows.map((r) => ({ ...r }));
          return rows.map((r) => {
            const copy = { ...r };
            for (const [k, v] of Object.entries(options.projection)) if (v === 0) delete copy[k];
            return copy;
          });
        },
      };
      return cursor;
    },
    async insertOne(doc) {
      if (name === 'integration_revisions' && docs.some((d) => String(d.integrationId) === String(doc.integrationId) && d.revision === doc.revision)) {
        const err = new Error('E11000 duplicate key');
        err.code = 11000;
        throw err;
      }
      const stored = { _id: new ObjectId(), ...doc };
      docs.push(stored);
      return { insertedId: stored._id };
    },
    async updateOne(filter, update) {
      const doc = docs.find((d) => matches(d, filter));
      if (!doc) return { matchedCount: 0 };
      Object.assign(doc, update.$set || {});
      for (const key of Object.keys(update.$unset || {})) delete doc[key];
      return { matchedCount: 1 };
    },
    async deleteMany(filter) {
      for (let i = docs.length - 1; i >= 0; i -= 1) if (matches(docs[i], filter)) docs.splice(i, 1);
      return {};
    },
  };
}

const collections = {};
const mockDb = {
  collection: (name) => {
    collections[name] = collections[name] || makeCollection(name);
    return collections[name];
  },
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => mockDb),
  toObjectId: (id) => {
    const { ObjectId: MockObjectId } = require('mongodb');
    return id instanceof MockObjectId ? id : new MockObjectId(String(id));
  },
}));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const revisions = require('../../src/data/integration-revisions');
const { runWithRequest } = require('../../src/utils/request-context');

const integrationId = new ObjectId();
const configs = () => mockDb.collection('integration_configs');
const history = () => mockDb.collection('integration_revisions');

function save(fields) {
  const existing = configs().docs.find((d) => String(d._id) === String(integrationId));
  if (existing) Object.assign(existing, fields);
  else configs().docs.push({ _id: integrationId, orgId: 1, direction: 'OUTBOUND', isActive: true, ...fields });
}

beforeEach(() => {
  for (const key of Object.keys(collections)) delete collections[key];
});

describe('integration revisions', () => {
  it('records a revision per change with who made it and which fields changed', async () => {
    save({ name: 'Orders', targetUrl: 'https://a.example', createdAt: new Date() });
    await runWithRequest({ user: { id: 'u1', email: 'dana@example.com' } }, () =>
      revisions.recordRevision({ integrationId, source: 'CREATED' })
    );
    save({ targetUrl: 'https://b.example', updatedAt: new Date() });
    await revisions.recordRevision({ integrationId, source: 'UPDATED' });

    const list = await revisions.listRevisions(1, integrationId);
    expect(list.map((r) => [r.revision, r.source, r.changedFields])).toEqual([
      [2, 'UPDATED', ['targetUrl']],
      [1, 'CREATED', []],
    ]);
    expect(list[1].changedBy).toEqual({ id: 'u1', email: 'dana@example.com' });
    expect(list[0].snapshot).toBeUndefined();
  });

  it('skips saves that change nothing and ignores runtime fields', async () => {
    save({ name: 'Orders', targetUrl: 'https://a.example' });
    await revisions.recordRevision({ integrationId, source: 'CREATED' });
    save({ circuitState: 'OPEN', consecutiveFailures: 4, updatedAt: new Date() });
    await revisions.recordRevision({ integrationId, source: 'UPDATED' });

    expect(history().docs).toHaveLength(1);
  });

  it('keeps the state before the first tracked edit as a baseline', async () => {
    save({ name: 'Orders', targetUrl: 'https://old.example' });
    const previous = { ...configs().docs[0] };
    save({ targetUrl: 'https://new.example' });
    await revisions.recordRevision({ integrationId, source: 'UPDATED', previous });

    const list = await revisions.listRevisions(1, integrationId);
    expect(list.map((r) => [r.revision, r.source])).toEqual([
      [2, 'UPDATED'],
      [1, 'BASELINE'],
    ]);
    const baseline = await revisions.getRevision(1, integrationId, 1);
    expect(baseline.snapshot.targetUrl).toBe('https://old.example');
  });

  it('does not show one organization another organization’s history', async () => {
    save({ name: 'Orders', targetUrl: 'https://a.example' });
    await revisions.recordRevision({ integrationId, source: 'CREATED' });
    expect(await revisions.listRevisions(2, integrationId)).toEqual([]);
    expect(await revisions.getRevision(2, integrationId, 1)).toBeNull();
  });

  it('restores an earlier configuration without touching activation or runtime state', async () => {
    save({ name: 'Orders', targetUrl: 'https://a.example', retryCount: 3 });
    await revisions.recordRevision({ integrationId, source: 'CREATED' });
    save({ targetUrl: 'https://b.example', timeoutMs: 9000, isActive: false, circuitState: 'OPEN' });
    delete configs().docs[0].retryCount;
    await revisions.recordRevision({ integrationId, source: 'UPDATED' });

    const result = await revisions.restoreRevision(1, integrationId, 1);

    const current = configs().docs[0];
    expect(current.targetUrl).toBe('https://a.example');
    expect(current.retryCount).toBe(3);
    expect(current).not.toHaveProperty('timeoutMs');
    expect(current.isActive).toBe(false);
    expect(current.circuitState).toBe('OPEN');
    expect(current.orgId).toBe(1);
    expect(result.revision).toMatchObject({ revision: 3, source: 'RESTORED', restoredFrom: 1 });
  });

  it('diffs a revision against the current configuration with secrets masked', async () => {
    save({ name: 'Orders', outgoingAuthConfig: { headerName: 'X-Key', apiKey: 'old' } });
    await revisions.recordRevision({ integrationId, source: 'CREATED' });
    save({ outgoingAuthConfig: { headerName: 'X-Key', apiKey: 'new' } });

    const diff = await revisions.diffRevision(1, integrationId, 1, 'current');
    expect(diff.changes).toEqual([
      expect.objectContaining({ path: 'outgoingAuthConfig.apiKey', kind: 'changed', secret: true }),
    ]);
    expect(JSON.stringify(diff)).not.toMatch(/"(old|new)"/);
  });

  it('keeps at most the configured number of revisions', async () => {
    save({ name: 'Orders', targetUrl: 'https://0.example' });
    for (let i = 1; i <= 5; i += 1) {
      save({ targetUrl: `https://${i}.example` });
      await revisions.recordRevision({ integrationId, source: 'UPDATED', maxRevisions: 3 });
    }
    expect(history().docs.map((d) => d.revision).sort()).toEqual([3, 4, 5]);
  });
});
