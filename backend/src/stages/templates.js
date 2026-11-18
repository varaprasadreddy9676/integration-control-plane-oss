'use strict';

/**
 * Stage templates: ready-made stage definitions, as data. A template is matched
 * to an integration by its provider (the target URL's host), offered with
 * "Add from template", and, where `applyByDefault` says so, pre-created on new
 * integrations for that provider. The stage it creates is an ordinary stage: the
 * user can rename, edit, disable or delete it.
 */

const { DEFAULT_SCHEDULE_SECONDS } = require('../services/delivery-follow-up-config');

// Qikchat (WhatsApp). The send response is
//   { status, message, data: [{ id, channel, status: 'processing', ... }] }
// and GET /v1/messages?msgid=<id> answers with the delivery report:
//   { status, message: { event: 'whatsapp:message:dlr', payload: { message: { status, sentAt, deliveredAt, readAt, ... } } } }
// The integration's own API key header is added by the gateway, only for api.qikchat.in.
// For a failed message the report carries only failedAt (no code or reason), observed live.
const QIKCHAT_STATUS_SCRIPT = `// Ask Qikchat what became of the message (the Pull DLR API).
const sent = ctx.delivery.response && ctx.delivery.response.body;
const id = sent && sent.data && sent.data[0] && sent.data[0].id;
if (!id) return skip('No message id in the response');

const res = await http.get('https://api.qikchat.in/v1/messages?msgid=' + encodeURIComponent(id));
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

const text = (value) => (value === undefined || value === null ? null : String(value));
return {
  status,
  done: status === 'READ' || status === 'FAILED', // nothing more to wait for
  data: {
    deliveredAt: text(m.deliveredAt),
    readAt: text(m.readAt),
    failedAt: text(m.failedAt),
    errorMessage: status === 'FAILED'
      ? text(m.errorMessage || m.reason || 'Qikchat reported the message as failed without giving a reason')
      : null,
  },
};`;

const hostOf = (url) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch (_error) {
    return null;
  }
};

const TEMPLATES = [
  {
    id: 'qikchat-delivery-status',
    version: 1,
    label: 'Qikchat: delivery status',
    description: 'Asks Qikchat what became of each WhatsApp message (sent, delivered, read or failed), at 30 s, 5 min, 1 h and 24 h.',
    provider: 'Qikchat',
    matches: (integration) => hostOf(integration && integration.targetUrl) === 'api.qikchat.in',
    applyByDefault: true,
    stage: {
      name: 'Delivery status check',
      hook: 'after_delivery',
      effect: 'observe',
      runner: { type: 'script', config: { code: QIKCHAT_STATUS_SCRIPT } },
      schedule: { checkAfterSeconds: DEFAULT_SCHEDULE_SECONDS },
      auth: { source: 'integration', allowedOrigins: ['https://api.qikchat.in'] },
      // The delivery report names the recipient.
      recording: { level: 'full', sensitivePaths: [], sensitiveKeys: ['to', 'from', 'recipient', 'recipient_id', 'phone', 'mobile', 'msisdn', 'wa_id'] },
      outputs: [
        { name: 'deliveredAt', type: 'string' },
        { name: 'readAt', type: 'string' },
        { name: 'failedAt', type: 'string' },
        { name: 'errorMessage', type: 'string' },
      ],
    },
  },
];

function getTemplate(id) {
  return TEMPLATES.find((template) => template.id === id) || null;
}

/** Templates for the console, those matching this integration first. */
function listTemplates(integration) {
  return TEMPLATES.map((template) => ({
    id: template.id,
    label: template.label,
    description: template.description,
    provider: template.provider,
    hook: template.stage.hook,
    recommended: Boolean(integration && template.matches(integration)),
  })).sort((a, b) => Number(b.recommended) - Number(a.recommended));
}

/** A new stage from a template, with its own ID and name. */
function stageFromTemplate(templateId, { id, name } = {}) {
  const template = getTemplate(templateId);
  if (!template) return null;
  const stage = JSON.parse(JSON.stringify(template.stage));
  return {
    id: id || templateId.replace(/[^A-Za-z0-9]+(.)/g, (_m, c) => c.toUpperCase()),
    ...stage,
    name: name || stage.name,
    enabled: true,
    template: { id: template.id, version: template.version },
  };
}

/** Stages a new integration starts with: the default templates for its provider. */
function defaultStagesFor(integration) {
  const existing = (integration && integration.stages) || [];
  return TEMPLATES.filter(
    (template) => template.applyByDefault && template.matches(integration) && !existing.some((stage) => stage.template && stage.template.id === template.id)
  ).map((template) => stageFromTemplate(template.id));
}

module.exports = { TEMPLATES, getTemplate, listTemplates, stageFromTemplate, defaultStagesFor };
