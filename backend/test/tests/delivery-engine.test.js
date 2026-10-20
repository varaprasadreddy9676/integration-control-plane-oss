'use strict';

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(),
  AbortController: class MockAbortController {
    constructor() {
      this.signal = {};
    }
    abort() {}
  },
}));

jest.mock('../../src/config', () => ({
  security: {},
  worker: {},
}));

const mockRecordLog = jest.fn();
const mockCheckCircuitState = jest.fn();
const mockRecordDeliverySuccess = jest.fn();
const mockRecordDeliveryFailure = jest.fn();

jest.mock('../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
  checkCircuitState: (...args) => mockCheckCircuitState(...args),
  recordDeliverySuccess: (...args) => mockRecordDeliverySuccess(...args),
  recordDeliveryFailure: (...args) => mockRecordDeliveryFailure(...args),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const mockApplyTransform = jest.fn(async (_integration, payload) => payload);
const mockIsTransformationSkipped = jest.fn((value) => Boolean(value?.__integrationControlPlaneSkip__));
const mockGetTransformationSkipReason = jest.fn((value) => value?.reason || null);

jest.mock('../../src/services/transformer', () => ({
  applyTransform: (...args) => mockApplyTransform(...args),
  isTransformationSkipped: (...args) => mockIsTransformationSkipped(...args),
  getTransformationSkipReason: (...args) => mockGetTransformationSkipReason(...args),
}));

jest.mock('../../src/utils/url-check', () => ({
  validateTargetUrl: jest.fn(() => ({ valid: true })),
}));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({})),
}));

jest.mock('../../src/services/integration-signing', () => ({
  generateSignatureHeaders: jest.fn(() => ({})),
}));

jest.mock('../../src/middleware/rate-limiter', () => ({
  checkRateLimit: jest.fn(async () => ({
    allowed: false,
    remaining: 0,
    resetAt: new Date().toISOString(),
    retryAfter: 30,
  })),
}));

jest.mock('../../src/data/dlq', () => ({
  createDLQEntry: jest.fn(),
}));

jest.mock('../../src/processor/condition-evaluator', () => ({
  evaluateCondition: jest.fn(() => true),
}));

jest.mock('../../src/utils/event-utils', () => ({
  generateCorrelationId: jest.fn(() => 'trace-1'),
  sleep: jest.fn(),
  isTestEvent: jest.fn(() => false),
  safeRead: jest.fn(),
}));

const mockStart = jest.fn();
const mockAddStep = jest.fn();
const mockUpdateStatus = jest.fn();
const mockSuccess = jest.fn();
const mockFail = jest.fn();

const mockCreateExecutionLogger = jest.fn();

jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: (...args) => mockCreateExecutionLogger(...args),
}));

jest.mock('../../src/utils/timeout', () => ({
  withTimeout: jest.fn((promise) => promise),
}));

jest.mock('../../src/services/communication/adapter-registry', () => ({}));

const mockSendMllpMessage = jest.fn();

jest.mock('../../src/services/hl7/mllp-client', () => ({
  sendMllpMessage: (...args) => mockSendMllpMessage(...args),
}));

const { deliverToIntegration } = require('../../src/processor/delivery-engine');
const { fetch: mockFetch } = require('../../src/utils/runtime');
const { generateSignatureHeaders } = require('../../src/services/integration-signing');
const { checkRateLimit } = require('../../src/middleware/rate-limiter');

