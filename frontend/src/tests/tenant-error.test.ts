import { describe, it, expect } from 'vitest';
import { classifyTenantError } from '../utils/tenant-error';

const withStatus = (statusCode: number) => Object.assign(new Error('x'), { statusCode });

// A missing or forbidden organization used to show "Connection lost", which
// sent people looking for an outage that did not exist.
describe('classifyTenantError', () => {
  it('reports an organization that does not exist', () => {
    expect(classifyTenantError(withStatus(404), 648, null)).toBe('org-missing');
  });

  it('reports when the signed-in user’s own organization is gone', () => {
    expect(classifyTenantError(withStatus(404), 648, 648)).toBe('own-org-missing');
  });

  it('reports an organization the user may not open', () => {
    expect(classifyTenantError(withStatus(403), 12, 7)).toBe('no-access');
  });

  it('treats everything else as the gateway being unreachable', () => {
    expect(classifyTenantError(new TypeError('Failed to fetch'), 1, 1)).toBe('offline');
    expect(classifyTenantError(withStatus(503), 1, 1)).toBe('offline');
  });
});
