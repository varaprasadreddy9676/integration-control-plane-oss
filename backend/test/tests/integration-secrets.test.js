'use strict';

/**
 * Integration configs came back from the API with their secrets in clear text —
 * GET /integrations returned an SMTP password and PartnerHub token credentials
 * verbatim (seen live, 2026-09-25). Responses now carry a mask, and a save that
 * sends the mask back keeps the stored value.
 */

const {
  SECRET_MASK,
  maskIntegrationSecrets,
  restoreMaskedSecrets,
} = require('../../src/utils/integration-secrets');

const stored = () => ({
  _id: 'abc',
  name: 'Email Purchase',
  outgoingAuthType: 'CUSTOM',
  outgoingAuthConfig: {
    tokenEndpoint: 'https://api.example.com/token',
    tokenRequestBody: '{"username":"u","password":"p"}',
    tokenHeaderName: 'Authorization',
    tokenHeaderPrefix: 'Bearer',
    clientId: 'client-1',
    clientSecret: 'shh',
    _cachedToken: 'eyJ.cached',
    _tokenExpiresAt: '2026-01-01T00:00:00Z',
    headers: { 'X-Api-Key': 'k-123', 'X-Tenant': 'tenant-9' },
  },
  inboundAuthType: 'HMAC',
  inboundAuthConfig: { secret: 'hmac-1', secrets: ['hmac-1', 'hmac-0'], toleranceSeconds: 300 },
  customHeaders: { 'x-partner-id': '{{partnerId}}', Authorization: 'Bearer static' },
  actions: [
    {
      kind: 'COMMUNICATION',
      communicationConfig: {
        provider: 'SMTP',
        smtp: { host: 'smtp.example.com', port: 587, username: 'purchase@example.com', password: 'Republic', fromEmail: 'a@b.c' },
      },
    },
  ],
  requestTransformation: { mode: 'SCRIPT', script: 'return payload.token;' },
});

describe('maskIntegrationSecrets', () => {
  const masked = maskIntegrationSecrets(stored());

  it('masks every credential', () => {
    expect(masked.outgoingAuthConfig.tokenRequestBody).toBe(SECRET_MASK);
    expect(masked.outgoingAuthConfig.clientSecret).toBe(SECRET_MASK);
    expect(masked.outgoingAuthConfig._cachedToken).toBe(SECRET_MASK);
    expect(masked.outgoingAuthConfig.headers).toEqual({ 'X-Api-Key': SECRET_MASK, 'X-Tenant': SECRET_MASK });
    expect(masked.inboundAuthConfig.secret).toBe(SECRET_MASK);
    expect(masked.inboundAuthConfig.secrets).toEqual([SECRET_MASK, SECRET_MASK]);
    expect(masked.actions[0].communicationConfig.smtp.password).toBe(SECRET_MASK);
    expect(masked.customHeaders.Authorization).toBe(SECRET_MASK);
  });

  it('leaves the settings the edit forms need untouched', () => {
    expect(masked.outgoingAuthType).toBe('CUSTOM');
    expect(masked.outgoingAuthConfig.tokenEndpoint).toBe('https://api.example.com/token');
    expect(masked.outgoingAuthConfig.tokenHeaderName).toBe('Authorization');
    expect(masked.outgoingAuthConfig.clientId).toBe('client-1');
    expect(masked.outgoingAuthConfig._tokenExpiresAt).toBe('2026-01-01T00:00:00Z');
    expect(masked.inboundAuthConfig.toleranceSeconds).toBe(300);
    expect(masked.customHeaders['x-partner-id']).toBe('{{partnerId}}');
    expect(masked.actions[0].communicationConfig.smtp.username).toBe('purchase@example.com');
    expect(masked.requestTransformation.script).toBe('return payload.token;');
  });

  it('does not mask empty values, so the UI can still tell "not set"', () => {
    const out = maskIntegrationSecrets({ outgoingAuthConfig: { apiKey: '', token: null } });
    expect(out.outgoingAuthConfig).toEqual({ apiKey: '', token: null });
  });

  it('does not modify the stored document', () => {
    const doc = stored();
    maskIntegrationSecrets(doc);
    expect(doc.outgoingAuthConfig.clientSecret).toBe('shh');
  });

  it('keeps ObjectIds and Dates intact', () => {
    const { ObjectId } = require('mongodb');
    const id = new ObjectId();
    const when = new Date();
    const out = maskIntegrationSecrets({ _id: id, updatedAt: when });
    expect(out._id).toBe(id);
    expect(out.updatedAt).toBe(when);
  });
});

describe('restoreMaskedSecrets', () => {
  it('keeps the stored value wherever the mask comes back unchanged', () => {
    const incoming = maskIntegrationSecrets(stored());
    const restored = restoreMaskedSecrets(incoming, stored());
    expect(restored).toEqual(stored());
  });

  it('takes a newly typed value', () => {
    const incoming = maskIntegrationSecrets(stored());
    incoming.actions[0].communicationConfig.smtp.password = 'NewPassword!';
    expect(restoreMaskedSecrets(incoming, stored()).actions[0].communicationConfig.smtp.password).toBe('NewPassword!');
  });

  it('never saves the mask itself when there is nothing stored to restore', () => {
    const restored = restoreMaskedSecrets({ outgoingAuthConfig: { apiKey: SECRET_MASK } }, {});
    expect(restored.outgoingAuthConfig).not.toHaveProperty('apiKey');
  });

  it('passes bodies without masks through unchanged', () => {
    const body = { name: 'x', outgoingAuthConfig: { apiKey: 'real' } };
    expect(restoreMaskedSecrets(body, stored())).toEqual(body);
  });
});
