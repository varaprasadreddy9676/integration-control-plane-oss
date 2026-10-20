'use strict';

/**
 * The event catalogue must act on the org the request is scoped to (req.orgId,
 * already tenant-checked by the auth middleware), not on req.user.orgId. A
 * SUPER_ADMIN has no org of their own, so reading req.user.orgId refused every
 * write with ORG_REQUIRED and listed only global templates — a fresh install
 * could not create its first event type.
 */

const express = require('express');
const request = require('supertest');

const mockCollection = {
  updateOne: jest.fn(async () => ({ upsertedCount: 1 })),
  find: jest.fn(() => ({ toArray: async () => [] })),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({ collection: () => mockCollection })),
  isConnected: jest.fn(() => true),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/middleware/permission', () => ({ requirePermission: () => (_req, _res, next) => next() }));
jest.mock('../../src/services/field-schema', () => ({
  getFieldSchema: jest.fn(),
  getAllFieldSchemas: jest.fn(),
  getAllEventTypes: jest.fn(async () => []),
  getEventType: jest.fn(async () => null),
  invalidateCache: jest.fn(),
}));

const fieldSchema = require('../../src/services/field-schema');
const router = require('../../src/routes/field-schemas');

function appAs(user, orgId) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = user;
    if (orgId) req.orgId = orgId;
    next();
  });
  app.use('/field-schemas', router);
  return app;
}

const superAdmin = { role: 'SUPER_ADMIN', orgId: null };
const newEventType = { eventType: 'ORDER_PLACED', fields: [{ path: 'orderId', type: 'string' }] };

describe('event catalogue org context', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the selected org’s event types for a super admin', async () => {
    await request(appAs(superAdmin, 7)).get('/field-schemas/event-types').expect(200);
    expect(fieldSchema.getAllEventTypes).toHaveBeenCalledWith({ activeOnly: true }, 7);
  });

  it('lets a super admin create an event type in the selected org', async () => {
    const res = await request(appAs(superAdmin, 7)).post('/field-schemas/event-types').send(newEventType).expect(200);
    expect(res.body.orgId).toBe(7);
    expect(mockCollection.updateOne.mock.calls[0][0]).toEqual({ eventType: 'ORDER_PLACED', orgId: 7 });
  });

  it('lets a super admin import templates into the selected org', async () => {
    await request(appAs(superAdmin, 7)).post('/field-schemas/event-types/import-templates').expect(200);
  });

  it('still requires an org when none is selected', async () => {
    const res = await request(appAs(superAdmin)).post('/field-schemas/event-types').send(newEventType).expect(403);
    expect(res.body.code).toBe('ORG_REQUIRED');
  });

  it('uses the org-bound caller’s org', async () => {
    await request(appAs({ role: 'ORG_ADMIN', orgId: 3 }, 3)).post('/field-schemas/event-types').send(newEventType).expect(200);
    expect(mockCollection.updateOne.mock.calls[0][0]).toEqual({ eventType: 'ORDER_PLACED', orgId: 3 });
  });
});
