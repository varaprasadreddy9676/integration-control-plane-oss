'use strict';

const ack = jest.fn();
const nack = jest.fn();

jest.mock('../../src/config', () => ({
  eventAudit: {
    enabled: true,
    maxPayloadSize: 100000,
    storeSummaryPayload: false,
    storeFullPayload: false,
  },
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateEventKey: jest.fn(() => 'evt-key'),
}));

jest.mock('../../src/processor/event-deduplication', () => ({
  isEventProcessed: jest.fn(() => false),
  markEventProcessed: jest.fn(),
}));

jest.mock('../../src/processor/event-processor', () => ({
  processEvent: jest.fn(),
}));

jest.mock('../../src/processor/event-normalizer', () => ({
  normalizeEventSubject: jest.fn(),
}));

jest.mock('../../src/data', () => ({
  resolveOrgIdFromEvent: jest.fn(() => 648),
  isEventAlreadyProcessed: jest.fn(() => false),
  listInvalidationProfiles: jest.fn(),
  cancelScheduledIntegrationsByMatch: jest.fn(),
  listConditionProfiles: jest.fn(),
  releaseHeldDeliveriesByMatch: jest.fn(),
  discardHeldDeliveriesByMatch: jest.fn(),
  listIntegrationsForProcessing: jest.fn(),
  recordEventAudit: jest.fn(),
  updateEventAudit: jest.fn(),
  getBucketTimestamp: jest.fn(() => new Date('2026-03-26T05:41:51.000Z')),
  hashPayload: jest.fn(() => 'hash-1'),
  extractSafePayload: jest.fn(() => ({})),
  extractSourceMetadata: jest.fn(() => ({})),
  markEventComplete: jest.fn(),
  saveProcessedEvent: jest.fn(),
}));

const data = require('../../src/data');
const { processEvent } = require('../../src/processor/event-processor');
const { normalizeEventSubject } = require('../../src/processor/event-normalizer');
const { createEventHandler } = require('../../src/processor/event-handler');

describe('event-handler skip reason summary', () => {
  const handler = createEventHandler('mysql');

  beforeEach(() => {
    jest.clearAllMocks();
    ack.mockResolvedValue(undefined);
    nack.mockResolvedValue(undefined);
    data.resolveOrgIdFromEvent.mockReturnValue(648);
    data.isEventAlreadyProcessed.mockResolvedValue(false);
    data.listInvalidationProfiles.mockResolvedValue([]);
    data.cancelScheduledIntegrationsByMatch.mockResolvedValue(0);
    data.listConditionProfiles.mockResolvedValue([]);
    data.releaseHeldDeliveriesByMatch.mockResolvedValue({ releasedCount: 0, failedCount: 0, matchedCount: 0 });
    data.discardHeldDeliveriesByMatch.mockResolvedValue(0);
    data.listIntegrationsForProcessing.mockResolvedValue([
      { id: 'cfg-1', name: 'Reminder 2' },
      { id: 'cfg-2', name: 'Reminder 1' },
      { id: 'cfg-3', name: 'Confirmation' },
    ]);
    data.recordEventAudit.mockResolvedValue(undefined);
    data.updateEventAudit.mockResolvedValue(undefined);
    data.markEventComplete.mockResolvedValue(undefined);
    data.saveProcessedEvent.mockResolvedValue(undefined);
    normalizeEventSubject.mockResolvedValue({
      subjectType: 'APPOINTMENT',
      eventType: 'APPOINTMENT_CANCELLATION',
      action: 'cancel',
      data: { apptRID: 'A-1' },
      warnings: [],
    });
    processEvent.mockResolvedValue({
      deliveryResults: [
        {
          integrationId: 'cfg-1',
          status: 'SKIPPED',
          logId: 'log-1',
          skipReason: 'visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
        },
        {
          integrationId: 'cfg-2',
          status: 'SKIPPED',
          logId: 'log-2',
          skipReason: 'visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
        },
        {
          integrationId: 'cfg-3',
          status: 'SKIPPED',
          logId: 'log-3',
          skipReason: 'visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
        },
      ],
      scheduledCount: 0,
      heldCount: 0,
      successCount: 0,
      failureCount: 0,
    });
  });

  it('writes the concrete business-rule reason into event audit when all integrations skip', async () => {
    await handler(
      {
        id: 907593,
        eventId: 'mysql-648-APPOINTMENT_CONFIRMATION-907593',
        event_type: 'APPOINTMENT_CONFIRMATION',
        payload: {
          appt: { bookingNumber: 'VAL-SKIP-REASON-001' },
          visit: { reasonName: 'Endo Prep' },
        },
      },
      { ack, nack }
    );

    expect(data.updateEventAudit).toHaveBeenCalledWith(
      'mysql-648-APPOINTMENT_CONFIRMATION-907593',
      expect.objectContaining({
        status: 'SKIPPED',
        skipCategory: 'INTEGRATION_SKIPPED',
        skipReason:
          'All integrations skipped: visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
      })
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });

  it('writes lifecycle invalidation context into event audit when no direct integrations match', async () => {
    data.listInvalidationProfiles.mockResolvedValue([
      {
        integrationId: 'cfg-reminder-1',
        subjectType: 'APPOINTMENT',
        subjectExtraction: { mode: 'PATHS', paths: { apptRID: 'appt.apptRID' } },
        lifecycleRule: {
          eventTypes: ['APPOINTMENT_CANCELLATION'],
          action: 'CANCEL_PENDING',
          matchKeys: ['apptRID'],
        },
      },
      {
        integrationId: 'cfg-reminder-2',
        subjectType: 'APPOINTMENT',
        subjectExtraction: { mode: 'PATHS', paths: { apptRID: 'appt.apptRID' } },
        lifecycleRule: {
          eventTypes: ['APPOINTMENT_CANCELLATION'],
          action: 'CANCEL_PENDING',
          matchKeys: ['apptRID'],
        },
      },
    ]);
    data.cancelScheduledIntegrationsByMatch.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    data.listIntegrationsForProcessing.mockResolvedValue([]);

    await handler(
      {
        id: 907608,
        eventId: 'mysql-648-APPOINTMENT_CANCELLATION-907608',
        event_type: 'APPOINTMENT_CANCELLATION',
        payload: {
          appt: { apptRID: 'A-1' },
        },
      },
      { ack, nack }
    );

    expect(data.updateEventAudit).toHaveBeenCalledWith(
      'mysql-648-APPOINTMENT_CANCELLATION-907608',
      expect.objectContaining({
        status: 'SKIPPED',
        skipCategory: 'NO_WEBHOOK',
        skipReason: 'Cancelled 2 scheduled reminders; no direct outbound integrations matched this event',
      })
    );
    expect(data.markEventComplete).toHaveBeenCalledWith(
      907608,
      'SKIPPED',
      'Cancelled 2 scheduled reminders; no direct outbound integrations matched this event'
    );
    expect(ack).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
  });
});
