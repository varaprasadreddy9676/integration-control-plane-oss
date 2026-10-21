'use strict';

jest.mock('../../src/data/execution-logs', () => ({
  createExecutionLog: jest.fn(),
  updateExecutionLog: jest.fn(),
  addExecutionStep: jest.fn(),
}));

jest.mock('../../src/data/dlq', () => ({
  createDLQEntry: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const executionLogsData = require('../../src/data/execution-logs');
const dlqData = require('../../src/data/dlq');
const { createExecutionLogger } = require('../../src/utils/execution-logger');

describe('ExecutionLogger', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    executionLogsData.createExecutionLog.mockResolvedValue({
      traceId: 'trc-test-1',
      executionLogId: '507f1f77bcf86cd799439011',
    });
    executionLogsData.updateExecutionLog.mockResolvedValue(undefined);
    executionLogsData.addExecutionStep.mockResolvedValue(undefined);
  });

  it('updates the created execution log by stable document id', async () => {
    const logger = createExecutionLogger({
      direction: 'OUTBOUND',
      triggerType: 'EVENT',
      integrationConfigId: '507f1f77bcf86cd799439012',
      integrationName: 'NCX - Appointment Cancellation',
      eventType: 'APPOINTMENT_CANCELLED',
      eventId: 'evt-1',
      orgId: 812,
      messageId: 'msg-1',
      request: { url: 'https://example.com', method: 'POST', body: { ok: true } },
    });

    await logger.start();
    await logger.addStep('validation', { status: 'success', durationMs: 5 });
    await logger.success({ response: { statusCode: 200 } });

    const expectedRef = {
      executionLogId: '507f1f77bcf86cd799439011',
      traceId: 'trc-test-1',
      orgId: 812,
    };

    expect(executionLogsData.addExecutionStep).toHaveBeenCalledWith(
      expectedRef,
      expect.objectContaining({
        name: 'validation',
        status: 'success',
      })
    );
    expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
      expectedRef,
      expect.objectContaining({
        status: 'success',
      })
    );
  });

  it('records the request that was actually sent when success() is given one', async () => {
    // Scheduled jobs only know the payload after the data source and transform run.
    const logger = createExecutionLogger({
      direction: 'SCHEDULED',
      triggerType: 'SCHEDULE',
      orgId: 1,
      messageId: 'job-1',
      request: { url: 'https://example.com/import', method: 'POST', headers: {}, body: {} },
    });
    const sent = { url: 'https://example.com/import', method: 'POST', headers: {}, body: { customers: [{ id: 1 }] } };

    await logger.start();
    await logger.success({ response: { statusCode: 200 }, request: sent });

    expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ request: sent })
    );
  });

  it('stores responseTimeMs when success() is given one', async () => {
    const logger = createExecutionLogger({ direction: 'SCHEDULED', orgId: 1, messageId: 'job-2' });
    await logger.start();
    await logger.success({ response: { statusCode: 200 }, responseTimeMs: 757 });

    expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ responseTimeMs: 757 })
    );
  });

  it('does not insert a second execution log when start is called twice on one instance', async () => {
    const logger = createExecutionLogger({
      traceId: 'trc-test-2',
      direction: 'OUTBOUND',
      orgId: 812,
    });

    await logger.start();
    await logger.start();

    expect(executionLogsData.createExecutionLog).toHaveBeenCalledTimes(1);
  });

  it('passes executionLogId into DLQ entries for terminal failures', async () => {
    const logger = createExecutionLogger({
      traceId: 'trc-test-3',
      direction: 'INBOUND',
      orgId: 812,
      integrationConfigId: '507f1f77bcf86cd799439013',
      messageId: 'msg-3',
      request: { body: { patientId: 'p3' } },
    });

    await logger.start();
    await logger.fail(new Error('boom'));

    expect(dlqData.createDLQEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        traceId: 'trc-test-1',
        executionLogId: '507f1f77bcf86cd799439011',
      })
    );
  });

  // Regression: a "Tailspin Daily Sync Report" Script Job FAILED execution rendered an
  // empty details panel in the UI (no console output, no error text) even though the
  // script runner captured real scriptLogs and a real error message. Root cause: fail()
  // built its updateExecutionLog() payload from scratch and — unlike success(), which
  // forwards options.metadata — never included `metadata` at all, and never set a
  // top-level `errorMessage` field (only the nested `error.message`), even though
  // several frontend views (LogDetailRoute's hasScheduledJobFlow gate, LogsRoute's
  // errorMessage displays) read `data.errorMessage` directly. Confirmed live: two real
  // FAILED Tailspin executions had `metadata: {}` and `errorMessage: null` in the stored
  // document despite the caller passing `{ metadata: { scriptLogs: [...] } }` to fail().
  describe('fail() persists metadata and errorMessage (previously silently dropped)', () => {
    it('forwards options.metadata into the execution log update, like success() does', async () => {
      const logger = createExecutionLogger({
        traceId: 'trc-test-4',
        direction: 'SCRIPT_JOB',
        orgId: 33,
        integrationConfigId: '507f1f77bcf86cd799439014',
        messageId: 'scriptjob-4',
      });

      await logger.start();
      const scriptLogs = [
        { level: 'info', message: 'Query results Patient Details: 2727', ts: '2026-07-05T13:00:05.000Z' },
        { level: 'error', message: 'Email send failed: connect ETIMEDOUT', ts: '2026-07-05T13:00:06.000Z' },
      ];
      await logger.fail(new Error('Script job failed'), { metadata: { scriptLogs } });

      expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
        expect.objectContaining({ executionLogId: '507f1f77bcf86cd799439011' }),
        expect.objectContaining({
          status: 'failed',
          metadata: { scriptLogs },
        })
      );
    });

    it('defaults metadata to {} when the caller passes none, matching success()', async () => {
      const logger = createExecutionLogger({
        traceId: 'trc-test-5',
        direction: 'OUTBOUND',
        orgId: 812,
      });

      await logger.start();
      await logger.fail(new Error('no metadata here'));

      expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ metadata: {} })
      );
    });

    it('sets a top-level errorMessage field derived from the error, not just nested error.message', async () => {
      const logger = createExecutionLogger({
        traceId: 'trc-test-6',
        direction: 'SCRIPT_JOB',
        orgId: 33,
      });

      await logger.start();
      await logger.fail(new Error('Cannot find module node:buffer'));

      expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          errorMessage: 'Cannot find module node:buffer',
          error: expect.objectContaining({ message: 'Cannot find module node:buffer' }),
        })
      );
    });

    it('falls back to "Unknown error" for both error.message and errorMessage when the error has no message', async () => {
      const logger = createExecutionLogger({
        traceId: 'trc-test-7',
        direction: 'OUTBOUND',
        orgId: 812,
      });

      await logger.start();
      await logger.fail({});

      expect(executionLogsData.updateExecutionLog).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          errorMessage: 'Unknown error',
          error: expect.objectContaining({ message: 'Unknown error' }),
        })
      );
    });

    it('still creates a DLQ entry carrying the same metadata when metadata is present', async () => {
      const logger = createExecutionLogger({
        traceId: 'trc-test-8',
        direction: 'INBOUND',
        orgId: 812,
        integrationConfigId: '507f1f77bcf86cd799439015',
        messageId: 'msg-8',
      });

      await logger.start();
      await logger.fail(new Error('upstream 500'), { metadata: { replayHint: 'retry-safe' } });

      expect(dlqData.createDLQEntry).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: { replayHint: 'retry-safe' } })
      );
    });
  });
});
