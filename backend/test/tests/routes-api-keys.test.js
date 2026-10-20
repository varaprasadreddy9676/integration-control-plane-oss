'use strict';

/**
 * API keys (personal access tokens) route tests
 * Tests CRUD for /api/v1/api-keys
 */

const express = require('express');
const request = require('supertest');

let storedKeys = [];

const mockCollection = {
  insertOne: jest.fn(async (doc) => {
    const _id = { toString: () => `key-${storedKeys.length + 1}` };
    storedKeys.push({ ...doc, _id });
    return { insertedId: _id };
  }),
  find: jest.fn(() => ({
    sort: () => ({
      toArray: async () => storedKeys,
    }),
  })),
  findOne: jest.fn(async (query) => {
    if (query.keyHash) return storedKeys.find((k) => k.keyHash === query.keyHash && !k.revokedAt) || null;
    if (query._id) return storedKeys.find((k) => k._id.toString() === query._id.toString()) || null;
    return null;
  }),
  updateOne: jest.fn(async (query, update) => {
    const found = storedKeys.find((k) => k._id.toString() === query._id.toString());
    if (found) Object.assign(found, update.$set);
    return { modifiedCount: found ? 1 : 0 };
  }),
  deleteOne: jest.fn(async (query) => {
    const before = storedKeys.length;
    storedKeys = storedKeys.filter((k) => k._id.toString() !== query._id.toString());
    return { deletedCount: before - storedKeys.length };
  }),
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(() => ({ collection: () => mockCollection })),
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
}));

jest.mock('../../src/middleware/auth', () => (req, _res, next) => {
  req.user = { id: 'user-1', email: 'admin@example.com', role: 'ORG_ADMIN', orgId: 892 };
  req.orgId = 892;
  next();
});

jest.mock('../../src/middleware/permission', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));

const mockAuditApiKey = {
  created: jest.fn(async () => {}),
  deleted: jest.fn(async () => {}),
  purged: jest.fn(async () => {}),
};

jest.mock('../../src/middleware/audit', () => ({ auditApiKey: mockAuditApiKey }));

const apiKeysRouter = require('../../src/routes/api-keys');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/api-keys', apiKeysRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('POST /api/v1/api-keys', () => {
  beforeEach(() => {
    storedKeys = [];
    jest.clearAllMocks();
  });

  it('creates a key and returns the raw value exactly once', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/api-keys').send({ name: 'CI pipeline' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('CI pipeline');
    expect(res.body.key).toMatch(/^mdcs_pat_[a-f0-9]{48}$/);
    expect(res.body.prefix).toBe(res.body.key.slice(0, 'mdcs_pat_'.length + 8));
    expect(res.body.role).toBe('ORG_ADMIN');
    expect(res.body.orgId).toBe(892);
    expect(mockAuditApiKey.created).toHaveBeenCalledTimes(1);
  });

  it('never stores the raw key — only its hash', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/api-keys').send({ name: 'CI pipeline' });

    expect(storedKeys).toHaveLength(1);
    expect(storedKeys[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(storedKeys[0]).not.toHaveProperty('key');
    expect(storedKeys[0]).not.toHaveProperty('rawKey');
  });

  it('creates an integration-only key: API_KEY role, bound to the org', async () => {
    // For systems that only call integrations (partner apps, an EMR): they get
    // a key for their own org with run-integration rights and nothing more,
    // instead of the shared system key.
    const res = await request(buildApp()).post('/api/v1/api-keys').send({ name: 'Partner app', scope: 'integrations' });

    expect(res.status).toBe(201);
    expect(res.body.role).toBe('API_KEY');
    expect(res.body.orgId).toBe(892);
    expect(storedKeys[0].role).toBe('API_KEY');
    expect(storedKeys[0].orgId).toBe(892);
  });

  it('rejects an unknown scope', async () => {
    const res = await request(buildApp()).post('/api/v1/api-keys').send({ name: 'x', scope: 'everything' });
    expect(res.status).toBe(400);
  });

  it('rejects a missing name', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/v1/api-keys').send({});

    expect(res.status).toBe(400);
  });

  it('rejects a name over 100 characters', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/v1/api-keys')
      .send({ name: 'x'.repeat(101) });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/api-keys', () => {
  beforeEach(() => {
    storedKeys = [];
    jest.clearAllMocks();
  });

  it('lists keys without ever exposing the hash or raw key', async () => {
    const app = buildApp();
    await request(app).post('/api/v1/api-keys').send({ name: 'CI pipeline' });

    const res = await request(app).get('/api/v1/api-keys');

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].name).toBe('CI pipeline');
    expect(res.body.data[0]).not.toHaveProperty('key');
    expect(res.body.data[0]).not.toHaveProperty('keyHash');
    expect(res.body.data[0].prefix).toMatch(/^mdcs_pat_/);
  });
});

