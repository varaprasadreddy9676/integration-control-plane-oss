'use strict';

/**
 * Built-in templates: one-step setups for common services. Each declares the few
 * inputs it needs and builds the payload for the normal create API
 * (POST /outbound-integrations or /inbound-integrations), so the result goes
 * through the same validation, audit and history as any other integration.
 *
 * Integrations are created inactive unless the caller asks to activate them.
 */

class TemplateInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TemplateInputError';
    this.statusCode = 400;
  }
}

const EVENT_TYPE_INPUT = {
  key: 'eventType',
  label: 'Event',
  type: 'eventType',
  required: true,
  help: 'The event from your systems that triggers this integration.',
};

// Field paths are embedded in scripts as JSON string literals: data, never code.
const literal = (value) => JSON.stringify(String(value || ''));

const SLACK_SCRIPT = `// Builds a Slack message from the event. Edit freely.
const fields = Object.entries(payload || {})
  .filter(([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value))
  .slice(0, 10)
  .map(([key, value]) => '*' + key + ':* ' + value);
return {
  text: context.eventType,
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: context.eventType } },
    ...(fields.length ? [{ type: 'section', text: { type: 'mrkdwn', text: fields.join('\\n') } }] : []),
  ],
};`;

const hubspotScript = ({ emailField, firstNameField, lastNameField, phoneField }) => `// Creates or updates a HubSpot contact, matched by email. Events without an email are skipped.
const get = (path) => (path ? path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), payload) : undefined);
const email = get(${literal(emailField)});
if (!email) return null;
const properties = { email: String(email) };
const mapping = { firstname: ${literal(firstNameField)}, lastname: ${literal(lastNameField)}, phone: ${literal(phoneField)} };
for (const [property, path] of Object.entries(mapping)) {
  const value = get(path);
  if (value !== undefined && value !== null && value !== '') properties[property] = String(value);
}
return { inputs: [{ idProperty: 'email', id: String(email), properties }] };`;

const outbound = (overrides) => ({
  httpMethod: 'POST',
  scope: 'INCLUDE_CHILDREN',
  outgoingAuthType: 'NONE',
  outgoingAuthConfig: {},
  timeoutMs: 15000,
  retryCount: 3,
  transformationMode: 'SCRIPT',
  ...overrides,
});

