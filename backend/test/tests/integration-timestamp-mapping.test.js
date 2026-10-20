'use strict';

const { mapIntegrationFromMongo } = require('../../src/data/helpers');

describe('integration timestamp mapping', () => {
  it('does not abort a complete integration export when a legacy timestamp is malformed', () => {
    const integration = mapIntegrationFromMongo({
      _id: { toString: () => 'integration-1' },
      orgId: 33,
      name: 'Legacy integration',
      createdAt: 'not-a-date',
      updatedAt: new Date('2026-10-01T00:00:00.000Z'),
    });

    expect(integration.createdAt).toBeNull();
    expect(integration.updatedAt).toBe('2026-10-01T00:00:00.000Z');
  });
});
