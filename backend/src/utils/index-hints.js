'use strict';

// Dropping a collection takes its indexes with it. Every hinted query against
// that collection then fails outright:
//
//   MongoServerError: planner returned error :: caused by ::
//   hint provided does not correspond to an existing index
//
// Until now the only cure was running src/scripts/ensure-mongodb-indexes.js by
// hand, because the main ensureIndexes() was never called at startup — so even a
// restart did not fix it.
//
// This module makes hints advisory rather than fatal:
//   - A hint is only applied when we know the index exists.
//   - If it does not, the query still runs (unhinted: slower, never wrong).
//   - Noticing a missing index schedules a debounced re-create, so the indexes
//     come back on their own without a restart or a manual script.
//
// Hints here are purely planner optimisations, so dropping one is always safe
// for correctness. A 500 is not.

const { log } = require('../logger');

/** collectionName -> Set<indexName> */
const knownIndexes = new Map();

let healer = null;
let healPending = false;
let lastHealAt = 0;
const HEAL_DEBOUNCE_MS = 60_000;

/**
 * Registered by mongodb.js so this module never has to require it back
 * (avoids a circular dependency).
 * @param {() => Promise<void>} fn recreates indexes and re-primes the cache
 */
function registerIndexHealer(fn) {
  healer = fn;
}

/** Record the indexes a collection actually has right now. */
function primeIndexCache(collectionName, indexNames) {
  knownIndexes.set(collectionName, new Set(indexNames));
}

function getKnownIndexes(collectionName) {
  const set = knownIndexes.get(collectionName);
  return set ? [...set] : null;
}

function resetIndexCache() {
  knownIndexes.clear();
  healPending = false;
  lastHealAt = 0;
}

/**
 * Debounced so a burst of failing queries triggers one repair, not hundreds.
 */
function scheduleHeal(reason) {
  if (!healer || healPending) return;
  if (Date.now() - lastHealAt < HEAL_DEBOUNCE_MS) return;

  healPending = true;
  const timer = setTimeout(() => {
    lastHealAt = Date.now();
    Promise.resolve()
      .then(() => healer())
      .then(() => log('info', 'Recreated missing MongoDB indexes automatically', { reason }))
      .catch((err) => log('error', 'Automatic index repair failed', { reason, error: err.message }))
      .finally(() => {
        healPending = false;
      });
  }, 0);
  if (typeof timer.unref === 'function') timer.unref();
}

/** MongoDB reports a hint on a non-existent index as BadValue (code 2). */
function isMissingIndexHintError(error) {
  return (
    error &&
    (error.code === 2 || error.codeName === 'BadValue') &&
    /hint provided does not correspond to an existing index/i.test(error.message || '')
  );
}

/**
 * A $text query needs its text index. It cannot be retried without it (the
 * results would change), but seeing the error means the index is gone — e.g. a
 * dropped collection that has since been recreated — so repair it.
 */
function isMissingTextIndexError(error) {
  return error && (error.code === 27 || /text index required/i.test(error.message || ''));
}

function forgetIndex(collectionName, indexName) {
  const known = knownIndexes.get(collectionName);
  if (known) known.delete(indexName);
}

/**
 * The cache alone is not enough: dropping a collection makes it stale
 * immediately, which is exactly when this matters. So the terminal operation is
 * wrapped — if the hint turns out to be dead, the query is retried without it
 * and a repair is scheduled. Costs nothing on the happy path.
 */
function guardTerminalOps(cursor, hintName, collectionName) {
  return retryTerminalOpsWithoutHint(
    cursor,
    () => {
      // clone() carries the hint, so clear it on the copy.
      const retry = cursor.clone();
      retry.hint(undefined);
      return retry;
    },
    collectionName,
    () => hintName
  );
}

/**
 * Drop-in replacement for the copy of this helper that used to live in seven
 * different files. Same signature, but it will not blow up on a missing index.
 *
 * @param {import('mongodb').FindCursor} cursor
 * @param {string} hintName
 */
function applyCursorHint(cursor, hintName) {
  if (!cursor || typeof cursor.hint !== 'function') return cursor;

  const collectionName = cursor.namespace && cursor.namespace.collection;
  const known = collectionName ? knownIndexes.get(collectionName) : null;

  // Known to be gone — skip the round trip entirely.
  if (known && !known.has(hintName)) {
    scheduleHeal(`${collectionName}.${hintName}`);
    return cursor;
  }

  cursor.hint(hintName);
  return typeof cursor.clone === 'function' ? guardTerminalOps(cursor, hintName, collectionName) : cursor;
}

