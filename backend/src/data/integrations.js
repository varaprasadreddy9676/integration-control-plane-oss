'use strict';
const { log, logError } = require('../logger');
const mongodb = require('../mongodb');
const { generateSigningSecret } = require('../services/integration-signing');
const { normalizeRequestPolicy, normalizeRateLimit } = require('../services/request-policy');
const { normalizePreDeliveryChecks } = require('../services/pre-delivery-checks');
const { validateLifecycleConfig, buildLifecycleProfile, findLifecycleRule } = require('../services/lifecycle-config');
const {
  validateConditionConfig,
  buildConditionProfile,
  normalizeConditionConfig,
  normalizeDeliveryMode,
} = require('../services/condition-config');
const { normalizeOrgId, integrationOrgQuery, getCollection, mapIntegrationFromMongo } = require('./helpers');
const { captureRevision } = require('./integration-revisions');

const allowedParentsCache = {
  values: null,
  fetchedAt: 0,
};

async function getAllowedParentRids() {
  const config = require('../config');
  if (!config.worker?.allowedParentsFromIntegrations) {
    return null;
  }

  const now = Date.now();
  if (allowedParentsCache.values && now - allowedParentsCache.fetchedAt < 30000) {
    return allowedParentsCache.values;
  }

  const dbClient = await mongodb.getDbSafe();
  const orgParents = await dbClient.collection('integration_configs').distinct('orgId', { isActive: true });
  allowedParentsCache.values = [...new Set(orgParents.filter(Boolean))];
  allowedParentsCache.fetchedAt = now;
  return allowedParentsCache.values;
}

async function listIntegrations(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  const db = await mongodb.getDbSafe();
  const integrations = await db
    .collection('integration_configs')
    .find(integrationOrgQuery(normalizedOrgId))
    .sort({ updatedAt: -1 })
    .toArray();
  return integrations.map(mapIntegrationFromMongo);
}

/**
 * Lightweight integration list for dropdowns, filter UIs, and health checks.
 * Fetches only the fields needed for display — avoids shipping transformation
 * scripts, auth configs, signing secrets, and metadata on every list load.
 *
 * @param {number} orgId
 * @returns {Promise<Array<{id,name,eventType,direction,isActive,scope,provider,updatedAt}>>}
 */
async function listIntegrationsSummary(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  const db = await mongodb.getDbSafe();
  const docs = await db
    .collection('integration_configs')
    .find(integrationOrgQuery(normalizedOrgId), {
      projection: {
        _id: 1,
        name: 1,
        type: 1,
        eventType: 1,
        direction: 1,
        isActive: 1,
        scope: 1,
        targetUrl: 1,
        httpMethod: 1,
        provider: 1,
        isInherited: 1,
        sourceEntityName: 1,
        excludedOrgUnits: 1,
        updatedAt: 1,
      },
    })
    .sort({ updatedAt: -1 })
    .toArray();

  return docs.map((doc) => ({
    id: doc._id.toString(),
    name: doc.name,
    eventType: doc.type || doc.eventType,
    direction: doc.direction || 'OUTBOUND',
    isActive: !!doc.isActive,
    scope: doc.scope,
    targetUrl: doc.targetUrl || null,
    httpMethod: doc.httpMethod || 'POST',
    provider: doc.provider || null,
    isInherited: !!doc.isInherited,
    sourceEntityName: doc.sourceEntityName || null,
    excludedOrgUnits: doc.excludedOrgUnits || [],
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt).toISOString() : new Date().toISOString(),
  }));
}

function filterInheritedIntegrationsForEntity(integrations, normalizedOrgId) {
  return integrations.filter((integration) => {
    if (integration.scope === 'ENTITY_ONLY') {
      return false;
    }

    if (integration.excludedOrgUnits && integration.excludedOrgUnits.length > 0) {
      if (integration.excludedOrgUnits.includes(normalizedOrgId)) {
        log('debug', 'Integration excluded for this entity', {
          scope: 'listIntegrationsForDelivery:EXCLUDED',
          integrationId: integration.id,
          integrationName: integration.name,
          orgId: normalizedOrgId,
          excludedOrgUnits: integration.excludedOrgUnits,
        });
        return false;
      }
    }

    return true;
  });
}

