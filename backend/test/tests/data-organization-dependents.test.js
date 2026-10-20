'use strict';

const mockCollections = {
  users: { countDocuments: jest.fn(), updateMany: jest.fn() },
  integration_configs: { countDocuments: jest.fn(), updateMany: jest.fn() },
};

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn(async () => ({ collection: (name) => mockCollections[name] })),
  isConnected: jest.fn(() => true),
}));

jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

jest.mock('../../src/data/helpers', () => ({
  useMongo: jest.fn(() => true),
  fallbackDisabledError: jest.fn(),
}));

const { countOrganizationDependents, deactivateOrganizationDependents } = require('../../src/data/organizations');

describe('organization dependents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts active users and all integrations for the org', async () => {
    mockCollections.users.countDocuments.mockResolvedValue(1);
    mockCollections.integration_configs.countDocuments.mockResolvedValue(4);

    await expect(countOrganizationDependents(648)).resolves.toEqual({ activeUsers: 1, integrations: 4 });
    expect(mockCollections.users.countDocuments).toHaveBeenCalledWith({ orgId: 648, isActive: { $ne: false } });
    expect(mockCollections.integration_configs.countDocuments).toHaveBeenCalledWith({ orgId: 648 });
  });

  it('deactivates only that org\'s active users and enabled integrations', async () => {
    mockCollections.users.updateMany.mockResolvedValue({ modifiedCount: 2 });
    mockCollections.integration_configs.updateMany.mockResolvedValue({ modifiedCount: 3 });

    await expect(deactivateOrganizationDependents(648)).resolves.toEqual({
      usersDeactivated: 2,
      integrationsDisabled: 3,
    });
    expect(mockCollections.users.updateMany).toHaveBeenCalledWith(
      { orgId: 648, isActive: { $ne: false } },
      { $set: { isActive: false, updatedAt: expect.any(Date) } }
    );
    expect(mockCollections.integration_configs.updateMany).toHaveBeenCalledWith(
      { orgId: 648, isActive: true },
      { $set: { isActive: false, updatedAt: expect.any(Date) } }
    );
  });
});