/**
 * True when the hint is safe to pass as an aggregate() option. Aggregations take
 * their hint through options rather than a cursor, so they cannot use
 * applyCursorHint.
 */
function hintIfPresent(collectionName, hintName) {
  const known = knownIndexes.get(collectionName);
  if (known && known.has(hintName)) return { hint: hintName };
  scheduleHeal(`${collectionName}.${hintName}`);
  return {};
}

const SAFETY_NET_INSTALLED = Symbol.for('icp.hintSafetyNetInstalled');
// Set on a cursor by another layer to prepare the clone a retry runs on.
const CURSOR_RETRY_SETUP = Symbol.for('icp.cursorRetrySetup');
const TERMINAL_OPS = ['toArray', 'next', 'hasNext', 'forEach'];

function noteDroppedHint(collectionName, hintName) {
  if (collectionName && hintName) forgetIndex(collectionName, hintName);
  scheduleHeal(`${collectionName || 'unknown'}.${hintName || 'hint'}`);
  log('warn', 'Hinted query hit a missing index; retrying without the hint', {
    collection: collectionName,
    hint: hintName,
  });
}

/** On a missing-index hint error, run the operation again on `makeRetry()`. */
function retryTerminalOpsWithoutHint(cursor, makeRetry, collectionName, getHintName) {
  // The driver's toArray() calls next() internally. Only the outermost call may
  // recover: if the inner next() retried, it would return the first row from a
  // fresh cursor while toArray() carried on reading the dead one.
  let depth = 0;
  for (const method of TERMINAL_OPS) {
    if (typeof cursor[method] !== 'function') continue;
    const original = cursor[method].bind(cursor);
    cursor[method] = async function guarded(...args) {
      if (depth > 0) return original(...args);
      depth += 1;
      try {
        return await original(...args);
      } catch (error) {
        if (isMissingTextIndexError(error)) scheduleHeal(`${collectionName || 'unknown'}.text`);
        if (!isMissingIndexHintError(error)) throw error;
        noteDroppedHint(collectionName, getHintName());
        // clone() drops cursor.map transforms (e.g. decryption): re-apply them.
        const retry = makeRetry();
        const setup = cursor[CURSOR_RETRY_SETUP];
        return (typeof setup === 'function' ? setup(retry) : retry)[method](...args);
      } finally {
        depth -= 1;
      }
    };
  }
  return cursor;
}

/**
 * Installed once on the driver's Collection so EVERY hinted query — including
 * the ones that call .hint() / pass { hint } directly instead of going through
 * applyCursorHint — survives a dropped collection or index: it retries once
 * without the hint (slower, never wrong) and schedules an index repair.
 *
 * @param {Function} Collection the driver's Collection class
 */
function installHintSafetyNet(Collection) {
  const proto = Collection && Collection.prototype;
  if (!proto || proto[SAFETY_NET_INSTALLED]) return;
  proto[SAFETY_NET_INSTALLED] = true;

  const originalFind = proto.find;
  const originalAggregate = proto.aggregate;
  const originalCountDocuments = proto.countDocuments;

  proto.find = function find(...args) {
    const cursor = originalFind.apply(this, args);
    if (!cursor || typeof cursor.clone !== 'function' || typeof cursor.hint !== 'function') return cursor;
    return retryTerminalOpsWithoutHint(
      cursor,
      () => {
        const retry = cursor.clone();
        retry.hint(undefined);
        return retry;
      },
      this.collectionName,
      () => cursor._hint
    );
  };

  proto.aggregate = function aggregate(pipeline, options) {
    const cursor = originalAggregate.call(this, pipeline, options);
    if (!cursor || !options || !options.hint) return cursor;
    const { hint, ...withoutHint } = options;
    return retryTerminalOpsWithoutHint(
      cursor,
      () => originalAggregate.call(this, pipeline, withoutHint),
      this.collectionName,
      () => hint
    );
  };

  proto.countDocuments = async function countDocuments(filter, options) {
    try {
      return await originalCountDocuments.call(this, filter, options);
    } catch (error) {
      if (!options || !options.hint || !isMissingIndexHintError(error)) throw error;
      const { hint, ...withoutHint } = options;
      noteDroppedHint(this.collectionName, hint);
      return originalCountDocuments.call(this, filter, withoutHint);
    }
  };
}

module.exports = {
  installHintSafetyNet,
  applyCursorHint,
  hintIfPresent,
  primeIndexCache,
  getKnownIndexes,
  resetIndexCache,
  registerIndexHealer,
};
