'use strict';

/**
 * Delivery follow-up: after a send is accepted, a small script asks the
 * provider what became of the message (delivered, read, failed) and the answer
 * is stored next to the delivery log. Everything the script returns is
 * normalized, so the dashboard never depends on a provider's vocabulary.
 */

const mockQueue = {
  enqueue: jest.fn(async (job) => ({ ...job, _id: 'job-1' })),
  saveCheck: jest.fn(async () => {}),
  markLog: jest.fn(async () => {}),
};
jest.mock('../../src/data/delivery-follow-ups', () => mockQueue);

const mockApplyScriptTransform = jest.fn();
const mockIsSkipped = jest.fn((value) => Boolean(value && value.__skipped));
jest.mock('../../src/services/transformer', () => ({
  applyScriptTransform: (...args) => mockApplyScriptTransform(...args),
  isTransformationSkipped: (value) => mockIsSkipped(value),
  getTransformationSkipReason: (value) => value.reason,
}));

const mockGetIntegration = jest.fn();
jest.mock('../../src/data', () => ({ getIntegration: (...args) => mockGetIntegration(...args) }));

jest.mock('../../src/processor/auth-helper', () => ({
  buildAuthHeaders: jest.fn(async () => ({ 'X-Key': 'secret' })),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const followUp = require('../../src/services/delivery-follow-up');

const SCRIPT = 'return { status: "DELIVERED" };';
const integration = (overrides = {}) => ({
  id: 'int-1',
  _id: 'int-1',
  orgId: 33,
  name: 'WhatsApp',
  customHeaders: { 'X-Trace': 'a' },
  deliveryFollowUp: { enabled: true, script: SCRIPT, checkAfterSeconds: [30, 300, 3600] },
  ...overrides,
});

describe('validateDeliveryFollowUp', () => {
  it('accepts no configuration', () => {
    expect(followUp.validateDeliveryFollowUp(undefined)).toBeNull();
    expect(followUp.validateDeliveryFollowUp(null)).toBeNull();
  });

  it('requires a script that parses when enabled', () => {
    expect(followUp.validateDeliveryFollowUp({ enabled: true })).toMatch(/script is required/i);
    expect(followUp.validateDeliveryFollowUp({ enabled: true, script: 'return {' })).toMatch(/not valid JavaScript/i);
    expect(followUp.validateDeliveryFollowUp({ enabled: true, script: SCRIPT })).toBeNull();
  });

  it('does not check the script while disabled', () => {
    expect(followUp.validateDeliveryFollowUp({ enabled: false, script: 'return {' })).toBeNull();
  });

  it('rejects a bad schedule', () => {
    const base = { enabled: true, script: SCRIPT };
    expect(followUp.validateDeliveryFollowUp({ ...base, checkAfterSeconds: [] })).toMatch(/at least one/i);
    expect(followUp.validateDeliveryFollowUp({ ...base, checkAfterSeconds: [1] })).toMatch(/between/i);
    expect(followUp.validateDeliveryFollowUp({ ...base, checkAfterSeconds: ['x'] })).toMatch(/whole number/i);
    expect(followUp.validateDeliveryFollowUp({ ...base, checkAfterSeconds: Array(9).fill(60) })).toMatch(/at most/i);
  });

  it('rejects an oversized script', () => {
    expect(followUp.validateDeliveryFollowUp({ enabled: true, script: `//${'x'.repeat(30000)}\nreturn 1;` })).toMatch(
      /too long/i
    );
  });
});

describe('normalizeDeliveryFollowUp', () => {
  it('returns null when absent', () => {
    expect(followUp.normalizeDeliveryFollowUp(undefined)).toBeNull();
  });

  it('fills the default schedule and orders and de-duplicates a custom one', () => {
    expect(followUp.normalizeDeliveryFollowUp({ enabled: true, script: SCRIPT }).checkAfterSeconds).toEqual([
      30, 300, 3600, 86400,
    ]);
    expect(
      followUp.normalizeDeliveryFollowUp({ enabled: true, script: SCRIPT, checkAfterSeconds: [300, 30, 300] })
        .checkAfterSeconds
    ).toEqual([30, 300]);
  });

  it('keeps the script as typed and the enabled flag strict', () => {
    const normalized = followUp.normalizeDeliveryFollowUp({ enabled: 'yes', script: ` ${SCRIPT} ` });
    expect(normalized.enabled).toBe(false);
    expect(normalized.script).toBe(SCRIPT);
  });
});

describe('normalizeFollowUpResult', () => {
  it('maps a status and its timestamps', () => {
    const result = followUp.normalizeFollowUpResult({
      status: 'read',
      deliveredAt: 1_790_000_000, // seconds
      readAt: '2026-10-22T10:00:00Z',
    });
    expect(result.status).toBe('READ');
    expect(result.deliveredAt).toEqual(new Date(1_790_000_000_000));
    expect(result.readAt).toEqual(new Date('2026-10-22T10:00:00Z'));
  });

  it('reads epoch milliseconds too', () => {
    expect(followUp.normalizeFollowUpResult({ status: 'DELIVERED', deliveredAt: 1_790_000_000_000 }).deliveredAt).toEqual(
      new Date(1_790_000_000_000)
    );
  });

  it('keeps the failure reason', () => {
    const result = followUp.normalizeFollowUpResult({ status: 'FAILED', errorCode: 131026, errorMessage: 'Undeliverable' });
    expect(result).toMatchObject({ status: 'FAILED', errorCode: '131026', errorMessage: 'Undeliverable' });
  });

  it('treats nothing, PENDING and a bare string as still waiting or the named status', () => {
    expect(followUp.normalizeFollowUpResult(null).status).toBe('PENDING');
    expect(followUp.normalizeFollowUpResult(undefined).status).toBe('PENDING');
    expect(followUp.normalizeFollowUpResult({ status: 'pending' }).status).toBe('PENDING');
    expect(followUp.normalizeFollowUpResult('delivered').status).toBe('DELIVERED');
  });

  it('takes whatever status word the script chooses', () => {
    expect(followUp.normalizeFollowUpResult({ status: 'Delivered' }).status).toBe('DELIVERED');
    expect(followUp.normalizeFollowUpResult({ status: 'in progress' }).status).toBe('IN_PROGRESS');
    expect(followUp.normalizeFollowUpResult({ status: 'signed-off' }).status).toBe('SIGNED_OFF');
  });

  it('rejects a status that is not a short word, so a mistake is visible', () => {
    expect(() => followUp.normalizeFollowUpResult({ status: 'not a word!' })).toThrow(/status must be a short word/i);
    expect(() => followUp.normalizeFollowUpResult({ status: 'x'.repeat(41) })).toThrow(/status must be a short word/i);
    expect(() => followUp.normalizeFollowUpResult({ status: { a: 1 } })).toThrow(/status must be a short word/i);
  });

  it('lets the script say it is finished; READ and FAILED finish by default', () => {
    expect(followUp.normalizeFollowUpResult({ status: 'COMPLETED', done: true }).done).toBe(true);
    expect(followUp.normalizeFollowUpResult({ status: 'COMPLETED' }).done).toBe(false);
    expect(followUp.normalizeFollowUpResult({ status: 'READ' }).done).toBe(true);
    expect(followUp.normalizeFollowUpResult({ status: 'FAILED' }).done).toBe(true);
    expect(followUp.normalizeFollowUpResult({ status: 'READ', done: false }).done).toBe(false);
    expect(followUp.normalizeFollowUpResult(null).done).toBe(false);
  });

  it('ignores unusable timestamps instead of failing the check', () => {
    const result = followUp.normalizeFollowUpResult({ status: 'DELIVERED', deliveredAt: 'not a date' });
    expect(result.deliveredAt).toBeNull();
  });
});

describe('scheduleFollowUp', () => {
  beforeEach(() => jest.clearAllMocks());
  const sent = { orgId: 33, logId: 'log-1', statusCode: 200, responseBody: { data: [{ id: 'm1' }] } };

  it('queues the first check relative to the send time', async () => {
    const before = Date.now();
    await followUp.scheduleFollowUp({ ...sent, integration: integration() });
    const job = mockQueue.enqueue.mock.calls[0][0];
    expect(job).toMatchObject({
      orgId: 33,
      logId: 'log-1',
      integrationId: 'int-1',
      status: 'PENDING',
      deliveryStatus: 'PENDING',
      checkIndex: 0,
      delivery: { statusCode: 200, response: { data: [{ id: 'm1' }] } },
    });
    expect(job.nextCheckAt.getTime()).toBeGreaterThanOrEqual(before + 30_000);
    expect(mockQueue.markLog).toHaveBeenCalledWith(33, 'log-1', expect.objectContaining({ status: 'PENDING', done: false }));
  });

  it('hands the script the parsed response when the provider answered JSON text', async () => {
    await followUp.scheduleFollowUp({
      ...sent,
      responseBody: '{"status":true,"data":[{"id":"wamid.1"}]}',
      integration: integration(),
    });
    expect(mockQueue.enqueue.mock.calls[0][0].delivery.response).toEqual({ status: true, data: [{ id: 'wamid.1' }] });
  });

  it('keeps a response that is not JSON as the text it is', async () => {
    await followUp.scheduleFollowUp({ ...sent, responseBody: 'OK queued', integration: integration() });
    expect(mockQueue.enqueue.mock.calls[0][0].delivery.response).toBe('OK queued');
    await followUp.scheduleFollowUp({ ...sent, responseBody: '{"cut off', integration: integration() });
    expect(mockQueue.enqueue.mock.calls[1][0].delivery.response).toBe('{"cut off');
  });

  it('does nothing when follow-up is off', async () => {
    await followUp.scheduleFollowUp({ ...sent, integration: integration({ deliveryFollowUp: null }) });
    await followUp.scheduleFollowUp({
      ...sent,
      integration: integration({ deliveryFollowUp: { enabled: false, script: SCRIPT } }),
    });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
  });

  it('never lets a queue failure reach the delivery', async () => {
    mockQueue.enqueue.mockRejectedValueOnce(new Error('mongo down'));
    await expect(followUp.scheduleFollowUp({ ...sent, integration: integration() })).resolves.toBeUndefined();
  });

  it('drops an oversized response rather than storing it twice', async () => {
    await followUp.scheduleFollowUp({ ...sent, responseBody: { blob: 'x'.repeat(100_000) }, integration: integration() });
    const job = mockQueue.enqueue.mock.calls[0][0];
    expect(JSON.stringify(job.delivery.response).length).toBeLessThan(60_000);
  });
});

describe('processFollowUp', () => {
  const sentAt = new Date('2026-10-22T10:00:00Z');
  const makeJob = (overrides = {}) => ({
    _id: 'job-1',
    orgId: 33,
    logId: 'log-1',
    integrationId: 'int-1',
    eventType: 'ORDER_PLACED',
    checkIndex: 0,
    sentAt,
    delivery: { statusCode: 200, response: { data: [{ id: 'm1' }] } },
    ...overrides,
  });
  const now = new Date('2026-10-22T10:00:31Z');

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetIntegration.mockResolvedValue(integration());
  });

  const lastSaved = () => mockQueue.saveCheck.mock.calls[0][1];

  it('runs the script with the delivery and the integration headers', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'DELIVERED' });
    await followUp.processFollowUp(makeJob(), now);

    const [script, delivery, context] = mockApplyScriptTransform.mock.calls[0];
    expect(script).toContain('const delivery = payload;');
    expect(script).toContain(SCRIPT);
    expect(delivery).toMatchObject({ statusCode: 200, check: 1, response: { data: [{ id: 'm1' }] } });
    expect(delivery.sentAt).toBe('2026-10-22T10:00:00.000Z');
    expect(context.headers).toEqual({ 'X-Key': 'secret', 'X-Trace': 'a' });
    expect(context).toMatchObject({ orgId: 33, eventType: 'ORDER_PLACED' });
  });

  it('keeps checking after DELIVERED (a read may follow), on the schedule from the send time', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'DELIVERED', deliveredAt: 1_790_000_000 });
    await followUp.processFollowUp(makeJob(), now);

    expect(lastSaved()).toMatchObject({ deliveryStatus: 'DELIVERED', status: 'PENDING', checkIndex: 1, lockedUntil: null });
    expect(lastSaved().nextCheckAt).toEqual(new Date(sentAt.getTime() + 300_000));
    expect(mockQueue.markLog).toHaveBeenCalledWith(
      33,
      'log-1',
      expect.objectContaining({ status: 'DELIVERED', done: false, checks: 1 })
    );
  });

  it.each(['READ', 'FAILED'])('stops at %s', async (status) => {
    mockApplyScriptTransform.mockResolvedValue({ status, errorCode: '131026', errorMessage: 'No' });
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: status, status: 'DONE' });
    expect(mockQueue.markLog.mock.calls[0][2]).toMatchObject({ status, done: true });
  });

  it('records the failure reason on the log', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'FAILED', errorCode: 131026, errorMessage: 'Undeliverable' });
    await followUp.processFollowUp(makeJob(), now);
    expect(mockQueue.markLog.mock.calls[0][2]).toMatchObject({ errorCode: '131026', errorMessage: 'Undeliverable' });
  });

  it('waits again on PENDING and does not move the next check into the past', async () => {
    mockApplyScriptTransform.mockResolvedValue(null);
    const late = new Date(sentAt.getTime() + 10 * 3_600_000); // worker was down for hours
    await followUp.processFollowUp(makeJob({ checkIndex: 0 }), late);
    expect(lastSaved().status).toBe('PENDING');
    expect(lastSaved().nextCheckAt.getTime()).toBeGreaterThanOrEqual(late.getTime());
  });

  it('gives up after the last check: UNKNOWN when it never learned anything, else the last status', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'PENDING' });
    await followUp.processFollowUp(makeJob({ checkIndex: 2 }), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: 'UNKNOWN', status: 'DONE' });

    jest.clearAllMocks();
    mockGetIntegration.mockResolvedValue(integration());
    mockApplyScriptTransform.mockResolvedValue({ status: 'DELIVERED' });
    await followUp.processFollowUp(makeJob({ checkIndex: 2 }), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: 'DELIVERED', status: 'DONE' });
  });

  it('survives a script that throws: records the error and tries again later', async () => {
    mockApplyScriptTransform.mockRejectedValue(new Error('Script execution failed: HTTP GET failed: ECONNRESET'));
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved()).toMatchObject({ status: 'PENDING', checkIndex: 1, lastError: expect.stringContaining('ECONNRESET') });
    expect(mockQueue.markLog.mock.calls[0][2].lastError).toMatch(/ECONNRESET/);
  });

  it('treats a status that is not a word as a failed check, not a status', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'not a word!' });
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved().deliveryStatus).toBe('PENDING');
    expect(lastSaved().lastError).toMatch(/status must be a short word/i);
  });

  it('stops on any status when the script says it is done, and goes on when it does not', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'Signed off', done: true });
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: 'SIGNED_OFF', status: 'DONE' });

    jest.clearAllMocks();
    mockGetIntegration.mockResolvedValue(integration());
    mockApplyScriptTransform.mockResolvedValue({ status: 'Signed off' });
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: 'SIGNED_OFF', status: 'PENDING' });
  });

  describe('what each check records', () => {
    const spanFor = (extra = {}) => ({
      name: 'script_http',
      method: 'GET',
      url: 'https://p.example/v1/messages?msgid=m1&api_key=url-secret',
      requestHeaders: { 'QIKCHAT-API-KEY': 'header-secret', Accept: 'application/json' },
      statusCode: 200,
      duration: 42,
      responseBody: '{"message":{"status":"delivered"}}',
      ...extra,
    });

    it('keeps the request and response of every check, with credentials masked', async () => {
      mockApplyScriptTransform.mockImplementation(async (_s, _d, _c, _i, spans) => {
        spans.push(spanFor());
        return { status: 'DELIVERED' };
      });
      await followUp.processFollowUp(makeJob(), now);

      const entry = lastSaved().history[0];
      expect(entry).toMatchObject({ check: 1, at: now, outcome: 'RESULT', status: 'DELIVERED' });
      expect(entry.httpCalls[0]).toMatchObject({ method: 'GET', statusCode: 200, durationMs: 42 });
      expect(entry.httpCalls[0].url).toContain('msgid=m1');
      expect(JSON.stringify(entry)).not.toMatch(/url-secret|header-secret/);
      expect(entry.httpCalls[0].headers).toEqual({ 'QIKCHAT-API-KEY': '********', Accept: 'application/json' });
      expect(entry.httpCalls[0].responseBody).toContain('delivered');
      expect(mockQueue.markLog.mock.calls[0][2].history).toEqual(lastSaved().history);
    });

    it('asks the sandbox to record request headers', async () => {
      mockApplyScriptTransform.mockResolvedValue({ status: 'SENT' });
      await followUp.processFollowUp(makeJob(), now);
      expect(mockApplyScriptTransform.mock.calls[0][2].captureHttpHeaders).toBe(true);
    });

    it('adds to the history of the earlier checks and keeps at most 10', async () => {
      mockApplyScriptTransform.mockResolvedValue({ status: 'SENT' });
      const earlier = Array.from({ length: 10 }, (_, i) => ({ check: i + 1, outcome: 'RESULT', status: 'SENT', httpCalls: [] }));
      await followUp.processFollowUp(makeJob({ checkIndex: 0, history: earlier }), now);
      const history = lastSaved().history;
      expect(history).toHaveLength(10);
      expect(history[9]).toMatchObject({ check: 1, outcome: 'RESULT' });
      expect(history[0].check).toBe(2); // the oldest fell off
    });

    it('records a failed check with its error and what the provider answered before it failed', async () => {
      mockApplyScriptTransform.mockImplementation(async (_s, _d, _c, _i, spans) => {
        spans.push(spanFor({ statusCode: 500, responseBody: '{"error":"down"}' }));
        throw new Error('Script execution failed: Status check returned 500');
      });
      await followUp.processFollowUp(makeJob(), now);
      const entry = lastSaved().history[0];
      expect(entry).toMatchObject({ outcome: 'ERROR', error: expect.stringContaining('returned 500') });
      expect(entry.httpCalls[0]).toMatchObject({ statusCode: 500 });
    });

    it('records a skip with its reason', async () => {
      mockApplyScriptTransform.mockResolvedValue({ __skipped: true, reason: 'No message id in the response' });
      await followUp.processFollowUp(makeJob(), now);
      expect(lastSaved().history[0]).toMatchObject({ outcome: 'SKIPPED', reason: 'No message id in the response' });
    });

    it('truncates a very large response so the log stays small', async () => {
      mockApplyScriptTransform.mockImplementation(async (_s, _d, _c, _i, spans) => {
        spans.push(spanFor({ responseBody: 'x'.repeat(20000) }));
        return { status: 'SENT' };
      });
      await followUp.processFollowUp(makeJob(), now);
      expect(lastSaved().history[0].httpCalls[0].responseBody.length).toBeLessThanOrEqual(3100);
    });
  });

  it('stops tracking when the script calls skip()', async () => {
    mockApplyScriptTransform.mockResolvedValue({ __skipped: true, reason: 'No message id in the response' });
    await followUp.processFollowUp(makeJob(), now);
    expect(lastSaved()).toMatchObject({ deliveryStatus: 'NOT_TRACKED', status: 'DONE' });
    expect(mockQueue.markLog.mock.calls[0][2]).toMatchObject({ status: 'NOT_TRACKED', reason: 'No message id in the response' });
  });

  it('stops quietly when the integration is gone or follow-up was switched off', async () => {
    for (const gone of [null, integration({ deliveryFollowUp: { enabled: false, script: SCRIPT } })]) {
      jest.clearAllMocks();
      mockGetIntegration.mockResolvedValue(gone);
      await followUp.processFollowUp(makeJob(), now);
      expect(mockApplyScriptTransform).not.toHaveBeenCalled();
      expect(lastSaved()).toMatchObject({ deliveryStatus: 'NOT_TRACKED', status: 'DONE' });
    }
  });

  it('uses the configuration as it is now, so an edited script takes effect on pending checks', async () => {
    mockGetIntegration.mockResolvedValue(
      integration({ deliveryFollowUp: { enabled: true, script: 'return { status: "READ" };', checkAfterSeconds: [30] } })
    );
    mockApplyScriptTransform.mockResolvedValue({ status: 'READ' });
    await followUp.processFollowUp(makeJob(), now);
    expect(mockApplyScriptTransform.mock.calls[0][0]).toContain('status: "READ"');
  });
});