async function listScopedIntegrations(orgId) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return [];

  log('debug', 'Starting integration matching', {
    scope: 'listIntegrationsForDelivery:START',
    orgId: normalizedOrgId,
  });

  const parentRid = await getParentRidForEntity(normalizedOrgId);
  log('debug', 'Got parent RID', {
    scope: 'listIntegrationsForDelivery:PARENT',
    orgId: normalizedOrgId,
    parentRid,
  });

  const direct = await listIntegrations(normalizedOrgId);
  log('debug', 'Fetched direct integrations', {
    scope: 'listIntegrationsForDelivery:DIRECT',
    orgId: normalizedOrgId,
    directCount: direct.length,
    directIntegrations: direct.map((w) => ({
      id: w.id,
      name: w.name,
      type: w.type,
      direction: w.direction,
      isActive: w.isActive,
    })),
  });

  if (parentRid && parentRid !== normalizedOrgId) {
    const parentHooks = await listIntegrations(parentRid);
    const inheritableParentHooks = filterInheritedIntegrationsForEntity(parentHooks, normalizedOrgId);
    const allHooks = [...inheritableParentHooks, ...direct];

    log('debug', 'Combined parent and direct hooks', {
      scope: 'listIntegrationsForDelivery:PARENT_HOOKS',
      parentHooksCount: parentHooks.length,
      allHooksCount: allHooks.length,
    });

    return allHooks;
  }

  return direct;
}

async function listIntegrationsForDelivery(orgId, eventType = null) {
  const direct = await listScopedIntegrations(orgId);

  if (eventType) {
    const filtered = direct.filter(
      (wh) =>
        wh.isActive &&
        (wh.direction === 'OUTBOUND' || !wh.direction) && // Include configs without direction for backward compatibility
        (wh.type === eventType || wh.type === '*')
    );
    log('debug', 'Filtered direct integrations by event type', {
      scope: 'listIntegrationsForDelivery:DIRECT_FILTERED',
      eventType,
      beforeFilter: direct.length,
      afterFilter: filtered.length,
      filtered: filtered.map((w) => ({
        id: w.id,
        name: w.name,
        type: w.type,
        direction: w.direction,
        isActive: w.isActive,
      })),
    });
    return filtered;
  }

  const active = direct.filter((wh) => wh.isActive && (wh.direction === 'OUTBOUND' || !wh.direction));
  log('debug', 'Filtered by active status and direction=OUTBOUND', {
    scope: 'listIntegrationsForDelivery:ACTIVE',
    beforeFilter: direct.length,
    afterFilter: active.length,
  });
  return active;
}

async function listIntegrationsForProcessing(orgId, eventType = null) {
  const scoped = await listScopedIntegrations(orgId);
  const active = scoped.filter(
    (integration) => integration.isActive && (integration.direction === 'OUTBOUND' || !integration.direction)
  );

  if (!eventType) {
    return active;
  }

  const directMatches = active.filter((integration) => integration.type === eventType || integration.type === '*');
  const directMatchIds = new Set(directMatches.map((integration) => integration.id));
  const rescheduleMatches = active.filter((integration) => {
    if (directMatchIds.has(integration.id)) {
      return false;
    }

    if (
      normalizeDeliveryMode(integration.deliveryMode) !== 'DELAYED' &&
      normalizeDeliveryMode(integration.deliveryMode) !== 'RECURRING'
    ) {
      return false;
    }

    const lifecycleRule = findLifecycleRule(integration.lifecycleRules, eventType);
    return lifecycleRule?.action === 'RESCHEDULE_PENDING';
  });

  const matches = [...directMatches, ...rescheduleMatches];

  log('debug', 'Resolved integrations for event processing', {
    scope: 'listIntegrationsForProcessing',
    orgId: normalizeOrgId(orgId),
    eventType,
    directMatchCount: directMatches.length,
    rescheduleMatchCount: rescheduleMatches.length,
    totalCount: matches.length,
  });

  return matches;
}

async function listInvalidationProfiles(orgId, eventType) {
  const scoped = await listScopedIntegrations(orgId);
  if (!eventType) return [];

  const profiles = scoped
    .filter((integration) => integration.isActive && (integration.direction === 'OUTBOUND' || !integration.direction))
    .map((integration) => buildLifecycleProfile(integration, eventType))
    .filter(Boolean);

  log('debug', 'Resolved invalidation profiles', {
    scope: 'listInvalidationProfiles',
    orgId: normalizeOrgId(orgId),
    eventType,
    profileCount: profiles.length,
  });

  return profiles;
}

