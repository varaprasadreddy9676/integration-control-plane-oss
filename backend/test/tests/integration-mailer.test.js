'use strict';

/**
 * The gateway's own emails (failure reports, integration alerts, daily
 * reports) can go out through an existing email integration's SMTP account
 * instead of an external communication service, which production never had.
 */

const mockConfig = { mail: { viaIntegrationId: null, viaIntegrationOrgId: null } };
const mockIntegration = {
  _id: 'int-email',
  orgId: 33,
  actions: [
    {
      kind: 'COMMUNICATION',
      communicationConfig: {
        channel: 'EMAIL',
        provider: 'SMTP',
        smtp: { host: 'smtp.example.com', port: 587, username: 'u', password: 'p', fromEmail: 'reports@example.com' },
      },
    },
  ],
};
const mockFindOne = jest.fn(async () => mockIntegration);
const mockSend = jest.fn(async () => ({ messageId: 'm-1' }));

jest.mock('../../src/config', () => mockConfig);
jest.mock('../../src/mongodb', () => ({
  toObjectId: (id) => id,
  getDbSafe: jest.fn(async () => ({ collection: () => ({ findOne: mockFindOne }) })),
}));
jest.mock('../../src/services/communication/adapter-registry', () => ({ send: mockSend }));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const { isIntegrationMailConfigured, deliverEmail } = require('../../src/services/notifications/integration-mailer');

describe('integration mailer', () => {
  beforeEach(() => {
    mockSend.mockClear();
    mockFindOne.mockClear();
    mockConfig.mail = { viaIntegrationId: 'int-email', viaIntegrationOrgId: 33 };
  });

  it('is off until an integration is configured', () => {
    mockConfig.mail = { viaIntegrationId: null, viaIntegrationOrgId: null };
    expect(isIntegrationMailConfigured()).toBe(false);
  });

  it("sends through the integration's SMTP account", async () => {
    await deliverEmail({ to: 'ops@example.com', subject: 'Alert', html: '<p>x</p>' });
    expect(mockFindOne.mock.calls[0][0]).toEqual({ _id: 'int-email', orgId: 33 });
    expect(mockSend).toHaveBeenCalledWith(
      'EMAIL',
      'SMTP',
      { to: 'ops@example.com', subject: 'Alert', html: '<p>x</p>', attachments: undefined },
      expect.objectContaining({ host: 'smtp.example.com', fromEmail: 'reports@example.com' })
    );
  });

  it('fails clearly when the integration has no email action', async () => {
    mockFindOne.mockResolvedValueOnce({ ...mockIntegration, actions: [] });
    await expect(deliverEmail({ to: 'ops@example.com', subject: 'Alert', html: '' })).rejects.toThrow(/email/i);
  });
});
