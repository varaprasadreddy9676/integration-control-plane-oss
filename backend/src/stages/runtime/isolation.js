'use strict';

/**
 * How stage runner processes are isolated by the operating system.
 *
 * Modes:
 *   host       Linux host where the backend runs as root.
 *              Each runner is started as
 *                unshare --net -- prlimit --data=N --nproc=P -- node child.js --uid=U --gid=G
 *              so it has its own empty network namespace (no network at all), an
 *              OS memory limit that also covers ArrayBuffers and native memory,
 *              and a process limit; child.js then drops to its slot's uid
 *              (setgroups, setgid, setuid) before it reads any input, so no script
 *              ever runs as root. Each runner has its own uid (see uids.js).
 *   sidecar    The backend cannot do the above (in Docker it runs as a non-root
 *              user without CAP_SYS_ADMIN), so runners are started by the
 *              stage-runner sidecar container and reached over its Unix socket.
 *   container  Used by the sidecar itself (sidecar.js): it runs as root in a
 *              container that has no network, so each runner is started as
 *                prlimit --data=N --nproc=P -- node child.js --uid=U --gid=G
 *   none       No isolation. Development only, and never accepted when isolation
 *              is required.
 *
 * Whatever the mode, the probe (probe.js) checks the result from inside a script
 * before stages are allowed to run.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parseUidRange } = require('./uids');

const TOOL_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];

// The flags each tool must support. BusyBox ships lookalike applets without them.
const REQUIRED_FLAGS = { unshare: ['--net'], prlimit: ['--data', '--nproc'] };

// Processes (threads count too) one runner uid may have: Node needs about a dozen.
const MAX_PROCESSES_PER_RUNNER = 64;

function defaultSupports(toolPath, flags) {
  try {
    const help = execFileSync(toolPath, ['--help'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
    return flags.every((flag) => help.includes(flag));
  } catch (error) {
    const text = `${(error.stdout || '').toString()}${(error.stderr || '').toString()}`;
    return flags.every((flag) => text.includes(flag));
  }
}

const defaultWhich = (tool) => {
  for (const dir of TOOL_DIRS) {
    const candidate = path.join(dir, tool);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
};

/**
 * Work out the isolation a mode can actually provide on this machine.
 * Resolves to { mode, ok, problems, uids, tools, socketPath }; `ok` false lists what is missing.
 * `runnerUids` is the uid range for runners ("61000-61031").
 */
function resolveIsolation({
  mode = 'none',
  runnerUids,
  socketPath,
  which = defaultWhich,
  supports = defaultSupports,
} = {}) {
  const problems = [];
  const tools = {};
  let uids = null;

  const needTools = (names) => {
    for (const tool of names) {
      tools[tool] = which(tool);
      if (!tools[tool]) problems.push(`${tool} is not installed (util-linux)`);
      else if (!supports(tools[tool], REQUIRED_FLAGS[tool])) {
        problems.push(`${tools[tool]} does not support ${REQUIRED_FLAGS[tool].join(' ')} (install util-linux's ${tool})`);
      }
    }
  };
  const needRootOnLinux = (what) => {
    if (process.platform !== 'linux') problems.push(`${what} needs Linux`);
    if (!(process.getuid && process.getuid() === 0)) problems.push(`${what} needs to run as root`);
  };
  const needUids = () => {
    uids = parseUidRange(runnerUids);
    if (!uids) problems.push('No valid runner uid range configured (STAGE_RUNNER_UIDS, e.g. 61000-61031)');
  };

  if (mode === 'none') {
    problems.push('Isolation is off');
  } else if (mode === 'host') {
    needRootOnLinux('Host isolation');
    needTools(['unshare', 'prlimit']);
    needUids();
  } else if (mode === 'container') {
    needRootOnLinux('The stage-runner sidecar');
    needTools(['prlimit']);
    needUids();
  } else if (mode === 'sidecar') {
    if (!socketPath) problems.push('No stage-runner socket configured (STAGE_RUNNER_SOCKET)');
    else if (!fs.existsSync(socketPath)) problems.push(`The stage-runner sidecar is not listening at ${socketPath}`);
  } else {
    problems.push(`Unknown isolation mode "${mode}"`);
  }

  return { mode, ok: problems.length === 0, problems, uids, tools, socketPath: mode === 'sidecar' ? socketPath : undefined };
}

/** The OS limit on a runner's private writable memory; V8's own heap limit trips first. */
function dataLimitMb(memoryMb) {
  return memoryMb * 3 + 256;
}

/**
 * The command that starts one runner process: `node` is [execPath, ...nodeArgs],
 * `account` the { uid, gid } the runner becomes (modes host and container).
 */
function buildLauncher(isolation, node, memoryMb, account) {
  const [execPath, ...nodeArgs] = node;
  const limits = [`--data=${dataLimitMb(memoryMb) * 1024 * 1024}`, `--nproc=${MAX_PROCESSES_PER_RUNNER}`];
  const mode = isolation && isolation.mode;

  if (mode === 'host' || mode === 'container') {
    if (!account) throw new Error('An isolated runner needs a uid');
    const runner = [isolation.tools.prlimit, ...limits, '--', ...node, `--uid=${account.uid}`, `--gid=${account.gid}`];
    return mode === 'host'
      ? { command: isolation.tools.unshare, args: ['--net', '--', ...runner] }
      : { command: runner[0], args: runner.slice(1) };
  }
  return { command: execPath, args: nodeArgs };
}

module.exports = { resolveIsolation, buildLauncher, dataLimitMb };
