'use strict';

/**
 * Integration history: a snapshot of an integration's configuration each time
 * it is saved, so changes can be compared and an earlier configuration restored.
 *
 * Covers outbound, inbound and scheduled integrations (all live in
 * integration_configs). Snapshots hold credentials, so integration_revisions is
 * encrypted at rest like integration_configs (utils/secrets-at-rest).
 */

const mongodb = require('../mongodb');
const { log } = require('../logger');
const { diffConfigs, summarizePaths } = require('../utils/config-diff');
const { maskIntegrationSecrets } = require('../utils/integration-secrets');
const { currentActor } = require('../utils/request-context');

const COLLECTION = 'integration_revisions';
const DEFAULT_MAX_REVISIONS = 100;

// Fields that are not configuration: identity, tenancy, timestamps and state the
// runtime writes (circuit breaker, script dependency install). They are left out
// of snapshots, so they never show as changes and a restore never overwrites them.
const NON_CONFIG_FIELDS = new Set([
  '_id',
  'orgId',
  'orgUnitRid',
  'entityRid',
  'entityParentRid',
  'createdAt',
  'updatedAt',
  'circuitState',
  'consecutiveFailures',
  'lastSuccessAt',
  'lastFailureAt',
  'circuitOpenedAt',
  'lastCircuitError',
  'depsStatus',
  'depsInstallLog',
  'depsInstalledAt',
  'depsNodeVersion',
  'depsValidation',
]);
// Cached OAuth tokens stored inside the auth config by the token cache.
const TOKEN_CACHE_FIELDS = ['_cachedToken', '_tokenExpiresAt', '_tokenRefreshToken'];
// In snapshots (so history shows them) but never changed by a restore.
const NOT_RESTORED = new Set(['isActive', 'direction']);

function toSnapshot(doc) {
  const snapshot = {};
  for (const [key, value] of Object.entries(doc || {})) {
    if (!NON_CONFIG_FIELDS.has(key)) snapshot[key] = value;
  }
  if (snapshot.outgoingAuthConfig && typeof snapshot.outgoingAuthConfig === 'object') {
    snapshot.outgoingAuthConfig = { ...snapshot.outgoingAuthConfig };
    for (const key of TOKEN_CACHE_FIELDS) delete snapshot.outgoingAuthConfig[key];
  }
  return snapshot;
}

async function latestRevision(db, integrationId) {
  const [latest] = await db
    .collection(COLLECTION)
    .find({ integrationId })
    .sort({ revision: -1 })
    .limit(1)
    .toArray();
  return latest || null;
}

/** Insert the next revision, retrying if a concurrent save took the number. */
async function insertNext(db, integrationId, buildDoc) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const base = await latestRevision(db, integrationId);
    const doc = buildDoc(base);
    if (!doc) return base;
    try {
      await db.collection(COLLECTION).insertOne(doc);
      return doc;
    } catch (err) {
      if (err.code !== 11000 || attempt === 2) throw err;
    }
  }
  return null;
}

/**
 * Record the integration's current configuration as a new revision.
 * `previous` is the stored document before this save: when the integration has
 * no history yet, it becomes the baseline revision so the first tracked edit can
 * still be compared and undone.
 */
async function recordRevision({ integrationId, source, restoredFrom = null, previous = null, maxRevisions = DEFAULT_MAX_REVISIONS }) {
  const db = await mongodb.getDbSafe();
  const id = mongodb.toObjectId(integrationId);
  const current = await db.collection('integration_configs').findOne({ _id: id });
  if (!current) return null;

  const meta = (doc) => ({ integrationId: id, orgId: doc.orgId, direction: doc.direction, name: doc.name });

  if (previous && !(await latestRevision(db, id))) {
    await insertNext(db, id, (base) =>
      base
        ? null
        : {
            ...meta(previous),
            revision: 1,
            source: 'BASELINE',
            restoredFrom: null,
            changedBy: null,
            changedFields: [],
            snapshot: toSnapshot(previous),
            createdAt: previous.updatedAt || previous.createdAt || new Date(),
          }
    );
  }

  const snapshot = toSnapshot(current);
  const saved = await insertNext(db, id, (base) => {
    const changes = base ? diffConfigs(base.snapshot, snapshot) : [];
    if (base && changes.length === 0) return null; // nothing changed
    return {
      ...meta(current),
      revision: (base?.revision || 0) + 1,
      source,
      restoredFrom,
      changedBy: currentActor(),
      changedFields: summarizePaths(changes.map((c) => c.path)),
      snapshot,
      createdAt: new Date(),
    };
  });

  if (saved && saved.revision > maxRevisions) {
    await db.collection(COLLECTION).deleteMany({ integrationId: id, revision: { $lte: saved.revision - maxRevisions } });
  }
  return saved;
}

