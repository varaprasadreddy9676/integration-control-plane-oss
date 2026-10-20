'use strict';

/**
 * An exported integration always masks credentials (the UI hardcodes
 * includeSensitive: false). Importing that file must never save the mask
 * itself as a credential, and "update existing" must actually find the
 * existing integration instead of silently creating a duplicate — both were
 * broken: getIntegrationById(req.orgId, id) passed the wrong argument to a
 * one-parameter function, so `id` was discarded and the lookup used orgId as
 * the ObjectId. That meant "update via import" always fell through to
 * "create new", and the masked auth config (e.g. a CUSTOM_HEADERS API key,
 * never masked at all before this fix) was stored as the literal credential.
 */

const express = require('express');
const request = require('supertest');

const SECRET_MASK = '********';

const stored = {
  id: 'int-1',
  _id: 'int-1',
  orgId: 1,
  name: 'Lab Orders',
  type: 'LAB_ORDER',
  targetUrl: 'https://partner.example.com/hook',
  httpMethod: 'POST',
  isActive: true,
  outgoingAuthType: 'CUSTOM_HEADERS',
  outgoingAuthConfig: { headers: { 'X-Api-Key': 'real-secret-key' } },
  timeoutMs: 10000,
  retryCount: 3,
};

jest.mock('../../src/data', () => ({
  getIntegrationById: jest.fn(),
  getIntegrationByTypeAndDirection: jest.fn(),
  listIntegrations: jest.fn().mockResolvedValue([]),
  listEventTypes: jest.fn().mockResolvedValue([]),
  createIntegration: jest.fn(),
  updateIntegration: jest.fn(),
}));
jest.mock('../../src/data/templates', () => ({
  getAllTemplates: jest.fn().mockResolvedValue([]),
  getTemplateById: jest.fn(),
  createIntegrationFromTemplate: jest.fn(),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/middleware/audit', () => ({
  auditData: { imported: jest.fn().mockResolvedValue(undefined), exported: jest.fn().mockResolvedValue(undefined) },
}));

const data = require('../../src/data');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    next();
  });
  app.use('/api/v1/import-export', require('../../src/routes/import-export'));
  return app;
}

describe('exporting an integration masks every credential field, not just a fixed list', () => {
  it('masks CUSTOM_HEADERS values (previously not masked at all)', async () => {
    data.listIntegrations.mockResolvedValue([stored]);
    const res = await request(buildApp()).get('/api/v1/import-export/outbound-integrations.json');
    expect(res.status).toBe(200);
    const exported = res.body.integrations[0];
    expect(exported.authConfig.headers['X-Api-Key']).toBe(SECRET_MASK);
    expect(exported.authConfig.headers['X-Api-Key']).not.toContain('real-secret-key');
  });

  it('includeSensitive=true still returns the real value (explicit opt-in)', async () => {
    data.listIntegrations.mockResolvedValue([stored]);
    const res = await request(buildApp()).get('/api/v1/import-export/outbound-integrations.json?includeSensitive=true');
    expect(res.body.integrations[0].authConfig.headers['X-Api-Key']).toBe('real-secret-key');
  });
});

describe('importing a masked export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    data.getIntegrationById.mockResolvedValue(stored);
    data.updateIntegration.mockImplementation(async (_org, _id, patch) => ({ ...stored, ...patch, id: 'int-1' }));
    data.createIntegration.mockImplementation(async (_org, payload) => ({ ...payload, id: 'int-new' }));
  });

  const importPayload = (overrides = {}) => ({
    importData: {
      integrations: [
        {
          id: 'int-1',
          name: 'Lab Orders',
          eventType: 'LAB_ORDER',
          targetUrl: 'https://partner.example.com/hook',
          httpMethod: 'POST',
          authType: 'CUSTOM_HEADERS',
          authConfig: { headers: { 'X-Api-Key': SECRET_MASK } },
          ...overrides,
        },
      ],
    },
    options: { updateExisting: true, continueOnError: true },
  });

  it('finds the existing integration by id — updateExisting is no longer a no-op', async () => {
    await request(buildApp()).post('/api/v1/import-export/outbound-integrations.json').send(importPayload());
    expect(data.getIntegrationById).toHaveBeenCalledWith('int-1');
    expect(data.updateIntegration).toHaveBeenCalledTimes(1);
    expect(data.createIntegration).not.toHaveBeenCalled();
  });

  it('keeps the stored credential instead of saving the literal mask', async () => {
    await request(buildApp()).post('/api/v1/import-export/outbound-integrations.json').send(importPayload());
    const patch = data.updateIntegration.mock.calls[0][2];
    expect(patch.outgoingAuthConfig.headers['X-Api-Key']).toBe('real-secret-key');
  });

  it('a real (non-masked) value in the import still overwrites the stored one', async () => {
    await request(buildApp())
      .post('/api/v1/import-export/outbound-integrations.json')
      .send(importPayload({ authConfig: { headers: { 'X-Api-Key': 'rotated-key' } } }));
    const patch = data.updateIntegration.mock.calls[0][2];
    expect(patch.outgoingAuthConfig.headers['X-Api-Key']).toBe('rotated-key');
  });

  it('creating new (no existing integration) strips the mask instead of storing it, and flags it', async () => {
    data.getIntegrationById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/v1/import-export/outbound-integrations.json')
      .send(importPayload({ id: undefined }));
    const payload = data.createIntegration.mock.calls[0][1];
    expect(payload.outgoingAuthConfig.headers).not.toHaveProperty('X-Api-Key');
    expect(res.body.results.successful[0].needsCredentials).toBe(true);
  });

  it('does not let one org pull another org\'s integration into the "existing" branch', async () => {
    data.getIntegrationById.mockResolvedValue({ ...stored, orgId: 2 });
    await request(buildApp()).post('/api/v1/import-export/outbound-integrations.json').send(importPayload());
    expect(data.createIntegration).toHaveBeenCalledTimes(1);
    expect(data.updateIntegration).not.toHaveBeenCalled();
  });
});
