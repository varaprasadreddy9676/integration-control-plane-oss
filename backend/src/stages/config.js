'use strict';

/**
 * Validation and defaults for an integration's stages and its Send bindings.
 * Runner-specific config is checked by the runner (runners/index.js); this
 * checks everything the engine relies on: unique IDs, hook/effect combinations,
 * schedules, error policies, timeouts, recording, outputs and the references
 * between stages, and the product boundary (single-delivery outbound only).
 *
 * validateStages(...) -> { ok, errors: [{ path, message }], stages, send }
 * The returned stages and send are new objects with defaults applied.
 */

const { expressionsIn, BindingError } = require('./binding');
const { STAGE_ID } = require('./store');

const HOOKS = ['before_send', 'after_response', 'after_delivery', 'on_failure'];
const INLINE_HOOKS = new Set(['before_send', 'after_response']);
const HOOK_ORDER = { before_send: 0, after_response: 1, after_delivery: 2, on_failure: 2 };
const EFFECTS = {
  before_send: ['gate', 'observe'],
  after_response: ['gate', 'observe'],
  after_delivery: ['observe'],
  on_failure: ['observe'],
};
const ERROR_ACTIONS = ['ignore', 'fail_stage', 'retry_stage'];
const RECORDING_LEVELS = ['full', 'errors-only', 'summary'];
const OUTPUT_TYPES = ['string', 'number', 'boolean', 'object'];
const CONTRACTS = [1, 'legacy:follow-up', 'legacy:response-transform', 'legacy:pre-delivery-checks'];

const LIMITS = {
  maxStages: 20,
  maxPerHook: 10,
  maxNameLength: 80,
  inlineTimeoutMs: { default: 3000, max: 10000 },
  deferredTimeoutMs: { default: 15000, max: 60000 },
  maxChecks: 20,
  minCheckSeconds: 5,
  maxCheckSeconds: 7 * 24 * 3600,
  minEverySeconds: 30,
  maxAgeSeconds: 30 * 24 * 3600,
  maxStageAttempts: 10,
  maxInlineAttempts: 3,
  maxBackoffSeconds: 24 * 3600,
  maxOutputs: 30,
  maxInputs: 30,
  maxSensitivePaths: 50,
  maxBindings: 30,
};

const OUTPUT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/;
const QUERY_NAME = /^[A-Za-z0-9_.~-]{1,128}$/;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isInt = (value) => Number.isInteger(value);

function defaultOnError(hook, effect) {
  if (INLINE_HOOKS.has(hook)) return { action: effect === 'gate' ? 'fail_stage' : 'ignore' };
  return { action: 'retry_stage', maxAttempts: 3, backoffSeconds: [30, 120, 600] };
}

/** Is this integration one that can have stages at all? Returns a reason when not. */
function stagesNotSupported(integration = {}) {
  if (String(integration.direction || 'OUTBOUND').toUpperCase() !== 'OUTBOUND') {
    return 'Stages are available for outbound integrations only';
  }
  if (Array.isArray(integration.actions) && integration.actions.length > 0) {
    return 'Stages are not available for integrations with multiple actions';
  }
  return null;
}

function checkSchedule(schedule, path, add) {
  if (!isPlainObject(schedule))
    return add(path, 'A schedule is required: checkAfterSeconds, or everySeconds with maxAgeSeconds');
  if (schedule.checkAfterSeconds !== undefined) {
    const list = schedule.checkAfterSeconds;
    if (!Array.isArray(list) || list.length === 0 || list.length > LIMITS.maxChecks) {
      return add(`${path}.checkAfterSeconds`, `Give 1 to ${LIMITS.maxChecks} check times`);
    }
    list.forEach((value, index) => {
      if (!isInt(value) || value < LIMITS.minCheckSeconds || value > LIMITS.maxCheckSeconds) {
        add(
          `${path}.checkAfterSeconds[${index}]`,
          `Each check time is whole seconds from ${LIMITS.minCheckSeconds} to ${LIMITS.maxCheckSeconds}`
        );
      } else if (index > 0 && value <= list[index - 1]) {
        add(`${path}.checkAfterSeconds[${index}]`, 'Check times must increase');
      }
    });
    return undefined;
  }
  if (!isInt(schedule.everySeconds) || schedule.everySeconds < LIMITS.minEverySeconds) {
    return add(`${path}.everySeconds`, `Repeat at most every ${LIMITS.minEverySeconds} seconds`);
  }
  if (
    !isInt(schedule.maxAgeSeconds) ||
    schedule.maxAgeSeconds <= schedule.everySeconds ||
    schedule.maxAgeSeconds > LIMITS.maxAgeSeconds
  ) {
    return add(
      `${path}.maxAgeSeconds`,
      `A repeating check needs a maximum age above everySeconds, up to ${LIMITS.maxAgeSeconds} seconds`
    );
  }
  if (
    schedule.maxChecks !== undefined &&
    (!isInt(schedule.maxChecks) || schedule.maxChecks < 1 || schedule.maxChecks > 1000)
  ) {
    return add(`${path}.maxChecks`, 'maxChecks is a whole number from 1 to 1000');
  }
  return undefined;
}