describe('testFollowUpScript', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockApplyScriptTransform.mockReset();
  });
  const delivery = { statusCode: 200, response: { data: [{ id: 'm1' }] } };

  it('returns what the script answered, normalized, without queueing or saving anything', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'read', readAt: 1_790_000_000 });
    const out = await followUp.testFollowUpScript({ integration: integration(), script: SCRIPT, delivery });
    expect(out).toMatchObject({ outcome: 'RESULT', result: { status: 'READ' } });
    expect(mockQueue.enqueue).not.toHaveBeenCalled();
    expect(mockQueue.saveCheck).not.toHaveBeenCalled();
    expect(mockQueue.markLog).not.toHaveBeenCalled();
  });

  it('collects the http calls the script made so it can be debugged', async () => {
    mockApplyScriptTransform.mockImplementation(async (_s, _d, _c, _i, spans) => {
      spans.push({ name: 'script_http', method: 'GET', url: 'https://p.example/v1/messages?msgid=m1', statusCode: 200, duration: 42 });
      return { status: 'DELIVERED' };
    });
    const out = await followUp.testFollowUpScript({ integration: integration(), script: SCRIPT, delivery });
    expect(out.httpCalls).toEqual([
      expect.objectContaining({ method: 'GET', url: 'https://p.example/v1/messages?msgid=m1', statusCode: 200 }),
    ]);
  });

  it('reports a skip, an error and a made-up status instead of throwing', async () => {
    mockApplyScriptTransform.mockResolvedValueOnce({ __skipped: true, reason: 'no id' });
    expect(await followUp.testFollowUpScript({ integration: integration(), script: SCRIPT, delivery })).toMatchObject({
      outcome: 'SKIPPED',
      reason: 'no id',
    });
    mockApplyScriptTransform.mockRejectedValueOnce(new Error('boom'));
    expect(await followUp.testFollowUpScript({ integration: integration(), script: SCRIPT, delivery })).toMatchObject({
      outcome: 'ERROR',
      error: expect.stringContaining('boom'),
    });
    mockApplyScriptTransform.mockResolvedValueOnce({ status: 'not a word!' });
    expect(await followUp.testFollowUpScript({ integration: integration(), script: SCRIPT, delivery })).toMatchObject({
      outcome: 'ERROR',
      error: expect.stringMatching(/status must be a short word/i),
    });
  });

  it('works for an integration that is not saved yet (no headers)', async () => {
    mockApplyScriptTransform.mockResolvedValue({ status: 'SENT' });
    const out = await followUp.testFollowUpScript({ integration: null, script: SCRIPT, delivery });
    expect(out.outcome).toBe('RESULT');
    expect(mockApplyScriptTransform.mock.calls[0][2].headers).toEqual({});
  });
});
