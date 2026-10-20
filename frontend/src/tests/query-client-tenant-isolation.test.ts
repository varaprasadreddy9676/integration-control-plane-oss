import { afterEach, describe, expect, it, vi } from 'vitest';
import { setCurrentOrgId } from '../services/api';
import { createAppQueryClient } from '../app/query-client';

describe('application query cache tenant isolation', () => {
  afterEach(() => {
    setCurrentOrgId(null);
    localStorage.removeItem('integration_gateway_user');
  });

  it('does not reuse an org-scoped response after the active organization changes', async () => {
    const queryClient = createAppQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    const loadOrg84 = vi.fn(async () => 'org-84');

    setCurrentOrgId(33);
    await queryClient.fetchQuery({ queryKey: ['integrations'], queryFn: async () => 'org-33' });

    setCurrentOrgId(84);
    const org84 = await queryClient.fetchQuery({
      queryKey: ['integrations'],
      queryFn: loadOrg84,
    });

    expect(org84).toBe('org-84');
    expect(loadOrg84).toHaveBeenCalledTimes(1);

    setCurrentOrgId(33);
    expect(queryClient.getQueryData(['integrations'])).toBe('org-33');
  });

  it('keeps a late response from the previous organization out of the current cache', async () => {
    const queryClient = createAppQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    let resolveOrg33: ((value: string) => void) | undefined;

    setCurrentOrgId(33);
    const org33Request = queryClient.fetchQuery({
      queryKey: ['logs'],
      queryFn: () =>
        new Promise<string>((resolve) => {
          resolveOrg33 = resolve;
        }),
    });

    setCurrentOrgId(84);
    await queryClient.fetchQuery({ queryKey: ['logs'], queryFn: async () => 'org-84' });

    resolveOrg33?.('org-33-late');
    await org33Request;

    expect(queryClient.getQueryData(['logs'])).toBe('org-84');
  });

  it('does not share cached data between users in the same organization', async () => {
    const queryClient = createAppQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    setCurrentOrgId(33);
    localStorage.setItem('integration_gateway_user', JSON.stringify({ id: 'admin-a', role: 'ORG_ADMIN', orgId: 33 }));
    await queryClient.fetchQuery({ queryKey: ['settings'], queryFn: async () => 'admin-a-settings' });

    localStorage.setItem('integration_gateway_user', JSON.stringify({ id: 'admin-b', role: 'ORG_ADMIN', orgId: 33 }));
    const adminBSettings = await queryClient.fetchQuery({
      queryKey: ['settings'],
      queryFn: async () => 'admin-b-settings',
    });

    expect(adminBSettings).toBe('admin-b-settings');
  });
});

describe('invalidation still works alongside the tenant-aware hash', () => {
  it('refetches a list after invalidateQueries, which every mutation relies on', async () => {
    // queryKeyHashFn changes how entries are *stored*. Invalidation matches on
    // the key array rather than the hash, so it should still work — but if it
    // ever stopped, every "save then see the updated list" flow would silently
    // show stale data, which is worse than a visible error.
    const queryClient = createAppQueryClient({ staleTime: Number.POSITIVE_INFINITY });
    setCurrentOrgId(33);

    let value = 'first';
    const queryFn = vi.fn(async () => value);

    await queryClient.fetchQuery({ queryKey: ['integrations'], queryFn });
    expect(queryClient.getQueryData(['integrations'])).toBe('first');

    value = 'second';
    await queryClient.invalidateQueries({ queryKey: ['integrations'] });
    await queryClient.fetchQuery({ queryKey: ['integrations'], queryFn });

    expect(queryClient.getQueryData(['integrations'])).toBe('second');
    expect(queryFn).toHaveBeenCalledTimes(2);
  });

  it('invalidating one org does not wipe another org cached entry', async () => {
    const queryClient = createAppQueryClient({ staleTime: Number.POSITIVE_INFINITY });

    setCurrentOrgId(33);
    await queryClient.fetchQuery({ queryKey: ['templates'], queryFn: async () => 'org-33' });
    setCurrentOrgId(84);
    await queryClient.fetchQuery({ queryKey: ['templates'], queryFn: async () => 'org-84' });

    await queryClient.invalidateQueries({ queryKey: ['templates'] });

    // Both are invalidated (same key array) but neither is discarded, so
    // switching back still renders immediately from cache while refetching.
    setCurrentOrgId(33);
    expect(queryClient.getQueryData(['templates'])).toBe('org-33');
    setCurrentOrgId(84);
    expect(queryClient.getQueryData(['templates'])).toBe('org-84');
  });
});
