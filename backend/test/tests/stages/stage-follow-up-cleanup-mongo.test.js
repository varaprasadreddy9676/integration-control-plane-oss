'use strict';

/**
 * The follow-up body cleanup against a real MongoDB (STAGE_MONGO_TEST_URI; see
 * stage-store.test.js): recent checks become masked stage runs, every check loses
 * its bodies and headers, and running it again changes nothing.
 */

const TEST_URI = process.env.STAGE_MONGO_TEST_URI;
const describeMongo = TEST_URI ? describe : describe.skip;
if (TEST_URI) {
  process.env.MONGODB_URI = TEST_URI;
  process.env.MONGODB_DATABASE = `stage_cleanup_test_${process.pid}`;
}

const mongodb = require('../../../src/mongodb');
const { ensureAllStageIndexes } = require('../../../src/stages/indexes');
const { cleanFollowUpBodies } = require('../../../src/stages/migration/cleanup');

jest.setTimeout(60000);

const ORG = 81;
let db;

describeMongo('follow-up body cleanup (MongoDB)', () => {
  beforeAll(async () => {
    db = await mongodb.connect();
    await ensureAllStageIndexes(db);
  });
  afterAll(async () => {
    await db.dropDatabase();
    await mongodb.close();
  });

  it('copies recent checks as masked runs, strips every body, and is idempotent', async () => {
    const now = new Date('2026-10-24T10:00:00Z');
    const call = {
      method: 'GET',
      url: 'https://api.provider.test/v1/messages?msgid=m-1&api_key=abcd1234',
      headers: { 'x-api-key': 'live-key-9876' },
      statusCode: 200,
      durationMs: 40,
      responseBody: JSON.stringify({ message: { payload: { message: { status: 'read', recipient: '919876543210' } } } }),
    };
    const { insertedId } = await db.collection('execution_logs').insertOne({
      orgId: ORG,
      integrationConfigId: 'int-1',
      followUp: {
        status: 'READ',
        done: true,
        history: [
          { check: 1, at: new Date('2026-08-01T10:00:00Z'), outcome: 'RESULT', status: 'SENT', durationMs: 50, httpCalls: [call] },
          { check: 2, at: new Date('2026-10-20T10:00:00Z'), outcome: 'RESULT', status: 'READ', durationMs: 45, httpCalls: [call] },
        ],
      },
    });
    await db.collection('execution_logs').insertOne({ orgId: ORG + 1, followUp: { history: [{ check: 1, at: now, httpCalls: [call] }] } });

    expect(await cleanFollowUpBodies({ orgId: ORG, now })).toEqual({ logs: 1, checksCopied: 1, checksStripped: 2 });
    expect(await db.collection('stage_runs').countDocuments({})).toBe(0); // counting changed nothing

    await cleanFollowUpBodies({ orgId: ORG, commit: true, now });
    const runs = await db.collection('stage_runs').find({}).toArray();
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ _id: `followup:${insertedId}:2`, deliveryId: String(insertedId), seq: 2, status: 'READ', stage: { id: 'deliveryStatus' } });
    expect(JSON.stringify(runs[0])).not.toMatch(/live-key-9876|919876543210|abcd1234/);

    const logDoc = await db.collection('execution_logs').findOne({ _id: insertedId });
    expect(logDoc.followUp.bodiesCleanedAt).toEqual(now);
    expect(logDoc.followUp.history.map((check) => check.httpCalls[0])).toEqual([
      { method: 'GET', url: 'https://api.provider.test/v1/messages?msgid=m-1&api_key=[REDACTED]', statusCode: 200, durationMs: 40, error: null },
      { method: 'GET', url: 'https://api.provider.test/v1/messages?msgid=m-1&api_key=[REDACTED]', statusCode: 200, durationMs: 40, error: null },
    ]);
    expect(logDoc.followUp.status).toBe('READ');

    expect(await cleanFollowUpBodies({ orgId: ORG, commit: true, now })).toEqual({ logs: 0, checksCopied: 0, checksStripped: 0 });
    // Another org's logs were not touched.
    expect((await db.collection('execution_logs').findOne({ orgId: ORG + 1 })).followUp.history[0].httpCalls[0].headers).toBeDefined();
  });
});
