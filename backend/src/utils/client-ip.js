'use strict';

const net = require('net');

const stripPort = (value) => {
  const v = String(value).trim();
  // [::1]:443 or 1.2.3.4:5678
  const bracket = v.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) return bracket[1];
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(v)) return v.slice(0, v.lastIndexOf(':'));
  return v;
};

const normalize = (value) => {
  let v = stripPort(value);
  if (v.toLowerCase().startsWith('::ffff:') && net.isIPv4(v.slice(7))) v = v.slice(7);
  return net.isIP(v) ? v : null;
};

const isPrivate = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v = ip.toLowerCase();
  return v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
};

/**
 * The caller's address. Each proxy appends the address it received the connection from, so the
 * entries a caller invented sit on the left and our own hops (load balancer, Apache) on the
 * right. Walk from the right, skip private hops, and the first public address is the caller.
 * An all-private chain means an internal caller: use the right-most entry. With no
 * X-Forwarded-For at all, fall back to the socket address.
 */
function resolveClientIp(req) {
  const header = req?.headers?.['x-forwarded-for'];
  const chain = String(Array.isArray(header) ? header.join(',') : header || '')
    .split(',')
    .map(normalize)
    .filter(Boolean);
  if (chain.length > 0) {
    for (let i = chain.length - 1; i >= 0; i -= 1) {
      if (!isPrivate(chain[i])) return chain[i];
    }
    return chain[chain.length - 1];
  }
  return normalize(req?.socket?.remoteAddress || req?.ip || '') || null;
}

module.exports = { resolveClientIp };
