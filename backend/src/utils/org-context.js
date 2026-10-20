function parsePositiveInt(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function getOrgIdFromQuery(query = {}) {
  return parsePositiveInt(query.orgId);
}

function getOrgIdFromRequest(req = {}) {
  return parsePositiveInt(req.orgId) || getOrgIdFromQuery(req.query);
}

const CROSS_ORG_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

/**
 * The org a request acts on when it may also name one (e.g. in the body).
 * SUPER_ADMIN and ADMIN may target any org; everyone else only their own,
 * and naming a different one is refused rather than silently honoured.
 */
function resolveScopedOrgId(req, candidate) {
  const named = parsePositiveInt(candidate);
  const own = parsePositiveInt(req.orgId);
  if (CROSS_ORG_ROLES.has(req.user && req.user.role)) {
    const target = named || own;
    if (!target) {
      const { ValidationError } = require('./errors');
      throw new ValidationError('A valid orgId is required');
    }
    return target;
  }
  if (named && named !== own) {
    const { ForbiddenError } = require('./errors');
    throw new ForbiddenError('You do not have access to this organization');
  }
  if (!own) {
    const { ValidationError } = require('./errors');
    throw new ValidationError('A valid orgId is required');
  }
  return own;
}

module.exports = {
  parsePositiveInt,
  getOrgIdFromQuery,
  getOrgIdFromRequest,
  resolveScopedOrgId,
};
