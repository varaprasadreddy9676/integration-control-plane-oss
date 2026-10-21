'use strict';

/**
 * The global MySQL pool can be configured at runtime (System Config in MongoDB,
 * applied after the data layer starts). The availability flag was only set at
 * startup, when the pool was not configured yet, so /health reported MySQL
 * "disconnected" for months while polling through that pool worked.
 */

const mockDb = {
  configured: false,
  isConfigured: jest.fn(() => mockDb.configured),
  ping: jest.fn(async () => true),
};

jest.mock('../../src/db', () => mockDb);
jest.mock('../../src/mongodb', () => ({
  connect: jest.fn(async () => undefined),
  getDb: jest.fn(() => ({})),
  getDbSafe: jest.fn(async () => ({ collection: () => ({ createIndex: jest.fn(async () => undefined) }) })),
  isConnected: jest.fn(() => true),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn(), setDb: jest.fn() }));

describe('MySQL availability after runtime configuration', () => {
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.useFakeTimers();
    // The reconnection monitor is switched off under NODE_ENV=test.
    process.env.NODE_ENV = 'production';
  });

  afterEach(() => {
    jest.useRealTimers();
    process.env.NODE_ENV = originalEnv;
  });

  it('notices a pool that is configured after startup', async () => {
    const data = require('../../src/data');
    await data.initDataLayer();
    expect(data.isMysqlAvailable()).toBe(false);

    // System Config is applied after initDataLayer and configures the pool.
    mockDb.configured = true;
    await jest.advanceTimersByTimeAsync(30000);

    expect(mockDb.ping).toHaveBeenCalled();
    expect(data.isMysqlAvailable()).toBe(true);
  });

  it('can be re-checked right after the pool is configured, without waiting for the monitor', async () => {
    jest.resetModules();
    mockDb.configured = false;
    const data = require('../../src/data');
    await data.initDataLayer();

    mockDb.configured = true;
    await data.refreshMysqlAvailability();

    expect(data.isMysqlAvailable()).toBe(true);
  });
});
