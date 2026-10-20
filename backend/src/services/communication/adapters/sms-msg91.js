/**
 * MSG91 SMS Adapter
 *
 * Supports:
 *   - Transactional SMS (route 4) via MSG91 Flow API v5
 *   - Template-based SMS with dynamic variables
 *   - Plain text SMS (non-template)
 *
 * MSG91 API reference:
 *   https://docs.msg91.com/reference/send-sms
 *
 * Standard SMS payload (same shape accepted by all SMS adapters):
 *   {
 *     to:         string|string[]  — E.164 or local format (91XXXXXXXXXX)
 *     message:    string           — Plain text body (used when no templateId)
 *     templateId: string           — MSG91 template/flow ID (preferred for DLT-compliant SMS)
 *     variables:  object           — Key-value pairs injected into the template: { VAR1: "...", VAR2: "..." }
 *     senderId:   string           — 6-char sender ID override (falls back to config)
 *   }
 *
 * Config (from communicationConfig.sms.msg91.*):
 *   {
 *     authKey:    string  — MSG91 API key (required)
 *     senderId:   string  — Default sender ID, 6 chars (required)
 *     route:      string  — "4" transactional (default), "1" promotional
 *     country:    string  — Country code prefix, e.g. "91" for India (default: "91")
 *   }
 */

const https = require('https');
const { log } = require('../../../logger');

const MSG91_API_HOST = 'api.msg91.com';
const MSG91_FLOW_PATH = '/api/v5/flow/';
const DEFAULT_ROUTE = '4'; // Transactional

class Msg91Adapter {
  /**
   * Send SMS via MSG91
   * @param {object} payload - Standard SMS payload
   * @param {object} config  - MSG91 config from communicationConfig.sms.msg91
   * @returns {Promise<object>} result
   */
  async send(payload, config) {
    const { to, message, templateId, variables = {}, senderId: payloadSenderId } = payload;
    const { authKey, senderId: configSenderId, route = DEFAULT_ROUTE, country = '91' } = config;

    // Validate
    if (!authKey) throw new Error('MSG91 authKey is required');
    if (!to) throw new Error('SMS recipient (to) is required');

    const senderId = payloadSenderId || configSenderId;
    if (!senderId) throw new Error('MSG91 senderId is required (config or payload)');

    // Normalize recipients to array, apply country prefix
    const recipients = this._normalizeRecipients(to, country);

    // Build request body
    const body = templateId
      ? this._buildFlowBody(senderId, templateId, variables, recipients)
      : this._buildPlainBody(senderId, message, route, recipients, country);

    log('info', '[MSG91] Sending SMS', {
      to: recipients,
      templateId: templateId || null,
      hasVariables: Object.keys(variables).length > 0,
    });

    const rawResponse = await this._post(MSG91_API_HOST, MSG91_FLOW_PATH, body, authKey);

    // MSG91 returns { type: "success", message: "...", request_id: "..." }
    if (rawResponse.type !== 'success') {
      throw new Error(`MSG91 error: ${rawResponse.message || JSON.stringify(rawResponse)}`);
    }

    log('info', '[MSG91] SMS sent successfully', {
      requestId: rawResponse.request_id,
      to: recipients,
    });

    return {
      messageId: rawResponse.request_id,
      to: recipients,
      provider: 'MSG91',
      channel: 'SMS',
      raw: rawResponse,
      timestamp: new Date().toISOString(),
    };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Build Flow API body (template-based — required for DLT compliance in India)
   */
  _buildFlowBody(senderId, templateId, variables, recipients) {
    return {
      template_id: templateId,
      short_url: '0',
      realTimeResponse: '1',
      mobiles: recipients.map((mobile) => ({
        mobiles: mobile,
        ...variables, // VAR1, VAR2, ... injected per-recipient or shared
      })),
    };
  }

  /**
   * Build plain SMS body (for non-template transactional)
   */
  _buildPlainBody(senderId, message, route, recipients, country) {
    if (!message) throw new Error('SMS message body is required when no templateId is provided');

    return {
      sender: senderId,
      route,
      country,
      sms: [
        {
          message,
          to: recipients,
        },
      ],
    };
  }

  /**
   * Normalize to/country into E.164-style numbers MSG91 expects
   * Supports: "9876543210", "919876543210", "+919876543210", ["91..."]
   */
  _normalizeRecipients(to, country) {
    const list = Array.isArray(to) ? to : [to];
    const prefix = String(country).replace('+', '');

    return list.map((num) => {
      const digits = String(num).replace(/\D/g, '');
      // Already has country prefix (e.g. 919876543210)
      if (digits.startsWith(prefix) && digits.length > 10) return digits;
      // Bare 10-digit → prepend country code
      return `${prefix}${digits}`;
    });
  }

  /**
   * POST JSON to MSG91 API
   */
  _post(host, path, body, authKey) {
    return new Promise((resolve, reject) => {
      const bodyStr = JSON.stringify(body);

      const options = {
        hostname: host,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authkey: authKey,
          'Content-Length': Buffer.byteLength(bodyStr),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (res.statusCode >= 400) {
              reject(new Error(`MSG91 HTTP ${res.statusCode}: ${parsed?.message || data}`));
            } else {
              resolve(parsed);
            }
          } catch {
            reject(new Error(`MSG91 invalid response (HTTP ${res.statusCode}): ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(new Error(`MSG91 network error: ${err.message}`)));
      req.write(bodyStr);
      req.end();
    });
  }
}

module.exports = new Msg91Adapter();
