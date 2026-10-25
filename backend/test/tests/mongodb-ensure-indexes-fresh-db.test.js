'use strict';

/**
 * A new install starts with no collections. ensureIndexes() must still create every
 * index: reading the indexes of a collection that does not exist yet used to throw,
 * which stopped it at execution_logs and left the rest of the database unindexed.
 * Needs a real MongoDB (STAGE_MONGO_TEST_URI; see stage-store.test.js).
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `fresh_indexes_test_${process.pid}`;
}

const mongodb = require('../../src/mongodb');

jest.setTimeout(60000);

describeMongo('ensureIndexes on a database with no collections', () => {
  let db;
  beforeAll(async () => {
    db = await mongodb.connect();
  });
  afterAll(async () => {
    await db.dropDatabase();
    await mongodb.close();
  });

  it('creates the execution log indexes and the ones listed after them', async () => {
    expect(await db.listCollections().toArray()).toHaveLength(0);
    await mongodb.ensureIndexes();
    const names = (await db.collection('execution_logs').indexes()).map((index) => index.name);
    expect(names).toEqual(expect.arrayContaining(['org_integration_config_created_idx', 'org_integration_ref_created_idx']));
    expect(names.length).toBeGreaterThan(20);
    // A collection indexed later in the same pass.
    expect((await db.collection('scheduled_job_locks').indexes()).length).toBeGreaterThan(1);
  });

  it('can run again on the database it just indexed', async () => {
    await expect(mongodb.ensureIndexes()).resolves.not.toThrow();
  });
});
