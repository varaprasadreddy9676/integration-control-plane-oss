/**
 * WhatsApp Meta Cloud API Adapter
 * Sends WhatsApp messages directly via Meta's WhatsApp Business Cloud API.
 *
 * Docs: https://developers.facebook.com/docs/whatsapp/cloud-api/messages
 *
 * Config (communicationConfig.meta):
 *   phoneNumberId  — WhatsApp Business phone number ID (from Meta Business Manager)
 *   accessToken    — Permanent system user access token
 *
 * Payload (from integration transform output):
 *   to             — Recipient phone number in E.164 format (+919876543210)
 *   type           — "text" | "template" (default: "text")
 *   text           — Message body (for type "text")
 *   templateName   — Template name (for type "template")
 *   templateLanguage — Language code, e.g. "en_US" (for type "template", default: "en")
 *   templateComponents — Array of template component objects (optional)
 */

const { httpPost } = require('../../../utils/http-post');
const { log } = require('../../../logger');

const META_API_VERSION = 'v19.0';
const META_API_HOST = 'graph.facebook.com';

class WhatsAppMetaAdapter {
  /**
   * Send a WhatsApp message via Meta Cloud API
   * @param {object} payload
   * @param {string} payload.to - Recipient in E.164 format
   * @param {string} [payload.type] - "text" | "template" (default: "text")
   * @param {string} [payload.text] - Message body (type=text)
   * @param {string} [payload.templateName] - Template name (type=template)
   * @param {string} [payload.templateLanguage] - Language code (type=template)
   * @param {Array}  [payload.templateComponents] - Template components (type=template)
   * @param {object} config
   * @param {string} config.phoneNumberId - Meta phone number ID
   * @param {string} config.accessToken - System user access token
   */
  async send(payload, config) {
    const { to, type = 'text', text, templateName, templateLanguage = 'en_US', templateComponents = [] } = payload;
    const { phoneNumberId, accessToken } = config;

    // Validate required fields
    if (!to) throw new Error('WhatsApp recipient (to) is required — use E.164 format (+919876543210)');
    if (!phoneNumberId) throw new Error('communicationConfig.meta.phoneNumberId is required');
    if (!accessToken) throw new Error('communicationConfig.meta.accessToken is required');

    // Build Meta API message body
    let messageBody;
    if (type === 'template') {
      if (!templateName) throw new Error('payload.templateName is required for template messages');
      messageBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: {
          name: templateName,
          language: { code: templateLanguage },
          ...(templateComponents.length > 0 ? { components: templateComponents } : {}),
        },
      };
    } else {
      // Default: free-form text
      if (!text) throw new Error('payload.text is required for text messages');
      messageBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      };
    }

    log('info', '[WhatsApp:Meta] Sending message', { to, type, phoneNumberId });

    const result = await this._post(phoneNumberId, accessToken, messageBody);

    const messageId = result?.messages?.[0]?.id ?? null;
    // wa_id is the WhatsApp-normalised number (without +), useful for deduplication
    const waId = result?.contacts?.[0]?.wa_id ?? null;

    log('info', '[WhatsApp:Meta] Message sent successfully', { to, waId, messageId });

    return {
      success: true,
      messageId,
      waId,
      to,
      provider: 'META',
      raw: result,
      timestamp: new Date(),
    };
  }

  /**
   * POST to Meta Graph API
   * @private
   */
  async _post(phoneNumberId, accessToken, body) {
    let res;
    try {
      res = await httpPost({
        hostname: META_API_HOST,
        path: `/${META_API_VERSION}/${phoneNumberId}/messages`,
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch (err) {
      throw new Error(`Meta API network error: ${err.message}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(res.body);
    } catch {
      throw new Error(`Meta API returned non-JSON response (HTTP ${res.status}): ${res.body.slice(0, 200)}`);
    }
    if (res.status >= 200 && res.status < 300) return parsed;
    const errMsg = parsed?.error?.message ?? `Meta API error HTTP ${res.status}`;
    const errCode = parsed?.error?.code;
    throw new Error(errCode ? `Meta API [${errCode}]: ${errMsg}` : errMsg);
  }
}

module.exports = new WhatsAppMetaAdapter();
