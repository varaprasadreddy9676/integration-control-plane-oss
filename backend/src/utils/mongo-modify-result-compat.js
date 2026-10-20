'use strict';

/**
 * MongoDB driver 6+ changed findOneAndUpdate / findOneAndReplace /
 * findOneAndDelete to return the document itself instead of
 * { value, ok, lastErrorObject }. Every caller here reads `result.value`, so
 * default `includeResultMetadata: true` to keep that shape. A caller that
 * passes the option explicitly gets what it asked for.
 */
const INSTALLED = Symbol.for('integration-gateway.modifyResultCompat');

// Position of the options argument for each method.
const OPTIONS_INDEX = { findOneAndUpdate: 2, findOneAndReplace: 2, findOneAndDelete: 1 };

function installModifyResultCompat(Collection) {
  const proto = Collection && Collection.prototype;
  if (!proto || proto[INSTALLED]) return;
  proto[INSTALLED] = true;

  for (const [method, index] of Object.entries(OPTIONS_INDEX)) {
    const original = proto[method];
    if (typeof original !== 'function') continue;
    proto[method] = function withResultMetadata(...args) {
      const options = args[index] || {};
      if (options.includeResultMetadata === undefined) {
        args[index] = { ...options, includeResultMetadata: true };
      }
      return original.apply(this, args);
    };
  }
}

module.exports = { installModifyResultCompat };
