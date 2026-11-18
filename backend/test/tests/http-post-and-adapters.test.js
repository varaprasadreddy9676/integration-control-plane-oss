'use strict';

/**
 * The one HTTP POST helper (utils/http-post) against a real local server, and
 * how each communication adapter reads what it returns: success, an error
 * answer, a non-JSON answer and a network failure, each in the adapter's own words.
 */

const http = require('http');

const mockPost = jest.fn();
jest.mock('../../src/utils/http-post', () => ({
  ...jest.requireActual('../../src/utils/http-post'),
  httpPost: (...args) => mockPost(...args),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const actual = jest.requireActual('../../src/utils/http-post');
const meta = require('../../src/services/communication/adapters/whatsapp-meta');
const msg91 = require('../../src/services/communication/adapters/sms-msg91');
const fcm = require('../../src/services/communication/adapters/push-fcm');

describe('httpPost', () => {
  let server;
  let port;
  const seen = [];
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        seen.push({ method: req.method, url: req.url, length: req.headers['content-length'], type: req.headers['content-type'], body });
        if (req.url === '/slow') return; // never answers
        res.statusCode = req.url === '/bad' ? 502 : 200;
        res.setHeader('x-answer', 'yes');
        res.end('{"ok":true}');
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });
  afterAll(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('posts the body with its length and returns status, headers and text for any status', async () => {
    const ok = await actual.httpPost({ url: `http://127.0.0.1:${port}/p?x=1`, headers: { 'Content-Type': 'application/json' }, body: '{"a":"é"}' });
    expect(ok).toMatchObject({ status: 200, body: '{"ok":true}', headers: { 'x-answer': 'yes' } });
    expect(seen[0]).toMatchObject({ method: 'POST', url: '/p?x=1', type: 'application/json', length: String(Buffer.byteLength('{"a":"é"}')), body: '{"a":"é"}' });
    expect((await actual.httpPost({ url: `http://127.0.0.1:${port}/bad`, body: '{}' })).status).toBe(502);
  });

  it('rejects on a network error and on a timeout', async () => {
    await expect(actual.httpPost({ url: 'http://127.0.0.1:1/x', body: '{}' })).rejects.toThrow();
    await expect(actual.httpPost({ url: `http://127.0.0.1:${port}/slow`, body: '{}', timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });
});

const reply = (status, body) => mockPost.mockResolvedValueOnce({ status, headers: {}, body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('WhatsApp (Meta)', () => {
  it('sends to the phone number\'s messages endpoint with the bearer token', async () => {
    reply(200, { messages: [{ id: 'wamid.1' }] });
    expect(await meta._post('123', 'tok', { a: 1 })).toEqual({ messages: [{ id: 'wamid.1' }] });
    expect(mockPost).toHaveBeenLastCalledWith(
      expect.objectContaining({ path: expect.stringMatching(/\/123\/messages$/), headers: expect.objectContaining({ Authorization: 'Bearer tok' }), body: '{"a":1}' })
    );
  });
  it('reads the provider\'s error code and message, non-JSON and network failures', async () => {
    reply(400, { error: { message: 'Bad number', code: 131030 } });
    await expect(meta._post('1', 't', {})).rejects.toThrow('Meta API [131030]: Bad number');
    reply(502, '<html>');
    await expect(meta._post('1', 't', {})).rejects.toThrow(/non-JSON response \(HTTP 502\)/);
    mockPost.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(meta._post('1', 't', {})).rejects.toThrow('Meta API network error: ECONNRESET');
  });
});

describe('SMS (MSG91)', () => {
  it('sends with the auth key, and reads success, error status, invalid and network failures', async () => {
    reply(200, { type: 'success' });
    expect(await msg91._post('control.msg91.com', '/api/v5/flow', { a: 1 }, 'key')).toEqual({ type: 'success' });
    expect(mockPost).toHaveBeenLastCalledWith(expect.objectContaining({ hostname: 'control.msg91.com', headers: expect.objectContaining({ authkey: 'key' }) }));
    reply(401, { message: 'Invalid auth' });
    await expect(msg91._post('h', '/p', {}, 'k')).rejects.toThrow('MSG91 HTTP 401: Invalid auth');
    reply(200, 'nope');
    await expect(msg91._post('h', '/p', {}, 'k')).rejects.toThrow('MSG91 invalid response (HTTP 200): nope');
    mockPost.mockRejectedValueOnce(new Error('ETIMEDOUT'));
    await expect(msg91._post('h', '/p', {}, 'k')).rejects.toThrow('MSG91 network error: ETIMEDOUT');
  });
});

describe('Push (FCM)', () => {
  it('posts a message to the project\'s v1 endpoint and reads FCM\'s error shape', async () => {
    reply(200, { name: 'projects/p/messages/1' });
    expect(await fcm._post('p', 'access', { message: {} })).toEqual({ name: 'projects/p/messages/1' });
    expect(mockPost).toHaveBeenLastCalledWith(expect.objectContaining({ path: '/v1/projects/p/messages:send', headers: expect.objectContaining({ Authorization: 'Bearer access' }) }));
    reply(404, { error: { message: 'Not registered', status: 'NOT_FOUND' } });
    await expect(fcm._post('p', 'a', {})).rejects.toThrow('FCM [NOT_FOUND]: Not registered');
    mockPost.mockRejectedValueOnce(new Error('EAI_AGAIN'));
    await expect(fcm._post('p', 'a', {})).rejects.toThrow('FCM network error: EAI_AGAIN');
  });
  it('exchanges a signed JWT for a token as a form post', async () => {
    reply(200, { access_token: 'ya29', expires_in: 3600 });
    expect(await fcm._exchangeJWTForToken('signed.jwt')).toMatchObject({ access_token: 'ya29' });
    const call = mockPost.mock.calls[mockPost.mock.calls.length - 1][0];
    expect(call).toMatchObject({ hostname: 'oauth2.googleapis.com', path: '/token', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
    expect(call.body).toContain('assertion=signed.jwt');
    reply(400, { error: 'invalid_grant', error_description: 'Bad signature' });
    await expect(fcm._exchangeJWTForToken('x')).rejects.toThrow('Google token exchange failed [400]: Bad signature');
  });
});
