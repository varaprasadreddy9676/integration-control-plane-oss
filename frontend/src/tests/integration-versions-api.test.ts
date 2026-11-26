import { afterEach, describe, expect, it, vi } from 'vitest';
import { getIntegrationVersions } from '../services/api';

describe('getIntegrationVersions', () => {
  afterEach(() => vi.restoreAllMocks());

  it('unwraps the versions envelope returned by the backend', async () => {
    const versions = [{ id: 'integration-1', version: '1.0.0', isActive: true }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ versions, summary: { totalVersions: 1 }, pagination: { limit: 50 } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );

    await expect(getIntegrationVersions('Appointment Created')).resolves.toEqual(versions);
  });

  it('keeps compatibility with array-shaped responses', async () => {
    const versions = [{ id: 'integration-1', version: '1.0.0' }];
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(versions), { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await expect(getIntegrationVersions('Appointment Created')).resolves.toEqual(versions);
  });
});
