'use strict';

jest.mock('../../src/data/event-sources', () => ({
  claimPendingEvents: jest.fn(),
  markPendingEventDone: jest.fn(),
  markPendingEventFailed: jest.fn(),
  requeuePendingEvent: jest.fn(),
  resetStalePendingEvents: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/worker-heartbeat', () => ({
  updateHeartbeat: jest.fn(),
}));

const eventSourceData = require('../../src/data/event-sources');
const { HttpPushAdapter } = require('../../src/adapters/HttpPushAdapter');

const queuedEvent = (overrides = {}) => ({
  _id: 'mongo-event-1',
  eventId: 'push-33-order-created-1',
  orgId: 33,
  event_type: 'ORDER_CREATED',
  payload: { orderId: 42 },
  attempts: 1,
  createdAt: new Date('2026-09-23T00:00:00.000Z'),
  ...overrides,
});

describe('HttpPushAdapter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eventSourceData.claimPendingEvents.mockResolvedValue([]);
    eventSourceData.markPendingEventDone.mockResolvedValue(undefined);
    eventSourceData.markPendingEventFailed.mockResolvedValue(undefined);
    eventSourceData.requeuePendingEvent.mockResolvedValue(undefined);
    eventSourceData.resetStalePendingEvents.mockResolvedValue(0);
  });

  test('claims an event and marks it done when the handler acknowledges it', async () => {
    const adapter = new HttpPushAdapter({ orgId: 33, batchSize: 5 });
    const event = queuedEvent();
    eventSourceData.claimPendingEvents.mockResolvedValueOnce([event]);
    const handler = jest.fn(async (received, ctx) => {
      expect(received).toMatchObject({ id: event._id, eventId: event.eventId, orgId: 33 });
      await ctx.ack();
    });

    await adapter._pollOnce(handler);

    expect(eventSourceData.claimPendingEvents).toHaveBeenCalledWith(33, 5);
    expect(eventSourceData.markPendingEventDone).toHaveBeenCalledWith(event._id);
    expect(eventSourceData.requeuePendingEvent).not.toHaveBeenCalled();
  });

  test('requeues a rejected event using the requested delay', async () => {
    const adapter = new HttpPushAdapter({ orgId: 33, maxAttempts: 5 });
    const event = queuedEvent({ attempts: 2 });
    eventSourceData.claimPendingEvents.mockResolvedValueOnce([event]);

    await adapter._pollOnce(async (_received, ctx) => {
      await ctx.nack(12_000);
    });

    expect(eventSourceData.requeuePendingEvent).toHaveBeenCalledWith(
      event._id,
      12_000,
      'Event processing requested a retry'
    );
    expect(eventSourceData.markPendingEventFailed).not.toHaveBeenCalled();
  });

  test('marks an event failed after the configured attempt limit', async () => {
    const adapter = new HttpPushAdapter({ orgId: 33, maxAttempts: 3 });
    const event = queuedEvent({ attempts: 3 });
    eventSourceData.claimPendingEvents.mockResolvedValueOnce([event]);

    await adapter._pollOnce(async (_received, ctx) => {
      await ctx.nack(1000);
    });

    expect(eventSourceData.markPendingEventFailed).toHaveBeenCalledWith(
      event._id,
      'Event processing failed after 3 attempts: Event processing requested a retry'
    );
    expect(eventSourceData.requeuePendingEvent).not.toHaveBeenCalled();
  });

  test('retries a handler exception instead of leaving the event in processing', async () => {
    const adapter = new HttpPushAdapter({ orgId: 33 });
    const event = queuedEvent();
    eventSourceData.claimPendingEvents.mockResolvedValueOnce([event]);

    await adapter._pollOnce(async () => {
      throw new Error('downstream unavailable');
    });

    expect(eventSourceData.requeuePendingEvent).toHaveBeenCalledWith(event._id, 60_000, 'downstream unavailable');
  });

  test('startup recovers stale claims only for its organization', async () => {
    const adapter = new HttpPushAdapter({ orgId: 33, staleAfterMs: 90_000 });
    await adapter.start(jest.fn());

    expect(eventSourceData.resetStalePendingEvents).toHaveBeenCalledWith(90_000, 33);
    expect(adapter.getRuntimeStatus()).toMatchObject({ running: true, sourceType: 'http_push', orgId: 33 });

    await adapter.stop();
    expect(adapter.getRuntimeStatus()).toMatchObject({ running: false });
  });
});