/** recordRevision for save paths: history must never make a save fail. */
async function captureRevision(args) {
  try {
    return await recordRevision(args);
  } catch (err) {
    log('warn', 'Could not record integration history', {
      integrationId: String(args.integrationId),
      error: err.message,
    });
    return null;
  }
}

async function listRevisions(orgId, integrationId, { limit = 50 } = {}) {
  const db = await mongodb.getDbSafe();
  return db
    .collection(COLLECTION)
    .find({ integrationId: mongodb.toObjectId(integrationId), orgId }, { projection: { snapshot: 0 } })
    .sort({ revision: -1 })
    .limit(Math.min(Number(limit) || 50, 200))
    .toArray();
}

/** The full revision, credentials included: callers must mask before returning it. */
async function getRevision(orgId, integrationId, revision) {
  const db = await mongodb.getDbSafe();
  return db
    .collection(COLLECTION)
    .findOne({ integrationId: mongodb.toObjectId(integrationId), orgId, revision: Number(revision) });
}

async function currentConfig(orgId, integrationId) {
  const db = await mongodb.getDbSafe();
  return db.collection('integration_configs').findOne({ _id: mongodb.toObjectId(integrationId), orgId });
}

/**
 * Changes from revision `revision` to `against` (another revision number, or
 * 'current' for the live configuration), with credential values masked.
 */
async function diffRevision(orgId, integrationId, revision, against = 'current') {
  const from = await getRevision(orgId, integrationId, revision);
  if (!from) return null;
  let toSnapshotValue;
  if (against === 'current') {
    const live = await currentConfig(orgId, integrationId);
    if (!live) return null;
    toSnapshotValue = toSnapshot(live);
  } else {
    const to = await getRevision(orgId, integrationId, against);
    if (!to) return null;
    toSnapshotValue = to.snapshot;
  }
  return {
    from: revision,
    to: against,
    changes: diffConfigs(from.snapshot, toSnapshotValue, { maskSecrets: true }),
    fromSnapshot: maskIntegrationSecrets(from.snapshot),
    toSnapshot: maskIntegrationSecrets(toSnapshotValue),
  };
}

/**
 * Put an earlier revision's configuration back. Activation, tenancy and runtime
 * state stay as they are. Returns { before, after, revision } or null if either
 * the integration or the revision does not exist in this organization.
 */
async function restoreRevision(orgId, integrationId, revision) {
  const target = await getRevision(orgId, integrationId, revision);
  const before = await currentConfig(orgId, integrationId);
  if (!target || !before) return null;

  const $set = { updatedAt: new Date() };
  const $unset = {};
  for (const [key, value] of Object.entries(target.snapshot)) {
    if (!NOT_RESTORED.has(key)) $set[key] = value;
  }
  for (const key of Object.keys(toSnapshot(before))) {
    if (!NOT_RESTORED.has(key) && !(key in target.snapshot)) $unset[key] = '';
  }

  const db = await mongodb.getDbSafe();
  const update = Object.keys($unset).length ? { $set, $unset } : { $set };
  await db.collection('integration_configs').updateOne({ _id: before._id, orgId }, update);

  const saved = await recordRevision({ integrationId, source: 'RESTORED', restoredFrom: Number(revision), previous: before });
  const after = await currentConfig(orgId, integrationId);
  return { before, after, revision: saved };
}

module.exports = {
  recordRevision,
  captureRevision,
  listRevisions,
  getRevision,
  diffRevision,
  restoreRevision,
  toSnapshot,
};
