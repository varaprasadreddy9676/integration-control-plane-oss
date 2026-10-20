'use strict';

describe('mongodb execution_logs index migration', () => {
  let mongodb;
  let mockExecutionLogsCollection;
  let mockDb;
  let connectMock;

  beforeEach(() => {
    jest.resetModules();

    connectMock = jest.fn().mockResolvedValue(undefined);
    mockExecutionLogsCollection = {
      collectionName: 'execution_logs',
      indexes: jest.fn().mockResolvedValue([
        { name: '_id_', key: { _id: 1 } },
        { name: 'integration_created_idx', key: { integrationConfigId: 1, createdAt: -1 } },
        { name: 'integration_status_created_idx', key: { integrationConfigId: 1, status: 1, createdAt: -1 } },
        {
          name: 'search_text_idx',
          key: {
            __KEEP_integrationName__: 'text',
            eventType: 'text',
            searchableText: 'text',
          },
        },
      ]),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      createIndexes: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined),
    };

    const genericCollection = {
      collectionName: 'generic',
      indexes: jest.fn().mockResolvedValue([]),
      dropIndex: jest.fn().mockResolvedValue(undefined),
      createIndexes: jest.fn().mockResolvedValue(undefined),
      createIndex: jest.fn().mockResolvedValue(undefined),
    };

    mockDb = {
      collection: jest.fn((name) => (name === 'execution_logs' ? mockExecutionLogsCollection : genericCollection)),
    };

    const mockClient = {
      connect: connectMock,
      db: jest.fn(() => mockDb),
      close: jest.fn().mockResolvedValue(undefined),
    };

    jest.doMock('../../src/config', () => ({
      mongodb: {
        uri: 'mongodb://localhost:27017',
        database: 'integration_gateway_test',
        options: {},
      },
    }));

    jest.doMock('../../src/logger', () => ({
      log: jest.fn(),
    }));

    jest.doMock('mongodb', () => ({
      MongoClient: jest.fn(() => mockClient),
      ObjectId: class ObjectId {},
    }));

    mongodb = require('../../src/mongodb');
  });

  it('drops obsolete execution_logs indexes and recreates org-scoped ones', async () => {
    await mongodb.connect();
    await mongodb.ensureIndexes();

    expect(connectMock).toHaveBeenCalled();
    expect(mockExecutionLogsCollection.dropIndex).toHaveBeenCalledWith('integration_created_idx');
    expect(mockExecutionLogsCollection.dropIndex).toHaveBeenCalledWith('integration_status_created_idx');
    expect(mockExecutionLogsCollection.dropIndex).toHaveBeenCalledWith('search_text_idx');
    const executionIndexDefs = mockExecutionLogsCollection.createIndexes.mock.calls[0][0];
    expect(executionIndexDefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'org_started_idx',
          key: { orgId: 1, startedAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_direction_started_idx',
          key: { orgId: 1, direction: 1, startedAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_trigger_started_idx',
          key: { orgId: 1, triggerType: 1, startedAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_integration_ref_created_idx',
          key: { orgId: 1, integrationRefKey: 1, createdAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_integration_ref_status_created_idx',
          key: { orgId: 1, integrationRefKey: 1, status: 1, createdAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_integration_config_started_idx',
          key: { orgId: 1, integrationConfigId: 1, startedAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_integration_config_created_idx',
          key: { orgId: 1, integrationConfigId: 1, createdAt: -1 },
        }),
        expect.objectContaining({
          name: 'org_webhook_config_created_idx',
          key: { orgId: 1, webhookConfigId: 1, createdAt: -1 },
        }),
      ])
    );

    expect(mockExecutionLogsCollection.createIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 1,
        integrationName: 'text',
        eventType: 'text',
        searchableText: 'text',
      }),
      expect.objectContaining({
        name: 'search_text_idx',
      })
    );
  });

  it('does not create indexes as part of connect()', async () => {
    await mongodb.connect();

    expect(connectMock).toHaveBeenCalled();
    expect(mockExecutionLogsCollection.createIndexes).not.toHaveBeenCalled();
    expect(mockExecutionLogsCollection.createIndex).not.toHaveBeenCalled();
  });
});
