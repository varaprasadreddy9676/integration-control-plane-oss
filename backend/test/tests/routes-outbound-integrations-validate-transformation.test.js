'use strict';

/**
 * POST /api/v1/outbound-integrations/validate-transformation
 * Deliberately does NOT mock src/services/transformer — unlike
 * routes-outbound-integrations.test.js, this exercises the real
 * applyTransform/applyScriptTransform so the dry-run endpoint's mock
 * integration object is actually validated end to end.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/mongodb', () => ({
  connect: jest.fn().mockResolvedValue(undefined),
  getDb: jest.fn(),
  getDbSafe: jest.fn(),
  isConnected: jest.fn().mockReturnValue(true),
  toObjectId: jest.fn((id) => (id ? { toString: () => String(id) } : null)),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn().mockReturnValue(false),
  ping: jest.fn().mockResolvedValue(false),
}));

jest.mock('../../src/data/store', () => ({
  initStore: jest.fn().mockResolvedValue(undefined),
  getTenant: jest.fn().mockReturnValue(null),
  findTenantByChildRid: jest.fn().mockReturnValue(null),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
  requestLogger: (_req, _res, next) => next(),
  setDb: jest.fn(),
  closeLogStreams: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', jwtExpiresIn: '12h', apiKey: 'test-api-key-xyz' },
  worker: {},
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => {
  req.id = 'req-test-id';
  next();
});
jest.mock('../../src/middleware/audit', () => ({
  auditIntegration: {
    created: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    updated: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
    deleted: jest.fn().mockReturnValue(jest.fn().mockResolvedValue(undefined)),
  },
}));

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    next();
  });

  const router = require('../../src/routes/outbound-integrations');
  const errorHandler = require('../../src/middleware/error-handler');

  app.use('/api/v1/outbound-integrations', router);
  app.use(errorHandler);
  return app;
}

describe('POST /api/v1/outbound-integrations/validate-transformation', () => {
  const app = buildApp();

  it('actually runs the SCRIPT transform instead of echoing the input back unchanged', async () => {
    const res = await request(app)
      .post('/api/v1/outbound-integrations/validate-transformation')
      .send({
        script: "return { mapped: payload.original, extra: 'added-by-script' };",
        samplePayload: { original: 'value' },
      });

    expect(res.status).toBe(200);
    expect(res.body.result.output).toEqual({ mapped: 'value', extra: 'added-by-script' });
    expect(res.body.result.output).not.toEqual(res.body.result.input);
  });

  it('surfaces a script error instead of silently passing through', async () => {
    const res = await request(app)
      .post('/api/v1/outbound-integrations/validate-transformation')
      .send({
        script: 'throw new Error("boom");',
        samplePayload: { original: 'value' },
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boom/);
  });

  it('reports skip() calls from the script instead of a false success', async () => {
    const res = await request(app)
      .post('/api/v1/outbound-integrations/validate-transformation')
      .send({
        script: "return skip('not applicable', { shouldRetry: false });",
        samplePayload: { original: 'value' },
      });

    expect(res.status).toBe(200);
    expect(res.body.result.skipped).toBe(true);
    expect(res.body.result.output).toBeNull();
  });
});
