'use strict';

const mockAxios = jest.fn();
jest.mock('axios', () => mockAxios);
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
const mockSendEmail = jest.fn();
jest.mock('../../src/services/email-service', () => ({ sendEmail: (...args) => mockSendEmail(...args) }));
const mockAdapterSend = jest.fn();
jest.mock('../../src/services/communication/adapter-registry', () => ({ send: (...args) => mockAdapterSend(...args) }));
jest.mock('../../src/config', () => ({ security: { blockPrivateNetworks: true }, frontendUrl: 'https://console.example.com' }));

const plugins = require('../../src/services/notifications/plugins');
const { verifySignedRequest } = require('../../src/services/integration-signing');

const failing = {
  type: 'INTEGRATION_DELIVERY_FAILING',
  severity: 'critical',
  title: 'Integration deliveries failing: Orders to CRM has failed every delivery for 15 minutes',
  message: 'Request failed with status code 401',
  orgId: 1,
  orgName: 'Acme Retail',
  integration: { id: 'int-1', name: 'Orders to CRM' },
  occurredAt: '2026-10-21T10:00:00.000Z',
  link: 'https://console.example.com/logs?orgId=1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAxios.mockResolvedValue({ status: 200, data: 'ok' });
  mockSendEmail.mockResolvedValue({ success: true });
  mockAdapterSend.mockResolvedValue({ success: true });
});

describe('alert channel plugin registry', () => {
  it('lists every plugin with its settings and no code', () => {
    const list = plugins.listPlugins();
    expect(list.map((p) => p.type)).toEqual(['slack', 'email', 'webhook', 'whatsapp']);
    for (const plugin of list) {
      expect(plugin).toEqual(expect.objectContaining({ name: expect.any(String), fields: expect.any(Array) }));
      expect(plugin.send).toBeUndefined();
    }
  });

  it('validates settings from what the plugin declares', () => {
    expect(plugins.validateConfig('nope', {})).toEqual({ error: 'Unknown channel type: nope' });
    expect(plugins.validateConfig('slack', {})).toEqual({ error: 'Slack webhook URL is required' });
    expect(plugins.validateConfig('slack', { webhookUrl: 'https://evil.example/x' }).error).toMatch(/hooks.slack.com/);
    expect(plugins.validateConfig('email', { recipients: 'ops@example.com, not-an-email' }).error).toMatch(/not-an-email/);
    expect(plugins.validateConfig('email', { recipients: 'ops@example.com, oncall@example.com' })).toEqual({
      config: { recipients: ['ops@example.com', 'oncall@example.com'] },
    });
  });

  it('knows which settings are secrets', () => {
    expect(plugins.secretFields('webhook')).toEqual(['bearerToken', 'signingSecret']);
    expect(plugins.secretFields('slack')).toEqual(['webhookUrl']);
  });
});

describe('slack plugin', () => {
  it('posts a red message for failures and a green one for recovery', async () => {
    await plugins.getPlugin('slack').send(failing, { webhookUrl: 'https://hooks.slack.com/services/T/B/X' });
    const request = mockAxios.mock.calls[0][0];
    expect(request).toMatchObject({ method: 'POST', url: 'https://hooks.slack.com/services/T/B/X' });
    expect(request.data.attachments[0].color).toBe('#d92d20');
    expect(JSON.stringify(request.data)).toContain('Request failed with status code 401');

    await plugins.getPlugin('slack').send({ ...failing, type: 'INTEGRATION_DELIVERY_RECOVERED', severity: 'resolved' }, {
      webhookUrl: 'https://hooks.slack.com/services/T/B/X',
    });
    expect(mockAxios.mock.calls[1][0].data.attachments[0].color).toBe('#12b76a');
  });

  it('fails when Slack rejects the message', async () => {
    mockAxios.mockRejectedValue(Object.assign(new Error('Request failed with status code 404'), { response: { status: 404, data: 'no_service' } }));
    await expect(
      plugins.getPlugin('slack').send(failing, { webhookUrl: 'https://hooks.slack.com/services/T/B/X' })
    ).rejects.toThrow(/404/);
  });
});

describe('webhook plugin (external reporting API)', () => {
  it('posts the alert as JSON, signed so the receiver can verify it', async () => {
    await plugins.getPlugin('webhook').send(failing, {
      url: 'https://reports.example.com/alerts',
      bearerToken: 'tok-1',
      signingSecret: 'whsec_c2VjcmV0LXNpZ25pbmcta2V5LTEyMzQ1Njc4',
    });
    const request = mockAxios.mock.calls[0][0];
    expect(request.headers.Authorization).toBe('Bearer tok-1');
    expect(JSON.parse(request.data)).toMatchObject({ version: 1, type: 'INTEGRATION_DELIVERY_FAILING', orgId: 1 });
    const verified = verifySignedRequest(
      { secret: 'whsec_c2VjcmV0LXNpZ25pbmcta2V5LTEyMzQ1Njc4' },
      Object.fromEntries(Object.entries(request.headers).map(([k, v]) => [k.toLowerCase(), v])),
      request.data
    );
    expect(verified).toBe(true);
  });

  it('refuses private network addresses', async () => {
    await expect(plugins.getPlugin('webhook').send(failing, { url: 'http://127.0.0.1:8080/alerts' })).rejects.toThrow();
    expect(mockAxios).not.toHaveBeenCalled();
  });
});

describe('email plugin', () => {
  it('emails every recipient through the gateway mailer', async () => {
    await plugins.getPlugin('email').send(failing, { recipients: ['ops@example.com'] });
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({ to: ['ops@example.com'], subject: failing.title, html: expect.stringContaining('Orders to CRM') })
    );
  });

  it('fails when the mailer could not send', async () => {
    mockSendEmail.mockResolvedValue({ success: false, reason: 'Email service not configured' });
    await expect(plugins.getPlugin('email').send(failing, { recipients: ['ops@example.com'] })).rejects.toThrow(
      'Email service not configured'
    );
  });

  it('reports the mailer error when sending throws inside the mailer', async () => {
    mockSendEmail.mockResolvedValue({ success: false, error: 'connect ECONNREFUSED smtp.example.com:587' });
    await expect(plugins.getPlugin('email').send(failing, { recipients: ['ops@example.com'] })).rejects.toThrow('ECONNREFUSED');
  });

  it('escapes HTML from alert text', async () => {
    await plugins.getPlugin('email').send({ ...failing, message: '<script>x</script>' }, { recipients: ['ops@example.com'] });
    expect(mockSendEmail.mock.calls[0][0].html).not.toContain('<script>');
  });
});

describe('whatsapp plugin', () => {
  it('sends a template message to each recipient through the WhatsApp adapter', async () => {
    await plugins.getPlugin('whatsapp').send(failing, {
      phoneNumberId: '1234',
      accessToken: 'EAAG',
      recipients: ['+15550001111', '+15550002222'],
      templateName: 'integration_alert',
    });
    expect(mockAdapterSend).toHaveBeenCalledTimes(2);
    expect(mockAdapterSend).toHaveBeenCalledWith(
      'WHATSAPP',
      'META',
      expect.objectContaining({ to: '+15550001111', type: 'template', templateName: 'integration_alert' }),
      { phoneNumberId: '1234', accessToken: 'EAAG' }
    );
  });

  it('sends plain text when no template is set', async () => {
    await plugins.getPlugin('whatsapp').send(failing, { phoneNumberId: '1', accessToken: 'a', recipients: ['+15550001111'] });
    expect(mockAdapterSend.mock.calls[0][2]).toMatchObject({ type: 'text', text: expect.stringContaining('Orders to CRM') });
  });
});