async function listConditionProfiles(orgId, eventType) {
  const scoped = await listScopedIntegrations(orgId);
  if (!eventType) return [];

  const profiles = scoped
    .filter((integration) => integration.isActive && (integration.direction === 'OUTBOUND' || !integration.direction))
    .map((integration) => buildConditionProfile(integration, eventType))
    .filter(Boolean);

  log('debug', 'Resolved condition profiles', {
    scope: 'listConditionProfiles',
    orgId: normalizeOrgId(orgId),
    eventType,
    profileCount: profiles.length,
  });

  return profiles;
}

async function getParentRidForEntity(orgId) {
  try {
    const dbClient = await mongodb.getDbSafe();
    const org = await dbClient.collection('organizations').findOne({ orgId }, { projection: { orgId: 1 } });
    if (org?.orgId) return org.orgId;

    const unit = await dbClient.collection('org_units').findOne({ rid: orgId }, { projection: { orgId: 1 } });
    if (unit?.orgId) return unit.orgId;
  } catch (err) {
    logError(err, { scope: 'getParentRidForEntity', orgId });
  }
  return orgId;
}

async function getIntegration(id) {
  const db = await mongodb.getDbSafe();
  const objectId = mongodb.toObjectId(id);

  log('debug', 'getIntegration called', {
    originalId: id,
    originalIdType: typeof id,
    isObjectId: id instanceof mongodb.ObjectId,
    convertedObjectId: objectId ? objectId.toString() : null,
  });

  if (!objectId) {
    log('error', 'CRITICAL: Failed to convert integration ID to ObjectId', {
      id,
      idType: typeof id,
      idValue: String(id),
    });
    return undefined;
  }

  const integration = await db.collection('integration_configs').findOne({ _id: objectId });

  if (!integration) {
    log('warn', 'Integration not found in database', {
      searchedId: objectId.toString(),
      originalId: id,
    });
  }

  return integration ? mapIntegrationFromMongo(integration) : undefined;
}

