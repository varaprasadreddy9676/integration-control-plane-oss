'use strict';

const { resolveClientIp } = require('../../src/utils/client-ip');

const req = (xff, remote) => ({ headers: xff === undefined ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });

describe('resolveClientIp', () => {
  it('takes the caller from behind the load balancer and Apache hops', () => {
    expect(resolveClientIp(req('203.0.113.61, 10.0.1.133'))).toBe('203.0.113.61');
  });

  it('ignores addresses the caller invented on the left of the chain', () => {
    expect(resolveClientIp(req('1.1.1.1, 203.0.113.61, 10.0.1.133'))).toBe('203.0.113.61');
  });

  it('uses the right-most entry for an internal (all-private) caller', () => {
    expect(resolveClientIp(req('10.0.4.9, 10.0.1.5'))).toBe('10.0.1.5');
  });

  it('falls back to the socket address, unwrapping IPv4-mapped IPv6', () => {
    expect(resolveClientIp(req(undefined, '::ffff:49.36.10.7'))).toBe('49.36.10.7');
  });

  it('strips ports and rejects junk', () => {
    expect(resolveClientIp(req('203.0.113.9:4821, 10.0.1.5'))).toBe('203.0.113.9');
    expect(resolveClientIp(req('not-an-ip, <script>'))).toBeNull();
  });

  it('handles IPv6 callers', () => {
    expect(resolveClientIp(req('2406:7400:abcd::1, 10.0.1.5'))).toBe('2406:7400:abcd::1');
  });
});
