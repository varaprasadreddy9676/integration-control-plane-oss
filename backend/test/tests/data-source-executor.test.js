'use strict';

const mockQuery = jest.fn();
const mockRelease = jest.fn();

jest.mock('../../src/db', () => ({
  getConnection: jest.fn(async () => ({
    query: mockQuery,
    release: mockRelease
  }))
}));

jest.mock('../../src/mongodb', () => ({
  getDb: jest.fn()
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn()
}));

describe('data-source-executor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockQuery.mockResolvedValue([[{ id: 1 }]]);
  });

  it('accepts MYSQL as an alias for SQL data sources', async () => {
    const { executeDataSource } = require('../../src/services/data-source-executor');

    const result = await executeDataSource(
      { type: 'MYSQL', query: 'SELECT id FROM users' },
      { orgId: 1, _id: 'job-1', name: 'Daily Job' }
    );

    expect(result).toEqual([{ id: 1 }]);
    expect(mockQuery).toHaveBeenCalledWith('SELECT id FROM users');
  });

  it('rejects mutating SQL data-source queries by default', async () => {
    const { executeDataSource } = require('../../src/services/data-source-executor');

    await expect(
      executeDataSource(
        { type: 'SQL', query: 'UPDATE users SET isActive = 0' },
        { orgId: 1, _id: 'job-1', name: 'Daily Job' }
      )
    ).rejects.toThrow('SQL data sources only support read-only SELECT/WITH queries');

    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('allows explicit unsafe SQL only when opted in', async () => {
    const { executeDataSource } = require('../../src/services/data-source-executor');

    await executeDataSource(
      { type: 'SQL', query: 'UPDATE users SET isActive = 0', allowUnsafeQuery: true },
      { orgId: 1, _id: 'job-1', name: 'Daily Job' }
    );

    expect(mockQuery).toHaveBeenCalledWith('UPDATE users SET isActive = 0');
  });
});
