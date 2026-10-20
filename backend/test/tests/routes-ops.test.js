'use strict';

const express = require('express');
const request = require('supertest');

const integration = {
  id: 'integration-1',
  orgId: 1,
  name: 'Acme Outbound',
  type: 'WEBHOOK',
  direction: 'OUTBOUND',
  isActive: true,
};

const mockData = {
  getIntegration: jest.fn(),
  checkCircuitState: jest.fn(),
  getLogsPage: jest.fn(),
  resetCircuitState: jest.fn(),
  getSourceCheckpoints: jest.fn(),
  getEventAuditStats: jest.fn(),
};

const mockDlqData = {
  getDLQStats: jest.fn(),
};

const mockReplay = jest.fn();
const mockApplyTransform = jest.fn();

jest.mock('../../src/data', () => mockData);
jest.mock('../../src/data/dlq', () => mockDlqData);
jest.mock('../../src/processor/retry-handler', () => ({ replayEvent: mockReplay }));
jest.mock('../../src/services/transformer', () => ({ applyTransform: mockApplyTransform }));
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
  app.use('/api/v1/ops', require('../../src/routes/ops'));
  app.use(require('../../src/middleware/error-handler'));
  return app;
}

describe('Ops routes', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    app = buildApp();
    mockData.getIntegration.mockResolvedValue(integration);
    mockData.checkCircuitState.mockResolvedValue({ isOpen: false, state: 'CLOSED', reason: null });
    mockData.getLogsPage.mockResolvedValue({
      data: [],
      pagination: { total: 0 },
    });
    mockData.resetCircuitState.mockResolvedValue({
      integrationId: 'integration-1',
      before: { state: 'OPEN', consecutiveFailures: 12 },
      after: { state: 'CLOSED', consecutiveFailures: 0 },
      modifiedCount: 1,
    });
    mockData.getSourceCheckpoints.mockResolvedValue([]);
    mockData.getEventAuditStats.mockResolvedValue({ total: 0 });
    mockDlqData.getDLQStats.mockResolvedValue({ statusBreakdown: {} });
    mockReplay.mockResolvedValue({ replayed: true });
    mockApplyTransform.mockResolvedValue({ mapped: true });
  });

  it('returns integration status with circuit, failures, and DLQ summary', async () => {
    const res = await request(app).get('/api/v1/ops/integration-status/integration-1?orgId=1');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.integration.name).toBe('Acme Outbound');
    expect(res.body.data.circuit.state).toBe('CLOSED');
    expect(mockDlqData.getDLQStats).toHaveBeenCalledWith(1, { integrationConfigId: 'integration-1' });
  });

  it('prevents cross-org integration status access', async () => {
    mockData.getIntegration.mockResolvedValueOnce({ ...integration, orgId: 2 });

    const res = await request(app).get('/api/v1/ops/integration-status/integration-1?orgId=1');

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('requires reason before resetting circuit breaker', async () => {
    const res = await request(app).post('/api/v1/ops/circuit-breaker/integration-1/reset').send({ orgId: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockData.resetCircuitState).not.toHaveBeenCalled();
  });

  it('rejects circuit reset when user lacks ops:circuit_reset', async () => {
    app = buildApp({ id: 'viewer-1', role: 'VIEWER' });

    const res = await request(app)
      .post('/api/v1/ops/circuit-breaker/integration-1/reset')
      .send({ orgId: 1, reason: 'Viewer should not reset' });

    expect(res.status).toBe(403);
    expect(mockData.resetCircuitState).not.toHaveBeenCalled();
  });

  it('resets circuit breaker when scoped and reasoned', async () => {
    const res = await request(app)
      .post('/api/v1/ops/circuit-breaker/integration-1/reset')
      .send({ orgId: 1, reason: 'Recover after credential fix' });

    expect(res.status).toBe(200);
    expect(res.body.data.after.state).toBe('CLOSED');
    expect(mockData.resetCircuitState).toHaveBeenCalledWith(
      'integration-1',
      expect.objectContaining({ reason: 'Recover after credential fix', userId: 'user-1' })
    );
  });

  it('runs transform tests through unified test-run endpoint', async () => {
    const res = await request(app).post('/api/v1/ops/test-run').send({
      orgId: 1,
      integrationId: 'integration-1',
      type: 'TRANSFORM',
      payload: { raw: true },
      reason: 'Validate sample payload',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PASSED');
    expect(res.body.data.output).toEqual({ mapped: true });
    expect(mockApplyTransform).toHaveBeenCalledWith(integration, { raw: true }, expect.objectContaining({ testRun: true }));
  });
});
