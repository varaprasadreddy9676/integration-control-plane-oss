'use strict';

/**
 * The HTTP client every stage call goes through. Runs against a local server;
 * names are resolved by an injected resolver so DNS behaviour (including a name
 * that resolves to a private address) can be tested without a network.
 */

const http = require('http');
const { request, StageHttpError } = require('../../../src/stages/http/client');

let server;
let port;
const seen = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    seen.push({ path: url.pathname, method: req.method, headers: req.headers });
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (url.pathname === '/json') return send(200, { ok: true, host: req.headers.host });
    if (url.pathname === '/echo') {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => send(200, { method: req.method, body: raw, headers: req.headers }));
      return undefined;
    }
    if (url.pathname === '/big') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('x'.repeat(200 * 1024));
      return undefined;
    }
    if (url.pathname === '/slow') {
      setTimeout(() => send(200, { late: true }), 2000);
      return undefined;
    }
    if (url.pathname === '/redirect') {
      return send(Number(url.searchParams.get('status') || 302), {}, { Location: url.searchParams.get('to') });
    }
    if (url.pathname === '/loop') return send(302, {}, { Location: '/loop' });
    return send(404, { error: 'nope' });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => (seen.length = 0));

// Every name resolves to the local server unless a test says otherwise.
const localResolver = (map = {}) => async (name) => (map[name] ? map[name] : ['127.0.0.1']);
const base = (host = 'api.test') => `http://${host}:${port}`;
const allowLocal = { allowPrivate: true };

