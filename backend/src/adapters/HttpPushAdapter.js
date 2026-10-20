/**
 * HTTP Push Adapter
 *
 * Polls the MongoDB pending_events queue populated by POST /api/v1/events/push.
 * Claims are atomic, failures are retried with a delay, and stale claims are
 * recovered at startup so accepted events are not stranded after a crash.
 */

const { EventSourceAdapter } = require('./EventSourceAdapter');
const eventSourceData = require('../data/event-sources');
const { log, logError } = require('../logger');
const { updateHeartbeat } = require('../worker-heartbeat');

const DEFAULT_POLL_INTERVAL_MS = 1000;
const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_STALE_AFTER_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 60 * 1000;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class HttpPushAdapter extends EventSourceAdapter {
  constructor(config = {}) {
    super();
    if (!config.orgId) throw new Error('HttpPushAdapter: orgId is required');

    this.orgId = config.orgId;
    this.pollIntervalMs = positiveInteger(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.batchSize = positiveInteger(config.batchSize, DEFAULT_BATCH_SIZE);
    this.maxAttempts = positiveInteger(config.maxAttempts, DEFAULT_MAX_ATTEMPTS);
    this.staleAfterMs = positiveInteger(config.staleAfterMs, DEFAULT_STALE_AFTER_MS);
    this.timer = null;
    this.handler = null;
    this.stopped = true;
    this.polling = false;
    this.currentPoll = null;
    this.pollCount = 0;
    this.processedCount = 0;
    this.retriedCount = 0;
    this.failedCount = 0;
    this.lastPollStartedAt = null;
    this.lastPollFinishedAt = null;
    this.lastSuccessAt = null;
    this.lastErrorAt = null;
    this.lastErrorMessage = null;
    this.consecutiveErrors = 0;
  }

  async start(handler) {
    if (typeof handler !== 'function') throw new Error('HttpPushAdapter: handler must be a function');
    if (!this.stopped) {
      log('warn', `[HttpPush:${this.orgId}] Already started`);
      return;
    }

    this.handler = handler;
    this.stopped = false;
    await eventSourceData.resetStalePendingEvents(this.staleAfterMs, this.orgId);
    log('info', `[HttpPush:${this.orgId}] Starting`, {
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
      maxAttempts: this.maxAttempts,
    });
    this._schedulePoll(0);
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.currentPoll) await this.currentPoll;
    this.handler = null;
    log('info', `[HttpPush:${this.orgId}] Stopped`);
  }

  _schedulePoll(delayMs) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.stopped) return;
      this.currentPoll = this._runPoll()
        .catch((error) => logError(error, { scope: `HttpPushAdapter[${this.orgId}].poll` }))
        .finally(() => {
          this.currentPoll = null;
          this._schedulePoll(this.pollIntervalMs);
        });
    }, delayMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  async _runPoll() {
    if (this.polling || this.stopped) return;
    this.polling = true;
    this.pollCount += 1;
    this.lastPollStartedAt = new Date();
    updateHeartbeat('deliveryWorker');
    try {
      await this._pollOnce(this.handler);
      this.lastSuccessAt = new Date();
      this.lastErrorMessage = null;
      this.consecutiveErrors = 0;
    } catch (error) {
      this.lastErrorAt = new Date();
      this.lastErrorMessage = error.message;
      this.consecutiveErrors += 1;
      throw error;
    } finally {
      this.lastPollFinishedAt = new Date();
      this.polling = false;
    }
  }

  async _pollOnce(handler) {
    if (typeof handler !== 'function') throw new Error('HttpPushAdapter: no event handler is registered');
    const events = await eventSourceData.claimPendingEvents(this.orgId, this.batchSize);
    for (const event of events) {
      // Preserve FIFO processing within each claimed batch.
      // eslint-disable-next-line no-await-in-loop
      await this._processEvent(event, handler);
    }
  }

  async _processEvent(event, handler) {
    let settled = false;
    const ctx = {
      ack: async () => {
        if (settled) return;
        await eventSourceData.markPendingEventDone(event._id);
        settled = true;
        this.processedCount += 1;
      },
      nack: async (retryDelayMs = DEFAULT_RETRY_DELAY_MS, errorMessage = 'Event processing requested a retry') => {
        if (settled) return;
        await this._settleFailure(event, retryDelayMs, errorMessage);
        settled = true;
      },
    };
    const normalizedEvent = { ...event, id: event._id, orgId: event.orgId || this.orgId };

    try {
      await handler(normalizedEvent, ctx);
      if (!settled) await ctx.nack(DEFAULT_RETRY_DELAY_MS, 'Event handler completed without acknowledging the event');
    } catch (error) {
      if (!settled) {
        await ctx.nack(DEFAULT_RETRY_DELAY_MS, error.message || 'Event handler failed');
      } else {
        logError(error, { scope: `HttpPushAdapter[${this.orgId}].handlerAfterSettlement` });
      }
    }
  }

  async _settleFailure(event, retryDelayMs, errorMessage) {
    const attempts = positiveInteger(event.attempts, 1);
    const safeMessage = String(errorMessage || 'Event processing failed').slice(0, 2000);
    if (attempts >= this.maxAttempts) {
      await eventSourceData.markPendingEventFailed(
        event._id,
        `Event processing failed after ${attempts} attempts: ${safeMessage}`
      );
      this.failedCount += 1;
      return;
    }

    const safeDelayMs = positiveInteger(retryDelayMs, DEFAULT_RETRY_DELAY_MS);
    await eventSourceData.requeuePendingEvent(event._id, safeDelayMs, safeMessage);
    this.retriedCount += 1;
  }

  getName() {
    return `HttpPushAdapter[org=${this.orgId}]`;
  }

  getRuntimeStatus() {
    return {
      adapterName: this.getName(),
      orgId: this.orgId,
      sourceType: 'http_push',
      connectionStatus: this.lastErrorMessage ? 'degraded' : 'not_applicable',
      running: !this.stopped,
      polling: this.polling,
      mode: 'push',
      pollIntervalMs: this.pollIntervalMs,
      batchSize: this.batchSize,
      maxAttempts: this.maxAttempts,
      pollCount: this.pollCount,
      processedCount: this.processedCount,
      retriedCount: this.retriedCount,
      failedCount: this.failedCount,
      lastPollStartedAt: this.lastPollStartedAt,
      lastPollFinishedAt: this.lastPollFinishedAt,
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastErrorMessage: this.lastErrorMessage,
      consecutiveErrors: this.consecutiveErrors,
      note: 'Events are accepted over HTTP and processed from the durable pending-events queue.',
    };
  }
}

module.exports = { HttpPushAdapter };
