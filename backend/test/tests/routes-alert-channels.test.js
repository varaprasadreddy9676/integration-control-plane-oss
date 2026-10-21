'use strict';

const express = require('express');
const request = require('supertest');

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
const mockChannels = {
  AlertChannelError: class AlertChannelError extends Error {},
  listChannels: jest.fn(),
  createChannel: jest.fn(),
  updateChannel: jest.fn(),
  deleteChannel: jest.fn(),
};
jest.mock('../../src/data/alert-channels', () => mockChannels);
const mockTest = jest.fn();
jest.mock('../../src/services/notifications/alert-dispatcher', () => ({ testChannel: (...a) => mockTest(...a) }));
const mockAudit = { changed: jest.fn() };
jest.mock('../../src/middleware/audit', () => ({ auditAlertChannel: mockAudit }));

const router = require('../../src/routes/alert-channels');

const app = (user = { id: 'u1', role: 'ORG_ADMIN' }, orgId = 1) => {
  const a = express();
  a.use(express.json());
  a.use((req, _res, next) => {
    req.user = user;
    req.orgId = orgId;
    next();
  });
  a.use('/alert-channels', router);
  return a;
};

beforeEach(() => jest.clearAllMocks());

describe('alert channel routes', () => {
  it('lists the available plugins and alert types', async () => {
    const res = await request(app()).get('/alert-channels/plugins');
    expect(res.status).toBe(200);
    expect(res.body.plugins.map((p) => p.type)).toEqual(['slack', 'email', 'webhook', 'whatsapp']);
    expect(res.body.events.map((e) => e.type)).toContain('INTEGRATION_DELIVERY_FAILING');
  });

  it('creates a channel and records it in the audit log', async () => {
    mockChannels.createChannel.mockResolvedValue({ id: 'c1', type: 'slack', config: { webhookUrl: '********' } });
    const res = await request(app())
      .post('/alert-channels')
      .send({ type: 'slack', name: 'Ops', config: { webhookUrl: 'https://hooks.slack.com/services/T/B/X' } });
    expect(res.status).toBe(201);
    expect(mockChannels.createChannel).toHaveBeenCalledWith(1, expect.objectContaining({ type: 'slack' }));
    expect(mockAudit.changed).toHaveBeenCalledWith(expect.anything(), 'CREATED', 'c1', expect.anything());
  });

  it('returns the plugin’s validation message as a 400', async () => {
    mockChannels.createChannel.mockRejectedValue(new mockChannels.AlertChannelError('Slack webhook URL is required'));
    const res = await request(app()).post('/alert-channels').send({ type: 'slack', config: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Slack webhook URL is required');
  });

  it('only lets users who can edit the organization change channels', async () => {
    const viewer = app({ id: 'u2', role: 'VIEWER' });
    expect((await request(viewer).post('/alert-channels').send({ type: 'slack' })).status).toBe(403);
    expect((await request(viewer).delete('/alert-channels/c1')).status).toBe(403);
    expect(mockChannels.createChannel).not.toHaveBeenCalled();
  });

  it('sends a test alert and returns the outcome', async () => {
    mockTest.mockResolvedValue({ ok: false, error: 'invalid_token' });
    const res = await request(app()).post('/alert-channels/c1/test');
    expect(res.body).toEqual({ ok: false, error: 'invalid_token' });
    expect(mockTest).toHaveBeenCalledWith(1, 'c1');
  });

  it('404s for a channel in another organization', async () => {
    mockChannels.updateChannel.mockResolvedValue(null);
    expect((await request(app()).put('/alert-channels/c9').send({ name: 'x' })).status).toBe(404);
  });
});
