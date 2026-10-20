'use strict';

/**
 * The shared system API key used to act for ANY org via ?orgId=. With
 * API_KEY_ORG_IDS set (config.security.apiKeyOrgIds), it may only act for
 * the listed orgs. Unset keeps the old behaviour for existing deployments.
 */

const mockConfig = { security: { apiKey: 'system-shared-key', jwtSecret: 'test-secret', apiKeyOrgIds: null } };

jest.mock('../../src/mongodb', () => ({ getDb: jest.fn(() => ({ collection: () => ({ findOne: jest.fn(async () => null) }) })) }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/config', () => mockConfig);

const auth = require('../../src/middleware/auth');

function makeReq(orgId) {
  return {
    query: orgId === undefined ? {} : { orgId: String(orgId) },
    body: {},
    header: (name) => (name.toLowerCase() === 'x-api-key' ? 'system-shared-key' : undefined),
    ip: '127.0.0.1',
    connection: {},
  };
}

async function run(orgId) {
  const req = makeReq(orgId);
  const next = jest.fn();
  await auth(req, {}, next);
  return { req, err: next.mock.calls[0][0] };
}

describe('shared system API key org allowlist', () => {
  afterEach(() => {
    mockConfig.security.apiKeyOrgIds = null;
  });

  it('acts for any org when no allowlist is configured (existing behaviour)', async () => {
    const { req, err } = await run(9001);
    expect(err).toBeUndefined();
    expect(req.orgId).toBe(9001);
  });

  it('acts for a listed org', async () => {
    mockConfig.security.apiKeyOrgIds = [33, 84];
    const { req, err } = await run(84);
    expect(err).toBeUndefined();
    expect(req.orgId).toBe(84);
  });

  it('refuses an org that is not listed', async () => {
    mockConfig.security.apiKeyOrgIds = [33, 84];
    const { req, err } = await run(9001);
    expect(err).toBeDefined();
    expect(err.statusCode || err.status).toBe(403);
    expect(req.orgId).toBeUndefined();
  });

  it('refuses a request with no org when an allowlist is configured', async () => {
    mockConfig.security.apiKeyOrgIds = [33];
    const { err } = await run(undefined);
    expect(err).toBeDefined();
    expect(err.statusCode || err.status).toBe(403);
  });
});
