'use strict';

const express = require('express');
const request = require('supertest');

const mockData = {
  listAlertCenterLogs: jest.fn(),
  getFailureReportSchedulerStatus: jest.fn(),
  countAlertCenterLogs: jest.fn(),
  streamAlertCenterLogsForExport: jest.fn(),
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
    if (name === 'alert_center_export_jobs') return mockJobsCollection;
    return {
      createIndex: jest.fn().mockResolvedValue(undefined),
      findOne: jest.fn().mockResolvedValue(null),
      insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
      findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
    };
  }),
};

jest.mock('../../src/data', () => mockData);

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.orgId = 145;
    next();
  });
  const router = require('../../src/routes/alert-center');
  app.use('/api/v1/alert-center', router);
  return app;
};

describe('Alert Center export routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.collection.mockClear();
    mockData.countAlertCenterLogs.mockReset();
    mockData.streamAlertCenterLogsForExport.mockReset();
    mockJobsCollection.createIndex.mockClear();
    mockJobsCollection.insertOne.mockClear();
    mockJobsCollection.findOne.mockReset();
    mockJobsCollection.findOne.mockResolvedValue(null);
    mockJobsCollection.findOneAndUpdate.mockReset();
    mockJobsCollection.findOneAndUpdate.mockResolvedValue({ value: null });
    mockJobsCollection.updateOne.mockClear();
  });

  it('queues large JSON exports as async jobs', async () => {
    mockData.countAlertCenterLogs.mockResolvedValue(6400);

    const app = buildApp();
    const res = await request(app).get('/api/v1/alert-center/export/json?async=true&search=delivery');

    expect(res.status).toBe(202);
    expect(mockData.countAlertCenterLogs).toHaveBeenCalledWith(
      145,
      expect.objectContaining({ search: 'delivery' })
    );
    expect(mockJobsCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(res.body).toMatchObject({
      status: 'QUEUED',
      format: 'json',
      totalRecords: 6400,
    });
    expect(res.body.statusPath).toContain('/api/v1/alert-center/export/jobs/');
    expect(res.body.downloadPath).toContain('/api/v1/alert-center/export/jobs/');
    expect(mockData.streamAlertCenterLogsForExport).not.toHaveBeenCalled();
  });

  it('streams CSV exports directly for smaller result sets', async () => {
    mockData.countAlertCenterLogs.mockResolvedValue(1);
    mockData.streamAlertCenterLogsForExport.mockImplementation(async (_orgId, filters, onRow) => {
      expect(filters).toMatchObject({ status: 'FAILED' });
      await onRow({
        id: 'alert-1',
        createdAt: '2026-03-27T06:00:00.000Z',
        status: 'FAILED',
        channel: 'EMAIL',
        type: 'FAILURE_REPORT',
        subject: 'Delivery failures',
        recipients: ['ops@example.com'],
        totalFailures: 3,
        windowStart: '2026-03-27T05:00:00.000Z',
        windowEnd: '2026-03-27T06:00:00.000Z',
        errorMessage: 'SMTP failure',
        errorStack: 'stack trace',
      });
    });

    const app = buildApp();
    const res = await request(app).get('/api/v1/alert-center/export/csv?status=FAILED');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain('Alert ID,Timestamp,Status,Channel,Type');
    expect(res.text).toContain('Delivery failures');
    expect(res.text).toContain('SMTP failure');
  });
});
