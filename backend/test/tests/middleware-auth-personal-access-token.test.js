'use strict';

/**
 * auth middleware — personal access token (DB-backed API key) lookup.
 * Covers the code path added alongside routes/api-keys.js: the legacy
 * static system key still works unchanged, and any other x-api-key value
 * is now looked up as a hashed record in the api_keys collection.
 */

const crypto = require('crypto');

let storedKeys = [];

const mockCollection = {
  findOne: jest.fn(async (query) => storedKeys.find((k) => k.keyHash === query.keyHash && !k.revokedAt) || null),
  updateOne: jest.fn(async () => ({ modifiedCount: 1 })),
};

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn(() => ({ collection: () => mockCollection })),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  security: { apiKey: 'system-shared-key', jwtSecret: 'test-secret' },
}));

const auth = require('../../src/middleware/auth');

function hashOf(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function makeReq({ apiKey, query = {} } = {}) {
  return {
    query,
    body: {},
    header: (name) => (name.toLowerCase() === 'x-api-key' ? apiKey : undefined),
    ip: '127.0.0.1',
    connection: {},
  };
}

describe('auth middleware — personal access tokens', () => {
  beforeEach(() => {
    storedKeys = [];
    jest.clearAllMocks();
  });

  it('still authenticates with the legacy shared system key, without touching the DB', async () => {
    const req = makeReq({ apiKey: 'system-shared-key' });
    const next = jest.fn();

    await auth(req, {}, next);

    expect(req.user).toEqual({ id: 'api-key', role: 'API_KEY' });
    expect(next).toHaveBeenCalledWith();
    expect(mockCollection.findOne).not.toHaveBeenCalled();
  });

  it('authenticates a valid personal access token as the user who created it', async () => {
    const raw = 'mdcs_pat_abc123';
    storedKeys.push({
      _id: { toString: () => 'key-1' },
      keyHash: hashOf(raw),
      role: 'ORG_ADMIN',
      orgId: 892,
      createdBy: 'user-42',
      createdByEmail: 'someone@org.com',
      revokedAt: null,
    });

    const req = makeReq({ apiKey: raw });
    const next = jest.fn();

    await auth(req, {}, next);

    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: 'user-42', role: 'ORG_ADMIN', apiKeyId: 'key-1' });
    expect(req.orgId).toBe(892);
    expect(mockCollection.updateOne).toHaveBeenCalledTimes(1);
  });

  it('rejects a revoked personal access token', async () => {
    const raw = 'mdcs_pat_revoked';
    storedKeys.push({
      _id: { toString: () => 'key-2' },
      keyHash: hashOf(raw),
      role: 'ORG_ADMIN',
      orgId: 892,
      createdBy: 'user-42',
      revokedAt: new Date(),
    });

    const req = makeReq({ apiKey: raw });
    const next = jest.fn();

    await auth(req, {}, next);

    expect(next).toHaveBeenCalledTimes(1);
    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
  });

  it('rejects a completely unknown key', async () => {
    const req = makeReq({ apiKey: 'not-a-real-key' });
    const next = jest.fn();

    await auth(req, {}, next);

    const err = next.mock.calls[0][0];
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Invalid API key');
  });

  it('does not fail the request if the lastUsedAt write fails', async () => {
    const raw = 'mdcs_pat_stillworks';
    storedKeys.push({
      _id: { toString: () => 'key-3' },
      keyHash: hashOf(raw),
      role: 'VIEWER',
      orgId: 33,
      createdBy: 'user-9',
      revokedAt: null,
    });
    mockCollection.updateOne.mockRejectedValueOnce(new Error('write conflict'));

    const req = makeReq({ apiKey: raw });
    const next = jest.fn();

    await auth(req, {}, next);
    // Let the fire-and-forget updateOne rejection settle before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    expect(next).toHaveBeenCalledWith();
    expect(req.user.id).toBe('user-9');
  });

  it('a SUPER_ADMIN token can override orgId via the query param', async () => {
    const raw = 'mdcs_pat_superadmin';
    storedKeys.push({
      _id: { toString: () => 'key-4' },
      keyHash: hashOf(raw),
      role: 'SUPER_ADMIN',
      orgId: null,
      createdBy: 'user-1',
      revokedAt: null,
    });

    const req = makeReq({ apiKey: raw, query: { orgId: '892' } });
    const next = jest.fn();

    await auth(req, {}, next);

    expect(req.orgId).toBe(892);
  });

  it.each(['API_KEY', 'ORG_ADMIN'])('an org-bound %s key cannot name another org', async (role) => {
    storedKeys.push({ _id: { toString: () => 'k1' }, keyHash: hashOf('mdcs_pat_bound'), role, orgId: 84, createdBy: 'u1' });
    const req = makeReq({ apiKey: 'mdcs_pat_bound', query: { orgId: '33' } });
    const next = jest.fn();
    await auth(req, {}, next);
    const err = next.mock.calls[0][0];
    expect(err && (err.statusCode || err.status)).toBe(403);
  });

  it('an org-bound key works for its own org', async () => {
    storedKeys.push({ _id: { toString: () => 'k2' }, keyHash: hashOf('mdcs_pat_own'), role: 'API_KEY', orgId: 84, createdBy: 'u1' });
    const req = makeReq({ apiKey: 'mdcs_pat_own', query: { orgId: '84' } });
    const next = jest.fn();
    await auth(req, {}, next);
    expect(next).toHaveBeenCalledWith();
    expect(req.orgId).toBe(84);
  });
});

