'use strict';

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { listCatalog, buildFromCatalog } = require('../../src/services/integration-templates/catalog');
const { applyTransform, validateScript } = require('../../src/services/transformer');

const OUTBOUND_REQUIRED = ['name', 'eventType', 'targetUrl', 'httpMethod', 'scope', 'outgoingAuthType', 'timeoutMs', 'retryCount'];

describe('built-in integration templates', () => {
  it('lists Slack, Stripe and HubSpot with the inputs each needs, and no build code', () => {
    const catalog = listCatalog();
    expect(catalog.map((t) => t.id)).toEqual(['slack-channel', 'stripe-webhooks', 'hubspot-contact']);
    for (const template of catalog) {
      expect(template).toEqual(
        expect.objectContaining({ name: expect.any(String), direction: expect.any(String), inputs: expect.any(Array) })
      );
      expect(template.build).toBeUndefined();
    }
  });

  it('rejects unknown templates and missing or malformed inputs with clear messages', () => {
    expect(() => buildFromCatalog('nope', {})).toThrow('Unknown template');
    expect(() => buildFromCatalog('slack-channel', { eventType: 'ORDER_PLACED' })).toThrow(/Slack webhook URL is required/);
    expect(() =>
      buildFromCatalog('slack-channel', { eventType: 'ORDER_PLACED', webhookUrl: 'https://evil.example/hook' })
    ).toThrow(/hooks.slack.com/);
  });

  describe('Slack', () => {
    const built = buildFromCatalog('slack-channel', {
      eventType: 'ORDER_PLACED',
      webhookUrl: 'https://hooks.slack.com/services/T000/B000/XXXX',
    });

    it('builds an outbound integration the create API accepts, inactive by default', () => {
      expect(built.direction).toBe('OUTBOUND');
      for (const field of OUTBOUND_REQUIRED) expect(built.payload[field]).toBeDefined();
      expect(built.payload.isActive).toBe(false);
      expect(validateScript(built.payload.transformation.script)).toBe(true);
    });

    it('turns an event into a Slack message', async () => {
      const message = await applyTransform(built.payload, { orderId: 'ORD-1', total: 49.9, items: [1, 2] }, { eventType: 'ORDER_PLACED' });
      expect(message.text).toContain('ORDER_PLACED');
      expect(JSON.stringify(message.blocks)).toContain('*orderId:* ORD-1');
    });
  });

  describe('HubSpot', () => {
    const built = buildFromCatalog('hubspot-contact', {
      eventType: 'CUSTOMER_CREATED',
      accessToken: 'pat-na1-abc',
      emailField: 'customer.email',
      firstNameField: 'customer.firstName',
    });

    it('upserts contacts by email with the private app token as a bearer token', () => {
      expect(built.payload.targetUrl).toBe('https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert');
      expect(built.payload.outgoingAuthType).toBe('BEARER');
      expect(built.payload.outgoingAuthConfig.token).toBe('pat-na1-abc');
    });

    it('maps the configured fields and skips events without an email', async () => {
      const body = await applyTransform(
        built.payload,
        { customer: { email: 'dana@example.com', firstName: 'Dana' } },
        { eventType: 'CUSTOMER_CREATED' }
      );
      expect(body).toEqual({
        inputs: [{ idProperty: 'email', id: 'dana@example.com', properties: { email: 'dana@example.com', firstname: 'Dana' } }],
      });
      expect(await applyTransform(built.payload, { customer: {} }, { eventType: 'CUSTOMER_CREATED' })).toBeNull();
    });

    it('keeps field paths as data, never as code', () => {
      const evil = buildFromCatalog('hubspot-contact', {
        eventType: 'X',
        accessToken: 'pat-na1-abc',
        emailField: "email'); process.exit(1); ('",
      });
      expect(validateScript(evil.payload.transformation.script)).toBe(true);
      expect(evil.payload.transformation.script).toContain(JSON.stringify("email'); process.exit(1); ('"));
    });
  });

  describe('Stripe', () => {
    const built = buildFromCatalog('stripe-webhooks', {
      signingSecret: 'whsec_abc',
      forwardUrl: 'https://api.example.com/stripe-events',
    });

    it('builds an inbound integration that verifies Stripe signatures and forwards events', () => {
      expect(built.direction).toBe('INBOUND');
      expect(built.payload).toEqual(
        expect.objectContaining({
          name: 'Stripe webhooks',
          type: 'stripe-events',
          targetUrl: 'https://api.example.com/stripe-events',
          inboundAuthType: 'HMAC',
          inboundAuthConfig: { scheme: 'STRIPE', secret: 'whsec_abc', toleranceSeconds: 300 },
          isActive: false,
        })
      );
    });

    it('requires a whsec_ signing secret', () => {
      expect(() => buildFromCatalog('stripe-webhooks', { signingSecret: 'sk_live_x', forwardUrl: 'https://a.example' })).toThrow(
        /whsec_/
      );
    });
  });

  it('activates on request', () => {
    const built = buildFromCatalog(
      'slack-channel',
      { eventType: 'ORDER_PLACED', webhookUrl: 'https://hooks.slack.com/services/T/B/X' },
      { activate: true }
    );
    expect(built.payload.isActive).toBe(true);
  });
});
