'use strict';

/**
 * OS isolation of stage runner processes. The launcher tests run everywhere; the
 * boundary tests need Linux with root and util-linux (unshare, prlimit, setpriv),
 * so they run only when STAGE_ISOLATION_TESTS=1 (CI runs them in a container).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLauncher, resolveIsolation } = require('../../../src/stages/runtime/isolation');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');
const { probeIsolation, classifyMemory } = require('../../../src/stages/runtime/probe');

jest.setTimeout(60000);

describe('buildLauncher', () => {
  const node = ['/usr/bin/node', '--max-old-space-size=128', '/app/child.js'];

  it('runs node directly when there is no isolation', () => {
    expect(buildLauncher({ mode: 'none' }, node, 128)).toEqual({ command: '/usr/bin/node', args: node.slice(1) });
  });

  it('on a host, wraps node in a new network namespace and a memory limit, and tells it which user to become', () => {
    const launcher = buildLauncher(
      { mode: 'host', user: { uid: 990, gid: 991 }, tools: { unshare: '/usr/bin/unshare', prlimit: '/usr/bin/prlimit' } },
      node,
      128
    );
    expect(launcher.command).toBe('/usr/bin/unshare');
    expect(launcher.args).toEqual([
      '--net',
      '--',
      '/usr/bin/prlimit',
      `--data=${(128 * 3 + 256) * 1024 * 1024}`,
      '--',
      ...node,
      '--uid=990',
      '--gid=991',
    ]);
  });

  it('inside the sidecar container (already without network), adds the memory limit only', () => {
    const launcher = buildLauncher({ mode: 'container', tools: { prlimit: '/usr/bin/prlimit' } }, node, 128);
    expect(launcher.command).toBe('/usr/bin/prlimit');
    expect(launcher.args.slice(-3)).toEqual(node);
  });
});

describe('the memory check', () => {
  it('counts only a real allocation failure or out-of-memory kill as capped', () => {
    expect(classifyMemory({ outcome: 'ok', value: 'allocated 24' })).toBe('uncapped');
    expect(classifyMemory({ outcome: 'error', error: 'Array buffer allocation failed' })).toBe('capped');
    expect(classifyMemory({ outcome: 'error', error: 'The stage ran out of memory and was stopped' })).toBe('capped');
    expect(classifyMemory({ outcome: 'error', error: 'The stage runner crashed or exited (signal SIGKILL)' })).toBe('capped');
  });

  it('does not count an unrelated failure as capped, so a broken probe cannot pass', () => {
    expect(classifyMemory({ outcome: 'error', error: 'Buffer is not defined' })).toBe('unknown');
    expect(classifyMemory({ outcome: 'timeout', error: 'did not finish' })).toBe('unknown');
  });

  it('reports memory as uncapped when nothing limits it (no isolation)', async () => {
    const pool = createRuntimePool({ size: 1, memoryMb: 32, isolation: { required: false } });
    try {
      const report = await probeIsolation(pool, { protectedFile: __filename, memoryMb: 32 });
      expect(report.ok).toBe(false);
      expect(report.checks.memory).toBe('uncapped');
      expect(report.checks.protectedFile).toBe('readable');
    } finally {
      pool.close();
    }
  });
});

describe('resolveIsolation', () => {
  it('needs a runner user and all three tools for host mode, and says what is missing', () => {
    const resolved = resolveIsolation({ mode: 'host', userName: 'no-such-user-xyz', which: () => null });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/no-such-user-xyz/);
    expect(resolved.problems.join(' ')).toMatch(/unshare/);
  });

  it('rejects a lookalike tool that lacks the needed flags (BusyBox applets)', () => {
    const resolved = resolveIsolation({
      mode: 'host',
      userName: 'svc',
      which: (tool) => `/bin/${tool}`,
      lookupUser: () => ({ uid: 990, gid: 990 }),
      supports: (toolPath) => !toolPath.endsWith('unshare'),
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/unshare does not support --net/);
  });

  it('mode none is never isolated', () => {
    expect(resolveIsolation({ mode: 'none' }).ok).toBe(false);
  });
});

const linuxRoot = process.platform === 'linux' && process.getuid && process.getuid() === 0;
const runBoundary = process.env.STAGE_ISOLATION_TESTS === '1' && linuxRoot;
const describeBoundary = runBoundary ? describe : describe.skip;

describeBoundary('the boundary, from inside an escaped script (Linux, root)', () => {
  let pool;
  let secretFile;

  beforeAll(() => {
    const isolation = resolveIsolation({ mode: 'host', userName: process.env.STAGE_RUNNER_USER || 'nobody' });
    if (!isolation.ok) throw new Error(`Isolation not available: ${isolation.problems.join('; ')}`);
    secretFile = path.join(os.tmpdir(), `stage-secret-${process.pid}`);
    fs.writeFileSync(secretFile, 'MONGODB_URI=mongodb://secret', { mode: 0o600 });
    pool = createRuntimePool({ size: 1, memoryMb: 64, isolation: { ...isolation, required: true } });
  });
  afterAll(() => {
    pool.close();
    fs.rmSync(secretFile, { force: true });
  });

  it('the probe reports every check as enforced', async () => {
    const report = await probeIsolation(pool, { protectedFile: secretFile, memoryMb: 64 });
    expect(report).toMatchObject({
      ok: true,
      checks: { network: 'blocked', user: 'unprivileged', protectedFile: 'unreadable', memory: 'capped' },
    });
  });

  it('a script that escapes still cannot open a connection', async () => {
    const out = await pool.run({
      code: `
        const p = this.constructor.constructor("return process")();
        const net = p.mainModule.require("net");
        return await new Promise((resolve) => {
          const s = net.connect({ host: "1.1.1.1", port: 53 });
          s.on("connect", () => resolve("connected"));
          s.on("error", (e) => resolve(e.code));
          setTimeout(() => resolve("timeout"), 1500);
        });`,
      globals: {},
      helpers: {},
      timeoutMs: 5000,
    });
    expect(out.value).not.toBe('connected');
  });
});
