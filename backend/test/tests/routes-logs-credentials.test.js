'use strict';

const express = require('express');
const request = require('supertest');

const mockData = { getLogById: jest.fn(), getIntegrationById: jest.fn(), getLogsPage: jest.fn() };
jest.mock('../../src/data', () => mockData);
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/mongodb', () => ({ getDbSafe: jest.fn(), isConnected: () => true }));

const logsRouter = require('../../src/routes/logs');

const app = () => {
  const a = express();
  a.use((req, _res, next) => {
    req.orgId = 1;
    req.user = { id: 'u1', role: 'VIEWER' };
    next();
  });
  a.use('/logs', logsRouter);
  return a;
};

describe('delivery log detail never carries credentials', () => {
  beforeEach(() => {
    mockData.getLogById.mockResolvedValue({
      id: 'log-1',
      integrationConfigId: 'int-1',
      targetUrl: 'https://hooks.slack.com/services/T0/B0/log-url-token',
      request: { url: 'https://api.example.com/x?api_key=log-query-key', method: 'POST' },
    });
    mockData.getIntegrationById.mockResolvedValue({
      id: 'int-1',
      name: 'Alert forwarder',
      targetUrl: 'https://api.example.com/x?api_key=cfg-query-key',
      inboundAuthType: 'API_KEY',
      inboundAuthConfig: { headerName: 'X-API-Key', apiKey: 'inbound-api-key' },
      outgoingAuthType: 'BEARER',
      outgoingAuthConfig: { token: 'outgoing-bearer', value: 'outgoing-value-secret' },
      actions: [{ communicationConfig: { smtp: { password: 'smtp-password' } } }],
    });
  });

  it('masks the attached integration configuration and URLs in the log', async () => {
    const res = await request(app()).get('/logs/log-1');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(
      /inbound-api-key|outgoing-bearer|outgoing-v|smtp-password|cfg-query-key|log-query-key|log-url-token/
    );
    expect(res.body.__KEEP_integrationConfig__.outgoingAuthType).toBe('BEARER');
    expect(res.body.__KEEP_integrationConfig__.inboundAuthConfig.headerName).toBe('X-API-Key');
  });

  it('masks credentials inside URLs in the log list', async () => {
    mockData.getLogsPage.mockResolvedValue({
      data: [{ id: 'log-1', targetUrl: 'https://hooks.slack.com/services/T0/B0/list-token' }],
      total: 1,
    });
    const res = await request(app()).get('/logs');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('list-token');
  });
});
