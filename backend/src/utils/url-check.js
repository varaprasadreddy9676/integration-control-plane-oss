const net = require('net');
const { URL } = require('url');
const { isIpInCidr } = require('./ip-address');

const privateBlocks = [
  { cidr: '10.0.0.0/8' },
  { cidr: '172.16.0.0/12' },
  { cidr: '192.168.0.0/16' },
  { cidr: '127.0.0.0/8' },
  { cidr: '0.0.0.0/8' },
  { cidr: '169.254.0.0/16' },
  { cidr: '::1/128' },
  { cidr: 'fc00::/7' },
  { cidr: 'fe80::/10' },
];

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return false;
  return privateBlocks.some((block) => isIpInCidr(ip, block.cidr));
}

function validateTargetUrl(
  targetUrl,
  { enforceHttps = false, blockPrivateNetworks = true, allowedProtocols = ['http:', 'https:'] } = {}
) {
  if (!targetUrl) {
    return { valid: false, reason: 'URL required' };
  }
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch (_err) {
    return { valid: false, reason: 'Invalid URL format' };
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    return { valid: false, reason: 'Only HTTP and HTTPS URLs are allowed' };
  }

  if (enforceHttps && parsed.protocol !== 'https:') {
    return { valid: false, reason: 'HTTPS required' };
  }

  if (blockPrivateNetworks) {
    // A URL keeps the brackets of an IPv6 literal in its hostname: [::1]
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    if (host === 'localhost') {
      return { valid: false, reason: 'Localhost is not allowed' };
    }
    if (net.isIP(host) && isPrivateIp(host)) {
      return { valid: false, reason: 'Private IP not allowed' };
    }
  }

  return { valid: true };
}

module.exports = { validateTargetUrl };
