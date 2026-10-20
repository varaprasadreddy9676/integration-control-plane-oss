'use strict';

/**
 * Auth route integration tests
 * Tests POST /api/v1/auth/login and GET /api/v1/auth/me
 */

const express = require('express');
const request = require('supertest');

// --- Module-level mocks (must be hoisted before any require) ---

const mockDb = {
  collection: jest.fn().mockReturnValue({
    find: jest.fn().mockReturnValue({ sort: jest.fn().mockReturnThis(), toArray: jest.fn().mockResolvedValue([]) }),
    findOne: jest.fn().mockResolvedValue(null),
    insertOne: jest.fn().mockResolvedValue({ insertedId: 'mock_id' }),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1, matchedCount: 1 }),
    deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    countDocuments: jest.fn().mockResolvedValue(0)
  })
};

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn().mockReturnValue(mockDb),
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id), _bsontype: 'ObjectId' } : null)),
  ObjectId: class MockObjectId {
    constructor(id) { this.id = id; }
    toString() { return String(this.id); }
  }
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false)
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'test-req-id'; next(); });
jest.mock('../../src/middleware/audit', () => ({
  auditAuth: {
    login: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    logout: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined))
  },
  auditAdmin: {
    userCreated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    userUpdated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined))
  }
}));


// The route's own `auth` is replaced so each test can choose the caller.
let mockCaller = null;
jest.mock('../../src/middleware/auth', () => {
  const fn = (req, _res, next) => {
    Object.assign(req, mockCaller);
    next();
  };
  fn.requireRole = () => (_req, _res, next) => next();
  return fn;
});

const mockConfig = {
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret-12345', jwtExpiresIn: '12h', apiKey: 'test-api-key', apiKeyOrgIds: null },
  portal: {},
  worker: {},
};
jest.mock('../../src/config', () => mockConfig);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/auth', require('../../src/routes/auth'));
  app.use(require('../../src/middleware/error-handler'));
  return app;
}

const post = (orgId) => request(buildApp()).post('/api/v1/auth/portal-session').send({ orgId });

describe('POST /api/v1/auth/portal-session — org scope', () => {
  afterEach(() => {
    mockConfig.security.apiKeyOrgIds = null;
  });

  it('an org-bound key cannot mint a session for another org', async () => {
    mockCaller = { authType: 'apiKey', orgId: 84, user: { id: 'u1', role: 'API_KEY', apiKeyId: 'k1' } };
    expect((await post(33)).status).toBe(403);
  });

  it('an org-bound key can mint one for its own org', async () => {
    mockCaller = { authType: 'apiKey', orgId: 84, user: { id: 'u1', role: 'ORG_ADMIN', apiKeyId: 'k1' } };
    expect((await post(84)).status).toBe(200);
  });

  it('the shared key is limited to API_KEY_ORG_IDS when it is set', async () => {
    mockConfig.security.apiKeyOrgIds = [33, 84];
    mockCaller = { authType: 'apiKey', user: { id: 'api-key', role: 'API_KEY' } };
    expect((await post(9001)).status).toBe(403);
    expect((await post(84)).status).toBe(200);
  });

  it('a super admin can mint one for any org', async () => {
    mockCaller = { authType: 'jwt', orgId: null, user: { id: 'u9', role: 'SUPER_ADMIN' } };
    expect((await post(9001)).status).toBe(200);
  });
});
