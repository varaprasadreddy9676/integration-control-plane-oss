'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/db', () => ({ isConfigured: jest.fn(), query: jest.fn() }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/data', () => ({}));
jest.mock('../../src/mongodb', () => ({ getDbSafe: jest.fn() }));
jest.mock('../../src/data/event-sources', () => ({
  enqueuePushEvent: jest.fn(),
  getConfigForOrg: jest.fn(),
}));

const eventSourceData = require('../../src/data/event-sources');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 100 };
    req.orgId = 100;
    next();
  });
  app.use('/api/v1/events', require('../../src/routes/events'));
  app.use(require('../../src/middleware/error-handler'));
  return app;
}

describe('POST /api/v1/events/push', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventSourceData.enqueuePushEvent.mockResolvedValue(undefined);
  });

  it('queues the event and warns when the org has no active http_push source', async () => {
    // Without a source nothing drains the queue: the caller got a bare 202
    // and the event waited silently until someone configured one.
    eventSourceData.getConfigForOrg.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/v1/events/push')
      .send({ eventType: 'ORDER_PLACED', payload: { id: 1 } });

    expect(res.status).toBe(202);
    expect(eventSourceData.enqueuePushEvent).toHaveBeenCalledTimes(1);
    expect(res.body.warning).toMatch(/no active http_push event source/i);
  });

  it('does not warn when an http_push source is active', async () => {
    eventSourceData.getConfigForOrg.mockResolvedValue({ orgId: 100, type: 'http_push', isActive: true });

    const res = await request(buildApp())
      .post('/api/v1/events/push')
      .send({ eventType: 'ORDER_PLACED', payload: {} });

    expect(res.status).toBe(202);
    expect(res.body.warning).toBeUndefined();
  });
});
