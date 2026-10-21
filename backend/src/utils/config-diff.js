'use strict';

/**
 * Field-level diff of two integration configurations, used by integration
 * history. Plain objects are walked; arrays and other values are compared as a
 * whole, so a reordered mapping list shows as one change to that list.
 */

const { isSecretField, SECRET_MASK } = require('./integration-secrets');

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const comparable = (value) => (value instanceof Date ? value.toISOString() : value);
const sameValue = (a, b) => JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));

function walk(before, after, path, parentKey, grandparentKey, maskSecrets, out) {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  for (const key of keys) {
    const a = before ? before[key] : undefined;
    const b = after ? after[key] : undefined;
    const childPath = path ? `${path}.${key}` : key;
    const secret = isSecretField(key, parentKey, grandparentKey);

    if (!secret && isPlainObject(a) && isPlainObject(b)) {
      walk(a, b, childPath, key, parentKey, maskSecrets, out);
      continue;
    }
    if (sameValue(a, b)) continue;

    const kind = a === undefined ? 'added' : b === undefined ? 'removed' : 'changed';
    if (secret && maskSecrets) {
      out.push({
        path: childPath,
        kind,
        before: a === undefined ? undefined : SECRET_MASK,
        after: b === undefined ? undefined : SECRET_MASK,
        secret: true,
      });
    } else {
      out.push({ path: childPath, kind, before: a, after: b });
    }
  }
  return out;
}

/** Changes from `before` to `after`, sorted by path. */
function diffConfigs(before, after, { maskSecrets = false } = {}) {
  return walk(before || {}, after || {}, '', '', '', maskSecrets, []);
}

/** Short, unique labels for a list of changed paths (at most two segments each). */
function summarizePaths(paths) {
  return [...new Set(paths.map((p) => p.split('.').slice(0, 2).join('.')))];
}

module.exports = { diffConfigs, summarizePaths };
