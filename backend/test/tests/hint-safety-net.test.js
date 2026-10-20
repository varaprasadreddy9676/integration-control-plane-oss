'use strict';

/**
 * ~35 queries pass .hint() / { hint } straight to the driver instead of going
 * through applyCursorHint, so dropping a collection (which takes its indexes
 * with it) turned those screens into 500s until the indexes were rebuilt. The
 * safety net is installed once on the driver's Collection, so every hinted
 * query — today's and future ones — retries without the hint instead.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const { installHintSafetyNet, resetIndexCache, registerIndexHealer } = require('../../src/utils/index-hints');

const missingIndexError = () =>
  Object.assign(new Error('planner returned error :: caused by :: hint provided does not correspond to an existing index'), {
    code: 2,
    codeName: 'BadValue',
  });

/** Stand-in cursor: fails while a hint is set, the way a dropped index does. */
function makeCursor({ hint, rows, otherError } = {}) {
  return {
    _hint: hint,
    hint(name) {
      this._hint = name;
      return this;
    },
    clone() {
      return makeCursor({ hint: this._hint, rows, otherError });
    },
    async toArray() {
      if (otherError) throw otherError;
      if (this._hint) throw missingIndexError();
      return rows;
    },
    async next() {
      return (await this.toArray())[0] ?? null;
    },
  };
}

function makeCollectionClass({ rows = [{ a: 1 }], otherError } = {}) {
  class FakeCollection {
    constructor(name) {
      this.collectionName = name;
      this.countCalls = [];
    }

    find() {
      return makeCursor({ rows, otherError });
    }

    aggregate(_pipeline, options = {}) {
      return makeCursor({ hint: options.hint, rows, otherError });
    }

    async countDocuments(_filter, options = {}) {
      this.countCalls.push(options);
      if (otherError) throw otherError;
      if (options.hint) throw missingIndexError();
      return rows.length;
    }
  }
  installHintSafetyNet(FakeCollection);
  return FakeCollection;
}

describe('hint safety net (dropped collections / missing indexes)', () => {
  beforeEach(() => resetIndexCache());

  it('find().hint(...) on a missing index returns results instead of throwing', async () => {
    const Collection = makeCollectionClass();
    const col = new Collection('event_audit');
    await expect(col.find({}).hint('parent_received_idx').toArray()).resolves.toEqual([{ a: 1 }]);
    await expect(col.find({}).hint('parent_received_idx').next()).resolves.toEqual({ a: 1 });
  });

  it('aggregate(..., { hint }) on a missing index returns results instead of throwing', async () => {
    const Collection = makeCollectionClass();
    const col = new Collection('execution_logs');
    await expect(col.aggregate([], { allowDiskUse: true, hint: 'org_created_idx' }).toArray()).resolves.toEqual([
      { a: 1 },
    ]);
  });

  it('countDocuments(..., { hint }) retries without the hint and keeps other options', async () => {
    const Collection = makeCollectionClass({ rows: [1, 2, 3] });
    const col = new Collection('failed_deliveries');
    await expect(col.countDocuments({}, { hint: 'org_failed_idx', limit: 10 })).resolves.toBe(3);
    expect(col.countCalls[1]).toEqual({ limit: 10 });
  });

  it('schedules an index repair when it has to drop a hint', async () => {
    jest.useFakeTimers();
    const healer = jest.fn().mockResolvedValue();
    registerIndexHealer(healer);
    const Collection = makeCollectionClass();
    await new Collection('event_audit').countDocuments({}, { hint: 'parent_received_idx' });
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    expect(healer).toHaveBeenCalledTimes(1);
  });

  it('does not swallow unrelated errors', async () => {
    const boom = new Error('connection reset');
    const Collection = makeCollectionClass({ otherError: boom });
    const col = new Collection('event_audit');
    await expect(col.find({}).hint('x').toArray()).rejects.toBe(boom);
    await expect(col.countDocuments({}, { hint: 'x' })).rejects.toBe(boom);
  });

  it('returns every row when toArray() drives next() internally, as the real driver does', async () => {
    const rows = [{ a: 1 }, { a: 2 }, { a: 3 }];
    const driverLikeCursor = (hint) => {
      let position = 0;
      let dead = false;
      return {
        _hint: hint,
        hint(name) {
          this._hint = name;
          return this;
        },
        clone() {
          return driverLikeCursor(this._hint);
        },
        async next() {
          if (dead) return null;
          if (this._hint) {
            dead = true;
            throw missingIndexError();
          }
          return rows[position++] ?? null;
        },
        async toArray() {
          const out = [];
          for (let doc = await this.next(); doc; doc = await this.next()) out.push(doc);
          return out;
        },
      };
    };
    class DriverLikeCollection {
      constructor() {
        this.collectionName = 'event_audit';
      }

      find() {
        return driverLikeCursor(undefined);
      }
    }
    installHintSafetyNet(DriverLikeCollection);
    await expect(new DriverLikeCollection().find({}).hint('gone').toArray()).resolves.toEqual(rows);
  });

  it('a $text query on a missing text index schedules the index repair too', async () => {
    let fresh;
    jest.isolateModules(() => {
      fresh = require('../../src/utils/index-hints');
    });
    jest.useFakeTimers();
    const healer = jest.fn().mockResolvedValue();
    fresh.registerIndexHealer(healer);
    const textError = Object.assign(new Error('text index required for $text query'), { code: 27 });
    class TextCollection {
      constructor() {
        this.collectionName = 'lookups';
      }

      find() {
        return makeCursor({ otherError: textError });
      }
    }
    fresh.installHintSafetyNet(TextCollection);
    await expect(new TextCollection().find({ $text: { $search: 'x' } }).toArray()).rejects.toBe(textError);
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    await new Promise((resolve) => setImmediate(resolve));
    expect(healer).toHaveBeenCalledTimes(1);
  });

  it('re-applies a registered transform to the retry cursor (decryption survives a hint retry)', async () => {
    const setupFor = Symbol.for('icp.cursorRetrySetup');
    class TransformingCollection {
      constructor() {
        this.collectionName = 'integration_configs';
      }

      find() {
        return makeCursor({ rows: [{ secret: 'enc' }] });
      }
    }
    installHintSafetyNet(TransformingCollection);
    const cursor = new TransformingCollection().find({}).hint('gone');
    cursor[setupFor] = (clone) => ({ toArray: async () => (await clone.toArray()).map(() => ({ secret: 'plain' })) });
    await expect(cursor.toArray()).resolves.toEqual([{ secret: 'plain' }]);
  });

  it('installs once, even if called again', () => {
    const Collection = makeCollectionClass();
    const find = Collection.prototype.find;
    installHintSafetyNet(Collection);
    expect(Collection.prototype.find).toBe(find);
  });
});
