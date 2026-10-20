'use strict';

const { resolveScopedOrgId } = require('../../src/utils/org-context');

const req = (role, orgId, body = {}) => ({ user: { role }, orgId, body, query: {} });

describe('resolveScopedOrgId', () => {
  it('returns the caller\'s org when nothing else is named', () => {
    expect(resolveScopedOrgId(req('ORG_ADMIN', 84), undefined)).toBe(84);
  });
  it('accepts the caller\'s own org named in the body', () => {
    expect(resolveScopedOrgId(req('ORG_ADMIN', 84), '84')).toBe(84);
  });
  it('refuses another org for an org-bound caller', () => {
    expect(() => resolveScopedOrgId(req('ORG_ADMIN', 84), 33)).toThrow(/access/i);
  });
  it.each(['SUPER_ADMIN', 'ADMIN'])('lets %s target another org', (role) => {
    expect(resolveScopedOrgId(req(role, 1), 33)).toBe(33);
  });
  it('requires an org when none can be resolved', () => {
    expect(() => resolveScopedOrgId(req('SUPER_ADMIN', undefined), undefined)).toThrow(/orgId/);
  });
});
