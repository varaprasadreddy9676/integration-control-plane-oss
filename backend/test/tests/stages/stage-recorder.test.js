'use strict';

/**
 * The recorder and masking: what a stage run stores must never contain a
 * credential, a token from a response, or a declared sensitive value, wherever
 * the script copied it (logs, errors, the result, other calls).
 */

const { createMasker, parsePath, REDACTED } = require('../../../src/stages/mask');
const { createRecorder } = require('../../../src/stages/recorder');

const everything = (record) => JSON.stringify(record);

describe('parsePath', () => {
  it('accepts dot paths, brackets, wildcards and a leading $', () => {
    expect(parsePath('data[*].phone')).toEqual(['data', '*', 'phone']);
    expect(parsePath('$.data.0.phone')).toEqual(['data', '0', 'phone']);
    expect(parsePath("message['to']")).toEqual(['message', 'to']);
  });
});

describe('createMasker', () => {
  it('masks credential keys and declared sensitive paths without touching the input', () => {
    const masker = createMasker({ sensitivePaths: ['data[*].recipient', 'meta.owner.email'] });
    const input = {
      access_token: 'tok-1234567',
      data: [{ recipient: '919876543210', status: 'READ' }, { recipient: '918888888888', status: 'SENT' }],
      meta: { owner: { email: 'someone@example.com', name: 'x' } },
    };
    const frozen = JSON.stringify(input);
    const out = masker.maskJson(input);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(out).toEqual({
      access_token: REDACTED,
      data: [{ recipient: REDACTED, status: 'READ' }, { recipient: REDACTED, status: 'SENT' }],
      meta: { owner: { email: REDACTED, name: 'x' } },
    });
  });

  it('scrubs every value it learned from every string, including encoded copies', () => {
    const masker = createMasker({ sensitivePaths: ['to'], secrets: ['sk_live_abc123'] });
    masker.maskJson({ to: '919876543210' });
    masker.maskHeaders({ Authorization: 'Bearer eyJhbGciOi.payload.sig' });
    const out = masker.scrub({
      log: 'calling with sk_live_abc123 for 919876543210 token eyJhbGciOi.payload.sig',
      url: 'https://x.test/?q=sk_live_abc123%21',
      nested: [{ text: 'k=' + encodeURIComponent('sk_live_abc123') }],
    });
    expect(everything(out)).not.toMatch(/sk_live_abc123|919876543210|eyJhbGciOi/);
  });

  it('masks credentials in URLs: user:password@ and credential query parameters', () => {
    const masker = createMasker();
    expect(masker.maskUrl('https://user:hunter22@api.test/x?api_key=abcd1234&page=2')).toBe(
      `https://user:${REDACTED}@api.test/x?api_key=${REDACTED}&page=2`
    );
    expect(masker.scrub('the key abcd1234 and hunter22')).toBe(`the key ${REDACTED} and ${REDACTED}`);
  });

  it('does not scrub short values found by key, which would mangle ordinary text', () => {
    const masker = createMasker();
    expect(masker.maskJson({ otp: '1234' })).toEqual({ otp: REDACTED });
    expect(masker.scrub('order 1234 shipped')).toBe('order 1234 shipped');
  });
});

