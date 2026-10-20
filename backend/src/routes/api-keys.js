const express = require('express');
const crypto = require('crypto');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { requirePermission } = require('../middleware/permission');
const { ValidationError, NotFoundError } = require('../utils/errors');
const mongodb = require('../mongodb');
const { auditApiKey } = require('../middleware/audit');
const { log } = require('../logger');

const router = express.Router();

router.use(auth);

const KEY_PREFIX = 'mdcs_pat_';
const MAX_NAME_LENGTH = 100;

function generateKey() {
  const raw = KEY_PREFIX + crypto.randomBytes(24).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  // Shown in the list UI to help identify a key without ever re-exposing the
  // full value — e.g. "mdcs_pat_ab12cd34…". Same idea as GitHub/OpenAI PATs.
  const displayPrefix = raw.slice(0, KEY_PREFIX.length + 8);
  return { raw, hash, displayPrefix };
}

function sanitizeKey(doc) {
  return {
    id: doc._id.toString(),
    name: doc.name,
    prefix: doc.displayPrefix,
    role: doc.role,
    orgId: doc.orgId,
    createdBy: doc.createdByEmail,
    createdAt: doc.createdAt,
    lastUsedAt: doc.lastUsedAt || null,
    revokedAt: doc.revokedAt || null,
  };
}

/**
 * GET /api/v1/api-keys
 * List API keys for the caller's org (never returns the hash or raw key).
 */
router.get(
  '/',
  requirePermission('api_keys:view'),
  asyncHandler(async (req, res) => {
    const db = mongodb.getDb();
    const query = req.user.role === 'SUPER_ADMIN' && !req.orgId ? {} : { orgId: req.orgId };
    const keys = await db.collection('api_keys').find(query).sort({ createdAt: -1 }).toArray();
    res.json({ data: keys.map(sanitizeKey) });
  })
);

/**
 * POST /api/v1/api-keys
 * Create a personal access token. The raw key is returned ONLY in this
 * response — it is never retrievable again, matching GitHub/OpenAI PAT UX.
 * The key authenticates as the creating user (same role + org), not as a
 * separate, independently-scoped principal.
 *
 * `scope: "integrations"` creates a least-privilege key instead: role API_KEY
 * (run integrations, health), always bound to one org. Give these to systems
 * that only call integrations, rather than the shared system key.
 */
router.post(
  '/',
  requirePermission('api_keys:create'),
  asyncHandler(async (req, res) => {
    const { name, scope } = req.body || {};

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name is required');
    }
    if (name.length > MAX_NAME_LENGTH) {
      throw new ValidationError(`name must be ${MAX_NAME_LENGTH} characters or fewer`);
    }
    if (!req.orgId && req.user.role !== 'SUPER_ADMIN') {
      throw new ValidationError('orgId is required');
    }
    if (scope !== undefined && scope !== 'user' && scope !== 'integrations') {
      throw new ValidationError('scope must be "user" or "integrations"');
    }
    const integrationsOnly = scope === 'integrations';
    if (integrationsOnly && !req.orgId) {
      throw new ValidationError('An integration key must belong to an organization: pass orgId');
    }

    const { raw, hash, displayPrefix } = generateKey();

    const doc = {
      name: name.trim(),
      keyHash: hash,
      displayPrefix,
      role: integrationsOnly ? 'API_KEY' : req.user.role,
      orgId: req.orgId || null,
      createdBy: req.user.id,
      createdByEmail: req.user.email || null,
      createdAt: new Date(),
      lastUsedAt: null,
      revokedAt: null,
    };

    const db = mongodb.getDb();
    const result = await db.collection('api_keys').insertOne(doc);
    doc._id = result.insertedId;

    await auditApiKey.created(req, doc);

    log('info', 'API key created', {
      userId: req.user.id,
      orgId: req.orgId,
      keyId: doc._id.toString(),
    });

    res.status(201).json({
      ...sanitizeKey(doc),
      key: raw,
    });
  })
);

/**
 * DELETE /api/v1/api-keys/:id
 * Revoke a key. Soft-delete (sets revokedAt) so revoked keys still show up
 * in the list for audit purposes, they just stop authenticating.
 */
router.delete(
  '/:id',
  requirePermission('api_keys:revoke'),
  asyncHandler(async (req, res) => {
    const { toObjectId } = mongodb;
    const db = mongodb.getDb();
    const query = { _id: toObjectId(req.params.id) };
    if (!(req.user.role === 'SUPER_ADMIN' && !req.orgId)) {
      query.orgId = req.orgId;
    }

    const existing = await db.collection('api_keys').findOne(query);
    if (!existing) {
      throw new NotFoundError('API key not found');
    }
    if (existing.revokedAt) {
      return res.json({ message: 'API key already revoked' });
    }

    await db.collection('api_keys').updateOne({ _id: existing._id }, { $set: { revokedAt: new Date() } });

    await auditApiKey.deleted(req, existing);

    log('info', 'API key revoked', {
      userId: req.user.id,
      keyId: existing._id.toString(),
    });

    res.json({ message: 'API key revoked' });
  })
);

/**
 * DELETE /api/v1/api-keys/:id/permanent
 * Permanently remove a key record. Only allowed once a key has been revoked,
 * so there's always an audit trail of the revocation before it disappears.
 */
router.delete(
  '/:id/permanent',
  requirePermission('api_keys:revoke'),
  asyncHandler(async (req, res) => {
    const { toObjectId } = mongodb;
    const db = mongodb.getDb();
    const query = { _id: toObjectId(req.params.id) };
    if (!(req.user.role === 'SUPER_ADMIN' && !req.orgId)) {
      query.orgId = req.orgId;
    }

    const existing = await db.collection('api_keys').findOne(query);
    if (!existing) {
      throw new NotFoundError('API key not found');
    }
    if (!existing.revokedAt) {
      throw new ValidationError('Revoke the key before deleting it permanently');
    }

    await db.collection('api_keys').deleteOne({ _id: existing._id });

    await auditApiKey.purged(req, existing);

    log('info', 'API key permanently deleted', {
      userId: req.user.id,
      keyId: existing._id.toString(),
    });

    res.json({ message: 'API key permanently deleted' });
  })
);

module.exports = router;
