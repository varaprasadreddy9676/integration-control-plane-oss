'use strict';

/**
 * Follow-up presets: a provider the gateway recognizes by the host of an
 * integration's target URL, with the follow-up script that asks that provider
 * what became of a message. Every integration for the provider follows up by
 * default; one integration opts out by saving its own follow-up with
 * `enabled: false`. A preset only fills in a follow-up that was never set.
 */

const { DEFAULT_SCHEDULE_SECONDS } = require('./delivery-follow-up-config');

// Qikchat (WhatsApp). The send response is
//   { status, message, data: [{ id, channel, status: 'processing', ... }] }
// and GET /v1/messages?msgid=<id> answers with the delivery report:
//   { status, message: { event: 'whatsapp:message:dlr', payload: { message: { status, sentAt, deliveredAt, readAt, ... } } } }
// The same API key header the integration sends with is used for the report.
const QIKCHAT_SCRIPT = `// Ask Qikchat what became of the message (the Pull DLR API).
const id = delivery.response && delivery.response.data && delivery.response.data[0] && delivery.response.data[0].id;
if (!id) return skip('No message id in the response');

const res = await http.get('https://api.qikchat.in/v1/messages?msgid=' + encodeURIComponent(id), { headers: context.headers });
if (res.status !== 200) throw new Error('Qikchat delivery report returned ' + res.status);

const m = (res.data && res.data.message && res.data.message.payload && res.data.message.payload.message) || {};
const raw = String(m.status || '').toLowerCase();
const statuses = {
  processing: 'SENT', queued: 'SENT', submitted: 'SENT', accepted: 'SENT', sent: 'SENT',
  delivered: 'DELIVERED',
  read: 'READ',
  failed: 'FAILED', undelivered: 'FAILED', rejected: 'FAILED', error: 'FAILED',
};
const status = statuses[raw];
if (!status) throw new Error('Unrecognised Qikchat status "' + raw + '"');

const first = (m.errors && m.errors[0]) || m.error || {};
return {
  status,
  deliveredAt: m.deliveredAt,
  readAt: m.readAt,
  errorCode: m.errorCode || first.code,
  errorMessage: status === 'FAILED'
    ? (m.errorMessage || m.reason || first.message || first.title || JSON.stringify(m).slice(0, 300))
    : undefined,
};`;

const PRESETS = [
  {
    id: 'qikchat',
    label: 'Qikchat WhatsApp',
    matches: (integration) => hostOf(integration && integration.targetUrl) === 'api.qikchat.in',
    config: { enabled: true, script: QIKCHAT_SCRIPT, checkAfterSeconds: DEFAULT_SCHEDULE_SECONDS },
  },
];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return null;
  }
}

/** The preset for an integration's provider, or null. */
function findPreset(integration) {
  if (!integration) return null;
  return PRESETS.find((preset) => preset.matches(integration)) || null;
}

/** A copy of a preset's follow-up configuration, safe for one integration to edit. */
function copyConfig(preset) {
  return { ...preset.config, checkAfterSeconds: [...preset.config.checkAfterSeconds] };
}

/**
 * The follow-up an integration being created should start with: what it was
 * given if anything (including a switched-off one), else its provider's preset.
 */
function defaultFollowUpFor(integration) {
  const given = integration && integration.deliveryFollowUp;
  if (given !== undefined && given !== null) return given;
  const preset = findPreset(integration);
  return preset ? copyConfig(preset) : given;
}

module.exports = { PRESETS, findPreset, defaultFollowUpFor, copyConfig };