describe('stage HTTP client', () => {
  it('makes the request and returns status, headers and body', async () => {
    const res = await request({ url: `${base()}/json`, resolve: localResolver(), policy: allowLocal });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true, host: `api.test:${port}` });
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.bodyTruncated).toBe(false);
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('sends the method, headers and body', async () => {
    const res = await request({
      method: 'POST',
      url: `${base()}/echo`,
      headers: { 'Content-Type': 'application/json', 'X-Trace': 't1' },
      body: JSON.stringify({ a: 1 }),
      resolve: localResolver(),
      policy: allowLocal,
    });
    const echoed = JSON.parse(res.body);
    expect(echoed).toMatchObject({ method: 'POST', body: '{"a":1}' });
    expect(echoed.headers['x-trace']).toBe('t1');
  });

  describe('destination policy on resolved addresses', () => {
    it('refuses a public-looking name that resolves to a private address', async () => {
      await expect(
        request({ url: 'http://evil.example.com/json', resolve: localResolver({ 'evil.example.com': ['10.0.0.5'] }) })
      ).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
    });

    it('refuses a name when any of its addresses is private', async () => {
      await expect(
        request({
          url: 'http://mixed.example.com/json',
          resolve: localResolver({ 'mixed.example.com': ['8.8.8.8', '127.0.0.1'] }),
        })
      ).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
    });

    it('refuses a literal private address and an internal name before resolving', async () => {
      const resolve = jest.fn();
      await expect(request({ url: 'http://169.254.169.254/latest', resolve })).rejects.toMatchObject({
        code: 'DESTINATION_BLOCKED',
      });
      await expect(request({ url: 'http://metadata.google.internal/', resolve })).rejects.toMatchObject({
        code: 'DESTINATION_BLOCKED',
      });
      expect(resolve).not.toHaveBeenCalled();
    });

    it('connects to the address it checked, so a second lookup cannot switch it', async () => {
      let lookups = 0;
      const rebinding = async () => {
        lookups += 1;
        return lookups === 1 ? ['127.0.0.1'] : ['10.9.9.9'];
      };
      const res = await request({ url: `${base('rebind.test')}/json`, resolve: rebinding, policy: allowLocal });
      expect(res.status).toBe(200);
      expect(lookups).toBe(1);
    });
  });

  describe('redirects', () => {
    it('follows a redirect and records the hops', async () => {
      const res = await request({
        url: `${base()}/redirect?to=${encodeURIComponent('/json')}`,
        resolve: localResolver(),
        policy: allowLocal,
      });
      expect(res.status).toBe(200);
      expect(res.redirects).toEqual([{ status: 302, url: `${base()}/json` }]);
      expect(res.finalUrl).toBe(`${base()}/json`);
    });

    it('checks every hop: a redirect to a private address is refused', async () => {
      // Allow the local server only for its own name, not for the redirect target.
      const res = request({
        url: `${base('api.test')}/redirect?to=${encodeURIComponent('http://169.254.169.254/latest')}`,
        resolve: localResolver(),
        policy: { allowPrivate: false, allowHosts: ['api.test'] },
      });
      await expect(res).rejects.toMatchObject({ code: 'DESTINATION_BLOCKED' });
    });

    it('stops after too many redirects', async () => {
      await expect(
        request({ url: `${base()}/loop`, resolve: localResolver(), policy: allowLocal, maxRedirects: 3 })
      ).rejects.toMatchObject({ code: 'TOO_MANY_REDIRECTS' });
    });

    it('turns a POST into a GET without the body on 303, and keeps it on 307', async () => {
      const r303 = await request({
        method: 'POST',
        url: `${base()}/redirect?status=303&to=${encodeURIComponent('/echo')}`,
        body: 'payload',
        resolve: localResolver(),
        policy: allowLocal,
      });
      expect(JSON.parse(r303.body)).toMatchObject({ method: 'GET', body: '' });
      const r307 = await request({
        method: 'POST',
        url: `${base()}/redirect?status=307&to=${encodeURIComponent('/echo')}`,
        body: 'payload',
        resolve: localResolver(),
        policy: allowLocal,
      });
      expect(JSON.parse(r307.body)).toMatchObject({ method: 'POST', body: 'payload' });
    });
  });

  describe('credentials', () => {
    const credential = { origins: [`http://api.test:${0}`], headers: { 'X-Api-Key': 'secret-1' } };
    const cred = () => ({ ...credential, origins: [`http://api.test:${port}`] });

    it('adds the credential only for an approved origin', async () => {
      const res = await request({ url: `${base('api.test')}/echo`, credential: cred(), resolve: localResolver(), policy: allowLocal });
      expect(JSON.parse(res.body).headers['x-api-key']).toBe('secret-1');
      const other = await request({ url: `${base('other.test')}/echo`, credential: cred(), resolve: localResolver(), policy: allowLocal });
      expect(JSON.parse(other.body).headers['x-api-key']).toBeUndefined();
    });

    it('drops the credential and any auth headers when a redirect leaves the approved origin', async () => {
      const res = await request({
        url: `${base('api.test')}/redirect?to=${encodeURIComponent(`${base('other.test')}/echo`)}`,
        headers: { Authorization: 'Bearer from-script', Cookie: 'c=1', 'X-Keep': 'yes' },
        credential: cred(),
        resolve: localResolver(),
        policy: allowLocal,
      });
      const headers = JSON.parse(res.body).headers;
      expect(headers['x-api-key']).toBeUndefined();
      expect(headers.authorization).toBeUndefined();
      expect(headers.cookie).toBeUndefined();
      expect(headers['x-keep']).toBe('yes');
    });
  });

  describe('limits', () => {
    it('stops reading at the byte cap and says the body was cut', async () => {
      const res = await request({ url: `${base()}/big`, maxResponseBytes: 1024, resolve: localResolver(), policy: allowLocal });
      expect(res.body.length).toBe(1024);
      expect(res.bodyTruncated).toBe(true);
    });

    it('gives up at the deadline', async () => {
      await expect(
        request({ url: `${base()}/slow`, timeoutMs: 200, resolve: localResolver(), policy: allowLocal })
      ).rejects.toMatchObject({ code: 'TIMEOUT' });
    });

    it('can be cancelled from outside', async () => {
      let abort;
      const signal = { aborted: false, addEventListener: (_e, fn) => (abort = fn), removeEventListener: () => {} };
      const pending = request({ url: `${base()}/slow`, signal, resolve: localResolver(), policy: allowLocal });
      setTimeout(() => {
        signal.aborted = true;
        abort();
      }, 50);
      await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
    });

    it('reports a refused connection as such (nothing was sent)', async () => {
      await expect(
        request({ url: 'http://api.test:1/json', resolve: localResolver(), policy: allowLocal, timeoutMs: 2000 })
      ).rejects.toMatchObject({ code: 'CONNECTION_REFUSED' });
    });

    it('reports a name that does not resolve as DNS (nothing was sent)', async () => {
      const failing = () => Promise.reject(new Error('ENOTFOUND'));
      await expect(request({ url: 'https://nowhere.test/x', resolve: failing })).rejects.toMatchObject({ code: 'DNS' });
    });
  });

  it('errors are StageHttpError with a code', async () => {
    const error = await request({ url: 'ftp://x' }).catch((e) => e);
    expect(error).toBeInstanceOf(StageHttpError);
    expect(error.code).toBe('DESTINATION_BLOCKED');
  });
});
