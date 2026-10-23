'use strict';

/**
 * A stage runner process. It runs one stage script at a time and talks to the
 * parent only through newline-delimited JSON on stdin/stdout:
 *
 *   parent -> child  { type: 'run', id, code, globals, helpers, timeoutMs }
 *                    { type: 'reply', callId, ok, value | error }
 *   child -> parent  { type: 'call', id, callId, helper, args }
 *                    { type: 'result', id, outcome, value | reason | error, logs }
 *                    (outcome: ok, skipped, failed (the script called fail()), error)
 *
 * The script runs in a fresh `vm` context per run, in strict mode, with frozen
 * copies of its inputs. That context is defence in depth, not the boundary: a
 * script can escape it, so the process itself is started with an empty
 * environment, and on hosts that support it as an unprivileged user with an OS
 * memory limit and no network (see pool.js and isolation.js).
 */

const vm = require('vm');
const readline = require('readline');

// Drop to the runner user before reading any input, so no script runs as root.
// setgroups/setgid/setuid are irreversible for this process.
(() => {
  const value = (name) => {
    const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? Number(hit.slice(name.length + 3)) : null;
  };
  const uid = value('uid');
  const gid = value('gid');
  if (uid === null && gid === null) return;
  try {
    process.setgroups([]);
    process.setgid(gid);
    process.setuid(uid);
  } catch (_error) {
    process.exit(77);
  }
  if (process.getuid() !== uid || process.getgid() !== gid || process.getuid() === 0) process.exit(77);
})();

const MAX_LOGS = 200;
const MAX_LOG_CHARS = 2000;

let current = null; // { id, pending: Map<callId, {resolve, reject}>, logs }
let callSeq = 0;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

const describe = (value) => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_error) {
    return String(value);
  }
};

function callHelper(helper, args) {
  const run = current;
  if (!run) return Promise.reject(new Error('No stage is running'));
  callSeq += 1;
  const callId = callSeq;
  return new Promise((resolve, reject) => {
    run.pending.set(callId, { resolve, reject });
    send({ type: 'call', id: run.id, callId, helper, args });
  });
}

function buildHelpers(names, logs) {
  const sandbox = {};
  const log = (level) => (...args) => {
    if (logs.length >= MAX_LOGS) return;
    logs.push({ level, message: args.map(describe).join(' ').slice(0, MAX_LOG_CHARS), at: new Date().toISOString() });
  };
  sandbox.log = log('info');
  sandbox.console = { log: log('info'), info: log('info'), debug: log('info'), warn: log('warn'), error: log('error') };
  sandbox.skip = (reason) => ({ __stageSkip: true, reason: reason === undefined || reason === null ? '' : String(reason) });
  // A deliberate failure: `return fail('why', { retryStage, retryDelivery })`.
  sandbox.fail = (message, options) => ({
    __stageFail: true,
    message: message === undefined || message === null ? '' : String(message),
    retryStage: Boolean(options && options.retryStage),
    retryDelivery: Boolean(options && options.retryDelivery),
  });

  // Timers the run owns; whatever is still pending when it finishes is cleared.
  const timers = new Set();
  const track = (create, clear) => [
    (fn, ms, ...args) => {
      const handle = create(() => {
        if (create === setTimeout) timers.delete(handle);
        fn(...args);
      }, ms);
      timers.add(handle);
      return handle;
    },
    (handle) => {
      timers.delete(handle);
      clear(handle);
    },
  ];
  [sandbox.setTimeout, sandbox.clearTimeout] = track(setTimeout, clearTimeout);
  [sandbox.setInterval, sandbox.clearInterval] = track(setInterval, clearInterval);
  sandbox.__clearTimers = () => {
    for (const handle of timers) {
      clearTimeout(handle);
      clearInterval(handle);
    }
    timers.clear();
  };

  for (const name of names) {
    if (name === 'http') {
      const call = (method) => (url, bodyOrOptions, maybeOptions) => {
        const hasBody = method !== 'GET' && method !== 'DELETE';
        return callHelper('http', {
          method,
          url,
          body: hasBody ? bodyOrOptions : undefined,
          options: (hasBody ? maybeOptions : bodyOrOptions) || {},
        });
      };
      sandbox.http = { get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), delete: call('DELETE') };
    } else if (name === 'lookup') {
      sandbox.lookup = (value, type) => callHelper('lookup', { value, type });
    } else {
      sandbox[name] = (...args) => callHelper(name, { args });
    }
  }
  return sandbox;
}

async function runScript(message) {
  const logs = [];
  current = { id: message.id, pending: new Map(), logs };
  let clearRunTimers = () => {};
  const finish = (result) => {
    clearRunTimers();
    const run = current;
    current = null;
    if (run) for (const pending of run.pending.values()) pending.reject(new Error('The stage finished'));
    send({ type: 'result', id: message.id, logs, ...result });
  };

  try {
    const globals = deepFreeze(message.globals || {});
    const helpers = buildHelpers(message.helpers || [], logs);
    clearRunTimers = helpers.__clearTimers;
    delete helpers.__clearTimers;
    const sandbox = { ...globals, ...helpers };
    const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const script = new vm.Script(`(async () => { 'use strict';\n${message.code}\n})()`, { filename: 'stage.js' });
    const raw = await script.runInContext(context, { timeout: message.timeoutMs || 5000 });

    if (raw && raw.__stageSkip === true) return finish({ outcome: 'skipped', reason: raw.reason });
    if (raw && raw.__stageFail === true) {
      return finish({ outcome: 'failed', error: raw.message.slice(0, 1000), retryStage: raw.retryStage, retryDelivery: raw.retryDelivery });
    }
    let value;
    try {
      value = raw === undefined ? null : JSON.parse(JSON.stringify(raw));
    } catch (_error) {
      return finish({ outcome: 'error', error: 'The stage returned a value that cannot be stored as JSON' });
    }
    return finish({ outcome: 'ok', value });
  } catch (error) {
    const text = error && error.message ? error.message : String(error);
    return finish({ outcome: 'error', error: text.slice(0, 1000) });
  }
}

const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch (_error) {
    process.exit(70); // the parent never sends anything else
  }
  if (message.type === 'run') {
    runScript(message);
  } else if (message.type === 'reply' && current) {
    const pending = current.pending.get(message.callId);
    if (!pending) return;
    current.pending.delete(message.callId);
    if (message.ok) pending.resolve(message.value);
    else pending.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
  }
});
lines.on('close', () => process.exit(0));
