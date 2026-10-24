'use strict';

/** The role guards both permission middlewares share. */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const guards = require('../../src/middleware/role-guards');
const permission = require('../../src/middleware/permission');
const featurePermission = require('../../src/middleware/feature-permission');

const run = (guard, user) => {
  const next = jest.fn();
  guard({ user, path: '/x' }, {}, next);
  return next.mock.calls[0][0];
};

describe('requireSuperAdmin and requireAdmin', () => {
  it('need a signed-in user', () => {
    expect(run(guards.requireAdmin, undefined)).toMatchObject({ statusCode: 401, message: 'Authentication required' });
    expect(run(guards.requireSuperAdmin, undefined)).toMatchObject({ statusCode: 401 });
  });

  it('let a super admin through both, an admin through one, and no one else', () => {
    expect(run(guards.requireSuperAdmin, { role: 'SUPER_ADMIN' })).toBeUndefined();
    expect(run(guards.requireAdmin, { role: 'SUPER_ADMIN' })).toBeUndefined();
    expect(run(guards.requireAdmin, { role: 'ADMIN' })).toBeUndefined();
    expect(run(guards.requireSuperAdmin, { role: 'ADMIN' })).toMatchObject({ statusCode: 403, message: 'Super Admin access required' });
    expect(run(guards.requireAdmin, { role: 'ORG_ADMIN' })).toMatchObject({ statusCode: 403, message: 'Admin access required' });
  });

  it('are the same guards whichever middleware a route imports them from', () => {
    expect(permission.requireAdmin).toBe(guards.requireAdmin);
    expect(featurePermission.requireAdmin).toBe(guards.requireAdmin);
    expect(permission.requireSuperAdmin).toBe(guards.requireSuperAdmin);
    expect(featurePermission.requireSuperAdmin).toBe(guards.requireSuperAdmin);
  });
});
