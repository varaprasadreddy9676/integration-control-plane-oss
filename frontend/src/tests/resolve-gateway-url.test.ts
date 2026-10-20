import { describe, it, expect, vi } from 'vitest';

vi.mock('../services/api', () => ({ getApiBaseUrl: () => 'http://localhost:4000/api/v1' }));

import { resolveGatewayUrl } from '../utils/curl';

const PROD = 'https://gateway.example.com/integration-gateway-server/api/v1';
const VAL = 'https://staging.gateway.example.com/integration-gateway-server/api/v1';

describe('resolveGatewayUrl', () => {
  it('restores the proxy prefix the backend strips from the logged path', () => {
    expect(resolveGatewayUrl('/api/v1/integrations/partnerhub-link-records?orgId=33', PROD)).toBe(
      'https://gateway.example.com/integration-gateway-server/api/v1/integrations/partnerhub-link-records?orgId=33'
    );
  });

  it('uses the validation host on validation', () => {
    expect(resolveGatewayUrl('/api/v1/public/integrations/x?orgId=1', VAL)).toBe(
      'https://staging.gateway.example.com/integration-gateway-server/api/v1/public/integrations/x?orgId=1'
    );
  });

  it('leaves the path alone when the API base has no extra prefix', () => {
    expect(resolveGatewayUrl('/api/v1/integrations/x', 'http://localhost:4000/api/v1')).toBe(
      'http://localhost:4000/api/v1/integrations/x'
    );
  });

  it('passes absolute URLs through untouched', () => {
    expect(resolveGatewayUrl('https://example.com/a', PROD)).toBe('https://example.com/a');
  });
});
