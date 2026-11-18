/**
 * Role guards: the checks every permission middleware shares. permission.js and
 * feature-permission.js re-export these, so each route imports them from either.
 */

const { ForbiddenError, UnauthorizedError } = require('../utils/errors');
const { log } = require('../logger');

/** A guard that lets through only the given roles (after checking there is a user at all). */
const requireRole = (roles, logMessage, denied) => (req, _res, next) => {
  if (!req.user) return next(new UnauthorizedError('Authentication required'));
  if (!roles.includes(req.user.role)) {
    log('warn', logMessage, { userId: req.user.id, userRole: req.user.role, path: req.path });
    return next(new ForbiddenError(denied));
  }
  return next();
};

/** SUPER_ADMIN only. */
const requireSuperAdmin = requireRole(['SUPER_ADMIN'], 'Super Admin required', 'Super Admin access required');

/** SUPER_ADMIN or ADMIN. */
const requireAdmin = requireRole(['SUPER_ADMIN', 'ADMIN'], 'Admin required', 'Admin access required');

module.exports = { requireRole, requireSuperAdmin, requireAdmin };
