'use strict';

const mockGetDbSafe = jest.fn();

jest.mock('../../src/mongodb', () => ({
  getDbSafe: (...args) => mockGetDbSafe(...args),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/worker-heartbeat', () => ({
  updateHeartbeat: jest.fn(),
}));

const { MysqlEventSource } = require('../../src/adapters/MysqlEventSource');

describe('MysqlEventSource.getRuntimeStatus', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDbSafe.mockResolvedValue({
      collection: jest.fn(() => ({
        findOne: jest.fn().mockResolvedValue(null),
        updateOne: jest.fn().mockResolvedValue({}),
      })),
    });
  });

  it('reports connected status when the pool probe succeeds', async () => {
    const pool = {
      query: jest.fn().mockResolvedValue([[{ 1: 1 }]]),
      execute: jest.fn(),
    };

    const adapter = new MysqlEventSource({
      orgId: 812,
      pool,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'transaction_type',
        payload: 'message',
      },
      pollIntervalMs: 5000,
      batchSize: 10,
    });

    const status = await adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('connected');
    expect(status.connectionProbe).toEqual(
      expect.objectContaining({
        ok: true,
      })
    );
    expect(pool.query).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports error status when the pool probe fails', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error('connect ETIMEDOUT')),
      execute: jest.fn(),
    };

    const adapter = new MysqlEventSource({
      orgId: 812,
      pool,
      table: 'notification_queue',
      columnMapping: {
        id: 'id',
        orgId: 'entity_parent_rid',
        eventType: 'transaction_type',
        payload: 'message',
      },
    });

    const status = await adapter.getRuntimeStatus();

    expect(status.connectionStatus).toBe('error');
    expect(status.connectionProbe).toEqual({
      ok: false,
      error: 'connect ETIMEDOUT',
    });
  });
});

// Regression: orgs configured with useSharedPool:false get a dedicated mysql2
// pool from DeliveryWorkerManager._createMysqlPool() that only this adapter
// instance owns. stop() used to only clear the polling timer, never closing
// that pool — its idle connections stayed ESTABLISHED for the process's whole
// remaining lifetime, including through graceful shutdown, which is why the
// gateway wouldn't exit on SIGTERM until start-backend.sh's 30s SIGKILL
// fallback. Fixed by having stop() end the pool it owns — but only when it
// owns it: orgs on the shared pool pass a poolProvider, and closing THAT pool
// here would break every other consumer of the shared pool mid-shutdown.
describe('MysqlEventSource.stop — dedicated pool cleanup', () => {
  const baseConfig = {
    orgId: 812,
    table: 'notification_queue',
    columnMapping: {
      id: 'id',
      orgId: 'entity_parent_rid',
      eventType: 'transaction_type',
      payload: 'message',
    },
    pollIntervalMs: 5000,
  };

  it('ends its own dedicated pool on stop when no poolProvider is set', async () => {
    const pool = { query: jest.fn(), execute: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
    const adapter = new MysqlEventSource({ ...baseConfig, pool });

    await adapter.start(jest.fn());
    await adapter.stop();

    expect(pool.end).toHaveBeenCalledTimes(1);
  });

  it('does not end the pool when it is shared via poolProvider', async () => {
    const sharedPool = { query: jest.fn(), execute: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
    const adapter = new MysqlEventSource({
      ...baseConfig,
      pool: sharedPool,
      poolProvider: () => sharedPool,
    });

    await adapter.start(jest.fn());
    await adapter.stop();

    expect(sharedPool.end).not.toHaveBeenCalled();
  });

  it('does not throw if the adapter was never started', async () => {
    const pool = { query: jest.fn(), execute: jest.fn(), end: jest.fn().mockResolvedValue(undefined) };
    const adapter = new MysqlEventSource({ ...baseConfig, pool });

    await expect(adapter.stop()).resolves.toBeUndefined();
    expect(pool.end).not.toHaveBeenCalled();
  });
});