function checkOnError(onError, hook, effect, path, add) {
  if (!isPlainObject(onError) || !ERROR_ACTIONS.includes(onError.action)) {
    return add(`${path}.action`, `onError.action is one of ${ERROR_ACTIONS.join(', ')}`);
  }
  if (onError.action !== 'retry_stage') return undefined;
  const inline = INLINE_HOOKS.has(hook);
  if (inline && effect === 'observe') {
    // An inline observer may not hold up the delivery; a retry would have to be deferred.
    return add(`${path}.action`, 'A stage that only observes inside the delivery cannot retry; use ignore');
  }
  const maxAttempts = inline ? LIMITS.maxInlineAttempts : LIMITS.maxStageAttempts;
  if (!isInt(onError.maxAttempts) || onError.maxAttempts < 2 || onError.maxAttempts > maxAttempts) {
    add(`${path}.maxAttempts`, `maxAttempts is 2 to ${maxAttempts}`);
  }
  if (inline && onError.backoffSeconds !== undefined) {
    add(`${path}.backoffSeconds`, 'Retries inside the delivery do not wait; remove backoffSeconds');
  }
  if (!inline) {
    const backoff = onError.backoffSeconds;
    if (
      !Array.isArray(backoff) ||
      backoff.length === 0 ||
      backoff.some((s) => !isInt(s) || s < 1 || s > LIMITS.maxBackoffSeconds)
    ) {
      add(`${path}.backoffSeconds`, `backoffSeconds is a list of waits in seconds (1 to ${LIMITS.maxBackoffSeconds})`);
    }
  }
  return undefined;
}

function checkOutputs(outputs, path, add) {
  if (outputs === undefined) return [];
  if (!Array.isArray(outputs) || outputs.length > LIMITS.maxOutputs) {
    add(path, `Up to ${LIMITS.maxOutputs} outputs`);
    return [];
  }
  const names = new Set();
  outputs.forEach((output, index) => {
    const at = `${path}[${index}]`;
    if (!isPlainObject(output) || !OUTPUT_NAME.test(String(output.name || '')))
      return add(`${at}.name`, 'Output names are letters, digits and _');
    if (names.has(output.name)) add(`${at}.name`, `Output ${output.name} is declared twice`);
    names.add(output.name);
    if (!OUTPUT_TYPES.includes(output.type)) add(`${at}.type`, `type is one of ${OUTPUT_TYPES.join(', ')}`);
    return undefined;
  });
  return outputs;
}

/** Where each stage's outputs can be read from: earlier hooks, or earlier in the same hook. */
function visibleOutputs(stages, index, outputsOf) {
  const me = stages[index];
  const visible = new Map();
  stages.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    const earlierHook = HOOK_ORDER[other.hook] < HOOK_ORDER[me.hook];
    const earlierInHook = other.hook === me.hook && otherIndex < index;
    // after_delivery and on_failure never both run for one attempt chain; neither sees the other.
    if (earlierHook || earlierInHook) visible.set(other.id, outputsOf(other));
  });
  return visible;
}

function checkReferences(template, visible, path, add) {
  let expressions;
  try {
    expressions = expressionsIn(template);
  } catch (error) {
    if (error instanceof BindingError) return add(path, error.message);
    throw error;
  }
  for (const expression of expressions) {
    if (expression.segments[0] !== 'stages') continue;
    const [, stageId, part, name] = expression.segments;
    if (!visible.has(stageId)) {
      add(path, `{{ ${expression.path} }} refers to ${stageId}, which does not run before this point`);
    } else if (part !== 'output' || !name) {
      add(path, `{{ ${expression.path} }}: use stages.${stageId}.output.<name>`);
    } else if (!visible.get(stageId).some((output) => output.name === name)) {
      add(path, `{{ ${expression.path} }}: ${stageId} has no output ${name}`);
    }
  }
  return undefined;
}

function checkTemplates(map, kind, nameRule, visible, path, add, max) {
  if (map === undefined) return;
  if (!isPlainObject(map) || Object.keys(map).length > max) {
    add(path, `${kind} is an object of up to ${max} entries`);
    return;
  }
  for (const [name, template] of Object.entries(map)) {
    if (nameRule && !nameRule.test(name)) add(`${path}.${name}`, `${name} is not a valid ${kind} name`);
    if (typeof template !== 'string') add(`${path}.${name}`, 'Each value is text, which may contain {{ }} expressions');
    else checkReferences(template, visible, `${path}.${name}`, add);
  }
}

