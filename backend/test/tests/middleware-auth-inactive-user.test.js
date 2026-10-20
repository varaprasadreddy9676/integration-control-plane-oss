'use strict';

/**
 * Deactivating a user used to stop new sign-ins only: a session token issued
 * earlier kept working until it expired, and so did the user's personal API
 * keys. Every authenticated request now checks that the user still exists and
 * is active (cached briefly). Integration-only keys and portal sessions are
 * not tied to a person's account and are unaffected.
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const ACTIVE_ID = '6989f92c26cf8e9a63cfd0aa';
const INACTIVE_ID = '6989f92c26cf8e9a63cfd0bb';
const DELETED_ID = '6989f92c26cf8e9a63cfd0cc';

const mockUsers = {
  [ACTIVE_ID]: { isActive: true },
  [INACTIVE_ID]: { isActive: false },
};
const mockApiKeys = {};
const mockUserLookups = jest.fn();

jest.mock('../../src/mongodb', () => ({
  toObjectId: (id) => id,
  getDb: () => ({
    collection: (name) => ({
      findOne: async (query) => {
        if (name === 'users') {
          mockUserLookups(query._id);
          return mockUsers[query._id] || null;
        }
        if (name === 'api_keys') return mockApiKeys[query.keyHash] || null;
        return null;
      },
      updateOne: async () => ({}),
    }),
  }),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/config', () => ({ security: { jwtSecret: 'test-secret', apiKey: 'shared' } }));

const auth = require('../../src/middleware/auth');

const bearer = (payload) => `Bearer ${jwt.sign(payload, 'test-secret')}`;

async function run(headers) {
  const req = {
    query: {},
    body: {},
    header: (name) => headers[name.toLowerCase()],
    ip: '127.0.0.1',
    connection: {},
  };
  const next = jest.fn();
  await auth(req, {}, next);
  return next.mock.calls[0][0];
}

const addKey = (raw, record) => {
  mockApiKeys[crypto.createHash('sha256').update(raw).digest('hex')] = { _id: { toString: () => raw }, ...record };
};

describe('inactive users', () => {
  beforeEach(() => {
    auth.clearUserStatusCache();
    mockUserLookups.mockClear();
  });

  it('accepts a session for an active user', async () => {
    const err = await run({ authorization: bearer({ sub: ACTIVE_ID, role: 'ORG_ADMIN', orgId: 1 }) });
    expect(err).toBeUndefined();
  });

  it('refuses a session for a deactivated user with 401', async () => {
    const err = await run({ authorization: bearer({ sub: INACTIVE_ID, role: 'ORG_ADMIN', orgId: 1 }) });
    expect(err.statusCode).toBe(401);
  });

  it('refuses a session for a user that no longer exists', async () => {
    const err = await run({ authorization: bearer({ sub: DELETED_ID, role: 'ORG_ADMIN', orgId: 1 }) });
    expect(err.statusCode).toBe(401);
  });

  it('does not look the same user up on every request', async () => {
    const token = bearer({ sub: ACTIVE_ID, role: 'ORG_ADMIN', orgId: 1 });
    await run({ authorization: token });
    await run({ authorization: token });
    expect(mockUserLookups).toHaveBeenCalledTimes(1);
  });

  it('leaves portal sessions alone (no user account behind them)', async () => {
    const err = await run({
      authorization: bearer({ sub: 'portal_abc', role: 'VIEWER', orgId: 1, isPortalSession: true }),
    });
    expect(err).toBeUndefined();
    expect(mockUserLookups).not.toHaveBeenCalled();
  });

  it("refuses a personal API key whose owner was deactivated", async () => {
    addKey('mdcs_pat_owner_gone', { createdBy: INACTIVE_ID, role: 'ORG_ADMIN', orgId: 1, revokedAt: null });
    const err = await run({ 'x-api-key': 'mdcs_pat_owner_gone' });
    expect(err.statusCode).toBe(401);
  });

  it('keeps integration-only keys working when the admin who issued them leaves', async () => {
    addKey('mdcs_pat_partner', { createdBy: INACTIVE_ID, role: 'API_KEY', orgId: 1, revokedAt: null });
    const err = await run({ 'x-api-key': 'mdcs_pat_partner' });
    expect(err).toBeUndefined();
  });
});
