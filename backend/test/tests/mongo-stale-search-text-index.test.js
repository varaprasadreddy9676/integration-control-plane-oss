'use strict';

/**
 * Production's execution_logs text index was created with a mangled weight
 * field (__KEEP_integrationName__) by an old codemod, so log search never
 * matched on integration names. It kept the right key shape (orgId prefix), so
 * the old "legacy index" check never replaced it.
 */

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { isStaleSearchTextIndex } = require('../../src/mongodb');

const current = {
  name: 'search_text_idx',
  key: { orgId: 1, _fts: 'text', _ftsx: 1 },
  weights: { integrationName: 10, eventType: 10, searchableText: 8, errorMessage: 5, targetUrl: 3, 'response.body': 1 },
};

describe('isStaleSearchTextIndex', () => {
  it('keeps the current definition', () => {
    expect(isStaleSearchTextIndex(current)).toBe(false);
  });

  it('flags an index without the orgId prefix (the original legacy case)', () => {
    expect(isStaleSearchTextIndex({ ...current, key: { _fts: 'text', _ftsx: 1 } })).toBe(true);
  });

  it('flags weights on a mangled __KEEP_ field (production, 2026-09)', () => {
    const { integrationName, ...rest } = current.weights;
    expect(isStaleSearchTextIndex({ ...current, weights: { ...rest, __KEEP_integrationName__: 10 } })).toBe(true);
  });

  it('flags an index that does not search integration names at all', () => {
    const { integrationName, ...rest } = current.weights;
    expect(isStaleSearchTextIndex({ ...current, weights: rest })).toBe(true);
  });

  it('treats a missing index as nothing to replace', () => {
    expect(isStaleSearchTextIndex(undefined)).toBe(false);
  });
});
