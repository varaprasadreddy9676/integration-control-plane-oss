'use strict';

/**
 * Stages on actions (delivery-engine deliverSingleAction): every kind of action
 * (email, HL7, HTTP) runs its own stages through the same seam, with the real
 * stage runtime and the database, the providers and the target mocked.
 */

jest.mock('../../../src/utils/runtime', () => ({ ...jest.requireActual('../../../src/utils/runtime'), fetch: jest.fn() }));
jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const mockRecordLog = jest.fn();
jest.mock('../../../src/data', () => ({
  recordLog: (...args) => mockRecordLog(...args),
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
jest.mock('../../../src/processor/auth-helper', () => ({ buildAuthHeaders: jest.fn(async () => ({})) }));
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
const mockSend = jest.fn();
jest.mock('../../../src/services/communication/adapter-registry', () => ({ send: (...args) => mockSend(...args) }));
jest.mock('../../../src/services/communication/sender-routing', () => ({ isSenderRoutingEnabled: () => false, resolveSenderRoute: jest.fn() }));
jest.mock('../../../src/services/operation-templates', () => ({ applyProviderRef: async (_orgId, action) => action }));
const mockMllp = jest.fn();
jest.mock('../../../src/services/hl7/mllp-client', () => ({ sendMllpMessage: (...args) => mockMllp(...args) }));

const { fetch } = require('../../../src/utils/runtime');
const { applyTransform } = require('../../../src/services/transformer');
const { createDLQEntry } = require('../../../src/data/dlq');
const { startStageRuntime, stopStageRuntime } = require('../../../src/stages/runtime');
const { deliverSingleAction } = require('../../../src/processor/delivery-engine');

jest.setTimeout(30000);

const script = (id, hook, code, extra = {}) => ({ id, name: id, hook, runner: { type: 'script', config: { code } }, ...extra });
const emailAction = (stages = [], send) => ({
  name: 'Send EMAIL',
  kind: 'COMMUNICATION',
  communicationConfig: { channel: 'EMAIL', provider: 'SMTP', smtp: { host: 'mail.test' } },
  stages,
  send,
});
const hl7Action = (stages = []) => ({ name: 'Send Order', kind: 'HL7_MLLP', hl7Config: { host: '127.0.0.1', port: 2575 }, stages });
const httpAction = (stages = [], send) => ({ name: 'Notify', kind: 'HTTP', targetUrl: 'https://partner.test/hook', httpMethod: 'POST', stages, send });
const integrationWith = (action) => ({ id: 'int-9', name: 'Gateway', orgId: 3, actions: [action] });
const evt = { id: 'e1', event_type: 'APPT', payload: { patientId: 'p1' }, attempt_count: 0, orgId: 3 };
const deliver = (action) => deliverSingleAction(integrationWith(action), action, evt, 0, 0, 'trace-1');
const lastLog = () => mockRecordLog.mock.calls[mockRecordLog.mock.calls.length - 1][1];
const reply = (status, body) => ({
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
  mockRecordLog.mockImplementation(async () => 'log-7');
  mockSend.mockResolvedValue({ messageId: 'smtp-1', accepted: ['a@b.test'] });
  mockMllp.mockResolvedValue({ accepted: true, ack: { code: 'AA', messageControlId: 'MSG-1' }, rawAck: 'MSA|AA|MSG-1' });
  fetch.mockResolvedValue(reply(202, '{"id":"m-1"}'));
});

describe('an action without stages', () => {
  it('writes its log exactly as before', async () => {
    expect((await deliver(emailAction())).status).toBe('SUCCESS');
    expect(lastLog()).not.toHaveProperty('stageIntents');
    expect(mockDrain).not.toHaveBeenCalled();
  });
});

describe('an email action', () => {
  const lookup = script('lookup', 'before_send', 'return { data: { to: "a@b.test" } };', { outputs: [{ name: 'to', type: 'string' }] });

  it('sends the message its Send step completed, and schedules after_delivery with what the provider answered', async () => {
    const check = script('check', 'after_delivery', 'return null;', { schedule: { checkAfterSeconds: [30] } });
    const action = emailAction([lookup, check], { bindings: { fields: { to: '{{ stages.lookup.output.to }}' } } });
    expect((await deliver(action)).status).toBe('SUCCESS');
    expect(mockSend).toHaveBeenCalledWith('EMAIL', 'SMTP', { patientId: 'p1', transformed: true, to: 'a@b.test' }, expect.anything());
    expect(lastLog()).toMatchObject({
      status: 'SUCCESS',
      requestPayload: { to: 'a@b.test' },
      stageRecords: [expect.objectContaining({ outcome: 'ok' })],
      stageIntents: [
        expect.objectContaining({
          stageId: 'check',
          input: expect.objectContaining({
            request: expect.objectContaining({ protocol: 'email', target: 'EMAIL:SMTP' }),
            response: expect.objectContaining({ protocol: 'email', ok: true, code: 'SENT', providerMessageId: 'smtp-1' }),
          }),
        }),
      ],
    });
    expect(mockDrain).toHaveBeenCalledWith(3, 'log-7');
  });

  it('a gate that skips stops the send', async () => {
    const result = await deliver(emailAction([script('g', 'before_send', 'return skip("unsubscribed");', { effect: 'gate' })]));
    expect(result).toMatchObject({ status: 'SKIPPED', skipReason: 'g: unsubscribed' });
    expect(mockSend).not.toHaveBeenCalled();
    expect(lastLog()).toMatchObject({ status: 'SKIPPED', httpMethod: 'COMMUNICATION', targetUrl: 'EMAIL:SMTP' });
  });

  it('a classifier can turn a sent message into a failure: on_failure runs, and no resend is queued unless allowed', async () => {
    const classify = script('c', 'after_response', 'return fail("bounced");', { effect: 'gate' });
    const notify = script('notify', 'on_failure', 'return null;');
    expect((await deliver(emailAction([classify, notify]))).status).toBe('FAILED');
    expect(lastLog()).toMatchObject({ status: 'FAILED', errorCode: 'STAGE_REJECTED', messageId: 'smtp-1', stageIntents: [expect.objectContaining({ stageId: 'notify' })] });
    expect(createDLQEntry).not.toHaveBeenCalled();

    const retrying = script('c', 'after_response', 'return fail("try later", { retryDelivery: true });', { effect: 'gate', allowDeliveryRetry: true });
    await deliver(emailAction([retrying]));
    expect(createDLQEntry).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'STAGE_REJECTED' }) }));
  });
});

