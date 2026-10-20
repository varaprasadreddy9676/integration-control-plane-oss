'use strict';

const express = require('express');
const request = require('supertest');

const mockData = {
  countEventAudit: jest.fn(),
  streamEventAuditForExport: jest.fn(),
  getEventAuditStats: jest.fn(),
  getSourceCheckpoints: jest.fn(),
  getSourceGaps: jest.fn(),
};

const mockJobsCollection = {
  createIndex: jest.fn().mockResolvedValue(undefined),
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findOne: jest.fn().mockResolvedValue(null),
  findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};

const mockDb = {
  collection: jest.fn((name) => {
    if (name === 'event_audit_export_jobs') return mockJobsCollection;
    return {
      createIndex: jest.fn().mockResolvedValue(undefined),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      findOne: jest.fn().mockResolvedValue(null),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    };
  }),
};

jest.mock('../../src/data', () => mockData);

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/db', () => ({
  isConfigured: jest.fn(() => false),
}));

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
}));

jest.mock('../../src/data/event-sources', () => ({}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 145;
    next();
  });
  const router = require('../../src/routes/events');
  app.use('/api/v1/events', router);
  return app;
};

describe('Event Audit export routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockClear();
    mockData.countEventAudit.mockReset();
    mockData.streamEventAuditForExport.mockReset();
    mockJobsCollection.insertOne.mockClear();
    mockJobsCollection.findOneAndUpdate.mockReset();
    mockJobsCollection.findOneAndUpdate.mockResolvedValue({ value: null });
  });

  it('queues large CSV exports as async jobs', async () => {
    mockData.countEventAudit.mockResolvedValue(9100);

    const app = buildApp();
    const res = await request(app).get('/api/v1/events/export?async=true&search=patient-42');

    expect(res.status).toBe(202);
    expect(mockData.countEventAudit).toHaveBeenCalledWith(
      145,
      expect.objectContaining({ search: 'patient-42' })
    );
    expect(mockJobsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      status: 'QUEUED',
      format: 'csv',
      totalRecords: 9100,
    });
    expect(res.body.statusPath).toContain('/api/v1/events/export/jobs/');
  });

  it('streams CSV exports directly for smaller result sets', async () => {
    mockData.countEventAudit.mockResolvedValue(1);
    mockData.streamEventAuditForExport.mockImplementation(async (_orgId, filters, onEvent) => {
      expect(filters).toMatchObject({ search: 'evt-1' });
      await onEvent({
        eventId: 'evt-1',
        receivedAt: '2026-03-27T06:05:00.000Z',
        source: 'mysql',
        sourceId: 'src-7',
        eventType: 'APPOINTMENT_CREATED',
        orgId: 145,
        status: 'DELIVERED',
        skipCategory: '',
        skipReason: '',
        deliveryStatus: {
          integrationsMatched: 2,
          deliveredCount: 2,
          failedCount: 0,
        },
        processingTimeMs: 81,
        payloadHash: 'abc123',
        payloadSize: 512,
      });
    });

    const app = buildApp();
    const res = await request(app).get('/api/v1/events/export?search=evt-1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Event ID,Received At,Source,Source ID');
    expect(res.text).toContain('evt-1');
    expect(res.text).toContain('APPOINTMENT_CREATED');
  });
});
