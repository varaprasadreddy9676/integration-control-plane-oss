'use strict';
const { getDb } = require('../mongodb');
const { log } = require('../logger');
const { encrypt, decrypt, describeKeySource } = require('../utils/secret-crypto');

/**
 * Called once at startup. Makes the risky key configurations loud instead of
 * silent, and optionally refuses to boot when GATEWAY_SECRET_KEY_REQUIRED=true.
 *
 * @returns {{ source: string, healthy: boolean }}
 */
function assertSecretKeyHealth() {
  const { source, reason } = describeKeySource();

  if (source === 'configured') {
    log('info', 'Gateway secret key: using GATEWAY_SECRET_KEY');
    return { source, healthy: true };
  }

  const message =
    source === 'mongodb-uri'
      ? 'Gateway secrets are encrypted with a key derived from MONGODB_URI. Changing the Mongo password, host or database name will make every stored secret permanently undecryptable.'
      : 'Gateway secrets are encrypted with a hardcoded fallback seed. This is not secure.';

  const remediation =
    'Generate a key with `node src/scripts/rotate-gateway-secret-key.js --generate-key`, migrate existing secrets onto it with `--to=<key>` (add --commit to apply), then set GATEWAY_SECRET_KEY=<key> and restart.';

  if (String(process.env.GATEWAY_SECRET_KEY_REQUIRED).toLowerCase() === 'true') {
    throw new Error(`${message} ${reason ? `(${reason}) ` : ''}${remediation}`);
  }

  log('warn', `INSECURE SECRET KEY: ${message}`, { reason, remediation });
  return { source, healthy: false };
}

async function col() {
  const db = await getDb();
  return db.collection('gateway_secrets');
}

async function setSecret(key, value, orgId = null) {
  const c = await col();
  await c.updateOne(
    { key, orgId },
    {
      $set: { key, orgId, encryptedValue: encrypt(value), updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true }
  );
  log('info', 'Secret stored', { key, orgId });
}

async function getSecret(key, orgId = null) {
  const c = await col();
  // Org-scoped first, then global fallback
  const doc = (orgId ? await c.findOne({ key, orgId }) : null) || (await c.findOne({ key, orgId: null }));
  if (!doc) return null;
  try {
    return decrypt(doc.encryptedValue);
  } catch (err) {
    log('error', 'Failed to decrypt secret', { key, error: err.message });
    throw new Error(`Failed to decrypt secret: ${key}`);
  }
}

async function listSecrets(orgId = null) {
  const c = await col();
  const filter = orgId ? { $or: [{ orgId }, { orgId: null }] } : {};
  return c
    .find(filter, { projection: { encryptedValue: 0 } })
    .sort({ key: 1 })
    .toArray();
}

async function deleteSecret(key, orgId = null) {
  const c = await col();
  await c.deleteOne({ key, orgId });
}

module.exports = {
  setSecret,
  getSecret,
  listSecrets,
  deleteSecret,
  assertSecretKeyHealth,
  describeKeySource,
};
