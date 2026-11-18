'use strict';

/**
 * One IP matcher for every address check (target URLs, request allowlists, the
 * stage destination policy), and the URL check that depends on it: IPv6 literals
 * and IPv4-mapped addresses used to slip past the private-network block.
 */

const { ipBytes, isIpInCidr, mappedIpv4, v6Groups } = require('../../src/utils/ip-address');
const { validateTargetUrl } = require('../../src/utils/url-check');
jest.mock('../../src/middleware/rate-limiter', () => ({ checkRateLimit: jest.fn() }));
const { evaluateInboundRequestPolicy } = require('../../src/services/request-policy');

describe('reading an address', () => {
  it('reads IPv4 and IPv6, including :: compression, dotted tails and zone ids', () => {
    expect([...ipBytes('10.1.2.3')]).toEqual([10, 1, 2, 3]);
    expect([...ipBytes('::1')]).toEqual([...Array(15).fill(0), 1]);
    expect([...ipBytes('2001:db8::8:800:200c:417a')].slice(0, 4)).toEqual([0x20, 0x01, 0x0d, 0xb8]);
    expect([...ipBytes('::ffff:10.0.0.1')].slice(10)).toEqual([0xff, 0xff, 10, 0, 0, 1]);
    expect(ipBytes('fe80::1%eth0')).toHaveLength(16);
    expect(v6Groups('1::')).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
    expect(ipBytes('not-an-ip')).toBeNull();
    expect(ipBytes('[::1]')).toBeNull(); // brackets belong to URLs, not addresses
    expect(mappedIpv4(ipBytes('::ffff:7f00:1'))).toEqual(Buffer.from([127, 0, 0, 1]));
    expect(mappedIpv4(ipBytes('2001::1'))).toBeNull();
  });
});

describe('isIpInCidr', () => {
  it.each([
    ['10.2.3.4', '10.0.0.0/8', true],
    ['11.0.0.1', '10.0.0.0/8', false],
    ['172.31.255.255', '172.16.0.0/12', true],
    ['172.32.0.1', '172.16.0.0/12', false],
    ['192.168.1.1', '192.168.1.1/32', true],
    ['192.168.1.2', '192.168.1.1/32', false],
    ['1.2.3.4', '0.0.0.0/0', true],
    ['::1', '::1/128', true],
    ['::2', '::1/128', false],
    ['1::', '::1/128', false], // used to match: groups were read without their zeros
    ['fd00::1', 'fc00::/7', true],
    ['fe80::abcd', 'fe80::/10', true],
    ['2606:4700::1111', 'fc00::/7', false],
    ['::ffff:127.0.0.1', '127.0.0.0/8', true], // an IPv4-mapped address is its IPv4 address
    ['::ffff:8.8.8.8', '10.0.0.0/8', false],
    ['10.0.0.1', 'fc00::/7', false], // different families never match
    ['10.0.0.1', '10.0.0.0/33', false],
    ['nope', '10.0.0.0/8', false],
    ['10.0.0.1', 'garbage', false],
  ])('%s in %s: %s', (ip, cidr, expected) => {
    expect(isIpInCidr(ip, cidr)).toBe(expected);
  });
});

describe('the target URL check', () => {
  it.each([
    'http://127.0.0.1/',
    'http://10.1.2.3/hook',
    'http://169.254.169.254/latest/meta-data',
    'http://localhost:3000/',
    'http://[::1]/',
    'http://[fd00::1]/',
    'http://[fe80::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:169.254.169.254]/', // cloud metadata through an IPv4-mapped address
  ])('refuses %s', (url) => {
    expect(validateTargetUrl(url)).toMatchObject({ valid: false });
  });

  it.each(['https://api.example.com/x', 'http://8.8.8.8/', 'http://[2606:4700::1111]/', 'http://[::ffff:8.8.8.8]/'])('allows %s', (url) => {
    expect(validateTargetUrl(url)).toEqual({ valid: true });
  });

  it('lets private addresses through only when the block is switched off', () => {
    expect(validateTargetUrl('http://[::1]/', { blockPrivateNetworks: false })).toEqual({ valid: true });
  });
});

describe('request allowlists', () => {
  const integration = { _id: { toString: () => 'int-1' }, orgId: 1, requestPolicy: { allowedIpCidrs: ['10.0.0.0/8', '2001:db8::/32'] } };
  const allowed = async (ip) => (await evaluateInboundRequestPolicy({ ip, headers: {} }, integration)).allowed;

  it('matches IPv4 and IPv6 clients, including IPv4-mapped ones', async () => {
    expect(await allowed('10.9.9.9')).toBe(true);
    expect(await allowed('::ffff:10.9.9.9')).toBe(true);
    expect(await allowed('2001:db8::5')).toBe(true);
    expect(await allowed('2001:db9::5')).toBe(false);
    expect(await allowed('11.0.0.1')).toBe(false);
  });
});