describe('createRecorder', () => {
  const fakeResponse = (overrides = {}) => ({
    status: 200,
    headers: { 'content-type': 'application/json', 'set-cookie': 'sid=s3cr3tcookie' },
    body: JSON.stringify({ access_token: 'tok_FROM_RESPONSE_99', data: [{ recipient: '919876543210' }] }),
    bodyTruncated: false,
    redirects: [],
    durationMs: 12,
    ...overrides,
  });

  it('gives the script the real response but stores only masked data, wherever it was copied', async () => {
    const requests = [];
    const recorder = createRecorder({
      sensitivePaths: ['data[*].recipient'],
      credential: { origins: ['https://api.provider.test'], headers: { 'X-Api-Key': 'cred-secret-777' } },
      request: async (args) => {
        requests.push(args);
        return fakeResponse();
      },
    });

    const res = await recorder.http({ method: 'POST', url: 'https://api.provider.test/token', body: { user: 'a' } });
    expect(res.data.access_token).toBe('tok_FROM_RESPONSE_99'); // the script can use it
    expect(requests[0].credential.headers['X-Api-Key']).toBe('cred-secret-777'); // the client adds it
    expect(requests[0].headers['content-type']).toBe('application/json');

    const record = recorder.finish({
      outcome: 'error',
      result: { token: 'tok_FROM_RESPONSE_99', phone: '919876543210' },
      error: 'failed with tok_FROM_RESPONSE_99',
      logs: [{ level: 'info', message: 'got tok_FROM_RESPONSE_99 for 919876543210 using cred-secret-777' }],
    });
    const text = everything(record);
    expect(text).not.toMatch(/tok_FROM_RESPONSE_99|919876543210|cred-secret-777|s3cr3tcookie/);
    expect(record.calls[0]).toMatchObject({
      method: 'POST',
      url: 'https://api.provider.test/token',
      statusCode: 200,
      requestHeaders: { 'X-Api-Key': REDACTED, 'content-type': 'application/json' },
      responseHeaders: { 'set-cookie': REDACTED },
      responseBody: { access_token: REDACTED, data: [{ recipient: REDACTED }] },
    });
    expect(record.result).toEqual({ token: REDACTED, phone: REDACTED });
  });

  it('does not show the credential on calls to origins it was not approved for', async () => {
    const recorder = createRecorder({
      credential: { origins: ['https://api.provider.test'], headers: { Authorization: 'Bearer zzz-cred-1' } },
      request: async () => fakeResponse({ body: '{}' }),
    });
    await recorder.http({ url: 'https://elsewhere.test/x' });
    const record = recorder.finish({ outcome: 'ok' });
    expect(record.calls[0].requestHeaders).toEqual({});
  });

  it('records failed calls with their error, and the error reaches the script', async () => {
    const recorder = createRecorder({
      request: async () => {
        throw Object.assign(new Error('Destination not allowed: 169.254.169.254'), { code: 'DESTINATION_BLOCKED' });
      },
    });
    await expect(recorder.http({ url: 'http://169.254.169.254/latest' })).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
    expect(recorder.finish({ outcome: 'error' }).calls[0].error).toEqual({
      code: 'DESTINATION_BLOCKED',
      message: 'Destination not allowed: 169.254.169.254',
    });
  });

  it('errors-only keeps bodies for failed calls only, unless the run failed', async () => {
    let status = 200;
    const recorder = createRecorder({ level: 'errors-only', request: async () => fakeResponse({ status, body: '{"ok":1}' }) });
    await recorder.http({ url: 'https://a.test/1' });
    status = 500;
    await recorder.http({ url: 'https://a.test/2' });
    const passed = recorder.finish({ outcome: 'ok' });
    expect(passed.calls[0]).toMatchObject({ statusCode: 200, bodiesOmitted: 'errors-only' });
    expect(passed.calls[0].responseBody).toBeUndefined();
    expect(passed.calls[1]).toMatchObject({ statusCode: 500, responseBody: { ok: 1 } });
    expect(recorder.finish({ outcome: 'error' }).calls[0].responseBody).toEqual({ ok: 1 });
  });

  it('summary keeps no bodies, headers or logs, but still learns and scrubs secrets', async () => {
    const recorder = createRecorder({ level: 'summary', request: async () => fakeResponse() });
    await recorder.http({ url: 'https://a.test/1' });
    const record = recorder.finish({ outcome: 'ok', result: { copy: 'tok_FROM_RESPONSE_99' }, logs: [{ message: 'x' }] });
    expect(record.calls[0]).toMatchObject({ statusCode: 200, bodiesOmitted: 'summary' });
    expect(record.calls[0].requestHeaders).toBeUndefined();
    expect(record).toMatchObject({ logs: [], logsOmitted: 1 });
    expect(everything(record)).not.toMatch(/tok_FROM_RESPONSE_99/);
  });

  it('caps what it stores and says so', async () => {
    const recorder = createRecorder({
      limits: { maxRecordedCalls: 2, maxBodyChars: 50, maxResultChars: 30, maxLogs: 1 },
      request: async () => fakeResponse({ body: JSON.stringify({ text: 'x'.repeat(500) }), bodyTruncated: true }),
    });
    for (let i = 0; i < 3; i += 1) await recorder.http({ url: `https://a.test/${i}` });
    const record = recorder.finish({ outcome: 'ok', result: { long: 'y'.repeat(100) }, logs: [{ message: 'a' }, { message: 'b' }] });
    expect(record.calls).toHaveLength(2);
    expect(record.callsOmitted).toBe(1);
    expect(record.calls[0].responseBody).toHaveLength(50);
    expect(record.calls[0].responseBodyCut).toBe('network'); // the network cap came first
    expect(record.result).toMatchObject({ truncated: true });
    expect(record.logsOmitted).toBe(1);
  });

  it('limits how many calls one run may make', async () => {
    const recorder = createRecorder({ limits: { maxCalls: 2 }, request: async () => fakeResponse({ body: '{}' }) });
    await recorder.http({ url: 'https://a.test/1' });
    await recorder.http({ url: 'https://a.test/2' });
    await expect(recorder.http({ url: 'https://a.test/3' })).rejects.toMatchObject({ code: 'TOO_MANY_CALLS' });
  });

  it('gives each call only the time left before the run deadline', async () => {
    const seen = [];
    const recorder = createRecorder({
      deadline: Date.now() + 500,
      request: async (args) => {
        seen.push(args.timeoutMs);
        return fakeResponse({ body: '{}' });
      },
    });
    await recorder.http({ url: 'https://a.test/1', options: { timeout: 60000 } });
    expect(seen[0]).toBeLessThanOrEqual(500);
  });

  it('adds query parameters and serializes object bodies', async () => {
    const seen = [];
    const recorder = createRecorder({ request: async (args) => (seen.push(args), fakeResponse({ body: 'plain text' })) });
    const res = await recorder.http({ method: 'put', url: 'https://a.test/x', body: { a: 1 }, options: { params: { id: 'm 1' } } });
    expect(seen[0]).toMatchObject({ method: 'PUT', url: 'https://a.test/x?id=m+1', body: '{"a":1}' });
    expect(res.data).toBe('plain text');
  });
});
