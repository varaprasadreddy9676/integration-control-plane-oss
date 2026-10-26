'use strict';

/**
 * Writing a stage with AI. Most people ask an AI to write the script, so the platform
 * says exactly what a step may do: the MCP tools an AI agent uses read it from here.
 *
 *   buildGuide({ hook })   what a step at this hook sees, may do and must return
 *
 * The script contract is contract 1 (contracts.js, runtime/child.js); a test holds this
 * guide to the limits in config.js so it cannot drift from what is enforced.
 */

const { LIMITS } = require('./config');
const runners = require('./runners');

const HOOKS = {
  before_send: {
    title: 'Before send',
    when: 'After the request is built, before the target is called. Runs again on every retry attempt.',
    sees: ['ctx.event', 'ctx.delivery.request { protocol, target, method, body } (what is about to be sent)', 'ctx.stages.<id>.output / .status (earlier steps)', 'ctx.vars, ctx.inputs'],
    may: ['return skip("reason") to not send it (not an error, no failure steps)', 'return fail("reason") to fail the delivery', 'return fail("reason", { retryDelivery: true }) to try the delivery again later (the step must allow it)', 'hand values to the send step with data'],
    inline: true,
  },
  after_response: {
    title: 'After the response',
    when: 'Right after the target answers. Only runs when there is an answer.',
    sees: ['ctx.event', 'ctx.delivery.response { protocol, ok, status, code, message, providerMessageId, headers, body }', 'ctx.delivery.request', 'ctx.stages, ctx.vars, ctx.inputs'],
    may: ['return fail("reason") when the answer means the send did not work (it is not sent again unless the step allows it)', 'return a status and data to record'],
    inline: true,
  },
  after_delivery: {
    title: 'Later (scheduled)',
    when: 'After an accepted send, on a schedule. Asks a provider what became of it, or notifies someone. It observes: it never changes the delivery outcome.',
    sees: ['ctx.delivery.response (what came back when it was sent: providerMessageId, body...)', 'ctx.run.seq (which check this is)', 'ctx.event, ctx.stages, ctx.vars, ctx.inputs'],
    may: ['return { status: "DELIVERED", done: true } when there is nothing more to wait for', 'return { status: "PENDING" } to be asked again at the next scheduled time'],
    inline: false,
  },
  on_failure: {
    title: 'On failure',
    when: 'Once the delivery has finally failed (including before any send). Observes only.',
    sees: ['ctx.delivery.status (FAILED or ABANDONED)', 'ctx.delivery.errorMessage', 'ctx.event, ctx.delivery.request, ctx.stages, ctx.vars'],
    may: ['do something about it (notify, record) and return { status: "NOTIFIED" }'],
    inline: false,
  },
};

const HELPERS = [
  'http.get(url, options) / http.post(url, body, options) / put / patch / delete: returns { status, headers, data }. Credentials are added by the platform to approved origins only; never put a secret in a script.',
  'http.getBuffer(url, options): a document or image as base64',
  'lookup(value, type): read the organization\'s lookup tables',
  'log(...): add a line to the step\'s record',
  'skip(reason), fail(reason, { retryStage, retryDelivery }): return one of these to decide',
];

const RULES = [
  'The script is the body of an async function: use await, and finish with return.',
  'Return { status, done, data }. status is a word of letters, digits and _ (up to 40 characters, e.g. DELIVERED). done: true ends a scheduled check. data is an object later steps can use.',
  'ctx is read-only. No require/import, no file or network access except http, no process or timers that outlive the step.',
  'A step that throws counts as an error, handled by its "when it fails" setting.',
  'Never put a credential, token or personal data in the script or in log().',
  'Keep it short and readable: a person has to review it.',
];

const EXAMPLES = {
  before_send: `// Skip people who have not agreed to be messaged
if (!ctx.event.consent) return skip('No consent');
return { status: 'OK' };`,
  after_response: `// The provider said 200 but the body says it was refused
const body = ctx.delivery.response.body || {};
if (body.accepted === false) return fail(body.reason || 'The provider refused the message');
return { status: 'ACCEPTED', data: { messageId: ctx.delivery.response.providerMessageId } };`,
  after_delivery: `// Ask the provider what became of the message
const id = ctx.delivery.response.providerMessageId;
const answer = await http.get('https://api.provider.example/messages/' + id);
const state = answer.data && answer.data.status;
if (state === 'read') return { status: 'READ', done: true };
if (state === 'failed') return { status: 'FAILED', done: true };
return { status: 'PENDING' };`,
  on_failure: `// Tell someone it failed
await http.post('https://hooks.example.com/alert', { text: 'Delivery failed: ' + ctx.delivery.errorMessage });
return { status: 'NOTIFIED' };`,
};

/** What a step at `hook` sees, may do and must return, as data. */
function buildGuide({ hook } = {}) {
  const at = HOOKS[hook] || null;
  const timeouts = at ? (at.inline ? LIMITS.inlineTimeoutMs : LIMITS.deferredTimeoutMs) : null;
  return {
    hook: hook || null,
    hooks: Object.fromEntries(Object.entries(HOOKS).map(([key, value]) => [key, { title: value.title, when: value.when }])),
    at: at && { ...at, timeoutMs: timeouts, example: EXAMPLES[hook] },
    helpers: HELPERS,
    rules: RULES,
    returns: '{ status?: string, done?: boolean, data?: object }',
    runners: runners.list().map((runner) => ({ type: runner.type, label: runner.label, hooks: runner.hooks })),
    limits: { stagesPerDelivery: LIMITS.maxStages, perHook: LIMITS.maxPerHook, nameLength: LIMITS.maxNameLength },
    shape: {
      id: 'letters, digits, _ or - starting with a letter; unique in the integration',
      name: 'what the user calls the step',
      hook: Object.keys(HOOKS).join(' | '),
      effect: 'gate (may skip or fail the delivery) | observe (only records); only at before_send and after_response',
      runner: '{ type: "script", config: { code } } or { type: "http", config } (see runners)',
      schedule: 'after_delivery only: { checkAfterSeconds: [30, 300] } or { everySeconds, maxAgeSeconds }',
      outputs: 'script steps: [{ name, type }] the data it hands on',
      verification: 'after_delivery only: { resendWhen: [status words that mean the provider does not have the message] }',
    },
  };
}

module.exports = { buildGuide, HOOKS };
