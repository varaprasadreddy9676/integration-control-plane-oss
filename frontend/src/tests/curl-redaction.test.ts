import { describe, expect, it, vi } from 'vitest';
import { generateCurlCommand, isCredentialField } from '../utils/curl';
import type { IntegrationConfig } from '../mocks/types';

const integration = {
  targetUrl: 'https://example.test/receive',
  httpMethod: 'POST',
  outgoingAuthType: 'API_KEY',
  outgoingAuthConfig: { headerName: 'X-Vendor-Auth', value: 'private-config-value' },
} as unknown as IntegrationConfig;

describe('cURL preview credential protection', () => {
  it('masks stored and custom authentication headers without hiding ordinary headers', () => {
    const result = generateCurlCommand(integration, {}, {
      authorization: 'Bearer private-auth-value',
      Cookie: 'private-cookie-value',
      'x-vendor-auth': 'private-custom-value',
      'X-API-Key': 'private-key-value',
      'Content-Type': 'application/json',
    });
    expect(result).not.toContain('private-');
    expect(result).toContain('[REDACTED]');
    expect(result).toContain('Content-Type: application/json');
  });

  it('does not leak prefixes of configured credentials', () => {
    expect(generateCurlCommand(integration, {})).not.toContain('private-');
    expect(generateCurlCommand({ ...integration, outgoingAuthType: 'BEARER' }, {})).not.toContain('private-');
  });

  it('writes the placeholder whole, not a truncated fragment of it', () => {
    // The redaction replaced a real value that used to be shown truncated; the
    // leftover substring() rendered the placeholder itself as "[REDACTE...".
    const apiKey = generateCurlCommand(integration, {});
    expect(apiKey).toContain('X-Vendor-Auth: [REDACTED]');
    expect(apiKey).not.toMatch(/\[REDACTE[^D]/);
    expect(apiKey).not.toContain('[REDACTED]...');

    const bearer = generateCurlCommand({ ...integration, outgoingAuthType: 'BEARER' }, {});
    expect(bearer).toContain('Authorization: Bearer [REDACTED]');
    expect(bearer).not.toContain('[REDACTED]...');
  });

  it('never embeds the frontend API key in inbound previews', () => {
    vi.stubEnv('VITE_API_KEY', 'private-build-value');
    try {
      const result = generateCurlCommand(integration, {}, undefined, {
        direction: 'INBOUND', request: { url: 'https://example.test/hooks', method: 'GET' },
      });
      expect(result).not.toContain('private-build-value');
      expect(result).toContain('X-API-Key: [REDACTED]');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('shows a placeholder, never a build-time key, even when credentials are revealed', () => {
    vi.stubEnv('VITE_API_KEY', 'private-build-value');
    try {
      const result = generateCurlCommand(integration, {}, undefined, {
        direction: 'INBOUND',
        request: { url: 'https://example.test/hooks', method: 'GET' },
        revealCredentials: true,
      });
      expect(result).not.toContain('private-build-value');
      expect(result).toContain('X-API-Key: YOUR_API_KEY');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('inbound cURL for the public endpoint', () => {
  const publicCall = { url: '/api/v1/public/integrations/customer-lookup?orgId=1', method: 'POST' };

  it('adds no auth header when the integration has no inbound auth', () => {
    const result = generateCurlCommand({ inboundAuthType: 'NONE' } as any, {}, undefined, {
      direction: 'INBOUND',
      request: publicCall,
    });
    expect(result).toContain('/api/v1/public/integrations/customer-lookup?orgId=1');
    expect(result).not.toContain('X-API-Key');
  });

  it("shows the integration's own API key header, masked, instead of the gateway key", () => {
    const result = generateCurlCommand(
      { inboundAuthType: 'API_KEY', inboundAuthConfig: { headerName: 'X-Lookup-Key', apiKey: 'private-inbound' } } as any,
      {},
      undefined,
      { direction: 'INBOUND', request: publicCall }
    );
    expect(result).toContain('X-Lookup-Key: [REDACTED]');
    expect(result).not.toContain('X-API-Key');
    expect(result).not.toContain('private-inbound');
  });

  it("shows the integration's real inbound key when an admin reveals credentials", () => {
    const result = generateCurlCommand(
      { inboundAuthType: 'API_KEY', inboundAuthConfig: { headerName: 'X-Lookup-Key', apiKey: 'real-inbound-key' } } as any,
      {},
      undefined,
      { direction: 'INBOUND', request: publicCall, revealCredentials: true }
    );
    expect(result).toContain('X-Lookup-Key: real-inbound-key');
  });

  it('uses Authorization for bearer auth', () => {
    const result = generateCurlCommand({ inboundAuthType: 'BEARER' } as any, {}, undefined, {
      direction: 'INBOUND',
      request: publicCall,
    });
    expect(result).toContain('Authorization: Bearer [REDACTED]');
  });
});

/**
 * The delivery-log detail view builds its own cURL strings rather than calling
 * generateCurlCommand, and that copy still printed Authorization and X-API-Key
 * verbatim from the logged headers long after utils/curl.ts was hardened —
 * on the exact screen support uses to triage a failed delivery. These lock the
 * shared predicate that both builders now use.
 */
describe('credential field detection (shared by both cURL builders)', () => {
  it('recognises the header names that carry secrets', () => {
    for (const name of [
      'Authorization',
      'authorization',
      'X-API-Key',
      'x_api_key',
      'apikey',
      'Cookie',
      'X-Auth-Token',
      'X-Signature',
      'client-secret',
      'password',
      'X-Vendor-Credential',
    ]) {
      expect(isCredentialField(name)).toBe(true);
    }
  });

  it('leaves ordinary headers alone so the command stays useful', () => {
    for (const name of ['Content-Type', 'Accept', 'X-Request-Id', 'X-Correlation-Id', 'User-Agent']) {
      expect(isCredentialField(name)).toBe(false);
    }
  });
});

describe('explicit credential reveal', () => {
  const headers = { Authorization: 'Bearer private-auth-value', 'Content-Type': 'application/json' };

  it('masks by default, so an accidental copy or screenshot leaks nothing', () => {
    const result = generateCurlCommand(integration, {}, headers);
    expect(result).toContain('Authorization: [REDACTED]');
    expect(result).not.toContain('private-auth-value');
  });

  it('emits a runnable command when a reveal is explicitly requested', () => {
    const result = generateCurlCommand(integration, {}, headers, { revealCredentials: true });
    expect(result).toContain('Authorization: Bearer private-auth-value');
    expect(result).not.toContain('[REDACTED]');
  });

  it('treats anything other than an explicit true as masked', () => {
    for (const opts of [{}, { revealCredentials: false }, { revealCredentials: undefined }] as any[]) {
      expect(generateCurlCommand(integration, {}, headers, opts)).toContain('[REDACTED]');
    }
  });

  it('still passes ordinary headers through untouched when revealing', () => {
    const result = generateCurlCommand(integration, {}, headers, { revealCredentials: true });
    expect(result).toContain('Content-Type: application/json');
  });
});

describe('reveal with headers the log returned masked', () => {
  const logged = { Authorization: '********', 'X-Key': '********', 'X-Partner-Token': '********', Accept: 'json' };

  it('fills each masked header from the revealed integration config', () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ outgoingAuthType: 'BEARER', outgoingAuthConfig: { token: 'real-bearer' } }, 'Authorization: Bearer real-bearer'],
      [{ outgoingAuthType: 'API_KEY', outgoingAuthConfig: { headerName: 'X-Key', apiKey: 'real-key' } }, 'X-Key: real-key'],
      [{ outgoingAuthType: 'BASIC', outgoingAuthConfig: { username: 'u', password: 'p' } }, `Authorization: Basic ${btoa('u:p')}`],
      [{ outgoingAuthType: 'CUSTOM_HEADERS', outgoingAuthConfig: { headers: { 'X-Partner-Token': 'real-custom' } } }, 'X-Partner-Token: real-custom'],
    ];
    for (const [config, expected] of cases) {
      const revealed = { targetUrl: 'https://example.test/receive?api_key=real-url-key', httpMethod: 'POST', ...config } as unknown as IntegrationConfig;
      const result = generateCurlCommand(revealed, {}, logged, { revealCredentials: true });
      expect(result).toContain(expected);
      expect(result).toContain('api_key=real-url-key');
    }
  });

  it('keeps them redacted without a reveal', () => {
    const revealed = { outgoingAuthType: 'BEARER', outgoingAuthConfig: { token: 'real-bearer' } } as unknown as IntegrationConfig;
    expect(generateCurlCommand(revealed, {}, logged)).not.toContain('real-bearer');
  });
});
