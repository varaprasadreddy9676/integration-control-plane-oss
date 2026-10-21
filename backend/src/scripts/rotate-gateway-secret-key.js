'use strict';
/**
 * Re-encrypt every gateway secret under a new key.
 *
 * Why this exists: when GATEWAY_SECRET_KEY is unset, gateway-secrets.js derives
 * the AES key from MONGODB_URI. That silently couples every stored secret to the
 * connection string — change the Mongo password, host or database name and none
 * of them can ever be decrypted again. This script moves secrets from whatever
 * key currently works onto an explicit GATEWAY_SECRET_KEY, and can also rotate
 * one explicit key to another later.
 *
 * It is deliberately paranoid:
 *   - Decrypts everything with the OLD key and verifies it before writing.
 *   - Re-encrypts, then decrypts again with the NEW key and compares to the
 *     original plaintext. A secret is only written if that round-trip matches.
 *   - Writes a timestamped backup of the whole collection first.
 *   - Dry-run by default; --commit is required to change anything.
 *
 * Usage
 *   # See what would happen (no writes):
 *   node src/scripts/rotate-gateway-secret-key.js --to=<64-hex>
 *
 *   # Generate a key to use:
 *   node src/scripts/rotate-gateway-secret-key.js --generate-key
 *
 *   # Actually migrate:
 *   node src/scripts/rotate-gateway-secret-key.js --to=<64-hex> --commit
 *
 *   # Rotate from one explicit key to another:
 *   node src/scripts/rotate-gateway-secret-key.js --from=<64-hex> --to=<64-hex> --commit
 *
 * It also re-encrypts integration credentials (integration_configs values with
 * the enc:v1: / enc:v1j: prefix, see utils/secrets-at-rest.js, and the config
 * snapshots kept in integration_revisions, and alert channel secrets), which use the
 * same key — rotating one without the other would break every integration.
 *
 * After --commit, set GATEWAY_SECRET_KEY=<the --to value> in the environment and
 * restart. Until you do, the app is still using the old key and will fail to
 * decrypt. Keep the backup collection until you have confirmed a working boot.
 */

const crypto = require('crypto');
const { MongoClient } = require('mongodb');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const COLLECTION = 'gateway_secrets';

function arg(name) {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf('=');
  return eq === -1 ? true : hit.slice(eq + 1);
}

function parseKeyHex(hex, label) {
  const buf = Buffer.from(String(hex), 'hex');
  if (buf.length !== 32) {
    throw new Error(`${label} must be a 32-byte (64-character) hex string; got ${buf.length} bytes`);
  }
  return buf;
}

// Mirrors gateway-secrets.js getKey() exactly. If that ever changes, change this.
function derivedKey(mongoUri) {
  const seed = mongoUri || 'integration-gateway-fallback';
  return crypto.createHash('sha256').update(seed).digest();
}

function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(ciphertext, key) {
  const parts = String(ciphertext).split(':');
  if (parts.length !== 3) throw new Error('Invalid secret format');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'), {
    authTagLength: TAG_LENGTH,
  });
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return decipher.update(Buffer.from(encHex, 'hex')).toString('utf8') + decipher.final('utf8');
}

// Collections whose documents hold enc:-prefixed integration credentials.
const INTEGRATION_COLLECTIONS = ['integration_configs', 'integration_revisions', 'alert_channels'];
const ENC_PREFIXES = ['enc:v1j:', 'enc:v1:'];

/**
 * Re-encrypt every enc:-prefixed string inside `value`. Returns the rewritten
 * value; problems are pushed onto `failures`, counts onto `stats`.
 */
function reencryptTree(value, oldKey, newKey, failures, stats) {
  if (typeof value === 'string') {
    const prefix = ENC_PREFIXES.find((p) => value.startsWith(p));
    if (!prefix) return value;
    try {
      const plaintext = decrypt(value.slice(prefix.length), oldKey);
      const reEncrypted = encrypt(plaintext, newKey);
      if (decrypt(reEncrypted, newKey) !== plaintext) throw new Error('round-trip mismatch');
      stats.values += 1;
      return prefix + reEncrypted;
    } catch (err) {
      failures.push(err.message);
      return value;
    }
  }
  if (Array.isArray(value)) return value.map((item) => reencryptTree(item, oldKey, newKey, failures, stats));
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = reencryptTree(child, oldKey, newKey, failures, stats);
    return out;
  }
  return value;
}

async function planIntegrationConfigs(db, oldKey, newKey) {
  const planned = [];
  const failures = [];
  const stats = { values: 0 };
  for (const collection of INTEGRATION_COLLECTIONS) {
    const docs = await db.collection(collection).find({}).toArray();
    planCollection(collection, docs, oldKey, newKey, { planned, failures, stats });
  }
  return { planned, failures, stats };
}

function planCollection(collection, docs, oldKey, newKey, { planned, failures, stats }) {
  for (const doc of docs) {
    const docFailures = [];
    const $set = {};
    for (const [key, value] of Object.entries(doc)) {
      if (key === '_id') continue;
      const rewritten = reencryptTree(value, oldKey, newKey, docFailures, stats);
      if (JSON.stringify(rewritten) !== JSON.stringify(value)) $set[key] = rewritten;
    }
    const label = `${collection}: ${doc.name || doc._id} (org ${doc.orgId})`;
    if (docFailures.length) failures.push({ label, stage: 'integration credential', error: docFailures[0] });
    else if (Object.keys($set).length) planned.push({ collection, _id: doc._id, label, $set, original: doc });
  }
}

