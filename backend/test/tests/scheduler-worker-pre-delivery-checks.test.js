'use strict';

jest.mock('../../src/utils/runtime', () => ({
  fetch: jest.fn(),
  AbortController: class MockAbortController {
    constructor() {
      this.signal = {};
    }
    abort() {}
  },
  uuidv4: jest.fn(() => 'uuid-1'),
}));
jest.mock('../../src/config', () => ({ security: {}, worker: {} }));

const mockRecordLog = jest.fn();
jest.mock('../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
  recordDeliverySuccess: jest.fn(),
  recordDeliveryFailure: jest.fn(),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../src/worker-heartbeat', () => ({
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
}));
jest.mock('../../src/utils/url-check', () => ({ validateTargetUrl: jest.fn(() => ({ valid: true })) }));
jest.mock('../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn(async () => ({})) }));
jest.mock('../../src/services/transformer', () => ({ applyTransform: jest.fn(async (_i, payload) => payload) }));

const mockAddStep = jest.fn();
const mockFail = jest.fn();
const mockUpdateStatus = jest.fn();
jest.mock('../../src/utils/execution-logger', () => ({
  createExecutionLogger: () => ({
    start: jest.fn(async () => {}),
    addStep: (...args) => mockAddStep(...args),
    updateStatus: (...args) => mockUpdateStatus(...args),
    success: jest.fn(async () => {}),
    fail: (...args) => mockFail(...args),
  }),
}));

const { fetch: mockFetch } = require('../../src/utils/runtime');
const { deliverScheduledIntegration, deliverScheduledAction } = require('../../src/processor/scheduler-worker');

const checkResponse = (status) => ({
  status,
  ok: status >= 200 && status < 300,
  headers: { get: () => 'application/pdf' },
  arrayBuffer: async () => new ArrayBuffer(10),
});

describe('scheduler-worker pre-delivery checks', () => {
  const integration = {
    id: 'integration-3',
    name: 'Deferred Bill',
    orgId: 521,
    retryCount: 3,
    targetUrl: 'https://example.com/messages',
    preDeliveryChecks: [{ name: 'Doc', urlPath: 'document.link' }],
  };
  const scheduled = (attemptCount = 0) => ({
    id: 'sched-1',
    orgId: 521,
    eventType: 'BILL_CREATED',
    targetUrl: 'https://example.com/messages',
    httpMethod: 'POST',
    attemptCount,
    payload: { document: { link: 'https://docs.example.com/bill.pdf' } },
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAddStep.mockResolvedValue(undefined);
    mockFail.mockResolvedValue(undefined);
    mockUpdateStatus.mockResolvedValue(undefined);
  });

  it('retries a temporary failure later without sending', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(503));

    const result = await deliverScheduledIntegration(scheduled(), integration);

    expect(result).toEqual(expect.objectContaining({ status: 'RETRYING', responseStatus: 503 }));
    expect(result.nextAttemptAt).toBeDefined();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockRecordLog).toHaveBeenCalledWith(521, expect.objectContaining({ status: 'RETRYING', shouldRetry: true }));
  });

  it('fails a permanent failure without sending or a DLQ entry', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(422));

    const result = await deliverScheduledIntegration(scheduled(), integration);

    expect(result.status).toBe('FAILED');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ createDLQ: false }));
  });

  it('fails with a DLQ entry once retries are used up', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(503));

    const result = await deliverScheduledIntegration(scheduled(2), integration);

    expect(result.status).toBe('FAILED');
    expect(mockFail).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ createDLQ: true }));
  });

  it('sends after the check passes', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(200)).mockResolvedValueOnce({
      status: 200,
      ok: true,
      headers: { get: () => 'application/json' },
      text: async () => '{}',
    });

    const result = await deliverScheduledIntegration(scheduled(), integration);

    expect(result.status).toBe('SUCCESS');
    expect(mockFetch).toHaveBeenNthCalledWith(2, 'https://example.com/messages', expect.anything());
  });

  it('reports a scheduled action check failure as retryable to the caller', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(504));
    const action = { name: 'WhatsApp', preDeliveryChecks: [{ urlPath: 'document.link' }] };

    const result = await deliverScheduledAction(action, 0, scheduled().payload, scheduled(), integration, 0, 'trace-s', 1);

    expect(result).toEqual(expect.objectContaining({ status: 'FAILED', responseStatus: 504, shouldRetry: true }));
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('reports a permanent scheduled action check failure as not retryable', async () => {
    mockFetch.mockResolvedValueOnce(checkResponse(404));

    const result = await deliverScheduledAction({ name: 'A' }, 0, scheduled().payload, scheduled(), integration, 0, 'trace-s', 1);

    expect(result).toEqual(expect.objectContaining({ status: 'FAILED', shouldRetry: false }));
  });
});
