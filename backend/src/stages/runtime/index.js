'use strict';

/**
 * The stage runtime of this backend process. At startup it resolves the
 * configured isolation (config.stages, see isolation.js) and proves it from
 * inside a runner with the probe; the pool is handed out only when every check
 * holds. With isolation off, stage scripts run only when allowUnisolated says so
 * (development), and the runtime reports that it is not isolated.
 */

const fs = require('fs');
const path = require('path');
const { resolveIsolation } = require('./isolation');
const { createRuntimePool } = require('./pool');
const { probeIsolation } = require('./probe');

let runtime = null;

// A file the backend can read and runners must not: its own secrets when they
// are on disk, otherwise a root-only system file. In sidecar mode the runner
// sees the sidecar's file system, where only the system file exists.
function defaultProtectedFile(mode) {
  const candidates =
    mode === 'sidecar'
      ? ['/etc/shadow']
      : [path.join(__dirname, '..', '..', '..', '.env'), path.join(__dirname, '..', '..', '..', 'config.json'), '/etc/shadow'];
  return candidates.find((file) => fs.existsSync(file)) || '/etc/shadow';
}

/**
 * Start (or restart) the runtime. Resolves to the state getStageRuntime() returns:
 * { ready, mode, isolated, checks, problems, pool }.
 */
async function startStageRuntime(options = {}) {
  const {
    isolation: mode = 'none',
    runnerUids,
    runnerSocket,
    allowUnisolated = false,
    protectedFile,
    poolSize = 4,
    memoryMb = 128,
  } = options;
  stopStageRuntime();

  if (mode === 'none') {
    runtime = allowUnisolated
      ? {
          ready: true,
          mode,
          isolated: false,
          checks: null,
          problems: ['Stage scripts run without OS isolation (development only)'],
          pool: createRuntimePool({ size: poolSize, memoryMb, isolation: { required: false } }),
        }
      : {
          ready: false,
          mode,
          isolated: false,
          checks: null,
          problems: ['Stage isolation is off (STAGE_ISOLATION) and unisolated stages are not allowed'],
          pool: null,
        };
    return runtime;
  }

  const isolation = resolveIsolation({ mode, runnerUids, socketPath: runnerSocket });
  if (!isolation.ok) {
    runtime = { ready: false, mode, isolated: false, checks: null, problems: isolation.problems, pool: null };
    return runtime;
  }

  const pool = createRuntimePool({ size: poolSize, memoryMb, isolation: { ...isolation, required: true } });
  const report = await probeIsolation(pool, { protectedFile: protectedFile || defaultProtectedFile(mode), memoryMb });
  if (!report.ok) pool.close();
  runtime = {
    ready: report.ok,
    mode,
    isolated: report.ok,
    checks: report.checks,
    problems: report.problems,
    pool: report.ok ? pool : null,
  };
  return runtime;
}

function getStageRuntime() {
  return (
    runtime || { ready: false, mode: null, isolated: false, checks: null, problems: ['The stage runtime has not started'], pool: null }
  );
}

function stopStageRuntime() {
  if (runtime && runtime.pool) runtime.pool.close();
  runtime = null;
}

module.exports = { startStageRuntime, getStageRuntime, stopStageRuntime, defaultProtectedFile };
