import { describe, expect, it } from 'vitest';
import { getActiveNavigationKey } from '../app/navigation-state';

const groups = [
  { items: [{ key: '/dashboard' }, { key: '/logs' }, { key: '/scheduled' }, { key: '/scheduled-jobs' }] },
  { items: [{ key: '/admin/orgs' }, { key: '/admin/users' }] },
];

describe('getActiveNavigationKey', () => {
  it('matches nested routes using the most specific navigation key', () => {
    expect(getActiveNavigationKey('/admin/users/42', groups)).toBe('/admin/users');
    expect(getActiveNavigationKey('/scheduled-jobs/42', groups)).toBe('/scheduled-jobs');
  });

  it('does not select a route that only shares a string prefix', () => {
    expect(getActiveNavigationKey('/logs-archive', groups)).toBeUndefined();
  });
});
