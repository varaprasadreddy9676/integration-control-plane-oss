'use strict';

/**
 * Stages in the immediate send path (delivery-engine deliverToIntegration): the
 * real attempt seam and stage runtime, with the database and the target mocked.
 */

jest.mock('../../../src/utils/runtime', () => ({ ...jest.requireActual('../../../src/utils/runtime'), fetch: jest.fn() }));
jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const mockRecordLog = jest.fn();
jest.mock('../../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
  checkCircuitState: jest.fn(async () => ({ isOpen: false, state: 'CLOSED' })),
  recordDeliverySuccess: jest.fn(),
  recordDeliveryFailure: jest.fn(),
}));
jest.mock('../../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../../src/services/transformer', () => ({
  applyTransform: jest.fn(async (_integration, payload) => ({ ...payload, transformed: true })),
  isTransformationSkipped: jest.fn(() => false),
  getTransformationSkipReason: jest.fn(() => null),
  applyResponseTransform: jest.fn(),
}));
jest.mock('../../../src/utils/url-check', () => ({ validateTargetUrl: jest.fn(() => ({ valid: true })) }));
jest.mock('../../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn(async () => ({ 'X-Target-Key': 'target-secret' })) }));
jest.mock('../../../src/data/dlq', () => ({ createDLQEntry: jest.fn() }));
jest.mock('../../../src/utils/event-utils', () => ({
  generateCorrelationId: jest.fn(() => 'trace-1'),
  sleep: jest.fn(),
  isTestEvent: jest.fn(() => false),
  safeRead: jest.fn(async () => '{"id":"m-1"}'),
}));
const mockDrain = jest.fn(async () => ({}));
jest.mock('../../../src/stages/outbox', () => ({ drainLog: (...args) => mockDrain(...args) }));
jest.mock('../../../src/stages/store', () => {
  const actual = jest.requireActual('../../../src/stages/store');
  return { ...actual, definitions: { ...actual.definitions, saveDefinition: jest.fn(async () => 'hash') } };
});
const mockLogger = {
  executionLogId: 'log-1',
  start: jest.fn(async () => 'trace-1'),
  addStep: jest.fn(async () => {}),
  updateStatus: jest.fn(async () => {}),
  success: jest.fn(async () => {}),
  fail: jest.fn(async () => {}),
};
jest.mock('../../../src/utils/execution-logger', () => ({ createExecutionLogger: () => mockLogger }));
jest.mock('../../../src/services/communication/adapter-registry', () => ({}));
jest.mock('../../../src/services/hl7/mllp-client', () => ({ sendMllpMessage: jest.fn() }));

const { fetch } = require('../../../src/utils/runtime');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const { deliverToIntegration } = require('../../../src/processor/delivery-engine');

jest.setTimeout(30000);

const reply = (status, body) => ({
  status,
  ok: status < 300,
  headers: { forEach: (fn) => fn('application/json', 'content-type') },
  text: async () => body,
  clone() {
    return this;
  },
});

const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const base = (stages, extra = {}) => ({
  id: 'int-1',
  name: 'Partner',
  orgId: 3,
  targetUrl: 'https://partner.test/messages',
  httpMethod: 'POST',
  stages,
  ...extra,
});
const evt = { id: 'e1', event_type: 'APPT', payload: { patientId: 'p1' }, attempt_count: 0, orgId: 3 };
const deliver = (integration) => deliverToIntegration(integration, evt, false, 0, null, 'trace-1', true);
const lastLog = () => mockRecordLog.mock.calls[mockRecordLog.mock.calls.length - 1][1];

beforeAll(async () => {
  await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 2, memoryMb: 64 });
});
afterAll(() => stopStageRuntime());
beforeEach(() => {
  jest.clearAllMocks();
  mockRecordLog.mockImplementation(async (_orgId, payload) => payload.id || 'log-1');
  fetch.mockResolvedValue(reply(202, '{"id":"m-1"}'));
});

describe('an integration without stages', () => {
  it('writes its log exactly as before', async () => {
    expect((await deliver(base([]))).status).toBe('SUCCESS');
    expect(lastLog()).not.toHaveProperty('stageIntents');
    expect(lastLog()).not.toHaveProperty('stageRecords');
    expect(mockDrain).not.toHaveBeenCalled();
  });
});

