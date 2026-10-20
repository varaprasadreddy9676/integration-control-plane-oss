'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn((id) => id),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
  ping: jest.fn(async () => false),
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
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
  frontendUrl: 'http://localhost:5174',
  dailyReports: { apiKey: 'test-api-key' },
  worker: {},
}));

jest.mock('../../src/middleware/rate-limit', () => (_req, _res, next) => next());
jest.mock('../../src/middleware/request-id', () => (req, _res, next) => {
  req.id = 'req-test-id';
  next();
});

const mockAuditOrg = { created: jest.fn(), updated: jest.fn(), deleted: jest.fn(async () => {}) };

jest.mock('../../src/middleware/audit', () => ({
  auditUser: { created: jest.fn(), updated: jest.fn(), deleted: jest.fn() },
  auditOrg: mockAuditOrg,
  auditConfig: {},
  auditAdmin: { passwordChanged: jest.fn() },
}));

const mockData = {
  getOrganization: jest.fn(),
  countOrganizationDependents: jest.fn(),
  deactivateOrganizationDependents: jest.fn(),
  deleteOrganization: jest.fn(),
};

jest.mock('../../src/data', () => mockData);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'admin-1', role: 'SUPER_ADMIN', orgId: null };
    next();
  });
  const adminRouter = require('../../src/routes/admin');
  const errorHandler = require('../../src/middleware/error-handler');
  app.use('/api/v1/admin', adminRouter);
  app.use(errorHandler);
  return app;
}

describe('DELETE /api/v1/admin/orgs/:orgId', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mockData.getOrganization.mockResolvedValue({ orgId: 648, name: 'Contoso' });
    mockData.deleteOrganization.mockResolvedValue(true);
    mockData.deactivateOrganizationDependents.mockResolvedValue({ usersDeactivated: 1, integrationsDisabled: 2 });
  });

  it('refuses with 409 and counts while users or integrations are still assigned', async () => {
    mockData.countOrganizationDependents.mockResolvedValue({ activeUsers: 1, integrations: 3 });

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/648');

    expect(res.status).toBe(409);
    expect(res.body.message || res.body.error).toMatch(/1 active user.*3 integrations/);
    expect(res.body.details).toEqual({ activeUsers: 1, integrations: 3 });
    expect(mockData.deleteOrganization).not.toHaveBeenCalled();
    expect(mockData.deactivateOrganizationDependents).not.toHaveBeenCalled();
    expect(mockAuditOrg.deleted).not.toHaveBeenCalled();
  });

  it('refuses when only integrations remain', async () => {
    mockData.countOrganizationDependents.mockResolvedValue({ activeUsers: 0, integrations: 1 });

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/648');

    expect(res.status).toBe(409);
    expect(mockData.deleteOrganization).not.toHaveBeenCalled();
  });

  it('deletes an org with nothing assigned', async () => {
    mockData.countOrganizationDependents.mockResolvedValue({ activeUsers: 0, integrations: 0 });

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/648');

    expect(res.status).toBe(200);
    expect(mockData.deactivateOrganizationDependents).not.toHaveBeenCalled();
    expect(mockData.deleteOrganization).toHaveBeenCalledWith(648);
    expect(mockAuditOrg.deleted).toHaveBeenCalled();
  });

  it('with force=true deactivates users and disables integrations before deleting', async () => {
    mockData.countOrganizationDependents.mockResolvedValue({ activeUsers: 1, integrations: 3 });

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/648?force=true');

    expect(res.status).toBe(200);
    expect(mockData.deactivateOrganizationDependents).toHaveBeenCalledWith(648);
    expect(mockData.deactivateOrganizationDependents.mock.invocationCallOrder[0]).toBeLessThan(
      mockData.deleteOrganization.mock.invocationCallOrder[0]
    );
    expect(res.body).toMatchObject({ usersDeactivated: 1, integrationsDisabled: 2 });
    expect(mockAuditOrg.deleted).toHaveBeenCalledWith(expect.anything(), 648, expect.anything(), {
      usersDeactivated: 1,
      integrationsDisabled: 2,
    });
  });

  it('does not treat other force values as force', async () => {
    mockData.countOrganizationDependents.mockResolvedValue({ activeUsers: 1, integrations: 0 });

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/648?force=1');

    expect(res.status).toBe(409);
    expect(mockData.deactivateOrganizationDependents).not.toHaveBeenCalled();
  });

  it('returns 404 for a missing org without touching users', async () => {
    mockData.getOrganization.mockResolvedValue(null);

    const res = await request(buildApp()).delete('/api/v1/admin/orgs/999?force=true');

    expect(res.status).toBe(404);
    expect(mockData.deactivateOrganizationDependents).not.toHaveBeenCalled();
    expect(mockData.deleteOrganization).not.toHaveBeenCalled();
  });
});
