'use strict';
/**
 * Node Process Script Job Runner
 *
 * Runs a user-authored script as a real, unrestricted Node.js child process —
 * not the VM sandbox used by regular Script Jobs. This is a deliberate
 * capability upgrade: scripts here can require() any installed npm package,
 * use fs/child_process/network freely, and behave like a normal Node.js
 * program. There is no code-level sandboxing.
 *
 * What IS enforced, because this runs on a server shared by every org:
 *   - Process isolation — a crash, infinite loop, or leak in one script kills
 *     only its own child process, not the gateway.
 *   - A wall-clock timeout (SIGKILL after jobConfig.timeoutMs).
 *   - A heap size ceiling (--max-old-space-size on the forked process).
 *   - A minimal environment — the child does NOT inherit the gateway's own
 *     .env. It only gets the job's declared secrets/connection credentials
 *     plus PATH/NODE_ENV, so a script can't harvest other orgs' or the
 *     platform's credentials from process.env.
 *   - npm install runs with --ignore-scripts to block postinstall supply
 *     chain attacks, and is capped by a small concurrency queue.
 *
 * Logging: the child's stdout/stderr are captured line-by-line and stored in
 * the same { level, message, ts } shape the VM-sandboxed Script Job runner
 * already produces, so both runtimes render in the same execution log UI.
 */

const fs = require('fs');
const path = require('path');
const { fork } = require('child_process');
const { log } = require('../logger');
const { resolveProfile } = require('./connection-profiles');
const { getSecret } = require('./gateway-secrets');

const JOBS_ROOT = path.join(__dirname, '../../node-script-jobs');
const MAX_CAPTURED_LOG_LINES = 2000;
const MAX_LOG_LINE_LENGTH = 4000;
const DEFAULT_MEMORY_LIMIT_MB = 512;
const DEFAULT_TIMEOUT_MS = 120000;
const NPM_INSTALL_TIMEOUT_MS = 180000;

function getJobDir(jobId) {
  return path.join(JOBS_ROOT, String(jobId));
}

// npm normally lives next to the node binary, but the gateway is started with an
// absolute node path (not via a login shell), so it doesn't inherit nvm's PATH
// entry — plain 'npm' would fail with ENOENT. Resolve it relative to the node
// binary that's actually running, falling back to PATH lookup otherwise.
function resolveNpmBin() {
  const candidate = path.join(path.dirname(process.execPath), 'npm');
  return fs.existsSync(candidate) ? candidate : 'npm';
}

function ensureJobDir(jobId) {
  const dir = getJobDir(jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ── Simple concurrency-limited queue (no extra dependency) ─────────────────
function createQueue(concurrency) {
  let active = 0;
  const pending = [];

  const runNext = () => {
    if (active >= concurrency || pending.length === 0) return;
    active += 1;
    const { fn, resolve, reject } = pending.shift();
    fn()
      .then(resolve, reject)
      .finally(() => {
        active -= 1;
        runNext();
      });
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      pending.push({ fn, resolve, reject });
      runNext();
    });
}

const enqueueInstall = createQueue(2);
const enqueueExecution = createQueue(5);

// ── Dependency management ───────────────────────────────────────────────────
function normalizeDependencies(dependencies) {
  if (!Array.isArray(dependencies)) return {};
  const deps = {};
  for (const entry of dependencies) {
    const name = String(entry?.name || '').trim();
    if (!name || !/^(@[a-z0-9-][\w.-]*\/)?[a-z0-9][\w.-]*$/i.test(name)) continue;
    const version = String(entry?.version || 'latest').trim() || 'latest';
    deps[name] = version;
  }
  return deps;
}

function writeJobFiles(jobConfig) {
  const dir = ensureJobDir(jobConfig._id);
  const dependencies = normalizeDependencies(jobConfig.dependencies);

  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: `node-script-job-${jobConfig._id}`, private: true, version: '1.0.0', dependencies }, null, 2)
  );
  fs.writeFileSync(path.join(dir, 'script.js'), jobConfig.script || '// empty script');

  return dir;
}

