'use strict';

const {
  SECRET_MASK,
  maskUrlSecrets,
  maskIntegrationSecrets,
  restoreMaskedSecrets,
  containsSecretMask,
  maskLogSecrets,
} = require('../../src/utils/integration-secrets');

describe('maskUrlSecrets', () => {
  it.each([
    ['https://hooks.slack.com/services/T00/B00/abcDEF123', `https://hooks.slack.com/services/T00/B00/${SECRET_MASK}`],
    ['https://discord.com/api/webhooks/123/tok-en_XYZ', `https://discord.com/api/webhooks/123/${SECRET_MASK}`],
    [
      'https://acme.webhook.office.com/webhookb2/g1@t1/IncomingWebhook/abc123/def-456',
      `https://acme.webhook.office.com/webhookb2/g1@t1/IncomingWebhook/${SECRET_MASK}/${SECRET_MASK}`,
    ],
    ['https://api.example.com/v1/orders?api_key=k1&page=2', `https://api.example.com/v1/orders?api_key=${SECRET_MASK}&page=2`],
    ['https://api.example.com/hook?token=t1&signature=s1', `https://api.example.com/hook?token=${SECRET_MASK}&signature=${SECRET_MASK}`],
    ['https://user:p%40ss@api.example.com/path', `https://user:${SECRET_MASK}@api.example.com/path`],
    ['mysql://reporter:hunter2@db.example.com:3306/sales', `mysql://reporter:${SECRET_MASK}@db.example.com:3306/sales`],
  ])('hides the secret part of %s', (url, masked) => {
    expect(maskUrlSecrets(url)).toBe(masked);
  });

  it.each([
    'https://httpbin.org/anything/orders',
    'https://api.example.com/v1/items?page=2&sort=asc',
    'https://api.example.com/{{orderId}}/status',
    'not a url',
    '',
  ])('leaves %p alone', (url) => {
    expect(maskUrlSecrets(url)).toBe(url);
  });
});

describe('URLs in integration documents', () => {
  const stored = {
    targetUrl: 'https://hooks.slack.com/services/T00/B00/abcDEF123',
    dataSource: { type: 'API', url: 'https://api.example.com/users?api_key=k1', connectionString: 'mysql://r:pw@db:3306/x' },
    actions: [{ targetUrl: 'https://api.example.com/hook?token=t1' }],
  };

  it('masks URL secrets wherever an integration keeps a URL', () => {
    const masked = maskIntegrationSecrets(stored);
    expect(JSON.stringify(masked)).not.toMatch(/abcDEF123|k1|:pw@|t1/);
    expect(masked.dataSource.url).toBe(`https://api.example.com/users?api_key=${SECRET_MASK}`);
  });

  it('puts the stored secret back when a masked URL is saved unchanged', () => {
    expect(restoreMaskedSecrets(maskIntegrationSecrets(stored), stored)).toEqual(stored);
  });

  it('keeps the stored secret when only another part of the URL changes', () => {
    const incoming = { targetUrl: `https://api.example.com/v2/users?api_key=${SECRET_MASK}&page=3` };
    const before = { targetUrl: 'https://api.example.com/users?api_key=k1' };
    expect(restoreMaskedSecrets(incoming, before).targetUrl).toBe('https://api.example.com/v2/users?api_key=k1&page=3');
  });

  it('accepts a brand new URL as typed', () => {
    const incoming = { targetUrl: 'https://hooks.slack.com/services/T9/B9/new' };
    expect(restoreMaskedSecrets(incoming, stored).targetUrl).toBe('https://hooks.slack.com/services/T9/B9/new');
  });

  it('flags a masked URL that has nothing stored behind it', () => {
    const restored = restoreMaskedSecrets({ targetUrl: `https://api.example.com/x?token=${SECRET_MASK}` }, {});
    expect(containsSecretMask(restored)).toBe(true);
  });
});

describe('header credentials', () => {
  const stored = {
    dataSource: { type: 'API', url: 'https://api.example.com/x', headers: { Authorization: 'ds-secret', Accept: 'json' } },
    authConfig: { headers: { 'X-Partner-Token': 'alias-secret' } },
  };

  it('masks credential headers outside the auth config, and auth config headers under the authConfig name', () => {
    const masked = maskIntegrationSecrets(stored);
    expect(masked.dataSource.headers).toEqual({ Authorization: SECRET_MASK, Accept: 'json' });
    expect(masked.authConfig.headers['X-Partner-Token']).toBe(SECRET_MASK);
  });

  it('puts the stored header values back on save', () => {
    expect(restoreMaskedSecrets(maskIntegrationSecrets(stored), stored)).toEqual(stored);
  });
});

describe('maskLogSecrets', () => {
  it('masks URL and request header credentials but leaves payloads alone', () => {
    const entry = {
      targetUrl: 'https://hooks.slack.com/services/T0/B0/slack-secret',
      requestHeaders: { Authorization: 'Bearer h1', 'X-Key': 'h2', 'Content-Type': 'application/json' },
      metadata: { httpRequest: { url: 'https://api.example.com/x?api_key=k9', headers: { 'x-api-key': 'h3' } } },
      requestPayload: { password: 'customer-data' },
    };
    const masked = maskLogSecrets(entry);
    expect(JSON.stringify(masked)).not.toMatch(/slack-secret|h1|h2|h3|k9/);
    expect(masked.requestHeaders['Content-Type']).toBe('application/json');
    expect(masked.requestPayload).toEqual({ password: 'customer-data' });
  });
});