function normalizeStage(stage) {
  const hook = stage.hook;
  const inline = INLINE_HOOKS.has(hook);
  const effect = stage.effect || (EFFECTS[hook] ? EFFECTS[hook][EFFECTS[hook].length - 1] : undefined);
  const timeouts = inline ? LIMITS.inlineTimeoutMs : LIMITS.deferredTimeoutMs;
  return {
    ...stage,
    name: typeof stage.name === 'string' ? stage.name.trim() : stage.name,
    enabled: stage.enabled !== false,
    effect,
    contract: stage.contract === undefined ? 1 : stage.contract,
    timeoutMs: stage.timeoutMs === undefined ? timeouts.default : stage.timeoutMs,
    onError: stage.onError === undefined ? defaultOnError(hook, effect) : stage.onError,
    recording: {
      level: (stage.recording && stage.recording.level) || 'full',
      sensitivePaths: (stage.recording && stage.recording.sensitivePaths) || [],
    },
    allowDeliveryRetry: stage.allowDeliveryRetry === true,
  };
}

/**
 * Validate `stages` (and `send`, the Send step's bindings) for `integration`.
 * `runners` is the runner registry ({ get(type) }).
 */
function validateStages(stages, { integration = {}, send, runners }) {
  const errors = [];
  const add = (path, message) => {
    errors.push({ path, message });
  };
  const list = stages === undefined || stages === null ? [] : stages;
  if (!Array.isArray(list))
    return { ok: false, errors: [{ path: 'stages', message: 'stages is a list' }], stages: [], send };

  const unsupported = stagesNotSupported(integration);
  if (unsupported && list.length > 0) add('stages', unsupported);
  if (list.length > LIMITS.maxStages) add('stages', `Up to ${LIMITS.maxStages} stages`);

  const normalized = list.map((stage) => (isPlainObject(stage) ? normalizeStage(stage) : stage));
  const ids = new Set();
  const perHook = {};

  normalized.forEach((stage, index) => {
    const at = `stages[${index}]`;
    if (!isPlainObject(stage)) return add(at, 'Each stage is an object');
    if (!STAGE_ID.test(String(stage.id || '')))
      add(`${at}.id`, 'A stage ID starts with a letter and has letters, digits, _ or - (up to 64)');
    else if (ids.has(stage.id)) add(`${at}.id`, `Stage ID ${stage.id} is used twice`);
    ids.add(stage.id);
    if (typeof stage.name !== 'string' || !stage.name || stage.name.length > LIMITS.maxNameLength) {
      add(`${at}.name`, `A name of 1 to ${LIMITS.maxNameLength} characters is required`);
    }
    if (!HOOKS.includes(stage.hook)) return add(`${at}.hook`, `hook is one of ${HOOKS.join(', ')}`);
    perHook[stage.hook] = (perHook[stage.hook] || 0) + 1;
    if (!EFFECTS[stage.hook].includes(stage.effect)) {
      add(`${at}.effect`, `At ${stage.hook} a stage can be: ${EFFECTS[stage.hook].join(' or ')}`);
    }
    if (!CONTRACTS.includes(stage.contract)) add(`${at}.contract`, 'Unknown contract version');

    const inline = INLINE_HOOKS.has(stage.hook);
    const timeouts = inline ? LIMITS.inlineTimeoutMs : LIMITS.deferredTimeoutMs;
    if (!isInt(stage.timeoutMs) || stage.timeoutMs < 100 || stage.timeoutMs > timeouts.max) {
      add(`${at}.timeoutMs`, `timeoutMs is 100 to ${timeouts.max} at ${stage.hook}`);
    }
    if (stage.hook === 'after_delivery') checkSchedule(stage.schedule, `${at}.schedule`, add);
    else if (stage.schedule !== undefined) add(`${at}.schedule`, `Only stages after delivery run on a schedule`);
    checkOnError(stage.onError, stage.hook, stage.effect, `${at}.onError`, add);
    if (stage.allowDeliveryRetry && !(inline && stage.effect === 'gate')) {
      add(`${at}.allowDeliveryRetry`, 'Only a gate inside the delivery can ask for the delivery to be retried');
    }

    const level = stage.recording.level;
    if (!RECORDING_LEVELS.includes(level))
      add(`${at}.recording.level`, `recording.level is one of ${RECORDING_LEVELS.join(', ')}`);
    const paths = stage.recording.sensitivePaths;
    if (
      !Array.isArray(paths) ||
      paths.length > LIMITS.maxSensitivePaths ||
      paths.some((p) => typeof p !== 'string' || !p.trim())
    ) {
      add(`${at}.recording.sensitivePaths`, `sensitivePaths is a list of up to ${LIMITS.maxSensitivePaths} paths`);
    }
    checkOutputs(stage.outputs, `${at}.outputs`, add);

    if (stage.auth !== undefined) {
      // Either an org credential, whose fields fill the headers ({{ credential.<field> }}),
      // or, explicitly, the integration's own outgoing auth. Only for allowedOrigins.
      const auth = stage.auth;
      const fromIntegration = isPlainObject(auth) && auth.source === 'integration';
      if (
        !isPlainObject(auth) ||
        (!fromIntegration && (typeof auth.credentialRef !== 'string' || !auth.credentialRef))
      ) {
        add(`${at}.auth.credentialRef`, 'auth needs a credentialRef, or source: integration');
      } else if (!fromIntegration) {
        const headers = auth.headers;
        if (!isPlainObject(headers) || Object.keys(headers).length === 0) {
          add(
            `${at}.auth.headers`,
            'auth.headers says where the credential goes, e.g. Authorization: Bearer {{ credential.token }}'
          );
        } else {
          for (const [name, template] of Object.entries(headers)) {
            if (!HEADER_NAME.test(name)) add(`${at}.auth.headers.${name}`, `${name} is not a valid header name`);
            if (typeof template !== 'string' || !/\{\{\s*credential\.[A-Za-z0-9_-]+\s*\}\}/.test(template)) {
              add(`${at}.auth.headers.${name}`, 'Each header uses a credential field: {{ credential.<field> }}');
            }
          }
        }
      }
      const origins = isPlainObject(auth) ? auth.allowedOrigins : undefined;
      if (!Array.isArray(origins) || origins.length === 0 || origins.some((origin) => !isOrigin(origin))) {
        add(`${at}.auth.allowedOrigins`, 'allowedOrigins lists origins like https://api.example.com');
      }
    }

    const runner = stage.runner;
    const module = isPlainObject(runner) && runners ? runners.get(runner.type) : null;
    if (!module) {
      add(`${at}.runner.type`, 'Unknown runner');
    } else {
      if (module.hooks && !module.hooks.includes(stage.hook))
        add(`${at}.runner.type`, `${runner.type} cannot run at ${stage.hook}`);
      if (module.internal && !String(stage.contract).startsWith('legacy:')) {
        add(`${at}.runner.type`, `${runner.type} is used only by migrated configurations`);
      }
      for (const problem of module.validate(runner.config || {}, stage))
        add(`${at}.runner.config${problem.path ? `.${problem.path}` : ''}`, problem.message);
    }
    return undefined;
  });

  for (const [hook, count] of Object.entries(perHook)) {
    if (count > LIMITS.maxPerHook) add('stages', `Up to ${LIMITS.maxPerHook} stages at ${hook}`);
  }

  // References between stages, in run order.
  const outputsOf = (stage) => {
    const module = runners && isPlainObject(stage.runner) ? runners.get(stage.runner.type) : null;
    const declared = module && module.outputs ? module.outputs(stage.runner.config || {}) : null;
    return declared || stage.outputs || [];
  };
  normalized.forEach((stage, index) => {
    if (!isPlainObject(stage) || !HOOKS.includes(stage.hook)) return;
    const visible = visibleOutputs(normalized, index, outputsOf);
    checkTemplates(stage.inputs, 'inputs', OUTPUT_NAME, visible, `stages[${index}].inputs`, add, LIMITS.maxInputs);
  });

  if (send !== undefined && send !== null) {
    const bindings = isPlainObject(send) ? send.bindings : undefined;
    const beforeSend = new Map(
      normalized
        .filter((stage) => isPlainObject(stage) && stage.hook === 'before_send')
        .map((stage) => [stage.id, outputsOf(stage)])
    );
    if (bindings !== undefined) {
      if (!isPlainObject(bindings)) add('send.bindings', 'send.bindings has headers and query');
      else {
        checkTemplates(
          bindings.headers,
          'header',
          HEADER_NAME,
          beforeSend,
          'send.bindings.headers',
          add,
          LIMITS.maxBindings
        );
        checkTemplates(
          bindings.query,
          'query parameter',
          QUERY_NAME,
          beforeSend,
          'send.bindings.query',
          add,
          LIMITS.maxBindings
        );
      }
    }
  }

  return { ok: errors.length === 0, errors, stages: normalized, send };
}

function isOrigin(value) {
  try {
    const url = new URL(String(value));
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === String(value).replace(/\/$/, '');
  } catch (_error) {
    return false;
  }
}

module.exports = {
  validateStages,
  normalizeStage,
  stagesNotSupported,
  HOOKS,
  INLINE_HOOKS,
  EFFECTS,
  LIMITS,
  CONTRACTS,
};
