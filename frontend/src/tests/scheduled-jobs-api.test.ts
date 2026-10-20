import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('scheduled jobs API', () => {
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
          new Response(JSON.stringify({ message: 'Dry-run job execution triggered', dryRun: true }), {
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

  it('sends dry-run options when manually executing a scheduled job', async () => {
    const { executeScheduledJob } = await import('../services/api');

    const result = await executeScheduledJob('job-1', '1', {
      dryRun: true,
      reason: 'Preview changes',
    });

    expect(result).toEqual({ message: 'Dry-run job execution triggered', dryRun: true });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/scheduled-jobs/job-1/execute?orgId=1'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ dryRun: true, reason: 'Preview changes' }),
      })
    );
  });

  it('uses an explicit org without changing the application-wide request context', async () => {
    const { getCurrentOrgId, getIntegrations, setCurrentOrgId } = await import('../services/api');
    setCurrentOrgId(33);

    await getIntegrations(84);

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/outbound-integrations?orgId=84'), expect.any(Object));
    expect(getCurrentOrgId()).toBe(33);
  });
});