async function main() {
  if (arg('generate-key')) {
    console.log(crypto.randomBytes(32).toString('hex'));
    return;
  }

  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error('MONGODB_URI is required');

  const toHex = arg('to');
  if (!toHex || toHex === true) {
    throw new Error('--to=<64-hex> is required (use --generate-key to create one)');
  }
  const newKey = parseKeyHex(toHex, '--to');

  // Old key: explicit if given, otherwise whatever the app is using right now.
  const fromHex = arg('from');
  const oldKey =
    fromHex && fromHex !== true
      ? parseKeyHex(fromHex, '--from')
      : process.env.GATEWAY_SECRET_KEY
        ? parseKeyHex(process.env.GATEWAY_SECRET_KEY, 'GATEWAY_SECRET_KEY')
        : derivedKey(mongoUri);

  const oldSource =
    fromHex && fromHex !== true
      ? '--from'
      : process.env.GATEWAY_SECRET_KEY
        ? 'GATEWAY_SECRET_KEY'
        : 'derived from MONGODB_URI';

  if (oldKey.equals(newKey)) {
    console.log('Old and new keys are identical — nothing to do.');
    return;
  }

  const commit = arg('commit') === true;
  console.log(`Mode      : ${commit ? 'COMMIT (will write)' : 'DRY RUN (no writes)'}`);
  console.log(`Old key   : ${oldSource}`);
  console.log(`New key   : --to (${String(toHex).slice(0, 8)}…)`);

  const client = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 10000 });
  await client.connect();

  try {
    const db = client.db();
    const col = db.collection(COLLECTION);
    const docs = await col.find({}).toArray();
    console.log(`Secrets   : ${docs.length}`);

    const integrations = await planIntegrationConfigs(db, oldKey, newKey);
    console.log(
      `Integration credentials: ${integrations.stats.values} value(s) in ${integrations.planned.length} config(s)`
    );

    if (!docs.length && !integrations.planned.length && !integrations.failures.length) return;

    // Phase 1 — prove every secret can be read and safely re-encrypted BEFORE
    // touching anything. A partial migration is far worse than none.
    const planned = [];
    const failures = [];

    for (const doc of docs) {
      const label = `${doc.key}${doc.orgId ? ` (org ${doc.orgId})` : ''}`;
      let plaintext;
      try {
        plaintext = decrypt(doc.encryptedValue, oldKey);
      } catch (err) {
        failures.push({ label, stage: 'decrypt with old key', error: err.message });
        continue;
      }

      const reEncrypted = encrypt(plaintext, newKey);
      let verified;
      try {
        verified = decrypt(reEncrypted, newKey);
      } catch (err) {
        failures.push({ label, stage: 'verify with new key', error: err.message });
        continue;
      }
      if (verified !== plaintext) {
        failures.push({ label, stage: 'round-trip mismatch', error: 'plaintext differs' });
        continue;
      }

      planned.push({ _id: doc._id, label, encryptedValue: reEncrypted });
    }

    failures.push(...integrations.failures);
    console.log(`Re-encryptable: ${planned.length}/${docs.length}`);
    if (failures.length) {
      console.log('\nFAILURES (these would be left untouched):');
      for (const f of failures) console.log(`  ✗ ${f.label} — ${f.stage}: ${f.error}`);
      console.log(
        '\nA secret that cannot be decrypted with the old key is already lost; the old key is wrong, ' +
          'or MONGODB_URI changed since it was written. Resolve before committing.'
      );
    }

    if (!commit) {
      console.log('\nDry run complete. Re-run with --commit to apply.');
      return;
    }

    if (failures.length) {
      throw new Error(`Refusing to commit: ${failures.length} secret(s) failed verification.`);
    }

    // Phase 2 — backup, then write.
    const backupName = `${COLLECTION}_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
    if (docs.length) {
      await db.collection(backupName).insertMany(docs.map((d) => ({ ...d, _backupOf: d._id })));
      console.log(`\nBackup    : ${backupName} (${docs.length} docs)`);
    }
    for (const collection of INTEGRATION_COLLECTIONS) {
      const items = integrations.planned.filter((p) => p.collection === collection);
      if (!items.length) continue;
      const integrationBackup = `${collection}_keyrotation_backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await db.collection(integrationBackup).insertMany(items.map((p) => ({ ...p.original, _backupOf: p.original._id })));
      console.log(`Backup    : ${integrationBackup} (${items.length} docs)`);
      for (const item of items) {
        await db.collection(collection).updateOne({ _id: item._id }, { $set: item.$set });
      }
      console.log(`${collection} rewritten: ${items.length}`);
    }

    let written = 0;
    for (const item of planned) {
      await col.updateOne(
        { _id: item._id },
        { $set: { encryptedValue: item.encryptedValue, keyRotatedAt: new Date() } }
      );
      written += 1;
    }

    console.log(`Rewritten : ${written}`);
    console.log('\nNEXT STEPS');
    console.log(`  1. Set GATEWAY_SECRET_KEY=${toHex}`);
    console.log('  2. Restart the gateway.');
    console.log('  3. Confirm startup logs show "using GATEWAY_SECRET_KEY" and a job runs green.');
    console.log(`  4. Only then drop the backup: db.${backupName}.drop()`);
  } finally {
    await client.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(`\nERROR: ${err.message}`);
  process.exitCode = 1;
});
