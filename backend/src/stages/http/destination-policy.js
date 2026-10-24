'use strict';

/**
 * Where a stage's HTTP call may go.
 *
 * `checkUrl` rejects what can be decided from the URL alone: the scheme,
 * credentials in the URL, internal names and literal private addresses. The URL
 * parser normalizes numeric host forms first (2130706433, 0x7f.1 and 127.1 all
 * become 127.0.0.1), so those cannot slip past. Because a public-looking name can
 * still resolve to a private address, the HTTP client also calls
 * `isBlockedAddress` on every address it is about to connect to, on every
 * redirect hop.
 */

const net = require('net');
const { v6Groups } = require('../../utils/ip-address');

// [first address, prefix length] in IPv4.
const BLOCKED_V4 = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // carrier-grade NAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, including cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, including broadcast
];

const BLOCKED_NAME = /(^|\.)(localhost|internal|local|localdomain|home\.arpa)\.?$/i;

const v4ToNumber = (ip) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);

function isBlockedV4(ip) {
  const value = v4ToNumber(ip);
  return BLOCKED_V4.some(([base, bits]) => {
    const size = 2 ** (32 - bits);
    const start = v4ToNumber(base);
    return value >= start && value < start + size;
  });
}

const embeddedV4 = (groups) =>
  [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.');

function isBlockedV6(ip) {
  const g = v6Groups(ip);
  const allZero = (from, to) => g.slice(from, to).every((x) => x === 0);
  if (allZero(0, 8)) return true; // ::
  if (allZero(0, 7) && g[7] === 1) return true; // ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x0100 && allZero(1, 4)) return true; // discard prefix
  // Addresses that carry an IPv4 address: judge the IPv4 address.
  if (allZero(0, 5) && g[5] === 0xffff) return isBlockedV4(embeddedV4(g)); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && allZero(2, 6)) return isBlockedV4(embeddedV4(g)); // NAT64
  if (allZero(0, 6)) return isBlockedV4(embeddedV4(g)); // ::a.b.c.d (deprecated)
  return false;
}

/** True for any address a stage must not connect to; anything that is not an IP counts as blocked. */
function isBlockedAddress(address) {
  const family = net.isIP(String(address || ''));
  if (family === 4) return isBlockedV4(address);
  if (family === 6) return isBlockedV6(address);
  return true;
}

/**
 * Check a URL before resolving it. Resolves to { ok: true, url } or
 * { ok: false, reason }. `allowPrivate` is for development and tests only.
 */
function checkUrl(raw, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch (_error) {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'Only http and https URLs are allowed' };
  }
  if (url.username || url.password) {
    return { ok: false, reason: 'Do not put credentials in the URL; use the stage credential' };
  }
  if (allowPrivate) return { ok: true, url };

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) return { ok: false, reason: 'Destination not allowed: private or reserved address' };
  } else if (BLOCKED_NAME.test(host)) {
    return { ok: false, reason: 'Destination not allowed: internal host name' };
  }
  return { ok: true, url };
}

module.exports = { checkUrl, isBlockedAddress };
