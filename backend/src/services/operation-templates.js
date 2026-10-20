'use strict';

/**
 * Operation Templates Resolver
 *
 * Resolves a { providerKey, operationKey } reference into a full, delivery-ready
 * integration config by:
 *   1. Looking up the matching template in integration_templates for the org.
 *   2. Filling in {{placeholder}} tokens from the supplied values.
 *   3. Returning a merged config object that callers (delivery engine, scheduled
 *      job worker) can overlay onto their existing action/job config.
 *
 * This enables reusable, named operations (e.g. "partnerhub / fetch-profile") instead
 * of copying the full auth + URL config into every integration that calls it.
 *
 * Template document shape expected in MongoDB:
 *   {
 *     orgId: <orgId>,
 *     providerKey: 'partnerhub',
 *     operationKey: 'fetch-profile',
 *     name: 'PartnerHub - Fetch Profile',
 *     targetUrl: 'https://api.partnerhub.example/api/profile/fetch',
 *     httpMethod: 'POST',
 *     authType: 'CUSTOM',
 *     authConfig: { ... },
 *     headers: { 'x-partner-id': '{{partnerId}}' },
 *     transformationMode: 'SCRIPT',
 *     transformation: { script: '...' },
 *     timeoutMs: 15000,
 *     ...
 *   }
 */

const { log } = require('../logger');
const mongodb = require('../mongodb');

const COLLECTION = 'integration_templates';

// ---------------------------------------------------------------------------
// Index management
// Ensure a unique compound index exists for fast template lookups.
// Runs at most once per process lifetime.
// ---------------------------------------------------------------------------

let _indexesEnsured = false;

async function ensureIndexes(collection) {
  if (_indexesEnsured) return;
  try {
    await collection.createIndex(
      { orgId: 1, providerKey: 1, operationKey: 1 },
      {
        unique: true,
        background: true,
        name: 'idx_template_org_provider_operation',
        partialFilterExpression: {
          providerKey: { $type: 'string' },
          operationKey: { $type: 'string' },
        },
      }
    );
    _indexesEnsured = true;
    log('debug', 'integration_templates index ensured');
  } catch (err) {
    // Non-fatal: index may already exist or be created by another process
    log('warn', 'Failed to ensure integration_templates index', { error: err.message });
  }
}

// ---------------------------------------------------------------------------
// Placeholder substitution
// Replaces {{key}} tokens in strings and recursively in objects/arrays.
// ---------------------------------------------------------------------------

/**
 * Replace {{key}} placeholders in a string.
 * Unknown keys are left as-is (no silent data loss).
 */
function fillString(str, values) {
  if (typeof str !== 'string') return str;
  return str.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const trimmed = key.trim();
    return Object.prototype.hasOwnProperty.call(values, trimmed) ? values[trimmed] : match;
  });
}

/**
 * Recursively fill placeholders in an object, array, or string.
 * Returns a new value — never mutates the input.
 */
