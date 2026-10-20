import { describe, it, expect } from 'vitest';
import { getCallerInfo, parseUserAgent, resolveClientIpFromChain } from '../utils/caller';

describe('resolveClientIpFromChain', () => {
  it('skips our own proxy hops on the right', () => {
    expect(resolveClientIpFromChain('203.0.113.61, 10.0.1.133')).toBe('203.0.113.61');
  });
  it('ignores entries the caller invented on the left', () => {
    expect(resolveClientIpFromChain('1.1.1.1, 203.0.113.61, 10.0.1.133')).toBe('203.0.113.61');
  });
  it('uses the right-most entry for an internal caller', () => {
    expect(resolveClientIpFromChain('10.0.4.9, 10.0.1.5')).toBe('10.0.1.5');
  });
  it('returns null with nothing usable', () => {
    expect(resolveClientIpFromChain(null)).toBeNull();
    expect(resolveClientIpFromChain('unknown')).toBeNull();
  });
});

describe('parseUserAgent', () => {
  it('names API tools with their version', () => {
    expect(parseUserAgent('curl/8.7.1')).toEqual({ label: 'curl 8.7.1', kind: 'tool' });
    expect(parseUserAgent('PostmanRuntime/7.43.0')).toEqual({ label: 'Postman 7.43.0', kind: 'tool' });
    expect(parseUserAgent('python-requests/2.31.0')?.label).toBe('python-requests 2.31.0');
  });
  it('reads browser and OS', () => {
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
      )
    ).toEqual({ label: 'Chrome 141 on macOS', kind: 'browser' });
    expect(
      parseUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'
      )?.label
    ).toBe('Edge 141 on Windows');
  });
  it('shows an unknown client as it is', () => {
    expect(parseUserAgent('AcmeApp/2.3 (Android)')).toEqual({ label: 'AcmeApp/2.3 (Android)', kind: 'app' });
    expect(parseUserAgent('')).toBeNull();
  });
});

describe('getCallerInfo', () => {
  const headers = {
    host: 'localhost:3545',
    'x-forwarded-for': '203.0.113.61, 10.0.1.133',
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'staging.gateway.example.com',
    'user-agent': 'curl/8.7.1',
    'content-length': '74',
    'x-amzn-trace-id': 'Root=1-6acf5048-6218281e516bd752503b14e5',
  };
  it('summarises the saved headers and resolves the IP for older logs', () => {
    const info = getCallerInfo(headers);
    expect(info).toMatchObject({
      clientIp: '203.0.113.61',
      host: 'staging.gateway.example.com',
      protocol: 'https',
      contentLength: 74,
      agent: { label: 'curl 8.7.1' },
    });
    expect(info?.forwardedChain).toEqual(['203.0.113.61', '10.0.1.133']);
  });
  it('prefers the IP the backend stored', () => {
    expect(getCallerInfo(headers, '203.0.113.9')?.clientIp).toBe('203.0.113.9');
  });
  it('returns null when nothing about the caller was kept', () => {
    expect(getCallerInfo(null)).toBeNull();
    expect(getCallerInfo({})).toBeNull();
  });
});
