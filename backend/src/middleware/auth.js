const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { log } = require('../logger');
const config = require('../config');
const { UnauthorizedError, ForbiddenError } = require('../utils/errors');
const { getOrgIdFromQuery } = require('../utils/org-context');
const mongodb = require('../mongodb');

const extractOrgIdFromQuery = (req) => {
  const orgId = getOrgIdFromQuery(req.query);
  const usedLegacyKey = !req.query.orgId && (req.query.entityParentRid || req.query.entityparentrid);
  if (usedLegacyKey) {
    log('warn', 'Deprecated query parameter used: entityParentRid. Use orgId instead.', {
      path: req.path,
      requestId: req.id,
    });
  }
  return orgId;
};

const applyOrgContext = (req, orgId) => {
  if (!orgId || !Number.isFinite(orgId) || orgId <= 0) {
    return;
  }
  req.orgId = orgId;
};

// Roles that work across organizations by design.
const CROSS_ORG_ROLES = new Set(['SUPER_ADMIN', 'ADMIN']);

/**
 * A caller bound to one org must not reach another by naming it in ?orgId=.
 * Many routes read req.query.orgId directly, so this is checked here, once,
 * for every authenticated request. Returns an error to pass to next(), or null.
 */
function foreignOrgError(req) {
  if (CROSS_ORG_ROLES.has(req.user?.role)) return null;
  const raw = req.query?.orgId;
  if (raw === undefined || raw === null || raw === '') return null;
  const requested = (Array.isArray(raw) ? raw : [raw]).filter((v) => v !== '');
  const foreign = requested.some((value) => Number(value) !== req.orgId);
  if (!foreign) return null;
  log('warn', 'Request named an org the caller does not belong to', {
    path: req.path,
    requestId: req.id,
    userId: req.user?.id,
    role: req.user?.role,
    callerOrgId: req.orgId || null,
    requestedOrgId: requested,
  });
  return new ForbiddenError('You do not have access to this organization');
}

// Whether a user account may still act. Deactivating a user must end their
// sessions and personal keys at once, not when the token happens to expire.
// Cached briefly so this is not a database read on every request.
const USER_STATUS_TTL_MS = 30 * 1000;
const userStatusCache = new Map();

async function isUserActive(userId) {
  const key = String(userId || '');
  const cached = userStatusCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.active;

  let active;
  try {
    const _id = mongodb.toObjectId(key);
    // Ids that are not user ids (e.g. the shared key) are not accounts to check.
    if (!_id) return true;
    const user = await mongodb.getDb().collection('users').findOne({ _id }, { projection: { isActive: 1 } });
    active = Boolean(user) && user.isActive !== false;
  } catch (err) {
    // If the database cannot be read, every other request fails too; do not
    // turn that into signing everyone out.
    log('warn', 'User status check failed; allowing request', { userId: key, error: err.message });
    return true;
  }
  userStatusCache.set(key, { active, expiresAt: Date.now() + USER_STATUS_TTL_MS });
  return active;
}

