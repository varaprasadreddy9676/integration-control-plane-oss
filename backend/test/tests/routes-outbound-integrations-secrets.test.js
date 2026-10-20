'use strict';

/**
 * Route-level pin for masked credentials: GET never returns them, and a PUT
 * that sends the mask back keeps the stored value instead of saving the mask.
 */

const express = require('express');
const request = require('supertest');

const mockStored = {
  id: 'int-1',
  _id: 'int-1',
  orgId: 1,
  name: 'Lab Orders',
  eventType: 'LAB_ORDER',
  targetUrl: 'https://partner.example.com/hook',
  httpMethod: 'POST',
  scope: 'ENTITY_ONLY',
  outgoingAuthType: 'BASIC',
  outgoingAuthConfig: { username: 'lab', password: 'real-password' },
  timeoutMs: 10000,
  retryCount: 3,
};

const mockDb = { collection: () => ({ findOne: async () => null, find: () => ({ toArray: async () => [] }) }) };

jest.mock('../../src/data', () => ({
  getIntegration: jest.fn(),
  updateIntegration: jest.fn(),
}));
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
  getTenant: jest.fn().mockReturnValue(null),
  findTenantByChildRid: jest.fn().mockReturnValue(null)
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn()
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', jwtExpiresIn: '12h', apiKey: 'test-api-key-xyz' },
  worker: {}
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => { req.id = 'req-test-id'; next(); });
jest.mock('../../src/middleware/audit', () => ({
  auditIntegration: {
    created: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    updated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    deleted: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    bulkEnabled: jest.fn().mockResolvedValue(undefined),
    bulkDisabled: jest.fn().mockResolvedValue(undefined),
    credentialsRevealed: jest.fn().mockResolvedValue(undefined)
  }
}));

jest.mock('../../src/services/transformer', () => ({
  validateScript: jest.fn().mockReturnValue(true),
  applyTransform: jest.fn().mockResolvedValue({})
}));

jest.mock('../../src/utils/url-check', () => ({
  validateTargetUrl: jest.fn().mockReturnValue({ valid: true })
}));

jest.mock('../../src/services/integration-signing', () => ({
  generateSigningSecret: jest.fn().mockReturnValue('mock-signing-secret'),
  generateSignatureHeaders: jest.fn().mockReturnValue({
    'X-Integration-Signature': 'v1,mock-signature',
    'X-Integration-Timestamp': '1710000000',
    'X-Integration-ID': 'msg_test',
  }),
}));

jest.mock('../../src/services/lookup-validator', () => ({
  validateLookupConfigs: jest.fn().mockResolvedValue(true)
}));

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(),
  AbortController: class { constructor() { this.signal = {}; } abort() {} }
}));

jest.mock('../../src/services/scheduler', () => ({
  executeSchedulingScript: jest.fn().mockResolvedValue(null),
  validateRecurringConfig: jest.fn().mockReturnValue(true)
}));

jest.mock('../../src/utils/curl-generator', () => ({
  generateMaskedCurlCommand: jest.fn().mockReturnValue('curl -X POST ...')
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn().mockResolvedValue({})
}));


function buildApp(role = 'ORG_ADMIN') {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role, orgId: 1 };
    req.orgId = 1;
    req.entityParentRid = 1;
    req.authType = 'apikey';
    next();
  });
  app.use('/api/v1/outbound-integrations', require('../../src/routes/outbound-integrations'));
  app.use(require('../../src/middleware/error-handler'));
  return app;
}

const data = require('../../src/data');

describe('outbound integration credentials over the API', () => {
  beforeEach(() => {
    data.getIntegration.mockReset().mockResolvedValue(mockStored);
    data.updateIntegration.mockReset().mockImplementation(async (_org, _id, body) => ({ ...mockStored, ...body }));
  });

  it('GET /:id masks the password', async () => {
    const res = await request(buildApp()).get('/api/v1/outbound-integrations/int-1');
    expect(res.status).toBe(200);
    expect(res.body.outgoingAuthConfig).toEqual({ username: 'lab', password: '********' });
  });

  it('PUT with the mask sent back keeps the stored password, and the response is masked', async () => {
    const res = await request(buildApp())
      .put('/api/v1/outbound-integrations/int-1')
      .send({ ...mockStored, name: 'Lab Orders v2', outgoingAuthConfig: { username: 'lab', password: '********' } });
    expect(res.status).toBe(200);
    expect(data.updateIntegration.mock.calls[0][2].outgoingAuthConfig.password).toBe('real-password');
    expect(res.body.outgoingAuthConfig.password).toBe('********');
  });

  it('PUT with a new password saves the new one', async () => {
    await request(buildApp())
      .put('/api/v1/outbound-integrations/int-1')
      .send({ ...mockStored, outgoingAuthConfig: { username: 'lab', password: 'rotated!' } });
    expect(data.updateIntegration.mock.calls[0][2].outgoingAuthConfig.password).toBe('rotated!');
  });

  it('GET /:id/credentials gives a super admin the real value, and audits it', async () => {
    const { auditIntegration } = require('../../src/middleware/audit');
    const res = await request(buildApp('SUPER_ADMIN')).get('/api/v1/outbound-integrations/int-1/credentials');
    expect(res.status).toBe(200);
    expect(res.body.outgoingAuthConfig.password).toBe('real-password');
    expect(auditIntegration.credentialsRevealed).toHaveBeenCalledWith(expect.anything(), 'int-1', 'Lab Orders');
  });

  it('GET /:id/credentials is refused to everyone else', async () => {
    const res = await request(buildApp('ORG_ADMIN')).get('/api/v1/outbound-integrations/int-1/credentials');
    expect(res.status).toBe(403);
    expect(JSON.stringify(res.body)).not.toContain('real-password');
  });
});
