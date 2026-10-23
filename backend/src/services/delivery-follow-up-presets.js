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
// For a failed message the report carries only failedAt (no code or reason), observed live.
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

return {
  status,
  done: status === 'READ' || status === 'FAILED', // nothing more to wait for
  deliveredAt: m.deliveredAt,
  readAt: m.readAt,
  errorCode: m.errorCode,
  errorMessage: status === 'FAILED'
    ? (m.errorMessage || m.reason || 'Qikchat reported the message as failed without giving a reason')
    : undefined,
};`;

// Earlier versions of the script, as already saved on integrations: apply-follow-up-preset.js
// --upgrade moves an integration that still has one of these to the current script.
const QIKCHAT_PREVIOUS_SCRIPTS = ["// Ask Qikchat what became of the message (the Pull DLR API).\nconst id = delivery.response && delivery.response.data && delivery.response.data[0] && delivery.response.data[0].id;\nif (!id) return skip('No message id in the response');\n\nconst res = await http.get('https://api.qikchat.in/v1/messages?msgid=' + encodeURIComponent(id), { headers: context.headers });\nif (res.status !== 200) throw new Error('Qikchat delivery report returned ' + res.status);\n\nconst m = (res.data && res.data.message && res.data.message.payload && res.data.message.payload.message) || {};\nconst raw = String(m.status || '').toLowerCase();\nconst statuses = {\n  processing: 'SENT', queued: 'SENT', submitted: 'SENT', accepted: 'SENT', sent: 'SENT',\n  delivered: 'DELIVERED',\n  read: 'READ',\n  failed: 'FAILED', undelivered: 'FAILED', rejected: 'FAILED', error: 'FAILED',\n};\nconst status = statuses[raw];\nif (!status) throw new Error('Unrecognised Qikchat status \"' + raw + '\"');\n\nconst first = (m.errors && m.errors[0]) || m.error || {};\nreturn {\n  status,\n  deliveredAt: m.deliveredAt,\n  readAt: m.readAt,\n  errorCode: m.errorCode || first.code,\n  errorMessage: status === 'FAILED'\n    ? (m.errorMessage || m.reason || first.message || first.title || JSON.stringify(m).slice(0, 300))\n    : undefined,\n};"];

const PRESETS = [
  {
    id: 'qikchat',
    label: 'Qikchat WhatsApp',
    matches: (integration) => hostOf(integration && integration.targetUrl) === 'api.qikchat.in',
    config: { enabled: true, script: QIKCHAT_SCRIPT, checkAfterSeconds: DEFAULT_SCHEDULE_SECONDS },
    previousScripts: QIKCHAT_PREVIOUS_SCRIPTS,
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