describe('delivery-engine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mirrors the real ExecutionLogger: executionLogId reflects whatever was
    // passed in (a retry's existing log id), falling back to a freshly
    // "created" one otherwise — same as every prior test in this file assumed.
    mockCreateExecutionLogger.mockImplementation((options) => ({
      executionLogId: options?.executionLogId || 'exec-log-1',
      start: (...args) => mockStart(...args),
      addStep: (...args) => mockAddStep(...args),
      updateStatus: (...args) => mockUpdateStatus(...args),
      success: (...args) => mockSuccess(...args),
      fail: (...args) => mockFail(...args),
    }));
    mockApplyTransform.mockImplementation(async (_integration, payload) => payload);
    mockIsTransformationSkipped.mockImplementation((value) => Boolean(value?.__integrationControlPlaneSkip__));
    mockGetTransformationSkipReason.mockImplementation((value) => value?.reason || null);
    mockCheckCircuitState.mockResolvedValue({ isOpen: false, state: 'CLOSED', reason: null });
    // Mirrors the real recordLog: updating by id returns that same id back
    // (data/logs.js `return existingLogId.toString();`), not a fresh one.
    mockRecordLog.mockImplementation(async (_orgId, payload) => payload?.id || 'exec-log-1');
    mockStart.mockResolvedValue('trace-1');
    mockAddStep.mockResolvedValue(undefined);
    mockUpdateStatus.mockResolvedValue(undefined);
    mockSuccess.mockResolvedValue(undefined);
    mockFail.mockResolvedValue(undefined);
    mockSendMllpMessage.mockResolvedValue({
      accepted: true,
      ack: {
        code: 'AA',
        messageControlId: 'MSG-1',
        errorMessage: null,
        raw: 'MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-1|P|2.3\rMSA|AA|MSG-1|OK\r',
      },
      rawAck: 'MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-1|P|2.3\rMSA|AA|MSG-1|OK\r',
      requestBytes: 100,
      responseBytes: 80,
    });
  });

  it('re-sends an inbound integration\'s {{placeholder}} customHeaders when it is replayed', async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '{"ok":true}',
      clone() {
        return this;
      },
    });
    const integration = {
      id: 'integration-1',
      name: 'Link Records',
      orgId: 812,
      direction: 'INBOUND',
      targetUrl: 'https://example.com/link',
      httpMethod: 'POST',
      customHeaders: { 'x-partner-id': '{{partnerId}}', 'x-partner-name': '{{partnerName}}' },
    };
    const evt = {
      id: 'replay-1',
      event_type: 'link-records',
      payload: { memberId: '1' },
      attempt_count: 0,
      orgId: 812,
      isReplay: true,
      // caller headers were never kept on this log, but the first upstream call was
      inboundHeaders: null,
      priorUpstreamHeaders: { 'x-partner-id': 'P-1001', 'x-partner-name': 'Northwind Clinic' },
    };

    await deliverToIntegration(integration, evt, true, 0, null, 'trace-replay', true);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/link',
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-partner-id': 'P-1001',
          'x-partner-name': 'Northwind Clinic',
        }),
      })
    );
  });

  it('updates the existing execution log document when first-attempt rate limiting occurs', async () => {
    const integration = {
      id: 'integration-1',
      name: 'Rate Limited Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      rateLimits: {
        enabled: true,
        maxRequests: 1,
        windowSeconds: 60,
      },
    };

    const evt = {
      id: 'evt-1',
      event_type: 'APPOINTMENT_CREATED',
      payload: { patientId: 'p1' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-1', true);

    expect(result).toEqual({ status: 'RETRYING', logId: 'exec-log-1', logIds: null });
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        id: 'exec-log-1',
        status: 'RETRYING',
        responseStatus: 429,
      })
    );
  });

  /**
   * retry-handler.js retries a RETRYING log by calling deliverToIntegration with
   * that log's id as existingLogId. Before this fix, createExecutionLogger was
   * never told about it, so start() always inserted a brand-new execution_logs
   * document — the original stayed at status RETRYING forever, unresolved and
   * orphaned, while a fresh, duplicate row was left behind by every retry.
   */
  it('reuses the original execution log on retry instead of creating a new one', async () => {
    const integration = {
      id: 'integration-1',
      name: 'Rate Limited Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      rateLimits: { enabled: true, maxRequests: 1, windowSeconds: 60 },
    };

    const evt = {
      id: 'evt-1',
      event_type: 'APPOINTMENT_CREATED',
      payload: { patientId: 'p1' },
      attempt_count: 1,
      orgId: 812,
    };

    // existingLogId is the 5th positional arg — retry-handler.js passes the
    // RETRYING log's id here.
    const result = await deliverToIntegration(integration, evt, false, 0, 'original-log-99', 'trace-1', true);

    expect(mockCreateExecutionLogger).toHaveBeenCalledWith(
      expect.objectContaining({ executionLogId: 'original-log-99' })
    );
    expect(result).toEqual({ status: 'RETRYING', logId: 'original-log-99', logIds: null });
    expect(mockRecordLog).toHaveBeenCalledWith(812, expect.objectContaining({ id: 'original-log-99' }));
    // Never the freshly-"created" id a from-scratch delivery would get.
    expect(mockRecordLog).not.toHaveBeenCalledWith(812, expect.objectContaining({ id: 'exec-log-1' }));
  });

  it('creates a new execution log when there is nothing to retry (existingLogId is null)', async () => {
    const integration = {
      id: 'integration-1',
      name: 'Rate Limited Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      rateLimits: { enabled: true, maxRequests: 1, windowSeconds: 60 },
    };

    const evt = {
      id: 'evt-1',
      event_type: 'APPOINTMENT_CREATED',
      payload: { patientId: 'p1' },
      attempt_count: 0,
      orgId: 812,
    };

    await deliverToIntegration(integration, evt, false, 0, null, 'trace-1', true);

    expect(mockCreateExecutionLogger).toHaveBeenCalledWith(expect.objectContaining({ executionLogId: null }));
  });

  it('fails closed when signing is enabled but signature generation throws', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date().toISOString(),
      retryAfter: 0,
    });
    generateSignatureHeaders.mockImplementation(() => {
      throw new Error('broken-secret');
    });

    const integration = {
      id: 'integration-1',
      name: 'Signed Integration',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
      retryCount: 3,
      enableSigning: true,
      signingSecrets: ['whsec_test_secret'],
    };

    const evt = {
      id: 'evt-2',
      event_type: 'ORDER_CREATED',
      payload: { orderId: 'o1' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-2', true);

    expect(result).toEqual({ status: 'FAILED', logId: 'exec-log-1', logIds: null });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        status: 'FAILED',
        errorMessage: expect.stringContaining('Signing configuration error'),
      })
    );
  });

  it('records a structured transformation skip reason without attempting delivery', async () => {
    mockApplyTransform.mockResolvedValue({
      __integrationControlPlaneSkip__: true,
      reason: 'visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
    });

    const integration = {
      id: 'integration-1',
      name: 'Fabrikam Confirmation',
      orgId: 812,
      targetUrl: 'https://example.com/hook',
      httpMethod: 'POST',
    };

    const evt = {
      id: 'evt-3',
      event_type: 'APPOINTMENT_CONFIRMATION',
      payload: { visit: { reasonName: 'Endo Prep' } },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-3', true);

    expect(result).toEqual({
      status: 'SKIPPED',
      logId: 'exec-log-1',
      logIds: null,
      skipReason: 'visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
    });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        status: 'SKIPPED',
        responseStatus: 204,
        errorMessage: 'Skipping delivery: visit.reasonName "Endo Prep" is not eligible; only "New Patient" is allowed',
        requestPayload: null,
      })
    );
  });

  it('delivers HL7_MLLP actions and records ACK metadata without using HTTP fetch', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date().toISOString(),
      retryAfter: 0,
    });
    mockApplyTransform.mockResolvedValue(
      'MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-1|P|2.3\rPID|||P-1\r'
    );

    const integration = {
      id: 'integration-hl7',
      name: 'RIS HL7',
      orgId: 812,
      actions: [
        {
          kind: 'HL7_MLLP',
          name: 'Send Order',
          hl7Config: {
            host: '127.0.0.1',
            port: 2575,
            connectTimeoutMs: 1000,
            ackTimeoutMs: 1000,
          },
          transformationMode: 'SCRIPT',
          transformation: { script: 'return payload;' },
        },
      ],
    };

    const evt = {
      id: 'evt-hl7',
      event_type: 'ORDER_CREATED',
      payload: { orderId: 'ORD-1' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-hl7', true);

    expect(result).toEqual({ status: 'SUCCESS', logId: null, logIds: ['exec-log-1'] });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockSendMllpMessage).toHaveBeenCalledWith(
      expect.stringContaining('ORM^O01'),
      expect.objectContaining({ host: '127.0.0.1', port: 2575 })
    );
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        status: 'SUCCESS',
        responseStatus: 200,
        targetUrl: 'mllp://127.0.0.1:2575',
        httpMethod: 'HL7_MLLP',
        metadata: expect.objectContaining({
          hl7: expect.objectContaining({
            ackCode: 'AA',
            messageControlId: 'MSG-1',
          }),
        }),
      })
    );
  });

  it('fails HL7_MLLP actions when ACK rejects the message', async () => {
    checkRateLimit.mockResolvedValue({
      allowed: true,
      remaining: 10,
      resetAt: new Date().toISOString(),
      retryAfter: 0,
    });
    mockApplyTransform.mockResolvedValue('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-2|P|2.3\r');
    mockSendMllpMessage.mockResolvedValue({
      accepted: false,
      ack: {
        code: 'AE',
        messageControlId: 'MSG-2',
        errorMessage: 'Missing patient id',
      },
      rawAck: 'MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-2|P|2.3\rMSA|AE|MSG-2|Missing patient id\r',
      requestBytes: 100,
      responseBytes: 90,
    });

    const integration = {
      id: 'integration-hl7',
      name: 'RIS HL7',
      orgId: 812,
      actions: [
        {
          kind: 'HL7_MLLP',
          name: 'Send Order',
          hl7Config: { host: '127.0.0.1', port: 2575 },
          transformationMode: 'SCRIPT',
          transformation: { script: 'return payload;' },
        },
      ],
    };

    const evt = {
      id: 'evt-hl7-reject',
      event_type: 'ORDER_CREATED',
      payload: { orderId: 'ORD-2' },
      attempt_count: 0,
      orgId: 812,
    };

    const result = await deliverToIntegration(integration, evt, false, 0, null, 'trace-hl7-reject', true);

    expect(result).toEqual({ status: 'FAILED', logId: null, logIds: ['exec-log-1'] });
    expect(mockRecordLog).toHaveBeenCalledWith(
      812,
      expect.objectContaining({
        status: 'FAILED',
        responseStatus: 422,
        errorMessage: expect.stringContaining('Missing patient id'),
      })
    );
  });
});
