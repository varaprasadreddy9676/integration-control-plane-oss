import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('integration save persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ id: 'integration-1', provider: 'Northwind LIS' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('includes editable routing and reliability fields when updating an integration', async () => {
    const { updateIntegration } = await import('../services/api');

    await updateIntegration('integration-1', {
      name: 'Lab order rule',
      eventType: 'LAB_ORDER_SENT_TO_EXTERNAL',
      targetUrl: 'https://example.com/orders',
      httpMethod: 'POST',
      scope: 'INCLUDE_CHILDREN',
      outgoingAuthType: 'NONE',
      isActive: true,
      timeoutMs: 15000,
      retryCount: 3,
      transformationMode: 'SCRIPT',
      provider: 'Northwind LIS',
      excludedOrgUnits: [1451, 1452],
      rateLimits: { enabled: true, maxRequests: 25, windowSeconds: 60 },
      customHeaders: { 'x-facility': 'north' },
      responseTransformation: { mode: 'SCRIPT', script: 'return response.body;' },
      updatedAt: new Date().toISOString(),
    } as any);

    const [, request] = (fetch as any).mock.calls[0];
    expect(JSON.parse(request.body)).toMatchObject({
      provider: 'Northwind LIS',
      excludedOrgUnits: [1451, 1452],
      rateLimits: { enabled: true, maxRequests: 25, windowSeconds: 60 },
      customHeaders: { 'x-facility': 'north' },
      responseTransformation: { mode: 'SCRIPT', script: 'return response.body;' },
    });
  });
});
