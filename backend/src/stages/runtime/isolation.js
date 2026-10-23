'use strict';

/**
 * How stage runner processes are isolated by the operating system.
 *
 * Modes:
 *   host       Linux host where the backend runs as root.
 *              Each runner is started as
 *                unshare --net -- prlimit --data=N -- node child.js --uid=U --gid=G
 *              so it has its own empty network namespace (no network at all) and
 *              an OS memory limit that also covers ArrayBuffers and native memory;
 *              child.js then drops to the unprivileged user (setgroups, setgid,
 *              setuid) before it reads any input, so no script ever runs as root.
 *   container  Inside the stage-runner sidecar container, which already has no
 *              network and runs as a non-root user; only the memory limit is added.
 *   none       No isolation. Development only, and never accepted when isolation
 *              is required.
 *
 * Whatever the mode, the probe (probe.js) checks the result from inside a script
 * before stages are allowed to run.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const TOOL_DIRS = ['/usr/bin', '/bin', '/usr/sbin', '/sbin', '/usr/local/bin'];

// The flags each tool must support. BusyBox ships lookalike applets without them.
const REQUIRED_FLAGS = { unshare: ['--net'], prlimit: ['--data'] };

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

function defaultLookupUser(name) {
  try {
    const uid = Number(execFileSync('id', ['-u', name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    const gid = Number(execFileSync('id', ['-g', name], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim());
    return Number.isInteger(uid) && Number.isInteger(gid) ? { uid, gid } : null;
  } catch (_error) {
    return null;
  }
}

/**
 * Work out the isolation a mode can actually provide on this machine.
 * Resolves to { mode, ok, problems, user, tools }; `ok` false lists what is missing.
 */
function resolveIsolation({
  mode = 'none',
  userName,
  which = defaultWhich,
  lookupUser = defaultLookupUser,
  supports = defaultSupports,
} = {}) {
  const problems = [];
  const tools = {};
  let user = null;

  if (mode === 'none') {
    return { mode, ok: false, problems: ['Isolation is off'], user, tools };
  }

  if (mode === 'host') {
    if (process.platform !== 'linux') problems.push('Host isolation needs Linux');
    if (!(process.getuid && process.getuid() === 0)) problems.push('Host isolation needs the backend to run as root');
    for (const tool of ['unshare', 'prlimit']) {
      tools[tool] = which(tool);
      if (!tools[tool]) problems.push(`${tool} is not installed (util-linux)`);
      else if (!supports(tools[tool], REQUIRED_FLAGS[tool])) {
        problems.push(`${tools[tool]} does not support ${REQUIRED_FLAGS[tool].join(' ')} (install util-linux's ${tool})`);
      }
    }
    if (!userName) {
      problems.push('No runner user configured (STAGE_RUNNER_USER)');
    } else {
      user = lookupUser(userName);
      if (!user) problems.push(`Runner user "${userName}" does not exist`);
      else if (user.uid === 0) problems.push(`Runner user "${userName}" must not be root`);
    }
  } else if (mode === 'container') {
    tools.prlimit = which('prlimit');
    if (!tools.prlimit) problems.push('prlimit is not installed (util-linux)');
    else if (!supports(tools.prlimit, REQUIRED_FLAGS.prlimit)) problems.push(`${tools.prlimit} does not support --data`);
  } else {
    problems.push(`Unknown isolation mode "${mode}"`);
  }

  return { mode, ok: problems.length === 0, problems, user, tools };
}

/** The OS limit on a runner's private writable memory; V8's own heap limit trips first. */
function dataLimitMb(memoryMb) {
  return memoryMb * 3 + 256;
}

/** The command that starts one runner process: `node` is [execPath, ...nodeArgs]. */
function buildLauncher(isolation, node, memoryMb) {
  const [execPath, ...nodeArgs] = node;
  const dataLimit = `--data=${dataLimitMb(memoryMb) * 1024 * 1024}`;

  if (isolation && isolation.mode === 'host') {
    const { unshare, prlimit } = isolation.tools;
    return {
      command: unshare,
      args: ['--net', '--', prlimit, dataLimit, '--', ...node, `--uid=${isolation.user.uid}`, `--gid=${isolation.user.gid}`],
    };
  }
  if (isolation && isolation.mode === 'container' && isolation.tools && isolation.tools.prlimit) {
    return { command: isolation.tools.prlimit, args: [dataLimit, '--', ...node] };
  }
  return { command: execPath, args: nodeArgs };
}

module.exports = { resolveIsolation, buildLauncher, dataLimitMb };
