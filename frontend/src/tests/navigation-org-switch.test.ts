import { describe, expect, it } from 'vitest';
import { getOrgSwitchDestination, shouldConfirmOrgSwitch } from '../utils/navigation';

describe('organization switch navigation', () => {
  it.each([
    ['/integrations/507f1f77bcf86cd799439011', '/integrations'],
    ['/inbound-integrations/507f1f77bcf86cd799439011', '/integrations?tab=inbound'],
    ['/scheduled-jobs/507f1f77bcf86cd799439011', '/scheduled-jobs'],
    ['/lookups/507f1f77bcf86cd799439011', '/lookups'],
    ['/templates/507f1f77bcf86cd799439011', '/templates'],
    ['/logs/507f1f77bcf86cd799439011', '/logs'],
    ['/versions/integration-name', '/integrations'],
    ['/flow-builder/507f1f77bcf86cd799439011', '/flow-builder'],
  ])('moves %s to %s', (pathname, destination) => {
    expect(getOrgSwitchDestination(pathname)).toBe(destination);
  });

  it.each([
    '/dashboard',
    '/integrations',
    '/integrations/new',
    '/scheduled-jobs',
    '/lookups/stats',
    '/templates/new',
    '/logs',
    '/flow-builder/new',
  ])('keeps tenant-safe route %s in place', (pathname) => {
    expect(getOrgSwitchDestination(pathname)).toBeNull();
  });
});

describe('organization switch confirmation', () => {
  it('asks before leaving an organization that is open', () => {
    expect(shouldConfirmOrgSwitch(33)).toBe(true);
  });

  it('switches straight away when no organization is open yet', () => {
    expect(shouldConfirmOrgSwitch(null)).toBe(false);
    expect(shouldConfirmOrgSwitch(undefined)).toBe(false);
  });
});
