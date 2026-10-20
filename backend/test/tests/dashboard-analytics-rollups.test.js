'use strict';

const {
  buildRollupPipeline,
  buildRollupDocuments,
  getFullHourRange,
  getOverviewFromRollups,
  getTimeseriesFromRollups,
  getErrorsFromRollups,
  getPerformanceFromRollups,
  RESPONSE_BUCKETS,
} = require('../../src/services/dashboard-analytics-rollups');

describe('dashboard analytics rollups', () => {
  it('splits a date range into complete UTC hours and partial boundaries', () => {
    const start = new Date('2026-09-08T18:30:00.000Z');
    const end = new Date('2026-09-09T18:29:59.999Z');

    expect(getFullHourRange(start, end)).toEqual({
      fullStart: new Date('2026-09-08T19:00:00.000Z'),
      fullEnd: new Date('2026-09-09T17:59:59.999Z'),
      leftEnd: new Date('2026-09-08T18:59:59.999Z'),
      rightStart: new Date('2026-09-09T18:00:00.000Z'),
    });
  });

  it('does not claim a complete hour when the requested range is shorter than one hour', () => {
    expect(getFullHourRange(new Date('2026-09-08T18:30:00.000Z'), new Date('2026-09-08T18:59:59.999Z'))).toBeNull();
  });

  it('builds one match plus durable rollup facets for all dashboard dimensions', () => {
    const pipeline = buildRollupPipeline({
      orgId: 145,
      start: new Date('2026-09-08T00:00:00.000Z'),
      end: new Date('2026-09-09T00:00:00.000Z'),
      bucketType: 'HOUR',
    });

    expect(pipeline[0]).toEqual({
      $match: {
        orgId: 145,
        startedAt: {
          $gte: new Date('2026-09-08T00:00:00.000Z'),
          $lte: new Date('2026-09-09T00:00:00.000Z'),
        },
      },
    });
    expect(pipeline[1].$facet).toEqual(
      expect.objectContaining({
        summary: expect.any(Array),
        summaryBuckets: expect.any(Array),
        successfulBuckets: expect.any(Array),
        eventTypes: expect.any(Array),
        integrations: expect.any(Array),
        errors: expect.any(Array),
      })
    );
  });

  it('converts aggregate facets into bounded, deterministic documents', () => {
    const docs = buildRollupDocuments(
      145,
      'HOUR',
      'build-1',
      {
        summary: [
          {
            _id: '2026-09-08T18:00:00.000Z',
            total: 4,
            successful: 2,
            failed: 1,
            skipped: 1,
            retrying: 0,
            pending: 0,
            responseTimeSum: 300,
            responseTimeCount: 2,
            successfulResponseTimeSum: 200,
            successfulResponseTimeCount: 2,
            minResponseTime: 50,
            maxResponseTime: 250,
            successfulMinResponseTime: 50,
            successfulMaxResponseTime: 150,
            lastSeen: new Date('2026-09-08T18:59:00.000Z'),
          },
        ],
        summaryBuckets: [
          { _id: { bucketStart: '2026-09-08T18:00:00.000Z', bucket: 1 }, count: 2 },
        ],
        successfulBuckets: [
          { _id: { bucketStart: '2026-09-08T18:00:00.000Z', bucket: 1 }, count: 1 },
        ],
        eventTypes: [
          {
            _id: { bucketStart: '2026-09-08T18:00:00.000Z', eventType: 'OP_VISIT_CREATED' },
            total: 4,
            successful: 2,
            failed: 1,
            skipped: 1,
            retrying: 0,
            pending: 0,
            responseTimeSum: 300,
            responseTimeCount: 2,
          },
        ],
        integrations: [
          {
            _id: {
              bucketStart: '2026-09-08T18:00:00.000Z',
              integrationConfigId: 'integration-1',
              integrationName: 'Example',
            },
            total: 4,
            successful: 2,
            failed: 1,
            skipped: 1,
            retrying: 0,
            pending: 0,
            responseTimeSum: 300,
            responseTimeCount: 2,
            lastSeen: new Date('2026-09-08T18:59:00.000Z'),
          },
        ],
        errors: [
          {
            _id: {
              bucketStart: '2026-09-08T18:00:00.000Z',
              message: 'timeout',
              status: 504,
              integrationId: 'integration-1',
              integrationName: 'Example',
            },
            count: 1,
            lastSeen: new Date('2026-09-08T18:59:00.000Z'),
          },
        ],
      },
      RESPONSE_BUCKETS
    );

    expect(docs).toHaveLength(4);
    expect(new Set(docs.map((doc) => doc._id)).size).toBe(docs.length);
    expect(docs.every((doc) => doc.orgId === 145 && doc.bucketType === 'HOUR' && doc.buildId === 'build-1')).toBe(true);

    const summary = docs.find((doc) => doc.kind === 'SUMMARY');
    expect(summary.metrics.total).toBe(4);
    expect(summary.metrics.successful).toBe(2);
    expect(summary.metrics.responseBuckets).toEqual([0, 2, ...new Array(RESPONSE_BUCKETS.length - 3).fill(0)]);
    expect(summary.metrics.successfulResponseBuckets).toEqual([0, 1, ...new Array(RESPONSE_BUCKETS.length - 3).fill(0)]);
  });

  it('reads each dashboard view from the same covered hourly materialization', async () => {
    const summary = {
      _id: '145:HOUR:2026-09-08T18:00:00.000Z:SUMMARY:summary',
      orgId: 145,
      bucketType: 'HOUR',
      bucketStart: new Date('2026-09-08T18:00:00.000Z'),
      kind: 'SUMMARY',
      buildId: 'build-1',
      metrics: {
        total: 4,
        successful: 2,
        failed: 1,
        skipped: 1,
        retrying: 0,
        pending: 0,
        responseTimeSum: 300,
        responseTimeCount: 2,
        successfulResponseTimeSum: 200,
        successfulResponseTimeCount: 2,
        minResponseTime: 50,
        maxResponseTime: 250,
        successfulMinResponseTime: 50,
        successfulMaxResponseTime: 150,
        responseBuckets: [0, 2, ...new Array(RESPONSE_BUCKETS.length - 3).fill(0)],
        successfulResponseBuckets: [0, 1, ...new Array(RESPONSE_BUCKETS.length - 3).fill(0)],
        lastSeen: new Date('2026-09-08T18:59:00.000Z'),
      },
    };
    const event = {
      ...summary,
      _id: 'event',
      kind: 'EVENT_TYPE',
      dimension: { eventType: 'OP_VISIT_CREATED' },
      metrics: { ...summary.metrics },
    };
    const integration = {
      ...summary,
      _id: 'integration',
      kind: 'INTEGRATION',
      dimension: { integrationConfigId: 'integration-1', integrationName: 'Example' },
      metrics: { ...summary.metrics },
    };
    const error = {
      ...summary,
      _id: 'error',
      kind: 'ERROR',
      dimension: { message: 'timeout', status: 504, integrationId: 'integration-1', integrationName: 'Example' },
      metrics: { count: 1, lastSeen: summary.metrics.lastSeen },
    };
    const documents = { SUMMARY: [summary], EVENT_TYPE: [event], INTEGRATION: [integration], ERROR: [error] };
    // The fake cursor selects by the kind predicate passed to find().
    const db = {
      collection: (name) => {
        if (name === 'dashboard_analytics_rollup_meta') {
          return {
            findOne: jest.fn().mockResolvedValue({
              state: 'READY',
              coverageStart: new Date('2026-09-08T00:00:00.000Z'),
              coverageEnd: new Date('2026-09-09T00:00:00.000Z'),
              buildId: 'build-1',
            }),
          };
        }
        return {
          find: jest.fn((query) => ({
            sort: jest.fn(() => ({
              toArray: jest.fn(async () => documents[query.kind] || []),
            })),
          })),
        };
      },
    };

    const start = new Date('2026-09-08T18:00:00.000Z');
    const end = new Date('2026-09-08T18:59:59.999Z');
    const overview = await getOverviewFromRollups(db, 145, start, end);
    const timeseries = await getTimeseriesFromRollups(db, 145, start, end, 'hour');
    const errors = await getErrorsFromRollups(db, 145, start, end);
    const performance = await getPerformanceFromRollups(db, 145, start, end);

    expect(overview.total).toBe(4);
    expect(overview.eventTypeAgg[0]).toMatchObject({ _id: 'OP_VISIT_CREATED', total: 4 });
    expect(overview.integrationAgg[0]).toMatchObject({ _id: 'integration-1', integrationName: 'Example', total: 4 });
    expect(timeseries[0]).toMatchObject({ _id: '2026-09-08T18:00:00.000Z', total: 4 });
    expect(errors[0]).toMatchObject({ _id: { message: 'timeout', status: 504 }, count: 1 });
    expect(performance).toMatchObject({ totalRequests: 4, successfulRequests: 2 });
    expect(performance.responseAgg).toMatchObject({ responseTimeCount: 2, minResponseTime: 50, maxResponseTime: 150 });
  });
});
