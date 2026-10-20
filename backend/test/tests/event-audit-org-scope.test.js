'use strict';

// Without an org, an event-audit query must return nothing. Passing the
// builder's null straight to MongoDB matched every org's events on driver 4
// (find(null) means "everything") and is a server error on driver 6+.
const mockCollection = { find: jest.fn(), countDocuments: jest.fn() };
const mockDb = { collection: jest.fn(() => mockCollection) };

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => mockDb),
  isConnected: jest.fn(() => true),
}));

const eventAudit = require('../../src/data/event-audit');

describe('event audit without an org', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, null, '', 'abc'])('listEventAudit(%p) returns no events without querying', async (orgId) => {
    const result = await eventAudit.listEventAudit(orgId, { limit: 5 });
    expect(result).toEqual({ events: [], total: 0, pages: 0, page: 1 });
    expect(mockCollection.find).not.toHaveBeenCalled();
    expect(mockCollection.countDocuments).not.toHaveBeenCalled();
  });

  it('countEventAudit returns 0 without querying', async () => {
    expect(await eventAudit.countEventAudit('', {})).toBe(0);
    expect(mockCollection.countDocuments).not.toHaveBeenCalled();
  });

  it('streamEventAuditForExport streams nothing without querying', async () => {
    const onEvent = jest.fn();
    await eventAudit.streamEventAuditForExport(null, {}, onEvent);
    expect(onEvent).not.toHaveBeenCalled();
    expect(mockCollection.find).not.toHaveBeenCalled();
  });
});
