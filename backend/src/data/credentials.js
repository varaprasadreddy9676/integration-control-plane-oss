'use strict';

const crypto = require('crypto');
const mongodb = require('../mongodb');
const config = require('../config');
const { uuidv4 } = require('../utils/runtime');

const COLLECTION = 'credential_placeholders';
const ALLOWED_ENVIRONMENTS = new Set(['validation', 'production']);
const ALLOWED_STATUSES = new Set(['PENDING', 'PROVIDED', 'TESTED', 'FAILED']);

function getEncryptionKey() {
  const seed =
    process.env.CREDENTIAL_ENCRYPTION_KEY ||
    config.security?.credentialEncryptionKey ||
    config.security?.jwtSecret ||
    config.security?.apiKey ||
    'integration-control-plane-development-key';
  return crypto.createHash('sha256').update(String(seed)).digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    value: encrypted.toString('base64'),
  };
}

function maskProvidedValue(value) {
  if (!value) return null;
  return '********';
}

function normalizeField(field) {
  const key = String(field?.key || '').trim();
  if (!key) {
    throw new Error('Credential field key is required');
  }
  return {
    key,
    label: String(field?.label || key),
    secret: field?.secret !== false,
    required: field?.required !== false,
    status: 'PENDING',
    maskedValue: null,
  };
}

function sanitizePlaceholder(doc) {
  if (!doc) return null;
  const values = doc.encryptedValues || {};
  return {
    id: doc.placeholderId || doc._id?.toString?.(),
    orgId: doc.orgId,
    provider: doc.provider,
    name: doc.name,
    environment: doc.environment,
    authType: doc.authType,
    status: doc.status,
    notes: doc.notes || null,
    fields: (doc.fields || []).map((field) => ({
      key: field.key,
      label: field.label,
      secret: field.secret !== false,
      required: field.required !== false,
      status: values[field.key] ? 'PROVIDED' : field.status || 'PENDING',
      maskedValue: values[field.key] ? maskProvidedValue(values[field.key]) : null,
    })),
    testStatus: doc.testStatus || null,
    testMessage: doc.testMessage || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    createdBy: doc.createdBy || null,
    updatedBy: doc.updatedBy || null,
  };
}

async function ensureIndexes() {
  const db = await mongodb.getDbSafe();
  await db.collection(COLLECTION).createIndex({ orgId: 1, environment: 1, provider: 1 });
  await db.collection(COLLECTION).createIndex({ placeholderId: 1 }, { unique: true });
}

async function createCredentialPlaceholder(orgId, input, options = {}) {
  const db = await mongodb.getDbSafe();
  const now = new Date();
  const environment = String(input?.environment || 'validation').toLowerCase();
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error('Credential environment must be validation or production');
  }

  const fields = Array.isArray(input?.fields) ? input.fields.map(normalizeField) : [];
  if (fields.length === 0) {
    throw new Error('At least one credential field is required');
  }

  const doc = {
    placeholderId: `cred_${uuidv4().replace(/-/g, '')}`,
    orgId,
    provider: String(input?.provider || '').trim(),
    name: String(input?.name || input?.provider || '').trim(),
    environment,
    authType: String(input?.authType || 'API_KEY').trim(),
    status: 'PENDING',
    notes: input?.notes ? String(input.notes) : null,
    fields,
    encryptedValues: {},
    createdAt: now,
    updatedAt: now,
    createdBy: options.userId || null,
    updatedBy: options.userId || null,
  };

  if (!doc.provider || !doc.name) {
    throw new Error('Provider and name are required');
  }

  await db.collection(COLLECTION).insertOne(doc);
  return sanitizePlaceholder(doc);
}

async function listCredentialPlaceholders(orgId, filters = {}) {
  const db = await mongodb.getDbSafe();
  const query = { orgId };
  if (filters.environment) query.environment = String(filters.environment).toLowerCase();
  if (filters.provider) query.provider = String(filters.provider);
  if (filters.status && ALLOWED_STATUSES.has(String(filters.status).toUpperCase())) {
    query.status = String(filters.status).toUpperCase();
  }
  const limit = Math.min(Math.max(Number.parseInt(filters.limit, 10) || 50, 1), 200);
  const docs = await db.collection(COLLECTION).find(query).sort({ updatedAt: -1 }).limit(limit).toArray();
  return docs.map(sanitizePlaceholder);
}

async function getCredentialPlaceholder(orgId, placeholderId) {
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(COLLECTION).findOne({ orgId, placeholderId });
  return sanitizePlaceholder(doc);
}

async function setCredentialValues(orgId, placeholderId, values, options = {}) {
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(COLLECTION).findOne({ orgId, placeholderId });
  if (!doc) return null;

  const allowedKeys = new Set((doc.fields || []).map((field) => field.key));
  const encryptedValues = { ...(doc.encryptedValues || {}) };
  Object.entries(values || {}).forEach(([key, value]) => {
    if (allowedKeys.has(key) && value !== undefined && value !== null && String(value) !== '') {
      encryptedValues[key] = encryptSecret(value);
    }
  });

  const fields = (doc.fields || []).map((field) => ({
    ...field,
    status: encryptedValues[field.key] ? 'PROVIDED' : 'PENDING',
  }));
  const missingRequired = fields.some((field) => field.required !== false && !encryptedValues[field.key]);
  const status = missingRequired ? 'PENDING' : 'PROVIDED';

  await db.collection(COLLECTION).updateOne(
    { orgId, placeholderId },
    {
      $set: {
        encryptedValues,
        fields,
        status,
        updatedAt: new Date(),
        updatedBy: options.userId || null,
      },
    }
  );

  return getCredentialPlaceholder(orgId, placeholderId);
}

async function updateCredentialTestStatus(orgId, placeholderId, testResult = {}) {
  const db = await mongodb.getDbSafe();
  const status = testResult.success ? 'TESTED' : 'FAILED';
  await db.collection(COLLECTION).updateOne(
    { orgId, placeholderId },
    {
      $set: {
        status,
        testStatus: status,
        testMessage: testResult.message || null,
        updatedAt: new Date(),
      },
    }
  );
  return getCredentialPlaceholder(orgId, placeholderId);
}

module.exports = {
  ensureIndexes,
  createCredentialPlaceholder,
  listCredentialPlaceholders,
  getCredentialPlaceholder,
  setCredentialValues,
  updateCredentialTestStatus,
  sanitizePlaceholder,
};
