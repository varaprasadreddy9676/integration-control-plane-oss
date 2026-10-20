'use strict';

jest.mock('../../src/data', () => ({
  resolveOrgIdFromEvent: jest.fn(() => 648),
  listIntegrationsForProcessing: jest.fn(),
  markEventComplete: jest.fn(),
  createScheduledIntegration: jest.fn(),
  recordLog: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/services/transformer', () => ({
  applyTransform: jest.fn(),
  getTransformationSkipReason: jest.fn(() => null),
  isTransformationSkipped: jest.fn(() => false),
}));

jest.mock('../../src/services/scheduler', () => ({
  executeSchedulingScript: jest.fn(),
}));

jest.mock('../../src/processor/event-normalizer', () => ({
  normalizeEventSubject: jest.fn(),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateCorrelationId: jest.fn(() => 'corr-reschedule-1'),
}));

jest.mock('../../src/processor/delivery-engine', () => ({
  deliverToIntegration: jest.fn(),
}));

const data = require('../../src/data');
const { applyTransform } = require('../../src/services/transformer');
const { executeSchedulingScript } = require('../../src/services/scheduler');
const { normalizeEventSubject } = require('../../src/processor/event-normalizer');
const { processEvent } = require('../../src/processor/event-processor');

describe('event-processor reschedule scheduling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    data.listIntegrationsForProcessing.mockResolvedValue([
      {
        id: 'cfg-reminder-2',
        name: 'Fabrikam - Reminder 2 (T-3hrs)',
        type: 'APPOINTMENT_CONFIRMATION',
        eventType: 'APPOINTMENT_CONFIRMATION',
        deliveryMode: 'DELAYED',
        targetUrl: 'https://api.qikchat.in/v1/messages',
        httpMethod: 'POST',
        resourceType: 'APPOINTMENT',
        subjectExtraction: {
          mode: 'PATHS',
          paths: {
            apptRID: ['appt.apptRID', 'apptRID'],
          },
        },
        lifecycleRules: [
          {
            eventTypes: ['APPOINTMENT_RESCHEDULED'],
            action: 'RESCHEDULE_PENDING',
            matchKeys: ['apptRID'],
            ruleMode: 'SIMPLE',
          },
        ],
        schedulingConfig: {
          script: 'return toTimestamp(addHours(parseDate("2026-06-30T13:00:00+05:30"), -3));',
        },
      },
    ]);
    applyTransform.mockResolvedValue({ outbound: true, template: 'reminder_2' });
    executeSchedulingScript.mockResolvedValue(Date.now() + 3 * 60 * 60 * 1000);
    normalizeEventSubject.mockResolvedValue({
      subjectType: 'APPOINTMENT',
      eventType: 'APPOINTMENT_RESCHEDULED',
      action: 'update',
      data: { apptRID: 4201151 },
      warnings: [],
    });
    data.createScheduledIntegration.mockResolvedValue({ id: 'scheduled-new-1' });
    data.recordLog.mockResolvedValue('log-reschedule-1');
    data.markEventComplete.mockResolvedValue(undefined);
  });

  it('creates a fresh scheduled reminder for the new appointment on RESCHEDULE_PENDING', async () => {
    const event = {
      id: 'evt-reschedule-1',
      event_type: 'APPOINTMENT_RESCHEDULED',
      payload: {
        appt: {
          apptRID: 4201151,
          apptDate: '2026-06-30',
          apptTime: '13:00:00',
          previousValues: {
            apptRID: 4185086,
            apptDate: '2026-03-28',
            apptTime: '13:30:00',
          },
        },
        visit: { reasonName: 'New Patient' },
        patient: { phone: '9876543221', fullName: 'Jane Doe' },
      },
    };

    const result = await processEvent(event, 0);

    expect(normalizeEventSubject).toHaveBeenCalledWith(
      'APPOINTMENT_RESCHEDULED',
      event.payload,
      expect.objectContaining({
        subjectType: 'APPOINTMENT',
        subjectExtraction: {
          mode: 'PATHS',
          paths: { apptRID: ['appt.apptRID', 'apptRID'] },
        },
      })
    );
    expect(data.createScheduledIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        integrationConfigId: 'cfg-reminder-2',
        integrationName: 'Fabrikam - Reminder 2 (T-3hrs)',
        orgId: 648,
        eventType: 'APPOINTMENT_RESCHEDULED',
        originalPayload: event.payload,
        payload: { outbound: true, template: 'reminder_2' },
        subject: expect.objectContaining({
          subjectType: 'APPOINTMENT',
          data: { apptRID: 4201151 },
        }),
      })
    );
    expect(result.scheduledCount).toBe(1);
  });
});