function fillPlaceholders(value, placeholders) {
  if (typeof value === 'string') return fillString(value, placeholders);
  if (Array.isArray(value)) return value.map((item) => fillPlaceholders(item, placeholders));
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = fillPlaceholders(v, placeholders);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Template lookup
// ---------------------------------------------------------------------------

/**
 * Find a template by (orgId, providerKey, operationKey).
 * Tries exact org match first, then falls back to a global template (orgId = 0).
 *
 * @param {number|string} orgId
 * @param {string} providerKey   e.g. 'partnerhub'
 * @param {string} operationKey  e.g. 'fetch-profile'
 * @returns {object|null} raw template document or null if not found
 */
async function findTemplate(orgId, providerKey, operationKey) {
  const db = await mongodb.getDbSafe();
  const collection = db.collection(COLLECTION);

  // Ensure the compound index exists (no-op if already done)
  await ensureIndexes(collection);

  // Normalise keys to lowercase for case-insensitive matching
  const pk = String(providerKey || '').toLowerCase();
  const ok = String(operationKey || '').toLowerCase();

  // Try org-specific template first
  const orgDoc = await collection.findOne({
    orgId: orgId,
    providerKey: pk,
    operationKey: ok,
    isActive: { $ne: false },
  });

  if (orgDoc) return orgDoc;

  // Fall back to global/shared template (orgId = 0 or absent)
  const globalDoc = await collection.findOne({
    $or: [{ orgId: 0 }, { orgId: { $exists: false } }],
    providerKey: pk,
    operationKey: ok,
    isActive: { $ne: false },
  });

  return globalDoc || null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a provider+operation reference into a delivery-ready config.
 *
 * @param {number|string} orgId
 * @param {string} providerKey   e.g. 'partnerhub'
 * @param {string} operationKey  e.g. 'fetch-profile'
 * @param {object} placeholders  key→value map for {{token}} substitution
 * @returns {object} Merged, placeholder-filled config with these fields:
 *   targetUrl, httpMethod, outgoingAuthType, outgoingAuthConfig,
 *   customHeaders, transformationMode, transformation, timeoutMs, retryCount
 * @throws if the template is not found or resolution fails
 */
async function resolveOperationTemplate(orgId, providerKey, operationKey, placeholders = {}) {
  const template = await findTemplate(orgId, providerKey, operationKey);

  if (!template) {
    throw new Error(
      `Operation template not found: providerKey="${providerKey}" operationKey="${operationKey}" orgId=${orgId}`
    );
  }

  log('debug', 'Resolving operation template', {
    providerKey,
    operationKey,
    orgId,
    templateId: template._id?.toString(),
    placeholderKeys: Object.keys(placeholders),
  });

  // Fill placeholders across all string/object fields
  const filled = fillPlaceholders(
    {
      targetUrl: template.targetUrl,
      httpMethod: template.httpMethod || 'POST',
      outgoingAuthType: template.authType || 'NONE',
      outgoingAuthConfig: template.authConfig || {},
      customHeaders: template.headers || {},
      transformationMode: template.transformationMode || 'PASSTHROUGH',
      transformation: template.transformation || {},
      timeoutMs: template.timeoutMs || 15000,
      retryCount: template.retryCount ?? 2,
    },
    placeholders
  );

  return filled;
}

/**
 * Check whether an action or job config contains a providerRef that should
 * be resolved before delivery.
 *
 * @param {object} config  action or job config
 * @returns {boolean}
 */
function hasProviderRef(config) {
  return (
    config != null &&
    typeof config.providerRef === 'object' &&
    config.providerRef !== null &&
    typeof config.providerRef.providerKey === 'string' &&
    typeof config.providerRef.operationKey === 'string'
  );
}

/**
 * If the config has a providerRef, resolve the template and merge it into
 * the config. Fields on the config take precedence over the template
 * (explicit overrides are preserved).
 *
 * Returns a new object — never mutates the input.
 *
 * @param {number|string} orgId
 * @param {object} config  action or job config (may have providerRef)
 * @returns {object} config with template fields merged in (or original if no ref)
 */
async function applyProviderRef(orgId, config) {
  if (!hasProviderRef(config)) return config;

  const { providerKey, operationKey, placeholders = {} } = config.providerRef;
  const resolved = await resolveOperationTemplate(orgId, providerKey, operationKey, placeholders);

  // Template fields are the base; explicit config fields override
  return {
    ...resolved,
    ...config,
    // Deep-merge auth config: template values are the default, config values win
    outgoingAuthConfig: {
      ...resolved.outgoingAuthConfig,
      ...(config.outgoingAuthConfig || {}),
    },
    // Deep-merge custom headers
    customHeaders: {
      ...resolved.customHeaders,
      ...(config.customHeaders || {}),
    },
  };
}

module.exports = {
  resolveOperationTemplate,
  applyProviderRef,
  hasProviderRef,
  fillPlaceholders, // exported for testing
  findTemplate, // exported for testing
};
