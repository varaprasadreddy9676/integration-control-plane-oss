import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { bulkDeleteIntegrations, deleteIntegration, revokeApiKey, setRemovalEffect } from '../services/api';

const respond = (body: unknown) =>
  vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

// Every delete plays the same removal effect, from one place, before callers
// refresh the list.
describe('removal effect', () => {
  const effect = vi.fn(async (_id: string) => undefined);

  beforeEach(() => setRemovalEffect(effect));
  afterEach(() => {
    setRemovalEffect(null);
    effect.mockClear();
    vi.restoreAllMocks();
  });

  it('plays on the removed record before the delete resolves', async () => {
    respond({ success: true });
    let resolved = false;
    effect.mockImplementationOnce(async () => {
      expect(resolved).toBe(false);
    });
    await deleteIntegration('abc').then(() => {
      resolved = true;
    });
    expect(effect).toHaveBeenCalledWith('abc');
  });

  it('skips rows a bulk delete failed to remove', async () => {
    respond({ deletedCount: 2, failedIds: ['b'] });
    await bulkDeleteIntegrations(['a', 'b', 'c']);
    expect(effect.mock.calls.map(([id]) => id)).toEqual(['a', 'c']);
  });

  it('does not play when the record stays listed (revoke)', async () => {
    respond({});
    await revokeApiKey('key-1');
    expect(effect).not.toHaveBeenCalled();
  });

  it('never fails the delete when the effect throws', async () => {
    respond({ success: true });
    effect.mockRejectedValueOnce(new Error('canvas unavailable'));
    await expect(deleteIntegration('abc')).resolves.toEqual({ success: true });
  });
});