async function addIntegration(orgId, payload) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  const now = new Date();
  const db = await mongodb.getDbSafe();

  // Handle versioning fields
  const {
    version = '1.0.0',
    versionNotes = 'Initial version',
    compatibilityMode = 'BACKWARD_COMPATIBLE',
    isDefault = false,
    autoIncrement = false,
    versionStrategy = 'SEMANTIC',
  } = payload.metadata || {};

  // Generate signing secret for integration security
  const signingSecret = generateSigningSecret();
  const lifecycleValidation = validateLifecycleConfig({
    resourceType: payload.resourceType,
    subjectExtraction: payload.subjectExtraction,
    subjectMapping: payload.subjectMapping,
    lifecycleRules: payload.lifecycleRules,
  });
  const conditionValidation = validateConditionConfig({
    deliveryMode: payload.deliveryMode,
    resourceType: payload.resourceType,
    subjectExtraction: payload.subjectExtraction,
    subjectMapping: payload.subjectMapping,
    conditionConfig: payload.conditionConfig,
  });

  if (!lifecycleValidation.valid) {
    const error = new Error(lifecycleValidation.error);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!conditionValidation.valid) {
    const error = new Error(conditionValidation.error);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  const integration = {
    name: payload.name,
    type: payload.type || payload.eventType,
    eventType: payload.type || payload.eventType,
    direction: payload.direction || 'OUTBOUND',
    orgId: normalizedOrgId,
    orgUnitRid: payload.orgUnitRid || normalizedOrgId,
    entityName: payload.entityName || 'Tenant',
    scope: payload.scope || 'INCLUDE_CHILDREN',
    excludedOrgUnits: payload.excludedOrgUnits || [],
    targetUrl: payload.targetUrl,
    httpMethod: payload.httpMethod,
    outgoingAuthType: payload.outgoingAuthType || 'NONE',
    outgoingAuthConfig: payload.outgoingAuthConfig || null,
    authType: payload.outgoingAuthType || 'NONE',
    authConfig: payload.outgoingAuthConfig || null,
    inboundAuthType: payload.inboundAuthType || null,
    inboundAuthConfig: payload.inboundAuthConfig || null,
    responseTransformation: payload.responseTransformation || null,
    streamResponse: !!payload.streamResponse,
    maxInboundFileSizeMb: Number.isFinite(Number(payload.maxInboundFileSizeMb))
      ? Math.max(1, Math.min(100, Math.floor(Number(payload.maxInboundFileSizeMb))))
      : 50,
    requestPolicy: normalizeRequestPolicy(payload.requestPolicy, payload.rateLimits) || null,
    rateLimits: normalizeRateLimit(payload.rateLimits) || null,
    preDeliveryChecks: normalizePreDeliveryChecks(payload.preDeliveryChecks) || null,
    isActive: payload.isActive !== false,
    timeoutMs: payload.timeoutMs,
    retryCount: payload.retryCount,
    transformationMode: payload.transformationMode || 'SIMPLE',
    transformation: payload.transformation || null,
    transformMode: payload.transformationMode || 'SIMPLE',
    transformConfig: payload.transformation || null,
    actions: payload.actions || null,
    resourceType: payload.resourceType || null,
    subjectExtraction:
      lifecycleValidation.normalizedSubjectExtraction || conditionValidation.normalizedSubjectExtraction,
    lifecycleRules: lifecycleValidation.normalizedLifecycleRules,
    conditionConfig: conditionValidation.normalizedConditionConfig,
    cancelOnEvents:
      lifecycleValidation.normalizedLifecycleRules.length > 0
        ? lifecycleValidation.derivedCancelOnEvents
        : payload.cancelOnEvents || [],
    isInherited: payload.isInherited || false,
    sourceEntityName: payload.sourceEntityName || null,
    version,
    versionNotes,
    compatibilityMode,
    isDefault,
    autoIncrement,
    versionStrategy,
    signingSecret,
    signingSecrets: [signingSecret],
    enableSigning: false,
    signatureVersion: 'v1',
    deliveryMode: normalizeDeliveryMode(payload.deliveryMode || 'IMMEDIATE'),
    schedulingConfig: payload.schedulingConfig || null,
    provider: payload.provider || null,
    metadata: {
      ...payload.metadata,
      versioning: {
        version,
        versionNotes,
        compatibilityMode,
        isDefault,
        autoIncrement,
        versionStrategy,
      },
    },
    createdAt: now,
    updatedAt: now,
  };

  log('info', 'Generated signing secret for new integration', {
    integrationName: payload.name,
    secretPrefix: signingSecret.substring(0, 10) + '...',
    enableSigning: true,
  });

  const result = await db.collection('integration_configs').insertOne(integration);
  integration._id = result.insertedId;
  await captureRevision({ integrationId: result.insertedId, source: 'CREATED' });

  return mapIntegrationFromMongo(integration);
}