function runCommandCaptured(command, args, options) {
  return new Promise((resolve) => {
    const { spawn } = require('child_process');
    // npm's own bin script is `#!/usr/bin/env node`, which resolves via PATH — on
    // servers where the gateway itself is launched with an absolute node binary
    // (not through a login shell), PATH can point at a much older system node that
    // can't even parse npm's CLI. Put the actual running node's bin dir first.
    const nodeBinDir = path.dirname(process.execPath);
    const env = { ...process.env, PATH: `${nodeBinDir}:${process.env.PATH || ''}` };
    const child = spawn(command, args, { ...options, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, options.timeoutMs || NPM_INSTALL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, exitCode: code, output: output.slice(-20000) });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, exitCode: null, output: `${output}\n${err.message}`.slice(-20000) });
    });
  });
}

/**
 * Installs a job's declared npm dependencies into its own isolated directory.
 * Safe to call repeatedly — npm install is idempotent and queued so at most
 * two installs run at once across the whole server.
 */
async function installDependencies(jobConfig) {
  return enqueueInstall(async () => {
    const dir = writeJobFiles(jobConfig);
    log('info', 'Installing Node Script Job dependencies', { jobId: jobConfig._id.toString(), dir });

    const result = await runCommandCaptured(
      resolveNpmBin(),
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'],
      { cwd: dir, timeoutMs: NPM_INSTALL_TIMEOUT_MS }
    );

    log(result.success ? 'info' : 'warn', 'Node Script Job dependency install finished', {
      jobId: jobConfig._id.toString(),
      success: result.success,
    });

    return result;
  });
}

// ── Environment resolution ──────────────────────────────────────────────────
async function resolveEnvironmentVariables(jobConfig, orgId) {
  const env = {};

  const rows = Array.isArray(jobConfig.environmentVariables) ? jobConfig.environmentVariables : [];
  for (const row of rows) {
    const key = String(row?.key || '').trim();
    if (!key) continue;
    if (Object.hasOwn(row, 'value') && row.value !== undefined && row.value !== null) {
      env[key] = String(row.value);
      continue;
    }
    if (!row.secretKey) continue;
    const value = await getSecret(row.secretKey, orgId);
    if (value !== null) env[key] = value;
  }

  const connections = jobConfig.connections || {};
  for (const [alias, profileId] of Object.entries(connections)) {
    if (!profileId) continue;
    try {
      const profile = await resolveProfile(profileId, orgId);
      const prefix = alias.toUpperCase().replace(/[^A-Z0-9]/g, '_');
      const cfg = profile.config || {};
      if (cfg.host) env[`${prefix}_HOST`] = String(cfg.host);
      if (cfg.port) env[`${prefix}_PORT`] = String(cfg.port);
      if (cfg.user) env[`${prefix}_USER`] = String(cfg.user);
      if (cfg.password) env[`${prefix}_PASSWORD`] = String(cfg.password);
      if (cfg.database) env[`${prefix}_DATABASE`] = String(cfg.database);
      if (cfg.connectionString) env[`${prefix}_CONNECTION_STRING`] = String(cfg.connectionString);
    } catch (err) {
      log('warn', `Node Script Job: failed to resolve connection profile '${profileId}' (alias: ${alias})`, {
        error: err.message,
      });
    }
  }

  return env;
}

// ── Execution ────────────────────────────────────────────────────────────────
function pushLogLine(scriptLogs, level, raw) {
  const text = String(raw);
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    if (scriptLogs.length >= MAX_CAPTURED_LOG_LINES) return;
    scriptLogs.push({
      level,
      message: line.length > MAX_LOG_LINE_LENGTH ? `${line.slice(0, MAX_LOG_LINE_LENGTH)}…[truncated]` : line,
      ts: new Date().toISOString(),
    });
  }
}

