'use strict';

const { installModifyResultCompat } = require('../../src/utils/mongo-modify-result-compat');

// Driver 6+ returns the document from findOneAnd* unless includeResultMetadata
// is set; every caller in this codebase reads `result.value` (the 4.x shape).
function fakeCollection() {
  class Collection {}
  const seen = [];
  Collection.prototype.findOneAndUpdate = async function (filter, update, options) {
    seen.push(['update', options]);
    return options && options.includeResultMetadata ? { value: { a: 1 }, ok: 1 } : { a: 1 };
  };
  Collection.prototype.findOneAndReplace = async function (filter, replacement, options) {
    seen.push(['replace', options]);
    return options && options.includeResultMetadata ? { value: { a: 1 }, ok: 1 } : { a: 1 };
  };
  Collection.prototype.findOneAndDelete = async function (filter, options) {
    seen.push(['delete', options]);
    return options && options.includeResultMetadata ? { value: { a: 1 }, ok: 1 } : { a: 1 };
  };
  return { Collection, seen };
}

describe('installModifyResultCompat', () => {
  it('returns the { value } shape by default for all three methods', async () => {
    const { Collection } = fakeCollection();
    installModifyResultCompat(Collection);
    const c = new Collection();
    expect(await c.findOneAndUpdate({}, { $set: { a: 1 } })).toEqual({ value: { a: 1 }, ok: 1 });
    expect(await c.findOneAndReplace({}, { a: 1 }, { returnDocument: 'after' })).toEqual({ value: { a: 1 }, ok: 1 });
    expect(await c.findOneAndDelete({})).toEqual({ value: { a: 1 }, ok: 1 });
  });

  it('keeps caller options and respects an explicit includeResultMetadata', async () => {
    const { Collection, seen } = fakeCollection();
    installModifyResultCompat(Collection);
    const c = new Collection();
    await c.findOneAndUpdate({}, {}, { returnDocument: 'after', upsert: true });
    expect(seen[0][1]).toEqual({ returnDocument: 'after', upsert: true, includeResultMetadata: true });
    expect(await c.findOneAndUpdate({}, {}, { includeResultMetadata: false })).toEqual({ a: 1 });
  });

  it('installs only once', async () => {
    const { Collection, seen } = fakeCollection();
    installModifyResultCompat(Collection);
    installModifyResultCompat(Collection);
    await new Collection().findOneAndDelete({});
    expect(seen).toHaveLength(1);
  });
});
