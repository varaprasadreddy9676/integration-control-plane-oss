'use strict';

// Dropping a collection drops its indexes, and every hinted query against it
// then fails with BadValue until someone manually runs ensure-mongodb-indexes.js.
// These tests pin the behaviour that makes that self-correcting.

jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const { log } = require('../../src/logger');
const {
  applyCursorHint,
  hintIfPresent,
  primeIndexCache,
  getKnownIndexes,
  resetIndexCache,
  registerIndexHealer,
} = require('../../src/utils/index-hints');

function missingIndexError() {
  const err = new Error(
    'error processing query: planner returned error :: caused by :: hint provided does not correspond to an existing index'
  );
  err.code = 2;
  err.codeName = 'BadValue';
  return err;
}

/** Minimal stand-in for a driver FindCursor. */
function makeCursor({ collection = 'admin_audit', rows = [{ a: 1 }], failWithHint = false } = {}) {
  const cursor = {
    namespace: { db: 'test', collection },
    _hint: undefined,
    hintCalls: [],
    hint(name) {
      this._hint = name;
      this.hintCalls.push(name);
      return this;
    },
    clone() {
      const c = makeCursor({ collection, rows, failWithHint });
      c._hint = this._hint;
      c.cloned = true;
      cloneRegistry.push(c);
      return c;
    },
    async toArray() {
      if (failWithHint && this._hint !== undefined) throw missingIndexError();
      return rows;
    },
    async next() {
      if (failWithHint && this._hint !== undefined) throw missingIndexError();
      return rows[0];
    },
  };
  return cursor;
}

let cloneRegistry = [];

describe('index hints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetIndexCache();
    registerIndexHealer(null);
    cloneRegistry = [];
  });

  describe('applyCursorHint', () => {
    it('applies the hint when the index is known to exist', async () => {
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
      const cursor = makeCursor();

      const result = applyCursorHint(cursor, 'admin_audit_created_idx');
      await result.toArray();

      expect(cursor.hintCalls).toEqual(['admin_audit_created_idx']);
    });

    it('skips the hint entirely when the index is known to be missing', () => {
      primeIndexCache('admin_audit', ['_id_']); // index dropped
      const cursor = makeCursor();

      applyCursorHint(cursor, 'admin_audit_created_idx');

      expect(cursor.hintCalls).toEqual([]);
    });

    it('retries without the hint when the cache is stale — the dropped-collection case', async () => {
      // Cache says the index is there; the collection was dropped underneath us.
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
      const cursor = makeCursor({ failWithHint: true, rows: [{ a: 1 }, { a: 2 }] });

      const rows = await applyCursorHint(cursor, 'admin_audit_created_idx').toArray();

      expect(rows).toHaveLength(2);
      const retried = cloneRegistry[0];
      expect(retried).toBeDefined();
      expect(retried._hint).toBeUndefined(); // hint cleared on the retry
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('retrying without the hint'),
        expect.objectContaining({ collection: 'admin_audit' })
      );
    });

    it('forgets the dead index so later queries do not retry the same failure', async () => {
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
      const cursor = makeCursor({ failWithHint: true });

      await applyCursorHint(cursor, 'admin_audit_created_idx').toArray();

      expect(getKnownIndexes('admin_audit')).not.toContain('admin_audit_created_idx');
    });

    it('guards next() as well as toArray()', async () => {
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
      const cursor = makeCursor({ failWithHint: true, rows: [{ a: 7 }] });

      await expect(applyCursorHint(cursor, 'admin_audit_created_idx').next()).resolves.toEqual({ a: 7 });
    });

    it('does not swallow unrelated errors', async () => {
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
      const cursor = makeCursor();
      cursor.toArray = async () => {
        throw new Error('connection reset');
      };

      await expect(applyCursorHint(cursor, 'admin_audit_created_idx').toArray()).rejects.toThrow(
        'connection reset'
      );
    });

    it('triggers a repair when it finds a missing index', async () => {
      const healer = jest.fn().mockResolvedValue(undefined);
      registerIndexHealer(healer);
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);

      await applyCursorHint(makeCursor({ failWithHint: true }), 'admin_audit_created_idx').toArray();
      await new Promise((r) => setTimeout(r, 20));

      expect(healer).toHaveBeenCalledTimes(1);
    });

    it('debounces repairs so a burst of failures does not stampede', async () => {
      const healer = jest.fn().mockResolvedValue(undefined);
      registerIndexHealer(healer);
      primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);

      for (let i = 0; i < 5; i += 1) {
        primeIndexCache('admin_audit', ['_id_', 'admin_audit_created_idx']);
        // eslint-disable-next-line no-await-in-loop
        await applyCursorHint(makeCursor({ failWithHint: true }), 'admin_audit_created_idx').toArray();
      }
      await new Promise((r) => setTimeout(r, 30));

      expect(healer).toHaveBeenCalledTimes(1);
    });

    it('passes non-cursor values through untouched', () => {
      expect(applyCursorHint(null, 'x')).toBeNull();
      expect(applyCursorHint({}, 'x')).toEqual({});
    });

    it('keeps the original behaviour when the driver exposes no namespace', async () => {
      const cursor = makeCursor();
      delete cursor.namespace;

      applyCursorHint(cursor, 'some_idx');

      expect(cursor.hintCalls).toEqual(['some_idx']);
    });
  });

  describe('hintIfPresent (aggregations)', () => {
    it('returns the hint option when the index exists', () => {
      primeIndexCache('scheduled_job_logs', ['job_started_idx']);
      expect(hintIfPresent('scheduled_job_logs', 'job_started_idx')).toEqual({
        hint: 'job_started_idx',
      });
    });

    it('returns no hint — rather than a failing one — when the index is gone', () => {
      primeIndexCache('scheduled_job_logs', ['_id_']);
      expect(hintIfPresent('scheduled_job_logs', 'job_started_idx')).toEqual({});
    });

    it('schedules a repair when the index is missing', async () => {
      const healer = jest.fn().mockResolvedValue(undefined);
      registerIndexHealer(healer);
      primeIndexCache('scheduled_job_logs', ['_id_']);

      hintIfPresent('scheduled_job_logs', 'job_started_idx');
      await new Promise((r) => setTimeout(r, 20));

      expect(healer).toHaveBeenCalledTimes(1);
    });
  });
});