/**
 * Runs a Node Script Job's script.js as an isolated child process.
 * Returns { status: 'SUCCESS'|'FAILED'|'TIMEOUT', scriptLogs, error, exitCode }
 */
async function runNodeScriptJob(jobConfig) {
  return enqueueExecution(async () => {
    const dir = writeJobFiles(jobConfig);
    const env = await resolveEnvironmentVariables(jobConfig, jobConfig.orgId);
    const timeoutMs = jobConfig.timeoutMs || DEFAULT_TIMEOUT_MS;
    const memoryLimitMb = jobConfig.memoryLimitMb || DEFAULT_MEMORY_LIMIT_MB;
    const scriptLogs = [];

    return new Promise((resolve) => {
      let settled = false;
      let timedOut = false;

      const child = fork(path.join(dir, 'script.js'), [], {
        cwd: dir,
        env: { ...env, PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV || 'production' },
        execArgv: [`--max-old-space-size=${memoryLimitMb}`],
        silent: true,
      });

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.stdout?.on('data', (chunk) => pushLogLine(scriptLogs, 'info', chunk));
      child.stderr?.on('data', (chunk) => pushLogLine(scriptLogs, 'error', chunk));

      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ...result, scriptLogs });
      };

      child.on('error', (err) => {
        finish({ status: 'FAILED', error: err.message, exitCode: null });
      });

      child.on('exit', (code, signal) => {
        if (timedOut) {
          finish({ status: 'TIMEOUT', error: `Script timed out after ${timeoutMs}ms and was killed`, exitCode: code });
          return;
        }
        if (code === 0) {
          finish({ status: 'SUCCESS', error: null, exitCode: code });
        } else {
          finish({
            status: 'FAILED',
            error: signal ? `Script terminated by signal ${signal}` : `Script exited with code ${code}`,
            exitCode: code,
          });
        }
      });
    });
  });
}

/**
 * Sanity-checks that a job's declared dependencies actually load under the Node
 * binary that will run the job (process.execPath — the same binary the gateway
 * itself runs on). npm install succeeding is not enough: a package can install
 * cleanly and still fail at require() time on an older Node/glibc (e.g. a
 * transitive dependency using the `node:`-prefixed core-module syntax, which
 * needs Node >=14.18). Catching that here, at save/install time, means a bad
 * dependency shows up as a clear per-package error in the UI instead of as a
 * silent cron failure at 6am.
 */
async function validateDependencies(jobConfig) {
  const dependencies = normalizeDependencies(jobConfig.dependencies);
  const names = Object.keys(dependencies);
  const nodeVersion = process.version;

  if (names.length === 0) {
    return { success: true, nodeVersion, results: [] };
  }

  const dir = getJobDir(jobConfig._id);
  const probePath = path.join(dir, '__validate_deps.js');
  const probeScript = [
    `const names = ${JSON.stringify(names)};`,
    'const results = names.map((name) => {',
    '  try {',
    '    require(name);',
    '    return { name, ok: true, error: null };',
    '  } catch (err) {',
    '    return { name, ok: false, error: err.message };',
    '  }',
    '});',
    'process.stdout.write(JSON.stringify(results));',
  ].join('\n');

  fs.writeFileSync(probePath, probeScript);
  try {
    const result = await runCommandCaptured(process.execPath, [probePath], { cwd: dir, timeoutMs: 30000 });
    let results;
    try {
      results = JSON.parse(result.output);
    } catch {
      results = names.map((name) => ({
        name,
        ok: false,
        error: result.output.slice(-500) || 'Validation probe crashed',
      }));
    }
    return { success: result.success && results.every((r) => r.ok), nodeVersion, results };
  } finally {
    fs.unlink(probePath, () => {});
  }
}

module.exports = {
  getJobDir,
  writeJobFiles,
  installDependencies,
  validateDependencies,
  runNodeScriptJob,
  normalizeDependencies,
};
