'use strict';

/**
 * Integration credentials are encrypted in MongoDB. The layer sits on the
 * driver's Collection (integration_configs only), so the ~20 places that read
 * integration configs — delivery workers, DLQ, schedulers, auth helper — get
 * plaintext without each having to remember to decrypt.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const {
  ENCRYPTED_PREFIX,
  encryptSecretFields,
  encryptUpdate,
  decryptSecrets,
  installEncryptionAtRest,
} = require('../../src/utils/secrets-at-rest');

const isEncrypted = (value) => typeof value === 'string' && value.startsWith('enc:');

const doc = () => ({
  name: 'Lab Orders',
  outgoingAuthType: 'CUSTOM',
  outgoingAuthConfig: {
    tokenEndpoint: 'https://api.example.com/token',
    tokenRequestBody: { username: 'u', password: 'p' },
    clientSecret: 'shh',
    headers: { 'X-Api-Key': 'k-1' },
  },
  inboundAuthConfig: { secrets: ['a', 'b'], toleranceSeconds: 300 },
  actions: [{ communicationConfig: { smtp: { host: 'smtp.example.com', password: 'Republic' } } }],
});

describe('encryptSecretFields / decryptSecrets', () => {
  it('encrypts every credential and nothing else', () => {
    const enc = encryptSecretFields(doc());
    expect(isEncrypted(enc.outgoingAuthConfig.clientSecret)).toBe(true);
    expect(isEncrypted(enc.outgoingAuthConfig.tokenRequestBody)).toBe(true);
    expect(isEncrypted(enc.outgoingAuthConfig.headers['X-Api-Key'])).toBe(true);
    expect(enc.inboundAuthConfig.secrets.every(isEncrypted)).toBe(true);
    expect(isEncrypted(enc.actions[0].communicationConfig.smtp.password)).toBe(true);
    expect(enc.outgoingAuthConfig.tokenEndpoint).toBe('https://api.example.com/token');
    expect(enc.actions[0].communicationConfig.smtp.host).toBe('smtp.example.com');
    expect(enc.inboundAuthConfig.toleranceSeconds).toBe(300);
  });

  it('round-trips exactly, keeping object-typed values as objects', () => {
    expect(decryptSecrets(encryptSecretFields(doc()))).toEqual(doc());
  });

  it('does not encrypt twice', () => {
    const once = encryptSecretFields(doc());
    expect(encryptSecretFields(once)).toEqual(once);
  });

  it('never encrypts the API mask or empty values', () => {
    const enc = encryptSecretFields({ outgoingAuthConfig: { password: '********', apiKey: '', token: null } });
    expect(enc.outgoingAuthConfig).toEqual({ password: '********', apiKey: '', token: null });
  });

  it('passes plaintext through on read, so data written before encryption still works', () => {
    expect(decryptSecrets(doc())).toEqual(doc());
  });

  it('turns a value it cannot decrypt (wrong key) into null instead of sending ciphertext as a password', () => {
    const tampered = { outgoingAuthConfig: { password: `${ENCRYPTED_PREFIX}00:00:00` } };
    expect(decryptSecrets(tampered).outgoingAuthConfig.password).toBeNull();
  });
});

describe('encryptUpdate', () => {
  it('encrypts dotted $set paths such as the OAuth token cache', () => {
    const update = encryptUpdate({
      $set: {
        'outgoingAuthConfig._cachedToken': 'eyJ.token',
        'outgoingAuthConfig._tokenExpiresAt': '2026-01-01T00:00:00Z',
        'outgoingAuthConfig.headers.X-Api-Key': 'k-2',
        'actions.0.communicationConfig.smtp.password': 'new',
        name: 'renamed',
      },
    });
    expect(isEncrypted(update.$set['outgoingAuthConfig._cachedToken'])).toBe(true);
    expect(isEncrypted(update.$set['outgoingAuthConfig.headers.X-Api-Key'])).toBe(true);
    expect(isEncrypted(update.$set['actions.0.communicationConfig.smtp.password'])).toBe(true);
    expect(update.$set['outgoingAuthConfig._tokenExpiresAt']).toBe('2026-01-01T00:00:00Z');
    expect(update.$set.name).toBe('renamed');
  });

  it('encrypts whole sub-documents set at once', () => {
    const update = encryptUpdate({ $set: { outgoingAuthConfig: { username: 'lab', password: 'pw' } } });
    expect(update.$set.outgoingAuthConfig.username).toBe('lab');
    expect(isEncrypted(update.$set.outgoingAuthConfig.password)).toBe(true);
  });

  it('treats an operator-free update as a replacement document', () => {
    const update = encryptUpdate({ name: 'x', outgoingAuthConfig: { password: 'pw' } });
    expect(isEncrypted(update.outgoingAuthConfig.password)).toBe(true);
  });

  it('leaves aggregation-pipeline updates alone', () => {
    const pipeline = [{ $set: { name: 'x' } }];
    expect(encryptUpdate(pipeline)).toBe(pipeline);
  });
});

describe('installEncryptionAtRest (driver Collection)', () => {
  function makeCollectionClass() {
    const stores = new Map();
    const storeFor = (name) => {
      if (!stores.has(name)) stores.set(name, []);
      return stores.get(name);
    };
    const cursorOver = (rows) => {
      let transform = (row) => row;
      return {
        map(fn) {
          const previous = transform;
          transform = (row) => fn(previous(row));
          return this;
        },
        async toArray() {
          return rows.map((row) => transform(row));
        },
        async next() {
          return rows.length ? transform(rows[0]) : null;
        },
      };
    };
    class FakeCollection {
      constructor(name) {
        this.collectionName = name;
        this.rows = storeFor(name);
      }

      async insertOne(document) {
        const stored = { _id: `id-${this.rows.length + 1}`, ...document };
        document._id = stored._id;
        this.rows.push(stored);
        return { insertedId: stored._id };
      }

      async updateOne(_filter, update) {
        const row = this.rows[0];
        for (const [path, value] of Object.entries(update.$set || {})) {
          const parts = path.split('.');
          let target = row;
          for (const part of parts.slice(0, -1)) target = target[part] ??= {};
          target[parts[parts.length - 1]] = value;
        }
        return { matchedCount: 1 };
      }

      async findOneAndUpdate(filter, update) {
        await this.updateOne(filter, update);
        return { value: this.rows[0] };
      }

      find() {
        return cursorOver(this.rows);
      }

      aggregate() {
        return cursorOver(this.rows);
      }

      async findOne() {
        return this.find().next();
      }
    }
    installEncryptionAtRest(FakeCollection, { collections: ['integration_configs'] });
    return FakeCollection;
  }

  it('stores credentials encrypted and hands every reader plaintext', async () => {
    const Collection = makeCollectionClass();
    const col = new Collection('integration_configs');
    const original = doc();
    await col.insertOne(original);

    expect(original._id).toBe('id-1');
    expect(original.outgoingAuthConfig.clientSecret).toBe('shh');
    expect(isEncrypted(col.rows[0].outgoingAuthConfig.clientSecret)).toBe(true);

    expect((await col.findOne({})).outgoingAuthConfig.clientSecret).toBe('shh');
    expect((await col.find({}).toArray())[0].actions[0].communicationConfig.smtp.password).toBe('Republic');
    expect((await col.aggregate([]).toArray())[0].inboundAuthConfig.secrets).toEqual(['a', 'b']);
  });

  it('encrypts dotted updates and decrypts findOneAndUpdate results', async () => {
    const Collection = makeCollectionClass();
    const col = new Collection('integration_configs');
    await col.insertOne(doc());
    const result = await col.findOneAndUpdate({}, { $set: { 'outgoingAuthConfig._cachedToken': 'eyJ.t' } });
    expect(isEncrypted(col.rows[0].outgoingAuthConfig._cachedToken)).toBe(true);
    expect(result.value.outgoingAuthConfig._cachedToken).toBe('eyJ.t');
  });

  it('encrypts the credentials inside integration history snapshots by default', async () => {
    class HistoryCollection {
      constructor(name) {
        this.collectionName = name;
        this.rows = [];
      }

      async insertOne(document) {
        this.rows.push(JSON.parse(JSON.stringify(document)));
        return { insertedId: 'rev-1' };
      }
    }
    installEncryptionAtRest(HistoryCollection);
    const col = new HistoryCollection('integration_revisions');
    await col.insertOne({ revision: 1, snapshot: doc() });

    const stored = col.rows[0].snapshot;
    expect(isEncrypted(stored.outgoingAuthConfig.clientSecret)).toBe(true);
    expect(stored.outgoingAuthConfig.tokenEndpoint).toBe('https://api.example.com/token');
  });

  it('leaves every other collection untouched', async () => {
    const Collection = makeCollectionClass();
    const col = new Collection('execution_logs');
    await col.insertOne({ request: { headers: { password: 'plain' } }, outgoingAuthConfig: { password: 'plain' } });
    expect(col.rows[0].outgoingAuthConfig.password).toBe('plain');
  });
});
