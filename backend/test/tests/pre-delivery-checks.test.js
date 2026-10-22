'use strict';

const http = require('http');
const {
  validatePreDeliveryChecks,
  normalizePreDeliveryChecks,
  runPreDeliveryChecks,
} = require('../../src/services/pre-delivery-checks');

// Loopback is a private address; the real gateway blocks it by default.
const urlOptions = { blockPrivateNetworks: false };

describe('pre-delivery-checks', () => {
  let server;
  let baseUrl;
  let hits;

  beforeAll(async () => {
    hits = {};
    server = http.createServer((req, res) => {
      hits[req.url] = (hits[req.url] || 0) + 1;
      if (req.url === '/pdf') {
        res.writeHead(200, { 'Content-Type': 'application/pdf' });
        return res.end(Buffer.alloc(2048, 1));
      }
      if (req.url === '/html') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        return res.end('<html>error</html>');
      }
      if (req.url === '/slow') {
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/pdf' });
          res.end('late');
        }, 1500);
        return undefined;
      }
      const status = Number(req.url.replace('/status/', ''));
      res.writeHead(status || 404);
      return res.end();
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(() => new Promise((resolve) => server.close(resolve)));

  const run = (check, requestPayload, eventPayload = {}) =>
    runPreDeliveryChecks([{ urlPath: 'doc.link', ...check }], { requestPayload, eventPayload, urlOptions });

  describe('validatePreDeliveryChecks', () => {
    it('accepts no checks', () => {
      expect(validatePreDeliveryChecks(undefined)).toBeNull();
      expect(validatePreDeliveryChecks(null)).toBeNull();
      expect(validatePreDeliveryChecks([])).toBeNull();
    });

    it('accepts a full check', () => {
      expect(
        validatePreDeliveryChecks([
          {
            name: 'Document',
            urlPath: 'template.document.link',
            source: 'request',
            method: 'GET',
            timeoutMs: 30000,
            expectedContentTypes: ['application/pdf'],
            minBytes: 1000,
            onMissingUrl: 'PASS',
          },
        ])
      ).toBeNull();
    });

    it.each([
      [{}, 'preDeliveryChecks must be an array'],
      [[{}], 'preDeliveryChecks[0].urlPath is required'],
      [[{ urlPath: 'a', source: 'x' }], 'preDeliveryChecks[0].source must be one of request, event'],
      [[{ urlPath: 'a', method: 'POST' }], 'preDeliveryChecks[0].method must be one of GET, HEAD'],
      [[{ urlPath: 'a', timeoutMs: 10 }], 'preDeliveryChecks[0].timeoutMs must be between 1000 and 120000'],
      [[{ urlPath: 'a', expectedContentTypes: 'pdf' }], 'preDeliveryChecks[0].expectedContentTypes must be an array of strings'],
      [[{ urlPath: 'a', minBytes: -1 }], 'preDeliveryChecks[0].minBytes must be a non-negative integer'],
      [[{ urlPath: 'a', onMissingUrl: 'SKIP' }], 'preDeliveryChecks[0].onMissingUrl must be one of PASS, FAIL'],
      [Array(6).fill({ urlPath: 'a' }), 'preDeliveryChecks allows at most 5 checks'],
    ])('rejects %j', (checks, message) => {
      expect(validatePreDeliveryChecks(checks)).toBe(message);
    });
  });

  it('normalizes defaults', () => {
    expect(normalizePreDeliveryChecks(undefined)).toBeUndefined();
    expect(normalizePreDeliveryChecks([])).toBeNull();
    expect(normalizePreDeliveryChecks([{ urlPath: ' doc.link ', method: 'head', expectedContentTypes: ['Application/PDF'] }])).toEqual([
      {
        name: 'doc.link',
        urlPath: 'doc.link',
        source: 'request',
        method: 'HEAD',
        timeoutMs: 30000,
        expectedContentTypes: ['application/pdf'],
        minBytes: 0,
        onMissingUrl: 'PASS',
      },
    ]);
  });

  it('passes when the URL returns the expected document', async () => {
    const result = await run(
      { expectedContentTypes: ['application/pdf'], minBytes: 1000 },
      { doc: { link: `${baseUrl}/pdf` } }
    );
    expect(result.outcome).toBe('PASS');
    expect(result.results[0]).toEqual(expect.objectContaining({ status: 200, outcome: 'PASS' }));
  });

  it('reads the URL from an array index in the path', async () => {
    const result = await runPreDeliveryChecks([{ urlPath: 'parts.1.url' }], {
      requestPayload: { parts: [{}, { url: `${baseUrl}/pdf` }] },
      urlOptions,
    });
    expect(result.outcome).toBe('PASS');
  });

  it('reads the URL from the original event when source is event', async () => {
    const result = await run({ source: 'event' }, {}, { doc: { link: `${baseUrl}/status/404` } });
    expect(result.outcome).toBe('PERMANENT');
  });

  it.each([500, 502, 503, 504, 408, 425, 429])('treats HTTP %i as retryable', async (status) => {
    const result = await run({}, { doc: { link: `${baseUrl}/status/${status}` } });
    expect(result.outcome).toBe('RETRYABLE');
    expect(result.failed).toEqual(expect.objectContaining({ status, message: `HTTP ${status}` }));
  });

  it.each([400, 403, 404, 410, 422])('treats HTTP %i as permanent', async (status) => {
    const result = await run({}, { doc: { link: `${baseUrl}/status/${status}` } });
    expect(result.outcome).toBe('PERMANENT');
  });

  it('treats a timeout as retryable', async () => {
    const result = await run({ timeoutMs: 1000 }, { doc: { link: `${baseUrl}/slow` } });
    expect(result.outcome).toBe('RETRYABLE');
    expect(result.failed.message).toBe('timed out after 1000ms');
  });

  it('treats a refused connection as retryable', async () => {
    const result = await run({}, { doc: { link: 'http://127.0.0.1:1/x' } });
    expect(result.outcome).toBe('RETRYABLE');
    expect(result.failed.message).toMatch(/^request failed:/);
  });

  it('fails permanently on an unexpected content type', async () => {
    const result = await run({ expectedContentTypes: ['application/pdf'] }, { doc: { link: `${baseUrl}/html` } });
    expect(result.outcome).toBe('PERMANENT');
    expect(result.failed.message).toContain('text/html');
  });

  it('fails permanently on a body smaller than minBytes', async () => {
    const result = await run({ minBytes: 4096 }, { doc: { link: `${baseUrl}/pdf` } });
    expect(result.outcome).toBe('PERMANENT');
    expect(result.failed.message).toBe('body is 2048 bytes, expected at least 4096');
  });

  it('uses HEAD without reading a body', async () => {
    const result = await run({ method: 'HEAD', minBytes: 999999 }, { doc: { link: `${baseUrl}/pdf` } });
    expect(result.outcome).toBe('PASS');
  });

  it('passes a missing URL by default and fails it with onMissingUrl FAIL', async () => {
    expect((await run({}, { doc: {} })).outcome).toBe('PASS');
    expect((await run({ onMissingUrl: 'FAIL' }, { doc: {} })).outcome).toBe('PERMANENT');
  });

  it('fails permanently on a URL the gateway does not allow', async () => {
    const result = await runPreDeliveryChecks([{ urlPath: 'u' }], {
      requestPayload: { u: 'http://127.0.0.1/x' },
      urlOptions: {},
    });
    expect(result.outcome).toBe('PERMANENT');
    expect(result.failed.message).toBe('URL not allowed: Private IP not allowed');
  });

  it('stops at the first failing check', async () => {
    hits = {};
    const result = await runPreDeliveryChecks(
      [{ urlPath: 'a' }, { urlPath: 'b' }],
      { requestPayload: { a: `${baseUrl}/status/404`, b: `${baseUrl}/pdf` }, urlOptions }
    );
    expect(result.outcome).toBe('PERMANENT');
    expect(result.results).toHaveLength(1);
    expect(hits['/pdf']).toBeUndefined();
  });
});
