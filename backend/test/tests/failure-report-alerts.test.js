'use strict';

/**
 * Failure email reports were enabled in production but had never sent a single
 * email: they looked for 'failed' / 'abandoned' / 'retrying', while delivery
 * logs store FAILED / ABANDONED / RETRYING. Separately, integration failure
 * alerts (e.g. a partner's expired certificate) now reuse the same
 * recipient and switch to reach people by email.
 */

const mockDistinct = jest.fn(async () => []);
const mockUiConfig = { notifications: { failureEmailReports: { enabled: true, email: 'ops@example.com' } } };

jest.mock('../../src/mongodb', () => ({
  isConnected: jest.fn(() => true),
  getDbSafe: jest.fn(async () => ({
    collection: () => ({ distinct: mockDistinct, findOne: jest.fn(async () => null) }),
  })),
}));
jest.mock('../../src/data', () => ({
  getUiConfigForEntity: jest.fn(async () => mockUiConfig),
  getTenant: jest.fn(async () => ({ tenantName: 'Tailspin Clinic', tenantCode: 'OVAL', tenantEmail: null })),
  recordAlertCenterLog: jest.fn(async () => true),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/config', () => ({ frontendUrl: 'https://console.example.com' }));

const { processFailureReports, sendAlertEmail } = require('../../src/services/notifications/failure-report');

describe('failure email reports', () => {
  it('match the statuses delivery logs actually store', async () => {
    await processFailureReports();
    const filter = mockDistinct.mock.calls[0][1];
    expect(filter.status.$in).toEqual(expect.arrayContaining(['FAILED', 'ABANDONED', 'RETRYING']));
  });
});

describe('sendAlertEmail', () => {
  const alert = {
    type: 'INTEGRATION_DELIVERY_FAILING',
    subject: 'Integration deliveries failing: OP_VISIT_CREATED',
    errorMessage: 'certificate has expired',
  };

  it('emails the configured failure-report recipient', async () => {
    const send = jest.fn(async () => ({ status: 200, body: '{}' }));
    const result = await sendAlertEmail(847, alert, { send });
    expect(send).toHaveBeenCalledTimes(1);
    const { payload, subject } = send.mock.calls[0][0];
    expect(subject).toBe(alert.subject);
    expect(JSON.stringify(payload)).toContain('ops@example.com');
    expect(JSON.stringify(payload)).toContain('certificate has expired');
    expect(result.sent).toBe(true);
  });

  it('sends nothing when failure emails are switched off for the org', async () => {
    mockUiConfig.notifications.failureEmailReports.enabled = false;
    const send = jest.fn();
    const result = await sendAlertEmail(847, alert, { send });
    expect(send).not.toHaveBeenCalled();
    expect(result.sent).toBe(false);
    mockUiConfig.notifications.failureEmailReports.enabled = true;
  });
});