describe('before_send', () => {
  it('a gate that skips stops the send and logs SKIPPED with its run', async () => {
    const integration = base([script('g', 'before_send', 'return ctx.delivery.request.body.transformed ? skip("patient opted out") : null;', { effect: 'gate' })]);
    const result = await deliver(integration);
    expect(result).toMatchObject({ status: 'SKIPPED', skipReason: 'g: patient opted out' });
    expect(fetch).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'SKIPPED', stageRecords: [expect.objectContaining({ outcome: 'skipped' })] });
  });

  it('a gate that fails fails the delivery without tripping the circuit, and schedules on_failure', async () => {
    const integration = base([
      script('g', 'before_send', 'return fail("no consent");', { effect: 'gate' }),
      script('tell', 'on_failure', 'return null;'),
    ]);
    expect((await deliver(integration)).status).toBe('FAILED');
    expect(fetch).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'FAILED', errorMessage: 'g: no consent', stageIntents: [expect.objectContaining({ hook: 'on_failure', stageId: 'tell' })] });
    const data = require('../../../src/data');
    expect(data.recordDeliveryFailure).toHaveBeenCalledWith('int-1', expect.objectContaining({ shouldTripCircuit: false }));
    expect(mockDrain).toHaveBeenCalledWith(3, 'log-1');
  });

  it('outputs reach the target request through the Send bindings', async () => {
    const integration = base(
      [script('tok', 'before_send', 'return { data: { token: "abc" } };', { effect: 'gate', outputs: [{ name: 'token', type: 'string' }] })],
      { send: { bindings: { headers: { Authorization: 'Bearer {{ stages.tok.output.token }}' }, query: { ref: '{{ event.patientId }}' } } } }
    );
    expect((await deliver(integration)).status).toBe('SUCCESS');
    expect(fetch).toHaveBeenCalledWith(
      'https://partner.test/messages?ref=p1',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer abc', 'X-Target-Key': 'target-secret' }) })
    );
  });

  it('stages never see the target\'s auth headers', async () => {
    const integration = base([script('peek', 'before_send', 'return { status: JSON.stringify(ctx.delivery.request).includes("target-secret") ? "LEAK" : "CLEAN" };')]);
    await deliver(integration);
    expect(lastLog().stageRecords[0].status).toBe('CLEAN');
  });
});

describe('after_response and after the send', () => {
  it('a classifier turns an accepted send into a failure, without resending', async () => {
    fetch.mockResolvedValue(reply(200, '{"accepted":false,"reason":"invalid number"}'));
    const integration = base([
      script('c', 'after_response', 'const b = ctx.delivery.response.body; return b.accepted ? null : fail(b.reason);', { effect: 'gate' }),
    ]);
    expect((await deliver(integration)).status).toBe('FAILED');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(lastLog()).toMatchObject({ status: 'FAILED', shouldRetry: false, errorMessage: 'c: invalid number' });
  });

  it('an accepted send writes its after_delivery intents with the answer, then drains', async () => {
    const integration = base([script('check', 'after_delivery', 'return null;', { schedule: { checkAfterSeconds: [30] } })]);
    expect((await deliver(integration)).status).toBe('SUCCESS');
    expect(lastLog()).toMatchObject({
      status: 'SUCCESS',
      stageIntents: [
        expect.objectContaining({
          hook: 'after_delivery',
          stageId: 'check',
          input: expect.objectContaining({ response: { status: 202, headers: { 'content-type': 'application/json' }, body: { id: 'm-1' } } }),
        }),
      ],
    });
    expect(mockDrain).toHaveBeenCalledWith(3, 'log-1');
  });

  it('a network failure past the retry budget is a terminal failure with on_failure', async () => {
    fetch.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const integration = base([script('tell', 'on_failure', 'return null;')], { retryCount: 1 });
    const result = await deliverToIntegration(integration, { ...evt, attempt_count: 1 }, false, 0, 'log-9', 'trace-1', true);
    expect(result.status).toBe('ABANDONED');
    expect(lastLog()).toMatchObject({ status: 'ABANDONED', stageIntents: [expect.objectContaining({ hook: 'on_failure' })] });
  });
});
