'use strict';

/**
 * Stages in the scheduled send path (scheduler-worker deliverScheduledIntegration):
 * the real attempt seam and stage runtime, with the database and the target mocked.
 */

jest.mock('../../../src/utils/runtime', () => ({ ...jest.requireActual('../../../src/utils/runtime'), fetch: jest.fn() }));
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
jest.mock('../../../src/utils/url-check', () => ({ validateTargetUrl: jest.fn(() => ({ valid: true })) }));
jest.mock('../../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn(async () => ({})) }));
jest.mock('../../../src/services/transformer', () => ({ applyTransform: jest.fn(async (_i, payload) => payload) }));
jest.mock('../../../src/utils/execution-logger', () => ({
  createExecutionLogger: () => ({
    start: jest.fn(async () => {}),
    addStep: jest.fn(async () => {}),
    updateStatus: jest.fn(async () => {}),
    success: jest.fn(async () => {}),
    fail: jest.fn(async () => {}),
  }),
}));
const mockDrain = jest.fn(async () => ({}));
jest.mock('../../../src/stages/outbox', () => ({ drainLog: (...args) => mockDrain(...args) }));
jest.mock('../../../src/stages/store', () => {
  const actual = jest.requireActual('../../../src/stages/store');
  return { ...actual, definitions: { ...actual.definitions, saveDefinition: jest.fn(async () => 'hash') } };
});

const { fetch } = require('../../../src/utils/runtime');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const { deliverScheduledIntegration } = require('../../../src/processor/scheduler-worker');

jest.setTimeout(30000);

const reply = (status, body) => ({
  status,
  ok: status < 300,
  headers: { forEach: () => {}, get: () => 'application/json' },
  text: async () => body,
  clone() {
    return this;
  },
});
const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const integrationWith = (stages, extra = {}) => ({ id: 'int-2', name: 'Reminder', orgId: 4, retryCount: 3, targetUrl: 'https://p.test/send', stages, ...extra });
const scheduled = (attemptCount = 0) => ({
  id: 'sched-1',
  orgId: 4,
  eventType: 'APPT_REMINDER',
  targetUrl: 'https://p.test/send',
  httpMethod: 'POST',
  attemptCount,
  payload: { to: 'x' },
  originalPayload: { patientId: 'p1' },
});
const lastLog = () => mockRecordLog.mock.calls[mockRecordLog.mock.calls.length - 1][1];

beforeAll(async () => {
  await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 2, memoryMb: 64 });
});
afterAll(() => stopStageRuntime());
beforeEach(() => {
  jest.clearAllMocks();
  mockRecordLog.mockResolvedValue('new-log-1');
});

it('a gate that skips returns SKIPPED and sends nothing', async () => {
  const integration = integrationWith([script('g', 'before_send', 'return skip("appointment cancelled");', { effect: 'gate' })]);
  expect(await deliverScheduledIntegration(scheduled(), integration)).toMatchObject({ status: 'SKIPPED' });
  expect(fetch).not.toHaveBeenCalled();
  expect(lastLog()).toMatchObject({ status: 'SKIPPED', stageRecords: [expect.objectContaining({ outcome: 'skipped' })] });
});

it('a retryable failure is logged FAILED but is not terminal: no on_failure until the last attempt', async () => {
  fetch.mockResolvedValue(reply(503, 'busy'));
  const integration = integrationWith([script('tell', 'on_failure', 'return null;')]);
  expect(await deliverScheduledIntegration(scheduled(0), integration)).toMatchObject({ status: 'RETRYING' });
  expect(lastLog()).toMatchObject({ status: 'FAILED' });
  expect(lastLog()).not.toHaveProperty('stageIntents');

  expect(await deliverScheduledIntegration(scheduled(2), integration)).toMatchObject({ status: 'FAILED' });
  expect(lastLog()).toMatchObject({ status: 'FAILED', stageIntents: [expect.objectContaining({ hook: 'on_failure', stageId: 'tell' })] });
  expect(mockDrain).toHaveBeenCalledWith(4, 'new-log-1');
});

it('bindings reach the request, a classifier can fail an accepted send, and success schedules after_delivery', async () => {
  fetch.mockResolvedValue(reply(200, '{"queued":true}'));
  const integration = integrationWith(
    [
      script('tok', 'before_send', 'return { data: { t: "k1" } };', { effect: 'gate', outputs: [{ name: 't', type: 'string' }] }),
      script('check', 'after_delivery', 'return null;', { schedule: { checkAfterSeconds: [60] } }),
    ],
    { send: { bindings: { headers: { 'X-Token': '{{ stages.tok.output.t }}' }, query: { p: '{{ event.patientId }}' } } } }
  );
  expect(await deliverScheduledIntegration(scheduled(), integration)).toMatchObject({ status: 'SUCCESS' });
  expect(fetch).toHaveBeenCalledWith('https://p.test/send?p=p1', expect.objectContaining({ headers: expect.objectContaining({ 'X-Token': 'k1' }) }));
  expect(lastLog().stageIntents).toEqual([expect.objectContaining({ hook: 'after_delivery', input: expect.objectContaining({ event: { patientId: 'p1' } }) })]);

  const rejecting = integrationWith([script('c', 'after_response', 'return fail("not queued");', { effect: 'gate' })]);
  expect(await deliverScheduledIntegration(scheduled(), rejecting)).toMatchObject({ status: 'FAILED', errorMessage: 'c: not queued' });
});