async function updateIntegration(orgId, id, patch) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return undefined;

  const now = new Date();
  const db = await mongodb.getDbSafe();

  const updateDoc = { ...patch, updatedAt: now };

  if (updateDoc.eventType && !updateDoc.type) {
    updateDoc.type = updateDoc.eventType;
  } else if (updateDoc.type && !updateDoc.eventType) {
    updateDoc.eventType = updateDoc.type;
  }
  if (Object.prototype.hasOwnProperty.call(updateDoc, 'rateLimits')) {
    updateDoc.rateLimits = normalizeRateLimit(updateDoc.rateLimits);
  }
  if (
    Object.prototype.hasOwnProperty.call(updateDoc, 'requestPolicy') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'rateLimits')
  ) {
    updateDoc.requestPolicy = normalizeRequestPolicy(updateDoc.requestPolicy, updateDoc.rateLimits);
  }
  if (Object.prototype.hasOwnProperty.call(updateDoc, 'preDeliveryChecks')) {
    updateDoc.preDeliveryChecks = normalizePreDeliveryChecks(updateDoc.preDeliveryChecks);
  }

  const existing = await getIntegration(id);
  const mergedLifecycleConfig = {
    resourceType: Object.prototype.hasOwnProperty.call(updateDoc, 'resourceType')
      ? updateDoc.resourceType
      : existing?.resourceType,
    subjectExtraction: Object.prototype.hasOwnProperty.call(updateDoc, 'subjectExtraction')
      ? updateDoc.subjectExtraction
      : existing?.subjectExtraction,
    subjectMapping: Object.prototype.hasOwnProperty.call(updateDoc, 'subjectMapping') ? updateDoc.subjectMapping : null,
    lifecycleRules: Object.prototype.hasOwnProperty.call(updateDoc, 'lifecycleRules')
      ? updateDoc.lifecycleRules
      : existing?.lifecycleRules,
  };
  const mergedConditionConfig = {
    deliveryMode: Object.prototype.hasOwnProperty.call(updateDoc, 'deliveryMode')
      ? updateDoc.deliveryMode
      : existing?.deliveryMode,
    resourceType: Object.prototype.hasOwnProperty.call(updateDoc, 'resourceType')
      ? updateDoc.resourceType
      : existing?.resourceType,
    subjectExtraction: Object.prototype.hasOwnProperty.call(updateDoc, 'subjectExtraction')
      ? updateDoc.subjectExtraction
      : existing?.subjectExtraction,
    subjectMapping: Object.prototype.hasOwnProperty.call(updateDoc, 'subjectMapping') ? updateDoc.subjectMapping : null,
    conditionConfig: Object.prototype.hasOwnProperty.call(updateDoc, 'conditionConfig')
      ? updateDoc.conditionConfig
      : existing?.conditionConfig,
  };

  const lifecycleValidation = validateLifecycleConfig(mergedLifecycleConfig);
  const conditionValidation = validateConditionConfig(mergedConditionConfig);
  if (!lifecycleValidation.valid) {
    const error = new Error(lifecycleValidation.error);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }
  if (!conditionValidation.valid) {
    const error = new Error(conditionValidation.error);
    error.code = 'VALIDATION_ERROR';
    throw error;
  }

  if (
    Object.prototype.hasOwnProperty.call(updateDoc, 'deliveryMode') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'resourceType') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'subjectExtraction') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'subjectMapping') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'lifecycleRules') ||
    Object.prototype.hasOwnProperty.call(updateDoc, 'conditionConfig')
  ) {
    updateDoc.resourceType = mergedLifecycleConfig.resourceType || null;
    updateDoc.subjectExtraction =
      lifecycleValidation.normalizedSubjectExtraction || conditionValidation.normalizedSubjectExtraction;
    updateDoc.subjectMapping = undefined;
    updateDoc.lifecycleRules = lifecycleValidation.normalizedLifecycleRules;
    updateDoc.conditionConfig = conditionValidation.normalizedConditionConfig;
    updateDoc.deliveryMode = normalizeDeliveryMode(mergedConditionConfig.deliveryMode || updateDoc.deliveryMode);
    updateDoc.cancelOnEvents =
      lifecycleValidation.normalizedLifecycleRules.length > 0
        ? lifecycleValidation.derivedCancelOnEvents
        : updateDoc.cancelOnEvents || existing?.cancelOnEvents || [];
  }

  const unsetDoc = {};
  if (Object.prototype.hasOwnProperty.call(updateDoc, 'subjectMapping')) {
    delete updateDoc.subjectMapping;
    unsetDoc.subjectMapping = '';
  }

  log('debug', 'Updating integration', {
    operation: 'updateIntegration',
    id,
    excludedOrgUnits: updateDoc.excludedOrgUnits,
    scope: updateDoc.scope,
    type: updateDoc.type,
    eventType: updateDoc.eventType,
  });

  const updateOperation = { $set: updateDoc };
  if (Object.keys(unsetDoc).length > 0) {
    updateOperation.$unset = unsetDoc;
  }

  const selector = { _id: mongodb.toObjectId(id), ...integrationOrgQuery(normalizedOrgId) };
  const previous = await db.collection('integration_configs').findOne(selector);
  const writeResult = await db.collection('integration_configs').updateOne(selector, updateOperation);
  if (previous && writeResult.matchedCount !== 0) {
    await captureRevision({ integrationId: previous._id, source: 'UPDATED', previous });
  }

  const updated = await getIntegration(id);

  log('debug', 'Integration updated, retrieved:', {
    scope: 'updateIntegration:retrieved',
    id: updated?.id,
    excludedOrgUnits: updated?.excludedOrgUnits,
    type: updated?.type,
  });

  return updated && updated.orgId === normalizedOrgId ? updated : undefined;
}

/**
 * Get integration config by type and direction
 * Used for INBOUND integrations to find the correct config
 */
async function getIntegrationByTypeAndDirection(orgId, type, direction) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return null;

  const db = await mongodb.getDbSafe();
  const doc = await db.collection('integration_configs').findOne({
    ...integrationOrgQuery(normalizedOrgId),
    type,
    direction,
    isActive: true,
  });

  return doc ? mapIntegrationFromMongo(doc) : null;
}

