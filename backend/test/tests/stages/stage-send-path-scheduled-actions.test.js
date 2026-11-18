'use strict';

/**
 * The scheduler sends each action of a scheduled integration through the delivery
 * engine's own action send: any kind of action works, stages run, and the result
 * comes back in the scheduler's terms. The scheduler keeps owning retries, so no
 * DLQ entry is created here.
 */

jest.mock('../../../src/utils/runtime', () => ({
  ...jest.requireActual('../../../src/utils/runtime'),
  fetch: jest.fn(),
}));
jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const mockRecordLog = jest.fn();
jest.mock('../../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
  recordDeliverySuccess: jest.fn(),
  recordDeliveryFailure: jest.fn(),
}));
jest.mock('../../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));
jest.mock('../../../src/worker-heartbeat', () => ({
  markWorkerRunError: jest.fn(),
  markWorkerRunStart: jest.fn(),
  markWorkerRunSuccess: jest.fn(),
  setWorkerState: jest.fn(),
  stopWorker: jest.fn(),
}));
jest.mock('../../../src/services/transformer', () => ({
  applyTransform: jest.fn(async (_integration, payload) => payload),
  isTransformationSkipped: jest.fn(() => false),
  getTransformationSkipReason: jest.fn(() => null),
  applyResponseTransform: jest.fn(),
}));
jest.mock('../../../src/utils/url-check', () => ({ validateTargetUrl: jest.fn(() => ({ valid: true })) }));
jest.mock('../../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn(async () => ({})) }));
const mockDlq = jest.fn();
jest.mock('../../../src/data/dlq', () => ({ createDLQEntry: (...args) => mockDlq(...args) }));
jest.mock('../../../src/stages/outbox', () => ({ drainLog: jest.fn(async () => ({})) }));
jest.mock('../../../src/stages/store', () => {
  const actual = jest.requireActual('../../../src/stages/store');
  return { ...actual, definitions: { ...actual.definitions, saveDefinition: jest.fn(async () => 'hash') } };
});
const mockSend = jest.fn();
jest.mock('../../../src/services/communication/adapter-registry', () => ({ send: (...args) => mockSend(...args) }));
jest.mock('../../../src/services/communication/sender-routing', () => ({ isSenderRoutingEnabled: () => false, resolveSenderRoute: jest.fn() }));
jest.mock('../../../src/services/operation-templates', () => ({ applyProviderRef: async (_orgId, action) => action }));
jest.mock('../../../src/services/hl7/mllp-client', () => ({ sendMllpMessage: jest.fn() }));

const { fetch } = require('../../../src/utils/runtime');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const { deliverScheduledAction } = require('../../../src/processor/scheduler-worker');

jest.setTimeout(30000);

const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const email = (stages = []) => ({
  name: 'Mail',
  kind: 'COMMUNICATION',
  communicationConfig: { channel: 'EMAIL', provider: 'SMTP', smtp: { host: 'mail.test' } },
  stages,
});
const http = { name: 'Hook', kind: 'HTTP', targetUrl: 'https://partner.test/hook', httpMethod: 'POST' };
const integration = (action) => ({ id: 'int-5', name: 'Reminders', orgId: 4, retryCount: 3, actions: [action] });
const scheduled = { id: 'sched-1', orgId: 4, eventType: 'APPT', originalEventId: 'e1', payload: { patientId: 'p1' } };
const run = (action, attemptCount = 1) => deliverScheduledAction(action, 0, scheduled.payload, scheduled, integration(action), 0, 'trace-s', attemptCount);
const lastLog = () => mockRecordLog.mock.calls[mockRecordLog.mock.calls.length - 1][1];
const reply = (status, body = '{}') => ({
  status,
  ok: status < 300,
  headers: { forEach: (fn) => fn('application/json', 'content-type') },
  text: async () => body,
  clone() {
    return this;
  },
});

beforeAll(async () => {
  await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 2, memoryMb: 64 });
});
afterAll(() => stopStageRuntime());
beforeEach(() => {
  jest.clearAllMocks();
  mockRecordLog.mockImplementation(async () => 'log-9');
  mockSend.mockResolvedValue({ messageId: 'smtp-1' });
});

describe('a scheduled action goes through the engine', () => {
  it('sends an email action, which the scheduler could not before', async () => {
    const result = await run(email());
    expect(mockSend).toHaveBeenCalledWith('EMAIL', 'SMTP', expect.objectContaining({ patientId: 'p1' }), expect.anything());
    expect(result).toEqual({ status: 'SUCCESS', responseStatus: 200, errorMessage: null, shouldRetry: false });
    expect(lastLog()).toMatchObject({ triggerType: 'SCHEDULED', targetUrl: 'EMAIL:SMTP' });
  });

  it('runs the action\'s stages: a gate that skips ends the action as SKIPPED', async () => {
    const result = await run(email([script('g', 'before_send', 'return skip("quiet hours");', { effect: 'gate' })]));
    expect(result.status).toBe('SKIPPED');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('keeps the scheduler header and sends the HTTP action once', async () => {
    fetch.mockResolvedValueOnce(reply(200));
    expect((await run(http)).status).toBe('SUCCESS');
    expect(fetch).toHaveBeenCalledWith('https://partner.test/hook', expect.objectContaining({ headers: expect.objectContaining({ 'X-Scheduled-Integration-ID': 'sched-1' }) }));
  });
});

describe('the scheduler keeps owning retries and the DLQ', () => {
  it('a retryable failure is reported as retryable, with no DLQ entry', async () => {
    fetch.mockResolvedValueOnce(reply(503));
    const result = await run(http, 1);
    expect(result).toMatchObject({ status: 'FAILED', responseStatus: 503, shouldRetry: true });
    expect(mockDlq).not.toHaveBeenCalled();
  });

  it('a permanent failure is not retryable, and a spent one makes no DLQ entry either', async () => {
    fetch.mockResolvedValueOnce(reply(400));
    expect(await run(http, 1)).toMatchObject({ status: 'FAILED', responseStatus: 400, shouldRetry: false });
    fetch.mockResolvedValueOnce(reply(503));
    expect(await run(http, 4)).toMatchObject({ status: 'FAILED', shouldRetry: false });
    expect(mockDlq).not.toHaveBeenCalled();
  });
});
