'use strict';

/**
 * Writing a stage with AI. Most people ask an AI to write the script, so the platform
 * says exactly what a step may do and builds the prompt for it: one source for the
 * console's "Write with AI" button and for the MCP tools an AI agent uses itself.
 *
 *   buildGuide({ hook })                          what a step at this hook sees, may do and must return
 *   shapeOf(value)                                a value's structure with no values (privacy: a sample
 *                                                 delivery's keys and types go into a prompt, never its data)
 *   buildPrompt({ hook, goal, current, samples }) the text to give an AI
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

const MAX_DEPTH = 4;
const MAX_KEYS = 40;

/** A value's structure and no data: keys with their types; an array by its first item. */
function shapeOf(value, depth = 0) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return depth >= MAX_DEPTH ? ['...'] : value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '{...}';
    return Object.fromEntries(Object.keys(value).slice(0, MAX_KEYS).map((key) => [key, shapeOf(value[key], depth + 1)]));
  }
  return typeof value;
}

const block = (title, body) => `## ${title}\n${body}\n`;
const list = (items) => items.map((item) => `- ${item}`).join('\n');
const json = (value) => `\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\``;

/**
 * The prompt to give an AI. `samples` are shapes (shapeOf), never values. `current` is
 * the script as it is now, to change rather than rewrite.
 */
function buildPrompt({ hook, goal, current, samples } = {}) {
  const guide = buildGuide({ hook });
  const at = guide.at;
  const parts = [
    'You write one step of a message-delivery pipeline as a JavaScript script. Answer with the script only, in one code block, then one sentence saying what it does.',
    block('What I want', String(goal || '').trim() || '(describe it)'),
  ];
  if (at) {
    parts.push(
      block(`Where it runs: ${at.title}`, `${at.when}\n\nIt sees:\n${list(at.sees)}\n\nIt may:\n${list(at.may)}\n\nTime limit: ${at.timeoutMs.default} ms by default (at most ${at.timeoutMs.max} ms).`)
    );
  }
  parts.push(block('Helpers', list(guide.helpers)), block('Rules', list(guide.rules)), block('The script must return', guide.returns));
  if (samples && Object.keys(samples).length) {
    parts.push(block('The shape of the data (keys and types only; the real values are not shared)', json(samples)));
  }
  if (current && String(current).trim()) parts.push(block('The script now (change it, do not start over)', `\`\`\`js\n${current}\n\`\`\``));
  if (at) parts.push(block('An example at this place', `\`\`\`js\n${at.example}\n\`\`\``));
  return parts.join('\n');
}

module.exports = { buildGuide, buildPrompt, shapeOf, HOOKS };