async function deleteIntegration(orgId, id) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return false;

  const db = await mongodb.getDbSafe();
  const result = await db.collection('integration_configs').deleteOne({
    _id: mongodb.toObjectId(id),
    ...integrationOrgQuery(normalizedOrgId),
  });
  return result.deletedCount > 0;
}

// Bulk update integrations (for enable/disable operations)
async function bulkUpdateIntegrations(orgId, ids, patch) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { updatedCount: 0, failedIds: ids };

  const db = await mongodb.getDbSafe();
  const now = new Date();

  const objectIds = [];
  const failedIds = [];

  for (const id of ids) {
    try {
      objectIds.push(mongodb.toObjectId(id));
    } catch (err) {
      failedIds.push(id);
      log('warn', 'Invalid integration ID in bulk update', { id, error: err.message });
    }
  }

  if (objectIds.length === 0) {
    return { updatedCount: 0, failedIds };
  }

  const selector = { _id: { $in: objectIds }, ...integrationOrgQuery(normalizedOrgId) };
  const previousDocs = await db.collection('integration_configs').find(selector).toArray();
  const result = await db.collection('integration_configs').updateMany(selector, { $set: { ...patch, updatedAt: now } });
  for (const previous of previousDocs) {
    await captureRevision({ integrationId: previous._id, source: 'UPDATED', previous });
  }

  log('info', 'Bulk update completed', {
    scope: 'bulkUpdateIntegrations',
    requested: ids.length,
    updated: result.modifiedCount,
    failed: failedIds.length,
  });

  return { updatedCount: result.modifiedCount, failedIds };
}

// Bulk delete integrations
async function bulkDeleteIntegrations(orgId, ids) {
  const normalizedOrgId = normalizeOrgId(orgId);
  if (!normalizedOrgId) return { deletedCount: 0, failedIds: ids };

  const db = await mongodb.getDbSafe();

  const objectIds = [];
  const failedIds = [];

  for (const id of ids) {
    try {
      objectIds.push(mongodb.toObjectId(id));
    } catch (err) {
      failedIds.push(id);
      log('warn', 'Invalid integration ID in bulk delete', { id, error: err.message });
    }
  }

  if (objectIds.length === 0) {
    return { deletedCount: 0, failedIds };
  }

  const result = await db.collection('integration_configs').deleteMany({
    _id: { $in: objectIds },
    ...integrationOrgQuery(normalizedOrgId),
  });

  log('info', 'Bulk delete completed', {
    scope: 'bulkDeleteIntegrations',
    requested: ids.length,
    deleted: result.deletedCount,
    failed: failedIds.length,
  });

  return { deletedCount: result.deletedCount, failedIds };
}

async function listEventTypes(orgId) {
  const collection = await getCollection('event_types');
  const query = orgId ? { $or: [{ orgId }, { orgId: null }] } : { orgId: null };
  const docs = await collection
    .find(query, { projection: { type: 1, eventType: 1, orgId: 1, _id: 0 } })
    .sort({ type: 1, eventType: 1 })
    .toArray();

  // Deduplicate: org-specific wins over global template on same key
  const seen = new Set();
  return docs
    .sort((a, b) => {
      const aIsOrg = a.orgId !== null && a.orgId !== undefined;
      const bIsOrg = b.orgId !== null && b.orgId !== undefined;
      if (aIsOrg && !bIsOrg) return -1;
      if (!aIsOrg && bIsOrg) return 1;
      return 0;
    })
    .filter((d) => {
      const k = d.type || d.eventType;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .map((d) => d.type || d.eventType)
    .filter(Boolean);
}

async function getIntegrationById(integrationId) {
  const db = await mongodb.getDbSafe();
  const integration = await db.collection('integration_configs').findOne({ _id: mongodb.toObjectId(integrationId) });
  return integration ? mapIntegrationFromMongo(integration) : null;
}

module.exports = {
  allowedParentsCache,
  getAllowedParentRids,
  listIntegrations,
  listIntegrationsSummary,
  listIntegrationsForDelivery,
  listIntegrationsForProcessing,
  listInvalidationProfiles,
  listConditionProfiles,
  getParentRidForEntity,
  getIntegration,
  addIntegration,
  updateIntegration,
  getIntegrationByTypeAndDirection,
  deleteIntegration,
  bulkUpdateIntegrations,
  bulkDeleteIntegrations,
  listEventTypes,
  getIntegrationById,
};
