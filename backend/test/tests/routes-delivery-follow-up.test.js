'use strict';

/**
 * Delivery follow-up over the API: the configuration is validated on save, and
 * a script can be tried against a sample response before it is saved.
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
const mockTest = jest.fn();
jest.mock('../../src/services/delivery-follow-up', () => ({
  testFollowUpScript: (...args) => mockTest(...args),
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

const SCRIPT = 'return { status: "DELIVERED" };';

describe('delivery follow-up on the integration', () => {
  beforeEach(() => {
    data.getIntegration.mockReset().mockResolvedValue(mockStored);
    data.updateIntegration.mockReset().mockImplementation(async (_org, _id, body) => ({ ...mockStored, ...body }));
    mockTest.mockReset().mockResolvedValue({ outcome: 'RESULT', result: { status: 'DELIVERED' }, httpCalls: [] });
  });

  const put = (deliveryFollowUp) =>
    request(buildApp()).put('/api/v1/outbound-integrations/int-1').send({ ...mockStored, deliveryFollowUp });

  it('saves a valid follow-up configuration', async () => {
    const config = { enabled: true, script: SCRIPT, checkAfterSeconds: [30, 300] };
    const res = await put(config);
    expect(res.status).toBe(200);
    expect(data.updateIntegration.mock.calls[0][2].deliveryFollowUp).toEqual(config);
  });

  it('rejects an enabled follow-up with no script', async () => {
    const res = await put({ enabled: true, script: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/script is required/i);
    expect(data.updateIntegration).not.toHaveBeenCalled();
  });

  it('rejects a script that is not JavaScript, and a bad schedule', async () => {
    expect((await put({ enabled: true, script: 'return {' })).body.error).toMatch(/not valid JavaScript/i);
    expect((await put({ enabled: true, script: SCRIPT, checkAfterSeconds: [1] })).body.error).toMatch(/between/i);
  });

  it('lets an integration turn it off', async () => {
    const res = await put({ enabled: false, script: SCRIPT });
    expect(res.status).toBe(200);
  });
});

describe('POST /:id/test-follow-up', () => {
  beforeEach(() => {
    data.getIntegration.mockReset().mockResolvedValue(mockStored);
    mockTest.mockReset().mockResolvedValue({ outcome: 'RESULT', result: { status: 'READ' }, httpCalls: [] });
  });

  const post = (id, body) => request(buildApp()).post(`/api/v1/outbound-integrations/${id}/test-follow-up`).send(body);

  it('runs the script against the sample response and returns the outcome', async () => {
    const res = await post('int-1', { script: SCRIPT, response: { data: [{ id: 'm1' }] }, statusCode: 200 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ outcome: 'RESULT', result: { status: 'READ' } });
    expect(mockTest).toHaveBeenCalledWith({
      integration: expect.objectContaining({ id: 'int-1' }),
      script: SCRIPT,
      delivery: { statusCode: 200, response: { data: [{ id: 'm1' }] } },
    });
  });

  it('works for an integration that is not saved yet', async () => {
    const res = await post('new', { script: SCRIPT, response: {} });
    expect(res.status).toBe(200);
    expect(mockTest.mock.calls[0][0].integration).toBeNull();
    expect(mockTest.mock.calls[0][0].delivery.statusCode).toBe(200);
  });

  it('needs a valid script', async () => {
    expect((await post('int-1', { response: {} })).status).toBe(400);
    expect((await post('int-1', { script: 'return {', response: {} })).body.error).toMatch(/not valid JavaScript/i);
    expect(mockTest).not.toHaveBeenCalled();
  });

  it('does not run against another organization\'s integration', async () => {
    data.getIntegration.mockResolvedValue({ ...mockStored, orgId: 2 });
    const res = await post('int-1', { script: SCRIPT, response: {} });
    expect(res.status).toBe(404);
    expect(mockTest).not.toHaveBeenCalled();
  });
});

describe('GET /follow-up-preset', () => {
  const get = (query) => request(buildApp()).get(`/api/v1/outbound-integrations/follow-up-preset${query}`);

  it('returns the preset for a known provider, with its script, so a new form can start with it on', async () => {
    const res = await get('?targetUrl=' + encodeURIComponent('https://api.qikchat.in/v1/messages'));
    expect(res.status).toBe(200);
    expect(res.body.preset).toMatchObject({ id: 'qikchat', label: 'Qikchat WhatsApp' });
    expect(res.body.preset.config).toMatchObject({ enabled: true, checkAfterSeconds: [30, 300, 3600, 86400] });
    expect(res.body.preset.config.script).toContain('api.qikchat.in/v1/messages?msgid=');
  });

  it('returns null for any other URL', async () => {
    expect((await get('?targetUrl=https://example.com/hook')).body).toEqual({ preset: null });
    expect((await get('')).body).toEqual({ preset: null });
  });
});
