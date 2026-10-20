'use strict';

const express = require('express');
const request = require('supertest');
const { ObjectId } = require('mongodb');

const mockCollection = {
  findOne: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue({
    collection: jest.fn(() => mockCollection),
  }),
}));

jest.mock('../../src/data', () => ({}));
jest.mock('../../src/config', () => ({ logging: {} }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn().mockResolvedValue({}),
  clearCachedToken: jest.fn(),
}));
jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(),
  hasResponseTransform: jest.fn(() => false),
  applyResponseTransform: jest.fn(),
  truncateForTrace: jest.fn((data) => data),
}));
jest.mock('../../src/services/communication/adapter-registry', () => ({}));
jest.mock('../../src/services/lookup-validator', () => ({
  validateLookupConfigs: jest.fn(),
}));
jest.mock('../../src/services/communication/sender-routing', () => ({
  isSenderRoutingEnabled: jest.fn(() => false),
  resolveSenderRoute: jest.fn(),
}));
jest.mock('../../src/services/request-policy', () => ({
  normalizeRateLimit: jest.fn((value) => value),
  normalizeRequestPolicy: jest.fn((value) => value),
  validateRequestPolicy: jest.fn(() => null),
  evaluateInboundRequestPolicy: jest.fn(),
}));
jest.mock('../../src/middleware/audit', () => ({
  auditIntegration: {
    created: jest.fn().mockResolvedValue(undefined),
    updated: jest.fn().mockResolvedValue(undefined),
    deleted: jest.fn().mockResolvedValue(undefined),
    credentialsRevealed: jest.fn().mockResolvedValue(undefined),
  },
}));

const { auditIntegration } = require('../../src/middleware/audit');
const inboundRouter = require('../../src/routes/integrations');

const ID = '64b7f0c2a1b2c3d4e5f60718';

const storedIntegration = {
  _id: new ObjectId(ID),
  orgId: 1,
  name: 'Order webhook',
  type: 'ORDER_CREATED',
  direction: 'INBOUND',
  targetUrl: 'https://example.com/orders',
  isActive: true,
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'user-1', role: 'ORG_ADMIN', orgId: 1 };
    req.orgId = 1;
    next();
  });
  app.use('/api/v1/inbound-integrations', inboundRouter);
  return app;
}

describe('Inbound integrations audit trail', () => {
  let app;

  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockCollection).forEach((fn) => fn.mockReset());
    app = buildApp();
  });

  describe('POST /', () => {
    it('records an audit entry for the created integration', async () => {
      const insertedId = new ObjectId();
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.insertOne.mockResolvedValue({ insertedId });

      const res = await request(app)
        .post('/api/v1/inbound-integrations')
        .send({ name: 'Order webhook', type: 'ORDER_CREATED', targetUrl: 'https://example.com/orders' });

      expect(res.status).toBe(201);
      expect(auditIntegration.created).toHaveBeenCalledTimes(1);
      const [, created] = auditIntegration.created.mock.calls[0];
      expect(created).toEqual(
        expect.objectContaining({ _id: insertedId, name: 'Order webhook', type: 'ORDER_CREATED', orgId: 1 })
      );
    });

    it('does not audit when the type already exists', async () => {
      mockCollection.findOne.mockResolvedValue(storedIntegration);

      const res = await request(app)
        .post('/api/v1/inbound-integrations')
        .send({ name: 'Order webhook', type: 'ORDER_CREATED', targetUrl: 'https://example.com/orders' });

      expect(res.status).toBe(409);
      expect(auditIntegration.created).not.toHaveBeenCalled();
    });
  });

  describe('PUT /:id', () => {
    it('records the before and after state', async () => {
      // First lookup loads the stored integration, second is the duplicate-type check.
      mockCollection.findOne.mockResolvedValueOnce(storedIntegration).mockResolvedValueOnce(null);
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 1 });

      const res = await request(app)
        .put(`/api/v1/inbound-integrations/${ID}`)
        .send({ name: 'Renamed webhook', type: 'ORDER_CREATED', targetUrl: 'https://example.com/orders' });

      expect(res.status).toBe(200);
      expect(auditIntegration.updated).toHaveBeenCalledTimes(1);
      const [, auditedId, changes] = auditIntegration.updated.mock.calls[0];
      expect(auditedId).toBe(ID);
      expect(changes.before).toBe(storedIntegration);
      expect(changes.after).toEqual(
        expect.objectContaining({ _id: storedIntegration._id, name: 'Renamed webhook', targetUrl: storedIntegration.targetUrl })
      );
    });

    it('does not audit when the integration is not found', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.updateOne.mockResolvedValue({ matchedCount: 0 });

      const res = await request(app)
        .put(`/api/v1/inbound-integrations/${ID}`)
        .send({ name: 'Renamed webhook', type: 'ORDER_CREATED', targetUrl: 'https://example.com/orders' });

      expect(res.status).toBe(404);
      expect(auditIntegration.updated).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /:id', () => {
    it('records the deleted integration as the before state', async () => {
      mockCollection.findOne.mockResolvedValue(storedIntegration);
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const res = await request(app).delete(`/api/v1/inbound-integrations/${ID}`);

      expect(res.status).toBe(200);
      expect(auditIntegration.deleted).toHaveBeenCalledWith(expect.anything(), ID, storedIntegration);
      // The before-state lookup is scoped exactly like the delete.
      expect(mockCollection.findOne.mock.calls[0][0]).toEqual(mockCollection.deleteOne.mock.calls[0][0]);
      expect(mockCollection.findOne.mock.calls[0][0]).toEqual(
        expect.objectContaining({ orgId: 1, direction: 'INBOUND' })
      );
    });

    it('does not audit when nothing was deleted', async () => {
      mockCollection.findOne.mockResolvedValue(null);
      mockCollection.deleteOne.mockResolvedValue({ deletedCount: 0 });

      const res = await request(app).delete(`/api/v1/inbound-integrations/${ID}`);

      expect(res.status).toBe(404);
      expect(auditIntegration.deleted).not.toHaveBeenCalled();
    });
  });
});