describe('an HL7 action', () => {
  beforeEach(() => applyTransform.mockResolvedValueOnce('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-1|P|2.3\rPID|||P-1\r'));

  it('a stage sees the ACK in the same shape and may reject an accepted message', async () => {
    const classify = script('c', 'after_response', 'return ctx.delivery.response.code === "AA" ? fail("wrong ward") : null;', { effect: 'gate' });
    expect((await deliver(hl7Action([classify]))).status).toBe('FAILED');
    expect(lastLog()).toMatchObject({ status: 'FAILED', errorCode: 'STAGE_REJECTED', errorMessage: 'c: wrong ward', targetUrl: 'mllp://127.0.0.1:2575' });
    expect(createDLQEntry).not.toHaveBeenCalled();
  });
});

describe('an HTTP action', () => {
  it('gets the Send step\'s headers and query, and its classifier', async () => {
    const token = script('token', 'before_send', 'return { data: { t: "tok" } };', { outputs: [{ name: 't', type: 'string' }] });
    const classify = script('c', 'after_response', 'return ctx.delivery.response.status === 202 ? null : fail("no");', { effect: 'gate' });
    const action = httpAction([token, classify], { bindings: { headers: { Authorization: 'Bearer {{ stages.token.output.t }}' }, query: { v: '2' } } });
    expect((await deliver(action)).status).toBe('SUCCESS');
    expect(fetch).toHaveBeenCalledWith('https://partner.test/hook?v=2', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
  });
});

describe('every exit of an action logs who it is', () => {
  const identity = {
    integrationConfigId: 'int-9',
    integrationName: 'Gateway - Mail',
    eventId: 'e1',
    eventType: 'APPT',
    triggerType: 'EVENT',
    actionName: 'Mail',
    actionIndex: 0,
    attemptCount: 1,
    originalPayload: { patientId: 'p1' },
    correlationId: 'trace-1',
    traceId: 'trace-1',
  };
  const mail = { ...emailAction(), name: 'Mail' };

  it('after a send, a failed send, a skip and a transform failure', async () => {
    await deliver(mail);
    expect(lastLog()).toMatchObject({ ...identity, status: 'SUCCESS' });

    mockSend.mockRejectedValueOnce(new Error('smtp down'));
    await deliver(mail);
    expect(lastLog()).toMatchObject({ ...identity, status: 'FAILED', errorCode: 'COMMUNICATION_ERROR' });

    await deliver({ ...mail, stages: [script('g', 'before_send', 'return skip("no");', { effect: 'gate' })] });
    expect(lastLog()).toMatchObject({ ...identity, status: 'SKIPPED' });

    applyTransform.mockRejectedValueOnce(new Error('bad script'));
    await deliver(mail);
    expect(lastLog()).toMatchObject({ ...identity, status: 'FAILED', responseStatus: 500 });
  });

  it('after an HTTP answer and a network error', async () => {
    const hook = { ...httpAction(), name: 'Mail' };
    fetch.mockResolvedValueOnce(reply(202, '{}'));
    await deliver(hook);
    expect(lastLog()).toMatchObject({ ...identity, direction: 'OUTBOUND', status: 'SUCCESS', targetUrl: 'https://partner.test/hook' });
    fetch.mockRejectedValueOnce(new Error('socket hang up'));
    await deliver(hook);
    expect(lastLog()).toMatchObject({ ...identity, status: 'RETRYING' });
  });
});
