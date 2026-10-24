'use strict';

/**
 * POST a body over http or https and collect the whole reply. The one place that
 * does this for the notification service, the failure report and the
 * communication adapters (Meta, MSG91, FCM); each of them interprets the reply
 * (status, JSON, its own error wording) itself.
 *
 *   httpPost({ url, headers, body, timeoutMs })
 *   httpPost({ hostname, path, headers, body, timeoutMs })      (https)
 *
 * `body` is a string (the Content-Length is set from it). Resolves to
 * { status, headers, body } for any status; rejects only on a network error or
 * (when timeoutMs is given) a timeout.
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');

function target({ url, hostname, path }) {
  if (!url) return { transport: https, hostname, path };
  const parsed = new URL(url);
  const secure = parsed.protocol === 'https:';
  return {
    transport: secure ? https : http,
    hostname: parsed.hostname,
    port: parsed.port || (secure ? 443 : 80),
    path: `${parsed.pathname}${parsed.search}`,
  };
}

function httpPost({ url, hostname, path, headers = {}, body = '', timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const { transport, ...where } = target({ url, hostname, path });
    const request = transport.request(
      {
        ...where,
        method: 'POST',
        headers: { ...headers, 'Content-Length': Buffer.byteLength(body) },
        ...(timeoutMs ? { timeout: timeoutMs } : {}),
      },
      (res) => {
        let text = '';
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers, body: text }));
      }
    );
    request.on('error', reject);
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.write(body);
    request.end();
  });
}

module.exports = { httpPost };
