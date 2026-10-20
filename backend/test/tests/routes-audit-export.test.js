'use strict';

const express = require('express');
const request = require('supertest');

const mockJobs = {
  createIndex: jest.fn().mockResolvedValue(undefined),
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
  findOne: jest.fn().mockResolvedValue(null),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockAuditLogs = { countDocuments: jest.fn().mockResolvedValue(2) };
const mockDb = { collection: jest.fn((name) => (name === 'audit_export_jobs' ? mockJobs : mockAuditLogs)) };

jest.mock('../../src/mongodb', () => ({ getDbSafe: jest.fn().mockResolvedValue(mockDb) }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/middleware/auth', () => {
  const auth = (_req, _res, next) => next();
  auth.requireRole = () => (_req, _res, next) => next();
  return auth;
});
jest.mock('../../src/services/audit-logger', () => ({
  queryAuditLogs: jest.fn().mockResolvedValue({ logs: [], pagination: { total: 2 } }),
  streamAuditLogsForExport: jest.fn(),
  getAuditStats: jest.fn(),
  ACTION_TYPES: {},
  RESOURCE_TYPES: {},
}));
jest.mock('../../src/services/user-activity-tracker', () => ({
  trackActivitiesBatch: jest.fn(), queryActivities: jest.fn(), getActivityStats: jest.fn(), getUserSessions: jest.fn(),
  ACTIVITY_EVENTS: {}, ACTIVITY_CATEGORIES: {},
}));

const app = express();
app.use(express.json());
app.use((req, _res, next) => {
  req.user = { id: 'admin-1', role: 'SUPER_ADMIN' };
  next();
});
app.use('/api/v1/admin/audit', require('../../src/routes/audit'));

describe('audit export route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queues an uncapped, owner-scoped export job', async () => {
    const res = await request(app)
      .post('/api/v1/admin/audit/export')
      .send({ format: 'csv', orgId: 33, action: 'LOGIN' });

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'QUEUED', format: 'csv', totalRecords: 2 });
    expect(res.body.statusPath).toContain('/admin/audit/export/jobs/');
    expect(mockJobs.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'admin-1',
      filters: expect.objectContaining({ orgId: 33, action: 'LOGIN' }),
    }));
  });
});
