'use strict';

/**
 * Encryption at rest for integration credentials.
 *
 * Installed once on the driver's Collection and scoped to integration_configs:
 * writes encrypt every secret field (see integration-secrets.isSecretField),
 * reads decrypt every value carrying the enc: prefix. Doing it at the driver is
 * deliberate — about twenty places read integration configs directly (delivery
 * and DLQ workers, schedulers, the OAuth token cache, admin routes), and one
 * that forgot to decrypt would send ciphertext to a hospital as a password.
 *
 * Reads are prefix-based, so plaintext written before encryption keeps working
 * until the backfill encrypts it. The key is the gateway secret key
 * (utils/secret-crypto): rotating it must re-encrypt these values too.
 */

const { encrypt, decrypt } = require('./secret-crypto');
const { SECRET_MASK, isSecretField, mapSecretFields, isPlainObject } = require('./integration-secrets');
const { log } = require('../logger');

const ENCRYPTED_PREFIX = 'enc:v1:';
// Non-string secrets (a tokenRequestBody stored as an object) round-trip as JSON.
const ENCRYPTED_JSON_PREFIX = 'enc:v1j:';
// integration_revisions holds full config snapshots, credentials included.
const DEFAULT_COLLECTIONS = ['integration_configs', 'integration_revisions'];

// Lets the hint safety net re-apply decryption to the clone it retries with
// (cursor.clone() drops cursor.map transforms).
const CURSOR_RETRY_SETUP = Symbol.for('icp.cursorRetrySetup');
const INSTALLED = Symbol.for('icp.encryptionAtRestInstalled');

const isEncrypted = (value) =>
  typeof value === 'string' && (value.startsWith(ENCRYPTED_PREFIX) || value.startsWith(ENCRYPTED_JSON_PREFIX));

function encryptLeaf(value) {
  if (value === undefined || value === null || value === '' || value === SECRET_MASK || isEncrypted(value)) {
    return value;
  }
  if (typeof value === 'string') return ENCRYPTED_PREFIX + encrypt(value);
  return ENCRYPTED_JSON_PREFIX + encrypt(JSON.stringify(value));
}

function encryptSecretValue(value) {
  return Array.isArray(value) ? value.map(encryptLeaf) : encryptLeaf(value);
}

/** Copy of `document` with every secret field encrypted. */
function encryptSecretFields(document, parentKey = '', grandparentKey = '') {
  return mapSecretFields(document, encryptSecretValue, parentKey, grandparentKey);
}

let reportedDecryptFailure = false;

function decryptLeaf(value) {
  if (!isEncrypted(value)) return value;
  try {
    if (value.startsWith(ENCRYPTED_JSON_PREFIX)) return JSON.parse(decrypt(value.slice(ENCRYPTED_JSON_PREFIX.length)));
    return decrypt(value.slice(ENCRYPTED_PREFIX.length));
  } catch (error) {
    // Never hand ciphertext to a caller that would use it as a credential.
    if (!reportedDecryptFailure) {
      reportedDecryptFailure = true;
      log('error', 'Cannot decrypt a stored integration credential — was GATEWAY_SECRET_KEY or MONGODB_URI changed without re-encrypting?', {
        error: error.message,
      });
    }
    return null;
  }
}

/** Copy of `value` with every enc: string decrypted. Anything else is returned as is. */
function decryptSecrets(value) {
  if (typeof value === 'string') return decryptLeaf(value);
  if (Array.isArray(value)) return value.map(decryptSecrets);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = decryptSecrets(child);
  return out;
}

/** Encrypt the secret values of `{ 'a.b.c': value }` style (dotted) assignments. */
function encryptAssignments(assignments) {
  if (!isPlainObject(assignments)) return assignments;
  const out = {};
  for (const [path, value] of Object.entries(assignments)) {
    const segments = path.split('.').filter((segment) => !/^\d+$/.test(segment) && segment !== '$');
    const key = segments[segments.length - 1] || '';
    const parentKey = segments[segments.length - 2] || '';
    const grandparentKey = segments[segments.length - 3] || '';
    out[path] = isSecretField(key, parentKey, grandparentKey)
      ? encryptSecretValue(value)
      : encryptSecretFields(value, key, parentKey);
  }
  return out;
}

