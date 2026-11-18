'use strict';

/**
 * IP address parsing and CIDR matching, for every place that judges an address
 * (the target URL check, request allowlists, the stage destination policy).
 *
 * An address is read into bytes (4 for IPv4, 16 for IPv6) with `::` compression and
 * a trailing dotted quad understood; an IPv4-mapped IPv6 address (::ffff:a.b.c.d)
 * is judged as the IPv4 address it carries, so it cannot be used to get around an
 * IPv4 rule.
 */

const net = require('net');

/** An IPv6 address as eight 16-bit groups (handles `::` and a trailing dotted quad). */
function v6Groups(ip) {
  let text = String(ip).toLowerCase().split('%')[0]; // drop a zone id (fe80::1%eth0)
  const dotted = text.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const parts = dotted[1].split('.').map(Number);
    text = `${text.slice(0, -dotted[1].length)}${((parts[0] << 8) | parts[1]).toString(16)}:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const missing = tail === undefined ? 0 : 8 - headGroups.length - tailGroups.length;
  return [...headGroups, ...Array(missing).fill('0'), ...tailGroups].map((group) => parseInt(group, 16) || 0);
}

/** The bytes of an IP address (a Buffer of 4 or 16), or null when it is not one. */
function ipBytes(ip) {
  const text = String(ip || '').split('%')[0];
  const family = net.isIP(text);
  if (family === 4) return Buffer.from(text.split('.').map(Number));
  if (family === 6) return Buffer.from(v6Groups(text).flatMap((group) => [group >> 8, group & 255]));
  return null;
}

/** The IPv4 bytes inside an IPv4-mapped IPv6 address (::ffff:a.b.c.d), or null. */
function mappedIpv4(bytes) {
  const mapped = bytes.length === 16 && bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return mapped ? bytes.subarray(12) : null;
}

/** Is `ip` inside `cidr` ("10.0.0.0/8", "fc00::/7")? False for anything that is not an address or a range. */
function isIpInCidr(ip, cidr) {
  const [base, prefixText] = String(cidr).split('/');
  const prefix = Number(prefixText);
  const range = ipBytes(base);
  let address = ipBytes(ip);
  if (!range || !address || !Number.isInteger(prefix)) return false;
  if (address.length === 16 && range.length === 4) address = mappedIpv4(address);
  if (!address || address.length !== range.length || prefix < 0 || prefix > range.length * 8) return false;

  const wholeBytes = Math.floor(prefix / 8);
  for (let i = 0; i < wholeBytes; i += 1) {
    if (address[i] !== range[i]) return false;
  }
  const rest = prefix % 8;
  if (rest === 0) return true;
  const mask = (0xff << (8 - rest)) & 0xff;
  return (address[wholeBytes] & mask) === (range[wholeBytes] & mask);
}

module.exports = { v6Groups, ipBytes, mappedIpv4, isIpInCidr };
