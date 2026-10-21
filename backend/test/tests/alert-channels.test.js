'use strict';

const { ObjectId } = require('mongodb');

// In-memory alert_channels collection.
const mockDocs = [];
const mockMatches = (doc, filter) =>
  Object.entries(filter).every(([key, cond]) => {
    if (cond && typeof cond === 'object' && '$in' in cond) return [].concat(doc[key] || []).some((v) => cond.$in.includes(v));
    if (key === 'events') return (doc.events || []).includes(cond);
    return String(doc[key]) === String(cond);
  });
const mockCollection = {
  find: (filter) => ({ sort: () => ({ toArray: async () => mockDocs.filter((d) => mockMatches(d, filter)).map((d) => ({ ...d })) }), toArray: async () => mockDocs.filter((d) => mockMatches(d, filter)).map((d) => ({ ...d })) }),
  findOne: async (filter) => {
    const doc = mockDocs.find((d) => mockMatches(d, filter));
    return doc ? { ...doc } : null;
  },
  insertOne: async (doc) => {
    const stored = { _id: new ObjectId(), ...doc };
    mockDocs.push(stored);
    return { insertedId: stored._id };
  },
  updateOne: async (filter, update) => {
    const doc = mockDocs.find((d) => mockMatches(d, filter));
    if (!doc) return { matchedCount: 0 };
    Object.assign(doc, update.$set || {});
    return { matchedCount: 1 };
  },
  deleteOne: async (filter) => {
    const i = mockDocs.findIndex((d) => mockMatches(d, filter));
    if (i >= 0) mockDocs.splice(i, 1);
    return { deletedCount: i >= 0 ? 1 : 0 };
  },
};
jest.mock('../../src/mongodb', () => ({
  getDbSafe: async () => ({ collection: () => mockCollection }),
  toObjectId: (id) => {
    const { ObjectId: MockObjectId } = require('mongodb');
    return MockObjectId.isValid(String(id)) ? new MockObjectId(String(id)) : null;
  },
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
const mockSend = { slack: jest.fn(), webhook: jest.fn() };
jest.mock('../../src/services/notifications/plugins', () => {
  const actual = jest.requireActual('../../src/services/notifications/plugins');
  return {
    ...actual,
    getPlugin: (type) => (actual.getPlugin(type) ? { ...actual.getPlugin(type), send: (...args) => mockSend[type](...args) } : null),
  };
});

process.env.GATEWAY_SECRET_KEY = process.env.GATEWAY_SECRET_KEY || 'a'.repeat(64);
const channels = require('../../src/data/alert-channels');
const { dispatchAlert, testChannel, toChannelAlert } = require('../../src/services/notifications/alert-dispatcher');
const { SECRET_MASK } = require('../../src/utils/integration-secrets');

const SLACK_URL = 'https://hooks.slack.com/services/T/B/secret';
const failing = { type: 'INTEGRATION_DELIVERY_FAILING', severity: 'critical', title: 'Failing', orgId: 1 };

beforeEach(() => {
  mockDocs.length = 0;
  mockSend.slack.mockReset().mockResolvedValue(undefined);
  mockSend.webhook.mockReset().mockResolvedValue(undefined);
});

describe('alert channels', () => {
  it('stores secrets encrypted and never returns them', async () => {
    const created = await channels.createChannel(1, { type: 'slack', name: 'Ops', config: { webhookUrl: SLACK_URL } });
    expect(mockDocs[0].config.webhookUrl).toMatch(/^enc:v1:/);
    expect(created.config.webhookUrl).toBe(SECRET_MASK);
    expect(JSON.stringify(await channels.listChannels(1))).not.toContain('secret');
    expect(created.events).toEqual(['INTEGRATION_DELIVERY_FAILING', 'INTEGRATION_DELIVERY_RECOVERED']);
  });

  it('keeps the stored secret when the masked value comes back on update', async () => {
    const created = await channels.createChannel(1, { type: 'slack', name: 'Ops', config: { webhookUrl: SLACK_URL } });
    await channels.updateChannel(1, created.id, { name: 'Ops alerts', config: { webhookUrl: SECRET_MASK } });
    const [enabled] = await channels.listChannelsForEvent(1, 'INTEGRATION_DELIVERY_FAILING');
    expect(enabled.name).toBe('Ops alerts');
    expect(enabled.config.webhookUrl).toBe(SLACK_URL);
  });

  it('rejects invalid settings with the plugin’s message', async () => {
    await expect(channels.createChannel(1, { type: 'slack', name: 'x', config: { webhookUrl: 'https://x.example' } })).rejects.toThrow(
      /hooks.slack.com/
    );
    await expect(channels.createChannel(1, { type: 'fax', name: 'x', config: {} })).rejects.toThrow('Unknown channel type: fax');
  });

  it('keeps organizations apart', async () => {
    const created = await channels.createChannel(1, { type: 'slack', name: 'Ops', config: { webhookUrl: SLACK_URL } });
    expect(await channels.listChannels(2)).toEqual([]);
    expect(await channels.updateChannel(2, created.id, { name: 'hijack' })).toBeNull();
    expect(await channels.deleteChannel(2, created.id)).toBe(false);
  });
});

describe('dispatchAlert', () => {
  it('sends to every enabled channel subscribed to the event, and one failure does not stop the others', async () => {
    await channels.createChannel(1, { type: 'slack', name: 'Ops', config: { webhookUrl: SLACK_URL } });
    await channels.createChannel(1, { type: 'webhook', name: 'Reports', config: { url: 'https://reports.example.com/a' } });
    await channels.createChannel(1, {
      type: 'slack',
      name: 'Recoveries only',
      events: ['INTEGRATION_DELIVERY_RECOVERED'],
      config: { webhookUrl: SLACK_URL },
    });
    await channels.createChannel(1, { type: 'slack', name: 'Off', enabled: false, config: { webhookUrl: SLACK_URL } });
    mockSend.webhook.mockRejectedValue(new Error('503 from reports API'));

    const results = await dispatchAlert(1, failing);

    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ['Ops', true],
      ['Reports', false],
    ]);
    expect(mockSend.slack).toHaveBeenCalledWith(failing, { webhookUrl: SLACK_URL });
    const reports = mockDocs.find((d) => d.name === 'Reports');
    expect(reports.lastResult).toMatchObject({ ok: false, error: '503 from reports API' });
  });

  it('never throws, even if loading channels fails', async () => {
    await expect(dispatchAlert(1, { ...failing, type: undefined })).resolves.toEqual([]);
  });

  it('sends a test alert to one channel even while it is disabled', async () => {
    const created = await channels.createChannel(1, { type: 'slack', name: 'Off', enabled: false, config: { webhookUrl: SLACK_URL } });
    const result = await testChannel(1, created.id);
    expect(result).toMatchObject({ ok: true });
    expect(mockSend.slack.mock.calls[0][0]).toMatchObject({ type: 'TEST' });
  });
});

describe('toChannelAlert', () => {
  it('turns a delivery-failure watcher alert into the plugin alert format', () => {
    const at = new Date('2026-10-21T10:15:00Z');
    expect(
      toChannelAlert(
        1,
        {
          type: 'INTEGRATION_DELIVERY_FAILING',
          subject: 'Integration deliveries failing: Orders',
          errorMessage: '401',
          payload: { integrationId: 'int-1', integrationName: 'Orders' },
          windowEnd: at,
        },
        { orgName: 'Acme Retail', frontendUrl: 'https://console.example.com' }
      )
    ).toEqual({
      type: 'INTEGRATION_DELIVERY_FAILING',
      severity: 'critical',
      title: 'Integration deliveries failing: Orders',
      message: '401',
      orgId: 1,
      orgName: 'Acme Retail',
      integration: { id: 'int-1', name: 'Orders' },
      occurredAt: at.toISOString(),
      link: 'https://console.example.com/logs?orgId=1',
    });
  });

  it('marks recoveries as resolved and leaves out the link when no console URL is known', () => {
    const alert = toChannelAlert(1, { type: 'INTEGRATION_DELIVERY_RECOVERED', subject: 'Recovered', payload: {} }, {});
    expect(alert.severity).toBe('resolved');
    expect(alert.link).toBeUndefined();
  });
});