/** Encrypt the secrets an update would write. Pipeline updates are left alone. */
function encryptUpdate(update) {
  if (Array.isArray(update) || !isPlainObject(update)) return update;
  const operatorKeys = Object.keys(update).filter((key) => key.startsWith('$'));
  if (operatorKeys.length === 0) return encryptSecretFields(update);
  const out = { ...update };
  for (const operator of ['$set', '$setOnInsert']) {
    if (out[operator]) out[operator] = encryptAssignments(out[operator]);
  }
  if (out.$push) out.$push = encryptAssignments(out.$push);
  return out;
}

function decryptingCursor(cursor) {
  if (!cursor || typeof cursor.map !== 'function') return cursor;
  cursor.map(decryptSecrets);
  cursor[CURSOR_RETRY_SETUP] = (clone) => (clone && typeof clone.map === 'function' ? clone.map(decryptSecrets) : clone);
  return cursor;
}

function decryptModifyResult(result) {
  if (!result || typeof result !== 'object') return result;
  // Driver 4.x returns { value, ok, lastErrorObject }; later versions can return the document.
  if ('value' in result && ('ok' in result || 'lastErrorObject' in result)) {
    return { ...result, value: decryptSecrets(result.value) };
  }
  return decryptSecrets(result);
}

/**
 * @param {Function} Collection the driver's Collection class
 * @param {{ collections?: string[] }} [options]
 */
function installEncryptionAtRest(Collection, { collections = DEFAULT_COLLECTIONS } = {}) {
  const proto = Collection && Collection.prototype;
  if (!proto || proto[INSTALLED]) return;
  proto[INSTALLED] = true;
  const scoped = new Set(collections);
  const inScope = (collection) => scoped.has(collection.collectionName);

  const wrap = (method, around) => {
    const original = proto[method];
    if (typeof original !== 'function') return;
    proto[method] = function wrapped(...args) {
      return inScope(this) ? around.call(this, original, args) : original.apply(this, args);
    };
  };

  wrap('insertOne', async function insertOne(original, [document, ...rest]) {
    const result = await original.call(this, encryptSecretFields(document), ...rest);
    // The driver sets _id on the document it was given; callers expect theirs to have it.
    if (isPlainObject(document) && document._id === undefined && result && result.insertedId !== undefined) {
      document._id = result.insertedId;
    }
    return result;
  });
  wrap('insertMany', function insertMany(original, [documents, ...rest]) {
    return original.call(this, Array.isArray(documents) ? documents.map((d) => encryptSecretFields(d)) : documents, ...rest);
  });
  wrap('replaceOne', function replaceOne(original, [filter, replacement, ...rest]) {
    return original.call(this, filter, encryptSecretFields(replacement), ...rest);
  });
  for (const method of ['updateOne', 'updateMany']) {
    wrap(method, function update(original, [filter, updateDoc, ...rest]) {
      return original.call(this, filter, encryptUpdate(updateDoc), ...rest);
    });
  }
  wrap('findOneAndUpdate', async function findOneAndUpdate(original, [filter, updateDoc, ...rest]) {
    return decryptModifyResult(await original.call(this, filter, encryptUpdate(updateDoc), ...rest));
  });
  wrap('findOneAndReplace', async function findOneAndReplace(original, [filter, replacement, ...rest]) {
    return decryptModifyResult(await original.call(this, filter, encryptSecretFields(replacement), ...rest));
  });
  wrap('findOneAndDelete', async function findOneAndDelete(original, args) {
    return decryptModifyResult(await original.apply(this, args));
  });
  wrap('find', function find(original, args) {
    return decryptingCursor(original.apply(this, args));
  });
  wrap('aggregate', function aggregate(original, args) {
    return decryptingCursor(original.apply(this, args));
  });
  // findOne goes through find() in the driver, but decrypting again is harmless
  // and keeps this correct if that ever changes.
  wrap('findOne', async function findOne(original, args) {
    return decryptSecrets(await original.apply(this, args));
  });
}

module.exports = {
  ENCRYPTED_PREFIX,
  ENCRYPTED_JSON_PREFIX,
  CURSOR_RETRY_SETUP,
  isEncrypted,
  encryptSecretFields,
  encryptUpdate,
  decryptSecrets,
  installEncryptionAtRest,
};
