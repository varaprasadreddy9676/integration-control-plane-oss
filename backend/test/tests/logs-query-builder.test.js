'use strict';

describe('buildLogsQuery', () => {
  let buildLogsQuery;

  beforeEach(() => {
    jest.resetModules();

    jest.doMock('../../src/logger', () => ({
      log: jest.fn(),
      logError: jest.fn(),
    }));

    jest.doMock('../../src/mongodb', () => {
      class FakeObjectId {
        constructor(value) {
          this.value = value;
        }

        toString() {
          return this.value;
        }
      }

      return {
        ObjectId: FakeObjectId,
        toObjectId: jest.fn((value) => {
          if (typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)) {
            return new FakeObjectId(value.toLowerCase());
          }
          return null;
        }),
      };
    });

    jest.doMock('../../src/data/helpers', () => ({
      useMongo: jest.fn(() => true),
      normalizeOrgId: jest.fn((orgId) => Number(orgId)),
      buildOrgScopeQuery: jest.fn((orgId) => ({ orgId })),
      addOrgScope: jest.fn((query, orgId) => ({ ...query, orgId: Number(orgId) })),
      fallbackDisabledError: jest.fn(),
      mapLogFromMongo: jest.fn((value) => value),
      mapIntegrationFromMongo: jest.fn((value) => value),
    }));

    ({ buildLogsQuery } = require('../../src/data/logs'));
  });

  it('filters by the exact client IP, trimmed', () => {
    expect(buildLogsQuery(145, { clientIp: '  203.0.113.61 ' })).toEqual({ orgId: 145, clientIp: '203.0.113.61' });
    expect(buildLogsQuery(145, { clientIp: '   ' })).toEqual({ orgId: 145 });
  });

  it('uses org-scoped text search instead of regex clauses', () => {
    const query = buildLogsQuery(145, {
      status: 'failed',
      search: 'patient mrn',
      startDate: '2026-03-20T00:00:00.000Z',
      endDate: '2026-03-27T23:59:59.999Z',
    });

    expect(query).toEqual({
      orgId: 145,
      status: { $in: ['FAILED', 'ABANDONED'] },
      $text: { $search: 'patient mrn' },
      createdAt: {
        $gte: new Date('2026-03-20T00:00:00.000Z'),
        $lte: new Date('2026-03-27T23:59:59.999Z'),
      },
    });
  });

  it('switches search to regex clauses when text search is disabled', () => {
    const query = buildLogsQuery(
      145,
      {
        status: 'failed',
        search: 'patient mrn',
      },
      { useTextSearch: false }
    );

    expect(query).toEqual({
      orgId: 145,
      status: { $in: ['FAILED', 'ABANDONED'] },
      $and: [
        {
          $or: [
            { integrationName: { $regex: 'patient mrn', $options: 'i' } },
            { __KEEP_integrationName__: { $regex: 'patient mrn', $options: 'i' } },
            { eventType: { $regex: 'patient mrn', $options: 'i' } },
            { searchableText: { $regex: 'patient mrn', $options: 'i' } },
            { errorMessage: { $regex: 'patient mrn', $options: 'i' } },
            { targetUrl: { $regex: 'patient mrn', $options: 'i' } },
            { 'response.body': { $regex: 'patient mrn', $options: 'i' } },
            { clientIp: { $regex: 'patient mrn', $options: 'i' } },
          ],
        },
      ],
    });
  });

  it('adds canonical and legacy integration filters for integration-scoped queries', () => {
    const integrationId = '67e4e72e8a6f3f2a12345678';
    const query = buildLogsQuery(145, {
      __KEEP___KEEP_integrationConfig__Id__: integrationId,
    });

    expect(query.orgId).toBe(145);
    expect(query.$and).toHaveLength(1);
    expect(query.$and[0]).toEqual({
      $or: [
        { integrationRefKey: integrationId },
        { integrationConfigId: expect.anything() },
        { integrationConfigId: integrationId },
        { __KEEP___KEEP_integrationConfig__Id__: expect.anything() },
        { __KEEP___KEEP_integrationConfig__Id__: integrationId },
        { webhookConfigId: expect.anything() },
        { webhookConfigId: integrationId },
      ],
    });
  });

  it('combines provider-resolved integration ids with other log filters', () => {
    const providerIds = ['67e4e72e8a6f3f2a12345678', 'integration-string-id'];
    const query = buildLogsQuery(145, {
      providerIntegrationIds: providerIds,
      direction: 'OUTBOUND',
    });

    expect(query).toMatchObject({ orgId: 145, direction: 'OUTBOUND' });
    expect(query.$and).toEqual([
      {
        $or: [
          { integrationRefKey: { $in: providerIds } },
          { integrationConfigId: { $in: providerIds } },
          { __KEEP___KEEP_integrationConfig__Id__: { $in: providerIds } },
          { webhookConfigId: { $in: providerIds } },
        ],
      },
    ]);
  });

  it('uses indexed createdAt windows for hour and day filters when a bounded date range is present', () => {
    const query = buildLogsQuery(145, {
      hour: '10',
      dayOfWeek: 'Fri',
      timezoneOffset: '-330',
      startDate: '2026-03-20T00:00:00.000Z',
      endDate: '2026-03-27T23:59:59.999Z',
    });

    expect(query.createdAt).toBeUndefined();
    expect(query.$and).toEqual([
      {
        $or: [
          {
            createdAt: {
              $gte: new Date('2026-03-20T04:30:00.000Z'),
              $lte: new Date('2026-03-20T05:29:59.999Z'),
            },
          },
          {
            createdAt: {
              $gte: new Date('2026-03-27T04:30:00.000Z'),
              $lte: new Date('2026-03-27T05:29:59.999Z'),
            },
          },
        ],
      },
    ]);
  });

  it('falls back to timezone-aware $expr filtering when no bounded date range is provided', () => {
    const query = buildLogsQuery(145, {
      hour: '10',
      dayOfWeek: 'Fri',
      timezoneOffset: '-330',
    });

    expect(query.$and).toHaveLength(1);
    expect(query.$and[0]).toEqual({
      $expr: {
        $and: [
          {
            $eq: [{ $hour: { date: { $ifNull: ['$startedAt', '$createdAt'] }, timezone: '+05:30' } }, 10],
          },
          {
            $eq: [{ $dayOfWeek: { date: { $ifNull: ['$startedAt', '$createdAt'] }, timezone: '+05:30' } }, 6],
          },
        ],
      },
    });
  });
});
