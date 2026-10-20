'use strict';

const ack = jest.fn();
const nack = jest.fn();

jest.mock('../../src/config', () => ({
  eventAudit: {
    enabled: true,
    maxPayloadSize: 100000,
    storeSummaryPayload: false,
    storeFullPayload: true,
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

describe('event-handler stores the full payload with base64 redacted', () => {
  const handler = createEventHandler('mysql');

  beforeEach(() => {
    jest.clearAllMocks();
    data.resolveOrgIdFromEvent.mockReturnValue(648);
    data.isEventAlreadyProcessed.mockResolvedValue(false);
    data.listInvalidationProfiles.mockResolvedValue([]);
    data.cancelScheduledIntegrationsByMatch.mockResolvedValue(0);
    data.listConditionProfiles.mockResolvedValue([]);
    data.releaseHeldDeliveriesByMatch.mockResolvedValue({ releasedCount: 0, failedCount: 0, matchedCount: 0 });
    data.discardHeldDeliveriesByMatch.mockResolvedValue(0);
    data.listIntegrationsForProcessing.mockResolvedValue([]);
    data.recordEventAudit.mockResolvedValue(undefined);
    data.updateEventAudit.mockResolvedValue(undefined);
    data.markEventComplete.mockResolvedValue(undefined);
    data.saveProcessedEvent.mockResolvedValue(undefined);
    normalizeEventSubject.mockResolvedValue({ subjectType: 'VISIT', eventType: 'X', action: 'x', data: {}, warnings: [] });
    processEvent.mockResolvedValue({ deliveryResults: [], scheduledCount: 0, heldCount: 0, successCount: 0, failureCount: 0 });
  });

  it('keeps the payload but replaces embedded base64 files', async () => {
    const blob = 'QUJD'.repeat(200);
    await handler(
      { id: 1, eventId: 'evt-1', event_type: 'OP_VISIT_CREATED', payload: { visitId: 9, scan: blob } },
      { ack, nack }
    );

    const received = data.recordEventAudit.mock.calls[0][0];
    expect(received.payload).toEqual({ visitId: 9, scan: '[BASE64_REDACTED: 800 chars]' });
    expect(received.payloadSize).toBeGreaterThan(800);
  });
});
