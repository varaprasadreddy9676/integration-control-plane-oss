'use strict';

/**
 * The one symmetric key for secrets at rest — gateway secrets and integration
 * credentials both use it — plus its AES-256-GCM cipher. Kept free of other
 * app modules so the Mongo layer can use it without a circular require.
 */
const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

const FALLBACK_SEED = 'integration-gateway-fallback';

/**
 * Which key source is in play, and why. Exposed so startup can warn about the
 * dangerous cases instead of discovering them the day a secret fails to decrypt.
 *
 * @returns {{ source: 'configured'|'mongodb-uri'|'hardcoded', reason: string|null }}
 */
function describeKeySource() {
  const hex = process.env.GATEWAY_SECRET_KEY;
  if (hex) {
    let buf;
    try {
      buf = Buffer.from(hex, 'hex');
    } catch (_) {
      buf = null;
    }
    if (buf && buf.length === 32) return { source: 'configured', reason: null };
    return {
      source: process.env.MONGODB_URI ? 'mongodb-uri' : 'hardcoded',
      reason: `GATEWAY_SECRET_KEY is set but is not a 32-byte hex string (got ${
        buf ? `${buf.length} bytes` : 'unparseable value'
      }) — it is being IGNORED`,
    };
  }
  if (process.env.MONGODB_URI) {
    return {
      source: 'mongodb-uri',
      reason: 'GATEWAY_SECRET_KEY is not set, so the key is derived from MONGODB_URI',
    };
  }
  return {
    source: 'hardcoded',
    reason: 'Neither GATEWAY_SECRET_KEY nor MONGODB_URI is set — using a hardcoded seed',
  };
}

function getKey() {
  const hex = process.env.GATEWAY_SECRET_KEY;
  if (hex) {
    const buf = Buffer.from(hex, 'hex');
    if (buf.length === 32) return buf;
  }
  // Derive from MONGODB_URI. Predictable across restarts, but it silently ties
  // every stored secret to the connection string: change the Mongo password,
  // host or database and nothing here can be decrypted again. Startup warns
  // about this (see assertSecretKeyHealth); migrate with
  // `node src/scripts/rotate-gateway-secret-key.js`.
  const seed = process.env.MONGODB_URI || FALLBACK_SEED;
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext) {
  const parts = ciphertext.split(':');
  if (parts.length !== 3) throw new Error('Invalid secret format');
  const [ivHex, tagHex, encHex] = parts;
  const key = getKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

module.exports = { encrypt, decrypt, describeKeySource };