async function auth(req, res, next) {
  if ((req.query && Object.hasOwn(req.query, 'tenantId')) || (req.body && Object.hasOwn(req.body, 'tenantId'))) {
    return res.status(400).json({
      error: 'tenantId is not supported. Use orgId instead.',
      code: 'TENANT_ID_NOT_ALLOWED',
    });
  }

  const authHeader = req.header('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    const jwtSecret = config.security?.jwtSecret;

    if (!jwtSecret) {
      return next(new UnauthorizedError('JWT secret not configured'));
    }

    try {
      const payload = jwt.verify(token, jwtSecret);
      if (!payload.isPortalSession && !(await isUserActive(payload.sub))) {
        log('warn', 'Session refused for an inactive or deleted user', { path: req.path, requestId: req.id });
        return next(new UnauthorizedError('This account is disabled'));
      }
      req.authType = 'jwt';
      req.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        orgId: payload.orgId || null,
        impersonatedBy: payload.impersonatedBy || null,
        impersonated: !!payload.impersonated,
        isPortalSession: !!payload.isPortalSession,
      };

      // Attach portal scope claims so downstream routes can enforce them
      if (payload.isPortalSession && payload.type === 'portal_access') {
        req.portalScope = {
          profileId: payload.profileId || null,
          allowedIntegrationIds: Array.isArray(payload.allowedIntegrationIds) ? payload.allowedIntegrationIds : [],
          allowedTags: Array.isArray(payload.allowedTags) ? payload.allowedTags : [],
          allowedViews: Array.isArray(payload.allowedViews) ? payload.allowedViews : ['dashboard', 'logs'],
          tokenVersion: payload.tokenVersion ?? null,
        };
      }

      if (payload.orgId) {
        applyOrgContext(req, Number(payload.orgId));
      }

      // SUPER_ADMIN and ADMIN can optionally scope requests via orgId query param
      if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN') {
        const queryOrgId = extractOrgIdFromQuery(req);
        if (queryOrgId) {
          applyOrgContext(req, queryOrgId);
        }
      }

      return next(foreignOrgError(req) || undefined);
    } catch (err) {
      log('warn', 'Invalid JWT', {
        path: req.path,
        requestId: req.id,
        error: err.message,
      });
      return next(new UnauthorizedError('Invalid token'));
    }
  }

  const apiKey = req.header('x-api-key');
  if (!apiKey) {
    log('warn', 'Missing API key', {
      path: req.path,
      requestId: req.id,
      ip: req.ip || req.connection.remoteAddress,
    });
    return next(new UnauthorizedError('Missing API key'));
  }

  const validApiKey = config.security?.apiKey;
  if (validApiKey && apiKey === validApiKey) {
    req.authType = 'apiKey';
    req.user = { id: 'api-key', role: 'API_KEY' };

    // Extract orgId from query parameter and set it on the request object
    const orgId = extractOrgIdFromQuery(req);
    const allowedOrgIds = config.security?.apiKeyOrgIds;
    if (Array.isArray(allowedOrgIds) && !allowedOrgIds.includes(orgId)) {
      log('warn', 'Shared API key refused for an org outside API_KEY_ORG_IDS', {
        path: req.path,
        requestId: req.id,
        orgId: orgId || null,
        ip: req.ip || req.connection.remoteAddress,
      });
      return next(new ForbiddenError('This API key is not allowed for this organization'));
    }
    if (orgId) {
      applyOrgContext(req, orgId);
    }

    return next();
  }

  // Not the single shared system key — check whether it's a personal access
  // token (created via POST /api-keys). PATs authenticate as the user who
  // created them (same role + org), not as a separately-scoped principal.
  try {
    const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex');
    const db = mongodb.getDb();
    const record = await db.collection('api_keys').findOne({ keyHash, revokedAt: null });

    if (!record) {
      log('warn', 'Invalid API key', {
        path: req.path,
        requestId: req.id,
        ip: req.ip || req.connection.remoteAddress,
      });
      return next(new UnauthorizedError('Invalid API key'));
    }

    // A personal key acts as its owner, so it stops with the owner's account.
    // Integration-only keys (role API_KEY) are handed to partner systems and
    // keep working when the admin who issued them leaves.
    if (record.role !== 'API_KEY' && !(await isUserActive(record.createdBy))) {
      log('warn', 'Personal API key refused: owner is inactive or deleted', { path: req.path, requestId: req.id });
      return next(new UnauthorizedError('This account is disabled'));
    }

    req.authType = 'apiKey';
    req.user = {
      id: record.createdBy,
      email: record.createdByEmail,
      role: record.role,
      apiKeyId: record._id.toString(),
    };

    if (record.orgId) {
      applyOrgContext(req, Number(record.orgId));
    }
    if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN') {
      const queryOrgId = extractOrgIdFromQuery(req);
      if (queryOrgId) {
        applyOrgContext(req, queryOrgId);
      }
    }

    const orgError = foreignOrgError(req);
    if (orgError) return next(orgError);

    // Fire-and-forget — a slow/failed lastUsedAt write must never block or
    // fail the actual request.
    db.collection('api_keys')
      .updateOne({ _id: record._id }, { $set: { lastUsedAt: new Date() } })
      .catch((err) => log('warn', 'Failed to update API key lastUsedAt', { error: err.message }));

    return next();
  } catch (err) {
    log('error', 'API key lookup failed', { path: req.path, requestId: req.id, error: err.message });
    return next(new UnauthorizedError('Invalid API key'));
  }
}

auth.requireEntity = (req, _res, next) => {
  if (!req.orgId) {
    return next(new UnauthorizedError('Missing orgId query parameter'));
  }
  return next();
};

auth.requireRole = (roles) => (req, _res, next) => {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!req.user) {
    return next(new UnauthorizedError('Missing user context'));
  }
  if (!allowed.includes(req.user.role)) {
    return next(new ForbiddenError('Insufficient role'));
  }
  return next();
};

auth.clearUserStatusCache = () => userStatusCache.clear();

module.exports = auth;
