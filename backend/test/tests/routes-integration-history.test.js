'use strict';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

const mockIntegrationId = new ObjectId();
let mockStored;

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({
    collection: () => ({
      findOne: jest.fn(async (filter) =>
        mockStored && String(filter._id) === String(mockStored._id) && filter.orgId === mockStored.orgId ? mockStored : null
      ),
    }),
  })),
}));

const mockHistory = {
  listRevisions: jest.fn(),
  getRevision: jest.fn(),
  diffRevision: jest.fn(),
  restoreRevision: jest.fn(),
};
jest.mock('../../src/data/integration-revisions', () => mockHistory);
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const mockAudit = { auditIntegration: { updated: jest.fn() }, auditScheduledJob: { updated: jest.fn() } };
jest.mock('../../src/middleware/audit', () => mockAudit);

const mockWorker = { scheduleJob: jest.fn(), unscheduleJob: jest.fn() };
jest.mock('../../src/processor/scheduled-job-worker', () => ({ getScheduledJobWorker: () => mockWorker }));

const historyRouter = require('../../src/routes/integration-history');

function app(user, orgId = 1) {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = user;
    req.orgId = orgId;
    next();
  });
  a.use('/integration-history', historyRouter);
  return a;
}

const editor = { id: 'u1', role: 'INTEGRATION_EDITOR' };
const base = `/integration-history/${mockIntegrationId}`;

beforeEach(() => {
  jest.clearAllMocks();
  mockStored = { _id: mockIntegrationId, orgId: 1, name: 'Orders', direction: 'OUTBOUND', isActive: true };
});

describe('integration history routes', () => {
  it('lists revisions for an integration in the caller’s organization', async () => {
    mockHistory.listRevisions.mockResolvedValue([{ revision: 2 }, { revision: 1 }]);
    const res = await request(app(editor)).get(`${base}/revisions`);
    expect(res.status).toBe(200);
    expect(res.body.revisions).toEqual([{ revision: 2 }, { revision: 1 }]);
    expect(res.body.integration).toMatchObject({ name: 'Orders', direction: 'OUTBOUND' });
  });

  it('hides another organization’s integration', async () => {
    const res = await request(app(editor, 2)).get(`${base}/revisions`);
    expect(res.status).toBe(404);
    expect(mockHistory.listRevisions).not.toHaveBeenCalled();
  });

  it('refuses users without the version history permission', async () => {
    const res = await request(app({ id: 'u2', role: 'ORG_USER' })).get(`${base}/revisions`);
    expect(res.status).toBe(403);
  });

  it('masks credentials in a revision snapshot', async () => {
    mockHistory.getRevision.mockResolvedValue({
      revision: 1,
      snapshot: { name: 'Orders', outgoingAuthConfig: { apiKey: 'real-secret' } },
    });
    const res = await request(app(editor)).get(`${base}/revisions/1`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain('real-secret');
  });

  it('restores a revision and audits it', async () => {
    mockHistory.restoreRevision.mockResolvedValue({
      before: { ...mockStored, targetUrl: 'https://b.example' },
      after: { ...mockStored, targetUrl: 'https://a.example' },
      revision: { revision: 3 },
    });
    const res = await request(app(editor)).post(`${base}/revisions/1/restore`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ restoredFrom: 1, revision: 3 });
    expect(mockHistory.restoreRevision).toHaveBeenCalledWith(1, mockIntegrationId, 1);
    expect(mockAudit.auditIntegration.updated).toHaveBeenCalledWith(
      expect.anything(),
      String(mockIntegrationId),
      expect.objectContaining({ restoredFromRevision: 1 })
    );
  });

  it('reschedules a restored scheduled job the way a save does', async () => {
    mockStored = { ...mockStored, direction: 'SCHEDULED' };
    const after = { ...mockStored, schedule: { type: 'CRON', expression: '0 9 * * *' } };
    mockHistory.restoreRevision.mockResolvedValue({ before: mockStored, after, revision: { revision: 2 } });
    const res = await request(app({ id: 'admin', role: 'ORG_ADMIN' })).post(`${base}/revisions/1/restore`);
    expect(res.status).toBe(200);
    expect(mockWorker.scheduleJob).toHaveBeenCalledWith(after);
    expect(mockAudit.auditScheduledJob.updated).toHaveBeenCalled();
  });

  it('requires edit permission to restore', async () => {
    const res = await request(app({ id: 'u3', role: 'VIEWER', permissions: ['integration:version_history'] })).post(
      `${base}/revisions/1/restore`
    );
    expect(res.status).toBe(403);
    expect(mockHistory.restoreRevision).not.toHaveBeenCalled();
  });

  it('rejects a revision that is not a positive whole number', async () => {
    const res = await request(app(editor)).get(`${base}/revisions/abc/diff`);
    expect(res.status).toBe(400);
  });
});
