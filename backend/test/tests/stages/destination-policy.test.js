'use strict';

/**
 * Where stage HTTP calls may go. The URL check alone is not enough (a name can
 * resolve anywhere), so the policy is applied to the URL and again to every
 * address the name resolves to, for every redirect hop.
 */

const { checkUrl, isBlockedAddress } = require('../../../src/stages/http/destination-policy');

describe('isBlockedAddress', () => {
  it.each([
    '127.0.0.1', '127.255.0.9', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', // cloud metadata
    '0.0.0.0', '100.64.0.1', // carrier-grade NAT
    '224.0.0.1', '255.255.255.255', '198.18.0.1', '192.0.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254',
    '64:ff9b::7f00:1', // NAT64 of 127.0.0.1
  ])('blocks %s', (ip) => {
    expect(isBlockedAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isBlockedAddress(ip)).toBe(false);
    }
  );

  it('treats anything that is not an IP address as blocked', () => {
    expect(isBlockedAddress('localhost')).toBe(true);
    expect(isBlockedAddress('')).toBe(true);
    expect(isBlockedAddress(undefined)).toBe(true);
  });
});

describe('checkUrl', () => {
  it('accepts an https or http URL with a public-looking host', () => {
    expect(checkUrl('https://api.example.com/v1/messages?x=1')).toEqual({ ok: true, url: expect.any(URL) });
    expect(checkUrl('http://api.example.com:8080/a').ok).toBe(true);
  });

  it.each([
    ['ftp://example.com/a', /http/i],
    ['file:///etc/passwd', /http/i],
    ['not a url', /not a valid url/i],
    ['https://user:pass@example.com/', /credentials in the URL/i],
    ['http://localhost/a', /not allowed/i],
    ['http://LOCALHOST./a', /not allowed/i],
    ['http://foo.localhost/a', /not allowed/i],
    ['http://127.0.0.1/a', /not allowed/i],
    ['http://[::1]/a', /not allowed/i],
    ['http://[::ffff:127.0.0.1]/a', /not allowed/i],
    ['http://2130706433/a', /not allowed/i], // 127.0.0.1 as a decimal number
    ['http://0x7f.1/a', /not allowed/i], // hex and short forms
    ['http://127.1/a', /not allowed/i],
    ['http://169.254.169.254/latest/meta-data', /not allowed/i],
    ['http://metadata.google.internal/', /not allowed/i],
  ])('rejects %s', (url, reason) => {
    const result = checkUrl(url);
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(reason);
  });

  it('can allow private destinations when explicitly configured (development only)', () => {
    expect(checkUrl('http://127.0.0.1:9099/a', { allowPrivate: true }).ok).toBe(true);
    expect(checkUrl('http://localhost:9099/a', { allowPrivate: true }).ok).toBe(true);
    // the scheme and credential rules still apply
    expect(checkUrl('file:///etc/passwd', { allowPrivate: true }).ok).toBe(false);
  });
});