describe('DELETE /api/v1/api-keys/:id', () => {
  beforeEach(() => {
    storedKeys = [];
    jest.clearAllMocks();
  });

  it('revokes a key (soft delete) and it stops matching lookups', async () => {
    const app = buildApp();
    const createRes = await request(app).post('/api/v1/api-keys').send({ name: 'Temp key' });
    const id = createRes.body.id;

    const deleteRes = await request(app).delete(`/api/v1/api-keys/${id}`);
    expect(deleteRes.status).toBe(200);
    expect(mockAuditApiKey.deleted).toHaveBeenCalledTimes(1);

    const listRes = await request(app).get('/api/v1/api-keys');
    expect(listRes.body.data[0].revokedAt).not.toBeNull();
  });

  it('returns 404 for an unknown key id', async () => {
    const app = buildApp();
    const res = await request(app).delete('/api/v1/api-keys/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('revoking an already-revoked key is a no-op, not an error', async () => {
    const app = buildApp();
    const createRes = await request(app).post('/api/v1/api-keys').send({ name: 'Temp key' });
    const id = createRes.body.id;

    await request(app).delete(`/api/v1/api-keys/${id}`);
    const secondDelete = await request(app).delete(`/api/v1/api-keys/${id}`);

    expect(secondDelete.status).toBe(200);
    expect(secondDelete.body.message).toMatch(/already revoked/);
  });
});

describe('DELETE /api/v1/api-keys/:id/permanent', () => {
  beforeEach(() => {
    storedKeys = [];
    jest.clearAllMocks();
  });

  it('permanently removes a revoked key', async () => {
    const app = buildApp();
    const createRes = await request(app).post('/api/v1/api-keys').send({ name: 'Temp key' });
    const id = createRes.body.id;
    await request(app).delete(`/api/v1/api-keys/${id}`);

    const purgeRes = await request(app).delete(`/api/v1/api-keys/${id}/permanent`);

    expect(purgeRes.status).toBe(200);
    expect(mockAuditApiKey.purged).toHaveBeenCalledTimes(1);

    const listRes = await request(app).get('/api/v1/api-keys');
    expect(listRes.body.data).toHaveLength(0);
  });

  it('refuses to permanently delete a key that is still active', async () => {
    const app = buildApp();
    const createRes = await request(app).post('/api/v1/api-keys').send({ name: 'Active key' });
    const id = createRes.body.id;

    const purgeRes = await request(app).delete(`/api/v1/api-keys/${id}/permanent`);

    expect(purgeRes.status).toBe(400);
    expect(mockAuditApiKey.purged).not.toHaveBeenCalled();

    const listRes = await request(app).get('/api/v1/api-keys');
    expect(listRes.body.data).toHaveLength(1);
  });

  it('returns 404 for an unknown key id', async () => {
    const app = buildApp();
    const res = await request(app).delete('/api/v1/api-keys/does-not-exist/permanent');
    expect(res.status).toBe(404);
  });
});
