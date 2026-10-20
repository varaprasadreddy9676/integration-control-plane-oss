'use strict';

const express = require('express');
const request = require('supertest');

const mockData = {
  streamScheduledIntegrationsForExport: jest.fn(),
};

jest.mock('../../src/data', () => mockData);
jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const scheduledIntegrationsRouter = require('../../src/routes/scheduled-integrations');

const buildApp = () => {
  const app = express();
  app.use((req, _res, next) => {
    req.orgId = 33;
    next();
  });
  app.use('/api/v1/scheduled-integrations', scheduledIntegrationsRouter);
  return app;
};

describe('scheduled integrations export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockData.streamScheduledIntegrationsForExport.mockImplementation(async (_orgId, _filters, onRow) => {
      await onRow({
        id: 'scheduled-1',
        scheduledFor: '2026-10-01T08:00:00.000Z',
        integrationName: ' =Unsafe formula',
        eventType: 'APPOINTMENT_REMINDER',
        status: 'PENDING',
        targetUrl: 'https://destination.example/api',
        httpMethod: 'POST',
        originalEventId: 'event-1',
        deliveryLogId: null,
        errorMessage: null,
        recurringConfig: { occurrenceNumber: 2, maxOccurrences: 3 },
        createdAt: '2026-10-01T07:00:00.000Z',
        updatedAt: '2026-10-01T07:30:00.000Z',
      });
    });
  });

  it('streams the complete filtered result set from the server as safe CSV', async () => {
    const res = await request(buildApp()).get(
      '/api/v1/scheduled-integrations/export?status=PENDING&eventType=APPOINTMENT_REMINDER'
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('scheduled-deliveries-');
    expect(mockData.streamScheduledIntegrationsForExport).toHaveBeenCalledWith(
      33,
      expect.objectContaining({ status: 'PENDING', eventType: 'APPOINTMENT_REMINDER' }),
      expect.any(Function),
      expect.objectContaining({ shouldStop: expect.any(Function) })
    );
    expect(res.text).toContain('Schedule ID,Scheduled For,Integration Name,Event Type,Status');
    expect(res.text).toContain("' =Unsafe formula");
    expect(res.text).toContain('2 of 3');
  });
});
