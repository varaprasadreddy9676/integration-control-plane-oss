'use strict';

/**
 * A bounded pool of stage runner processes (child.js).
 *
 * - Each process runs one stage at a time. A run that cannot get a process
 *   within `maxQueueWaitMs` fails ("busy"); a stage never blocks a delivery.
 * - The parent enforces the deadline: at the deadline the process is killed and
 *   replaced, and the run's in-flight helper calls (http) are cancelled.
 * - A process that crashes, runs out of memory, or writes anything that is not a
 *   protocol message is killed; only its current run fails.
 * - Processes are replaced after `maxRunsPerProcess` runs.
 * - Processes start with an empty environment. With a resolved isolation (see
 *   isolation.js) they also run without network, under an OS memory limit, as an
 *   unprivileged user. When isolation is required but not available, runs are refused.
 */

const path = require('path');
const os = require('os');
const readline = require('readline');
const { spawn } = require('child_process');
const { AbortController } = require('../../utils/runtime');
const { buildLauncher } = require('./isolation');

const CHILD = path.join(__dirname, 'child.js');
const STDERR_TAIL = 2000;

function createRuntimePool({
  size = 4,
  maxRunsPerProcess = 200,
  memoryMb = 128,
  maxQueueWaitMs = 2000,
  isolation = { required: false },
} = {}) {
  const processes = new Set();
  const queue = [];
  let runSeq = 0;
  let closed = false;

  // `isolation` comes from resolveIsolation(); only a fully resolved mode counts.
  const isolated = isolation.ok === true && isolation.mode !== 'none';

  function spawnProcess() {
    const { command, args } = buildLauncher(
      isolated ? isolation : { mode: 'none' },
      [process.execPath, `--max-old-space-size=${memoryMb}`, CHILD],
      memoryMb
    );
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: {}, cwd: os.tmpdir() });
    const proc = { child, run: null, runs: 0, stderr: '', dead: false };
    processes.add(proc);

    readline.createInterface({ input: child.stdout }).on('line', (line) => onLine(proc, line));
    child.stderr.on('data', (chunk) => {
      proc.stderr = (proc.stderr + chunk.toString()).slice(-STDERR_TAIL);
    });
    child.on('exit', (code, signal) => onExit(proc, code, signal));
    child.on('error', (error) => onExit(proc, null, null, error));
    child.stdin.on('error', () => {}); // a dying child closes its stdin; the exit handler reports it
    return proc;
  }

  function kill(proc) {
    if (proc.dead) return;
    proc.dead = true;
    processes.delete(proc);
    try {
      proc.child.kill('SIGKILL');
    } catch (_error) {
      // already gone
    }
  }

  function finishRun(proc, result) {
    const run = proc.run;
    if (!run) return;
    proc.run = null;
    clearTimeout(run.timer);
    for (const controller of run.controllers) controller.abort();
    run.resolve({ logs: [], ...result, durationMs: Date.now() - run.startedAt });
    if (!proc.dead) {
      proc.runs += 1;
      if (proc.runs >= maxRunsPerProcess) kill(proc);
    }
    pump();
  }

  function reply(proc, run, message) {
    if (proc.run !== run || proc.dead) return; // the run is over; drop late answers
    proc.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  function onLine(proc, line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch (_error) {
      message = null;
    }
    const run = proc.run;
    if (!message || !run || message.id !== run.id) {
      // Something other than the protocol reached stdout: the script escaped its context.
      kill(proc);
      if (run) finishRun(proc, { outcome: 'error', error: 'The stage broke the runner protocol and was stopped' });
      return;
    }
    if (message.type === 'result') {
      const { type, id, ...result } = message;
      finishRun(proc, result);
    } else if (message.type === 'call') {
      const helper = run.helpers[message.helper];
      if (typeof helper !== 'function') {
        reply(proc, run, { type: 'reply', callId: message.callId, ok: false, error: { message: `${message.helper} is not available` } });
        return;
      }
      const controller = new AbortController();
      run.controllers.add(controller);
      Promise.resolve()
        .then(() => helper(message.args || {}, { signal: controller.signal }))
        .then(
          (value) => reply(proc, run, { type: 'reply', callId: message.callId, ok: true, value: value === undefined ? null : value }),
          (error) =>
            reply(proc, run, {
              type: 'reply',
              callId: message.callId,
              ok: false,
              error: { message: String((error && error.message) || error), code: error && error.code },
            })
        )
        .finally(() => run.controllers.delete(controller));
    }
  }

  function onExit(proc, code, signal, error) {
    const run = proc.run;
    proc.dead = true;
    processes.delete(proc);
    if (run && !run.timedOut) {
      const how = error ? error.message : signal ? `signal ${signal}` : `exit code ${code}`;
      const memory = /heap out of memory|allocation failed|Cannot allocate/i.test(proc.stderr);
      finishRun(proc, {
        outcome: 'error',
        error: memory
          ? 'The stage ran out of memory and was stopped'
          : `The stage runner crashed or exited (${how})`,
      });
    }
    pump();
  }

  function start(proc, run) {
    proc.run = run;
    run.timer = setTimeout(() => {
      run.timedOut = true;
      kill(proc);
      finishRun(proc, { outcome: 'timeout', error: `The stage did not finish within ${run.timeoutMs} ms` });
    }, run.timeoutMs);
    proc.child.stdin.write(
      `${JSON.stringify({
        type: 'run',
        id: run.id,
        code: run.code,
        globals: run.globals,
        helpers: Object.keys(run.helpers),
        timeoutMs: run.timeoutMs,
      })}\n`
    );
  }

  function pump() {
    while (queue.length > 0 && !closed) {
      let proc = [...processes].find((candidate) => !candidate.run && !candidate.dead);
      if (!proc && processes.size < size) proc = spawnProcess();
      if (!proc) return;
      const run = queue.shift();
      clearTimeout(run.queueTimer);
      start(proc, run);
    }
  }

  /**
   * Run a stage script. Resolves (never rejects) to
   * { outcome: 'ok' | 'skipped' | 'error' | 'timeout', value?, reason?, error?, logs, durationMs }.
   * `helpers` maps a helper name (http, lookup...) to an async function (args, { signal }).
   */
  function run({ code, globals = {}, helpers = {}, timeoutMs = 5000 }) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      if (closed) return resolve({ outcome: 'error', error: 'The stage runtime is shut down', logs: [], durationMs: 0 });
      if (isolation.required && !isolated) {
        return resolve({
          outcome: 'error',
          error: `The stage runtime is not isolated on this host${
            isolation.problems && isolation.problems.length ? `: ${isolation.problems.join('; ')}` : ''
          }`,
          logs: [],
          durationMs: 0,
        });
      }
      runSeq += 1;
      const entry = {
        id: runSeq,
        code,
        globals,
        helpers,
        timeoutMs,
        startedAt,
        controllers: new Set(),
        resolve,
      };
      entry.queueTimer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index === -1) return;
        queue.splice(index, 1);
        resolve({ outcome: 'error', error: 'All stage runners are busy; try again later', logs: [], durationMs: Date.now() - startedAt });
      }, maxQueueWaitMs);
      queue.push(entry);
      pump();
    });
  }

  function close() {
    closed = true;
    for (const proc of [...processes]) {
      if (proc.run) finishRun(proc, { outcome: 'error', error: 'The stage runtime is shut down' });
      kill(proc);
    }
    for (const entry of queue.splice(0)) {
      clearTimeout(entry.queueTimer);
      entry.resolve({ outcome: 'error', error: 'The stage runtime is shut down', logs: [], durationMs: 0 });
    }
  }

  return { run, close, isolated };
}

module.exports = { createRuntimePool };
