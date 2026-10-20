'use strict';

/**
 * Tenant isolation at the auth layer: a caller bound to one org can't reach
 * another org by naming it in ?orgId=. SUPER_ADMIN and ADMIN work across orgs
 * by design. Many routes read req.query.orgId directly, so the guard has to
 * live in the auth middleware rather than in each route.
 */
const jwt = require('jsonwebtoken');

jest.mock('../../src/mongodb', () => ({ getDb: jest.fn(() => ({ collection: () => ({ findOne: jest.fn(async () => null) }) })) }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/config', () => ({ security: { apiKey: null, jwtSecret: 'test-secret', apiKeyOrgIds: null } }));

const auth = require('../../src/middleware/auth');

const token = (claims) => jwt.sign({ sub: 'u1', email: 'u@example.com', ...claims }, 'test-secret');

async function call({ claims, query = {} }) {
  const req = {
    query,
    body: {},
    header: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token(claims)}` : undefined),
    ip: '127.0.0.1',
    connection: {},
  };
  const next = jest.fn();
  await auth(req, {}, next);
  return { req, err: next.mock.calls[0][0] };
}

describe('org-bound callers cannot name another org', () => {
  it('rejects ?orgId= for a different org', async () => {
    const { err } = await call({ claims: { role: 'ORG_ADMIN', orgId: 84 }, query: { orgId: '33' } });
    expect(err && (err.statusCode || err.status)).toBe(403);
  });

  it('rejects when any of several ?orgId= values is foreign', async () => {
    const { err } = await call({ claims: { role: 'ORG_USER', orgId: 84 }, query: { orgId: ['84', '33'] } });
    expect(err && (err.statusCode || err.status)).toBe(403);
  });

  it('allows their own org', async () => {
    const { req, err } = await call({ claims: { role: 'ORG_ADMIN', orgId: 84 }, query: { orgId: '84' } });
    expect(err).toBeUndefined();
    expect(req.orgId).toBe(84);
  });

  it('allows no ?orgId= at all', async () => {
    const { req, err } = await call({ claims: { role: 'VIEWER', orgId: 84 } });
    expect(err).toBeUndefined();
    expect(req.orgId).toBe(84);
  });

  it.each(['SUPER_ADMIN', 'ADMIN'])('lets %s work across orgs', async (role) => {
    const { req, err } = await call({ claims: { role, orgId: 1 }, query: { orgId: '33' } });
    expect(err).toBeUndefined();
    expect(req.orgId).toBe(33);
  });
});
