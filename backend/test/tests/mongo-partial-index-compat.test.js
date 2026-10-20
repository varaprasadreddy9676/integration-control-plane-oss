'use strict';

/**
 * Production runs MongoDB 4.4 and validation 5.0. Neither accepts $in, $or, $ne
 * or $nin inside a partialFilterExpression — those arrived in 6.0. A spec that
 * uses one makes createIndexes reject the WHOLE batch it is sent with, so every
 * index in that safeCreateIndexes call silently goes missing (it only logs a
 * warning).
 *
 * That is how pending_events ran with no indexes at all on both servers: its
 * TTL used `status: { $in: ['done', 'failed'] }`, taking the claim index down
 * with it. This pins every partial filter to the 4.4-supported operator set.
 */

const fs = require('fs');
const path = require('path');

const MONGODB_SOURCE = fs.readFileSync(path.join(__dirname, '../../src/mongodb.js'), 'utf8');
const UNSUPPORTED_ON_4_4 = ['$in', '$or', '$nin', '$ne', '$not', '$regex'];

const partialFilters = () => {
  const filters = [];
  const marker = 'partialFilterExpression:';
  let from = MONGODB_SOURCE.indexOf(marker);
  while (from !== -1) {
    const start = MONGODB_SOURCE.indexOf('{', from);
    let depth = 0;
    let end = start;
    for (; end < MONGODB_SOURCE.length; end++) {
      if (MONGODB_SOURCE[end] === '{') depth++;
      if (MONGODB_SOURCE[end] === '}') depth--;
      if (depth === 0) break;
    }
    filters.push(MONGODB_SOURCE.slice(start, end + 1));
    from = MONGODB_SOURCE.indexOf(marker, end);
  }
  return filters;
};

describe('MongoDB 4.4 partial index compatibility', () => {
  it('finds the partial filters it is guarding', () => {
    expect(partialFilters().length).toBeGreaterThan(0);
  });

  it.each(UNSUPPORTED_ON_4_4)('no partialFilterExpression uses %s', (operator) => {
    const offending = partialFilters().filter((filter) => filter.includes(`${operator}:`));
    expect(offending).toEqual([]);
  });

  it('migrates the legacy scheduled-job lock index before creating its TTL replacement', () => {
    expect(MONGODB_SOURCE).toContain("dropIndexIfPresent(scheduledJobLocksCollection, 'locked_until_idx')");
    expect(MONGODB_SOURCE).not.toContain("{ key: { lockedUntil: 1 }, name: 'locked_until_idx' }");
    expect(MONGODB_SOURCE).toContain("name: 'lock_ttl_idx'");
  });
});
