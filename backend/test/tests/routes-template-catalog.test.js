'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/data', () => ({}));
jest.mock('../../src/data/templates', () => ({ getAllTemplates: jest.fn(async () => []) }));
jest.mock('../../src/middleware/audit', () => ({ auditTemplate: {} }));

const templatesRouter = require('../../src/routes/templates');

const app = () => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.orgId = 1;
    req.user = { id: 'u1', role: 'ORG_ADMIN' };
    next();
  });
  a.use('/templates', templatesRouter);
  return a;
};

describe('built-in template routes', () => {
  it('lists the catalog', async () => {
    const res = await request(app()).get('/templates/catalog');
    expect(res.status).toBe(200);
    expect(res.body.templates.map((t) => t.id)).toEqual(['slack-channel', 'stripe-webhooks', 'hubspot-contact']);
  });

  it('builds a create payload from inputs', async () => {
    const res = await request(app())
      .post('/templates/catalog/slack-channel/build')
      .send({ inputs: { eventType: 'ORDER_PLACED', webhookUrl: 'https://hooks.slack.com/services/T/B/X' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ direction: 'OUTBOUND', payload: { eventType: 'ORDER_PLACED', isActive: false } });
  });

  it('explains invalid input with a 400', async () => {
    const res = await request(app()).post('/templates/catalog/stripe-webhooks/build').send({ inputs: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Stripe signing secret is required');
  });
});