const TEMPLATES = [
  {
    id: 'slack-channel',
    name: 'Slack: post events to a channel',
    description: 'Sends a message to a Slack channel each time the event happens.',
    category: 'Messaging',
    direction: 'OUTBOUND',
    docsUrl: 'https://api.slack.com/messaging/webhooks',
    inputs: [
      EVENT_TYPE_INPUT,
      {
        key: 'webhookUrl',
        label: 'Slack webhook URL',
        type: 'secret',
        required: true,
        placeholder: 'https://hooks.slack.com/services/…',
        help: 'In Slack: create an app, enable Incoming Webhooks, add one to the channel and copy its URL.',
        pattern: '^https://hooks\\.slack\\.com/services/',
        patternMessage: 'Slack webhook URLs start with https://hooks.slack.com/services/',
      },
    ],
    build: (inputs) =>
      outbound({
        name: `Slack: ${inputs.eventType}`,
        eventType: inputs.eventType,
        targetUrl: inputs.webhookUrl,
        transformation: { script: SLACK_SCRIPT },
      }),
  },
  {
    id: 'stripe-webhooks',
    name: 'Stripe: receive webhooks',
    description: 'Gives Stripe a URL to send events to, verifies each signature, and forwards the event to your endpoint.',
    category: 'Payments',
    direction: 'INBOUND',
    docsUrl: 'https://docs.stripe.com/webhooks',
    inputs: [
      {
        key: 'signingSecret',
        label: 'Stripe signing secret',
        type: 'secret',
        required: true,
        placeholder: 'whsec_…',
        help: 'In Stripe: Developers → Webhooks → your endpoint → Signing secret. Create the endpoint first with the URL shown after setup, then paste its secret here (you can edit it later).',
        pattern: '^whsec_',
        patternMessage: 'Stripe signing secrets start with whsec_',
      },
      {
        key: 'forwardUrl',
        label: 'Forward events to',
        type: 'url',
        required: true,
        placeholder: 'https://api.example.com/stripe-events',
        help: 'Your endpoint that handles the verified Stripe events.',
        pattern: '^https://',
        patternMessage: 'Use an https:// URL',
      },
      {
        key: 'type',
        label: 'Endpoint name',
        type: 'text',
        required: false,
        placeholder: 'stripe-events',
        help: 'Becomes part of the URL Stripe calls.',
        pattern: '^[a-z0-9][a-z0-9-]{1,62}$',
        patternMessage: 'Lowercase letters, numbers and dashes',
      },
    ],
    build: (inputs) => ({
      name: 'Stripe webhooks',
      type: inputs.type || 'stripe-events',
      targetUrl: inputs.forwardUrl,
      httpMethod: 'POST',
      contentType: 'application/json',
      inboundAuthType: 'HMAC',
      inboundAuthConfig: { scheme: 'STRIPE', secret: inputs.signingSecret, toleranceSeconds: 300 },
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {},
      timeout: 10000,
      retryCount: 3,
    }),
  },
  {
    id: 'hubspot-contact',
    name: 'HubSpot: create or update contacts',
    description: 'Creates a HubSpot contact for each event, or updates the one with the same email.',
    category: 'CRM',
    direction: 'OUTBOUND',
    docsUrl: 'https://developers.hubspot.com/docs/api/private-apps',
    inputs: [
      EVENT_TYPE_INPUT,
      {
        key: 'accessToken',
        label: 'HubSpot private app token',
        type: 'secret',
        required: true,
        placeholder: 'pat-…',
        help: 'In HubSpot: Settings → Integrations → Private apps → create one with the crm.objects.contacts.write scope.',
        pattern: '^pat-',
        patternMessage: 'HubSpot private app tokens start with pat-',
      },
      { key: 'emailField', label: 'Email field in the event', type: 'text', required: true, placeholder: 'email', default: 'email' },
      { key: 'firstNameField', label: 'First name field', type: 'text', required: false, placeholder: 'firstName', default: 'firstName' },
      { key: 'lastNameField', label: 'Last name field', type: 'text', required: false, placeholder: 'lastName', default: 'lastName' },
      { key: 'phoneField', label: 'Phone field', type: 'text', required: false, placeholder: 'phone', default: 'phone' },
    ],
    build: (inputs) =>
      outbound({
        name: `HubSpot contacts: ${inputs.eventType}`,
        eventType: inputs.eventType,
        targetUrl: 'https://api.hubapi.com/crm/v3/objects/contacts/batch/upsert',
        outgoingAuthType: 'BEARER',
        outgoingAuthConfig: { token: inputs.accessToken },
        transformation: { script: hubspotScript(inputs) },
      }),
  },
];

const byId = new Map(TEMPLATES.map((template) => [template.id, template]));

/** The catalog as the API returns it: everything except the build functions. */
function listCatalog() {
  return TEMPLATES.map(({ build, ...template }) => template);
}

function normalizeInputs(template, rawInputs = {}) {
  const inputs = {};
  for (const input of template.inputs) {
    const raw = rawInputs[input.key];
    const value = typeof raw === 'string' ? raw.trim() : raw;
    const resolved = value === undefined || value === null || value === '' ? input.default : value;
    if (resolved === undefined || resolved === null || resolved === '') {
      if (input.required) throw new TemplateInputError(`${input.label} is required`);
      continue;
    }
    if (typeof resolved !== 'string') throw new TemplateInputError(`${input.label} must be text`);
    if (input.type === 'eventType' && !/^[A-Za-z0-9_.:-]{1,100}$/.test(resolved)) {
      throw new TemplateInputError(`${input.label} is not a valid event type`);
    }
    if (input.pattern && !new RegExp(input.pattern).test(resolved)) {
      throw new TemplateInputError(input.patternMessage || `${input.label} is not valid`);
    }
    inputs[input.key] = resolved;
  }
  return inputs;
}

/**
 * The payload for the create API, from a template and the user's inputs.
 * Throws TemplateInputError (statusCode 400) for unknown templates or bad input.
 */
function buildFromCatalog(templateId, rawInputs, { activate = false } = {}) {
  const template = byId.get(templateId);
  if (!template) throw new TemplateInputError('Unknown template');
  const inputs = normalizeInputs(template, rawInputs);
  return {
    templateId: template.id,
    direction: template.direction,
    payload: { ...template.build(inputs), isActive: activate === true },
  };
}

module.exports = { listCatalog, buildFromCatalog, TemplateInputError };
