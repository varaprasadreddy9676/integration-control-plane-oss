'use strict';

const axios = require('axios');
const crypto = require('crypto');
const config = require('../../../config');
const { validateTargetUrl } = require('../../../utils/url-check');
const { generateSignatureHeaders } = require('../../integration-signing');

module.exports = {
  type: 'webhook',
  name: 'Webhook',
  description: 'POST each alert as JSON to your own endpoint or an external reporting API.',
  fields: [
    { key: 'url', label: 'Endpoint URL', type: 'url', required: true, placeholder: 'https://reports.example.com/alerts' },
    {
      key: 'bearerToken',
      label: 'Bearer token',
      type: 'secret',
      required: false,
      help: 'Sent as Authorization: Bearer <token>.',
    },
    {
      key: 'signingSecret',
      label: 'Signing secret',
      type: 'secret',
      required: false,
      help: 'If set, each request carries X-Integration-ID, -Timestamp and -Signature headers (HMAC-SHA256) so your endpoint can verify it came from the gateway.',
    },
  ],

  async send(alert, settings) {
    const urlCheck = validateTargetUrl(settings.url, config.security);
    if (!urlCheck.valid) throw new Error(`Endpoint URL not allowed: ${urlCheck.reason}`);

    const body = JSON.stringify({ version: 1, ...alert });
    const headers = { 'Content-Type': 'application/json' };
    if (settings.bearerToken) headers.Authorization = `Bearer ${settings.bearerToken}`;
    if (settings.signingSecret) {
      Object.assign(
        headers,
        generateSignatureHeaders(settings.signingSecret, `alert_${crypto.randomBytes(12).toString('hex')}`, Math.floor(Date.now() / 1000), body)
      );
    }
    await axios({ method: 'POST', url: settings.url, headers, data: body, timeout: 10000, maxRedirects: 0 });
  },
};
