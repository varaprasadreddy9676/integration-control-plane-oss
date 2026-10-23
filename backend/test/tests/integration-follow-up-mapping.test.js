'use strict';

jest.mock('../../src/mongodb', () => ({ toObjectId: jest.fn(), ObjectId: class {} }));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { mapIntegrationFromMongo } = require('../../src/data/helpers');

// The read mapper is a whitelist: a field it does not list is saved but never
// reaches the API or the delivery engine, as deliveryFollowUp did at first.
describe('integration read mapping', () => {
  const doc = { _id: 'abc', orgId: 7, name: 'WA', eventType: 'X', targetUrl: 'https://p.example/send' };

  it('returns the delivery follow-up configuration', () => {
    const deliveryFollowUp = { enabled: true, script: 'return null;', checkAfterSeconds: [30, 300] };
    expect(mapIntegrationFromMongo({ ...doc, deliveryFollowUp }).deliveryFollowUp).toEqual(deliveryFollowUp);
  });

  it('is null for an integration without one', () => {
    expect(mapIntegrationFromMongo(doc).deliveryFollowUp).toBeNull();
  });
});
