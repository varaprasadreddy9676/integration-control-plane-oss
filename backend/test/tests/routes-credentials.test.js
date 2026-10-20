'use strict';

const express = require('express');
const request = require('supertest');

const mockCredentialData = {
  listCredentialPlaceholders: jest.fn(),
  createCredentialPlaceholder: jest.fn(),
  getCredentialPlaceholder: jest.fn(),
  setCredentialValues: jest.fn(),
  updateCredentialTestStatus: jest.fn(),
};

jest.mock('../../src/data/credentials', () => mockCredentialData);
jest.mock('../../src/services/mcp-audit', () => ({
  logMcpAudit: jest.fn(async () => {}),
}));
jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

function buildApp(user = { id: 'user-1', role: 'ORG_ADMIN' }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 1;
    req.user = user;
    next();
  });
  app.use('/api/v1/credentials', require('../../src/routes/credentials'));
  app.use(require('../../src/middleware/error-handler'));
  return app;
}

describe('Credential routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockCredentialData.listCredentialPlaceholders.mockResolvedValue([]);
    mockCredentialData.createCredentialPlaceholder.mockResolvedValue({
      id: 'cred_1',
      status: 'PENDING',
      fields: [{ key: 'apiKey', status: 'PENDING', maskedValue: null }],
    });
    mockCredentialData.getCredentialPlaceholder.mockResolvedValue({
      id: 'cred_1',
      status: 'PROVIDED',
      fields: [{ key: 'apiKey', required: true, status: 'PROVIDED', maskedValue: '********' }],
    });
    mockCredentialData.setCredentialValues.mockResolvedValue({
      id: 'cred_1',
      status: 'PROVIDED',
      fields: [{ key: 'apiKey', status: 'PROVIDED', maskedValue: '********' }],
    });
    mockCredentialData.updateCredentialTestStatus.mockResolvedValue({
      id: 'cred_1',
      status: 'TESTED',
      testStatus: 'TESTED',
    });
  });

  it('creates credential placeholders with an audit reason', async () => {
    const res = await request(app)
      .post('/api/v1/credentials/placeholders')
      .send({
        orgId: 1,
        provider: 'acme',
        name: 'Acme validation',
        fields: [{ key: 'apiKey' }],
        reason: 'Create integration credentials',
      });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(mockCredentialData.createCredentialPlaceholder).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ provider: 'acme' }),
      expect.objectContaining({ userId: 'user-1' })
    );
  });

  it('rejects credential mutations without reason', async () => {
    const res = await request(app)
      .post('/api/v1/credentials/cred_1/values')
      .send({ orgId: 1, values: { apiKey: 'secret' } });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockCredentialData.setCredentialValues).not.toHaveBeenCalled();
  });

  it('rejects credential value updates without credentials:manage', async () => {
    app = buildApp({ id: 'viewer-1', role: 'VIEWER' });

    const res = await request(app)
      .post('/api/v1/credentials/cred_1/values')
      .send({ orgId: 1, values: { apiKey: 'secret' }, reason: 'Viewer should not manage credentials' });

    expect(res.status).toBe(403);
    expect(mockCredentialData.setCredentialValues).not.toHaveBeenCalled();
  });

  it('sets credential values without returning raw values', async () => {
    const res = await request(app)
      .post('/api/v1/credentials/cred_1/values')
      .send({ orgId: 1, values: { apiKey: 'secret' }, reason: 'Configure acme auth' });

    expect(res.status).toBe(200);
    expect(res.body.data.fields[0].maskedValue).toBe('********');
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});
