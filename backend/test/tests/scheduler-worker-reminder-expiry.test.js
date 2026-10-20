'use strict';

jest.mock('../../src/data', () => ({}));
jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));
jest.mock('../../src/worker-heartbeat', () => ({
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
}));

const { getReminderExpirationDetails } = require('../../src/processor/scheduler-worker');

describe('scheduler-worker reminder expiry guard', () => {
  it('expires overdue reminder messages after the allowed lateness window', () => {
    const now = new Date('2026-03-11T06:54:22.000Z');
    const result = getReminderExpirationDetails(
      {
        __KEEP_integrationName__: 'Fabrikam - Reminder 2 (T-3hrs)',
        scheduledFor: '2026-03-11T05:30:00.000Z',
        payload: {
          metadata: {
            messageType: 'reminder_2_t3',
          },
        },
      },
      {
        name: 'Fabrikam - Reminder 2 (T-3hrs)',
      },
      now
    );

    expect(result).toEqual(
      expect.objectContaining({
        expired: true,
        overdueMinutes: 84,
      })
    );
  });

  it('does not expire non-reminder scheduled integrations', () => {
    const now = new Date('2026-03-11T06:54:22.000Z');
    const result = getReminderExpirationDetails(
      {
        __KEEP_integrationName__: 'Nightly Export',
        scheduledFor: '2026-03-11T05:30:00.000Z',
        payload: {
          metadata: {
            messageType: 'export_job',
          },
        },
      },
      {
        name: 'Nightly Export',
      },
      now
    );

    expect(result).toEqual({ expired: false });
  });

  it('allows a reminder that is only slightly overdue', () => {
    const now = new Date('2026-03-11T05:50:00.000Z');
    const result = getReminderExpirationDetails(
      {
        __KEEP_integrationName__: 'Fabrikam - Reminder 2 (T-3hrs)',
        scheduledFor: '2026-03-11T05:30:00.000Z',
        payload: {
          metadata: {
            messageType: 'reminder_2_t3',
          },
        },
      },
      {
        name: 'Fabrikam - Reminder 2 (T-3hrs)',
      },
      now
    );

    expect(result).toEqual({ expired: false });
  });

  it('expires unlabeled pre-appointment reminders once the appointment time has passed', () => {
    const now = new Date('2026-03-11T06:00:00.000Z');
    const result = getReminderExpirationDetails(
      {
        __KEEP_integrationName__: 'Fabrikam WhatsApp Template',
        scheduledFor: '2026-03-11T03:30:00.000Z',
        originalPayload: {
          appt: {
            apptDate: '2026-03-11',
            apptTime: '10:45:00',
          },
        },
        payload: {
          metadata: {},
        },
      },
      {
        name: 'Fabrikam WhatsApp Template',
      },
      now
    );

    expect(result).toEqual(
      expect.objectContaining({
        expired: true,
      })
    );
    expect(result.reason).toContain('appointment time passed');
  });

  it('does not expire post-appointment follow-ups that are not reminders', () => {
    const now = new Date('2026-03-11T12:00:00.000Z');
    const result = getReminderExpirationDetails(
      {
        __KEEP_integrationName__: 'Fabrikam Post Visit Follow-up',
        scheduledFor: '2026-03-11T09:30:00.000Z',
        originalPayload: {
          appt: {
            apptDate: '2026-03-11',
            apptTime: '10:45:00',
          },
        },
        payload: {
          metadata: {
            messageType: 'followup_d_plus_1',
          },
        },
      },
      {
        name: 'Fabrikam Post Visit Follow-up',
      },
      now
    );

    expect(result).toEqual({ expired: false });
  });
});
