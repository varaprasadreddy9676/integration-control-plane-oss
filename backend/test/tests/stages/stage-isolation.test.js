'use strict';

/**
 * OS isolation of stage runner processes. The launcher, slot and sidecar
 * transport tests run everywhere; the boundary tests need Linux with root and
 * util-linux (unshare, prlimit), so they run only when STAGE_ISOLATION_TESTS=1
 * (CI runs them in a container).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildLauncher, resolveIsolation } = require('../../../src/stages/runtime/isolation');
const { createRuntimePool } = require('../../../src/stages/runtime/pool');
const { probeIsolation, classifyMemory } = require('../../../src/stages/runtime/probe');
const { parseUidRange, createUidSlots } = require('../../../src/stages/runtime/uids');
const { createSidecar } = require('../../../src/stages/runtime/sidecar');

jest.setTimeout(60000);

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('buildLauncher', () => {
  const node = ['/usr/bin/node', '--max-old-space-size=128', '/app/child.js'];
  const limits = [`--data=${(128 * 3 + 256) * 1024 * 1024}`, '--nproc=64'];
  const tools = { unshare: '/usr/bin/unshare', prlimit: '/usr/bin/prlimit' };

  it('runs node directly when there is no isolation', () => {
    expect(buildLauncher({ mode: 'none' }, node, 128)).toEqual({ command: '/usr/bin/node', args: node.slice(1) });
  });

  it('on a host, wraps node in a new network namespace and OS limits, and tells it which uid to become', () => {
    expect(buildLauncher({ mode: 'host', tools }, node, 128, { uid: 61003, gid: 61000 })).toEqual({
      command: '/usr/bin/unshare',
      args: ['--net', '--', '/usr/bin/prlimit', ...limits, '--', ...node, '--uid=61003', '--gid=61000'],
    });
  });

  it('inside the sidecar container (already without network), adds the limits and the uid only', () => {
    expect(buildLauncher({ mode: 'container', tools }, node, 128, { uid: 61001, gid: 61000 })).toEqual({
      command: '/usr/bin/prlimit',
      args: [...limits, '--', ...node, '--uid=61001', '--gid=61000'],
    });
  });

  it('refuses to start an isolated runner without a uid', () => {
    expect(() => buildLauncher({ mode: 'host', tools }, node, 128)).toThrow(/uid/);
  });
});

describe('runner uid slots', () => {
  it('parses a uid range and rejects nonsense, including root', () => {
    expect(parseUidRange('61000-61031')).toEqual({ first: 61000, count: 32 });
    expect(parseUidRange(' 61000 - 61000 ')).toEqual({ first: 61000, count: 1 });
    for (const bad of [undefined, '', '0-10', '61031-61000', 'abc', '61000']) expect(parseUidRange(bad)).toBeNull();
  });

  it('never hands out a uid twice, and only gives one back after it was reaped', async () => {
    const reaped = [];
    let finishReap;
    const reap = (uid) =>
      new Promise((resolve) => {
        reaped.push(uid);
        finishReap = resolve;
      });
    const slots = createUidSlots({ first: 100, count: 2, reap });
    expect([slots.acquire(), slots.acquire(), slots.acquire()]).toEqual([100, 101, null]);

    const released = slots.release(100);
    expect(reaped).toEqual([100]);
    expect(slots.acquire()).toBeNull(); // still being reaped
    finishReap();
    await released;
    expect(slots.acquire()).toBe(100);
  });
});

describe('the memory check', () => {
  it('counts only a real allocation failure or out-of-memory kill as capped', () => {
    expect(classifyMemory({ outcome: 'ok', value: 'allocated 24' })).toBe('uncapped');
    expect(classifyMemory({ outcome: 'error', error: 'Array buffer allocation failed' })).toBe('capped');
    expect(classifyMemory({ outcome: 'error', errorCode: 'OUT_OF_MEMORY', error: 'ran out of memory' })).toBe('capped');
  });

  it('does not count an unrelated failure as capped, so a broken probe cannot pass', () => {
    expect(classifyMemory({ outcome: 'error', error: 'Buffer is not defined' })).toBe('unknown');
    expect(classifyMemory({ outcome: 'timeout', error: 'did not finish' })).toBe('unknown');
    expect(classifyMemory({ outcome: 'error', errorCode: 'CRASHED', error: 'crashed (signal SIGKILL)' })).toBe('unknown');
    // A runner that could not even start must not pass, whatever its message says.
    expect(classifyMemory({ outcome: 'error', errorCode: 'UNAVAILABLE', error: 'connect: out of memory' })).toBe('unknown');
  });

  it('reports memory as uncapped and the file as readable when nothing isolates the runner', async () => {
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

  it('does not accept a protected file that does not exist as proof', async () => {
    const pool = createRuntimePool({ size: 1, memoryMb: 32, isolation: { required: false } });
    try {
      const report = await probeIsolation(pool, { protectedFile: '/nonexistent/.env', memoryMb: 32 });
      expect(report.checks.protectedFile).toBe('missing');
      expect(report.problems.join(' ')).toMatch(/does not exist/);
    } finally {
      pool.close();
    }
  });
});

describe('resolveIsolation', () => {
  it('needs a uid range and both tools for host mode, and says what is missing', () => {
    const resolved = resolveIsolation({ mode: 'host', runnerUids: 'nope', which: () => null });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/STAGE_RUNNER_UIDS/);
    expect(resolved.problems.join(' ')).toMatch(/unshare/);
  });

  it('rejects a lookalike tool that lacks the needed flags (BusyBox applets)', () => {
    const resolved = resolveIsolation({
      mode: 'host',
      runnerUids: '61000-61003',
      which: (tool) => `/bin/${tool}`,
      supports: (toolPath) => !toolPath.endsWith('unshare'),
    });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/unshare does not support --net/);
  });

  it('sidecar mode needs the sidecar socket to exist', () => {
    const resolved = resolveIsolation({ mode: 'sidecar', socketPath: '/nonexistent/runner.sock' });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/not listening/);
    expect(resolveIsolation({ mode: 'sidecar', socketPath: __filename })).toMatchObject({ ok: true, socketPath: __filename });
  });

  it('the sidecar itself needs prlimit and a uid range', () => {
    const resolved = resolveIsolation({ mode: 'container', which: () => null });
    expect(resolved.ok).toBe(false);
    expect(resolved.problems.join(' ')).toMatch(/prlimit/);
    expect(resolved.problems.join(' ')).toMatch(/STAGE_RUNNER_UIDS/);
  });

  it('mode none is never isolated', () => {
    expect(resolveIsolation({ mode: 'none' }).ok).toBe(false);
  });
});

describe('runners reached through the sidecar socket', () => {
  // Without root the sidecar cannot change uids, so this runs it in mode none:
  // what is tested here is the transport, not the boundary.
  let sidecar;
  let pool;
  const socketPath = path.join('/tmp', `stage-sidecar-${process.pid}.sock`);

  beforeAll(async () => {
    const slots = createUidSlots({ first: 1, count: 2, reap: () => Promise.resolve() });
    sidecar = createSidecar({ socketPath, isolation: { mode: 'none' }, clientUid: process.getuid(), slots });
    await sidecar.listen();
    pool = createRuntimePool({
      size: 2,
      memoryMb: 64,
      isolation: { mode: 'sidecar', ok: true, socketPath, required: true },
    });
  });
  afterAll(() => {
    pool.close();
    sidecar.close();
  });

  it('only the backend user can open the socket', () => {
    const stat = fs.statSync(socketPath);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.uid).toBe(process.getuid());
  });

  it('runs a stage and its helper calls like a local runner', async () => {
    const out = await pool.run({
      code: 'const r = await http.get({ url: "x" }); log("got", r.status); return { doubled: input.n * 2, status: r.status };',
      globals: { input: { n: 21 } },
      helpers: { http: async () => ({ status: 200 }) },
      timeoutMs: 5000,
    });
    expect(out).toMatchObject({ outcome: 'ok', value: { doubled: 42, status: 200 } });
    expect(out.logs[0].message).toMatch(/got 200/);
  });

  it('kills the runner at the deadline and keeps working', async () => {
    const out = await pool.run({ code: 'while (true) {}', globals: {}, helpers: {}, timeoutMs: 300 });
    expect(out.outcome).toBe('timeout');
    const next = await pool.run({ code: 'return 1;', globals: {}, helpers: {}, timeoutMs: 5000 });
    expect(next).toMatchObject({ outcome: 'ok', value: 1 });
  });

  it('reports a runner that dies as a failed run', async () => {
    const out = await pool.run({
      code: 'this.constructor.constructor("return process")().exit(3);',
      globals: {},
      helpers: {},
      timeoutMs: 5000,
    });
    expect(out).toMatchObject({ outcome: 'error', errorCode: 'CRASHED' });
    expect(out.error).toMatch(/exit code 3/);
  });

  it('a pool that cannot reach the sidecar fails runs instead of hanging', async () => {
    const lost = createRuntimePool({
      size: 1,
      isolation: { mode: 'sidecar', ok: true, socketPath: '/tmp/no-such-stage-sidecar.sock', required: true },
    });
    try {
      const out = await lost.run({ code: 'return 1;', globals: {}, helpers: {}, timeoutMs: 2000 });
      expect(out).toMatchObject({ outcome: 'error', errorCode: 'UNAVAILABLE' });
      expect(out.error).toMatch(/sidecar/i);
    } finally {
      lost.close();
    }
  });
});

const linuxRoot = process.platform === 'linux' && process.getuid && process.getuid() === 0;
const runBoundary = process.env.STAGE_ISOLATION_TESTS === '1' && linuxRoot;
const describeBoundary = runBoundary ? describe : describe.skip;

const ESCAPE = 'const p = this.constructor.constructor("return process")(); const req = p.mainModule.require;';

describeBoundary('the boundary, from inside an escaped script (Linux, root)', () => {
  let secretFile;

  beforeAll(() => {
    secretFile = path.join(os.tmpdir(), `stage-secret-${process.pid}`);
    fs.writeFileSync(secretFile, 'MONGODB_URI=mongodb://secret', { mode: 0o600 });
  });
  afterAll(() => fs.rmSync(secretFile, { force: true }));

  describe('host mode', () => {
    let pool;
    beforeAll(() => {
      const isolation = resolveIsolation({ mode: 'host', runnerUids: '61000-61003' });
      if (!isolation.ok) throw new Error(`Isolation not available: ${isolation.problems.join('; ')}`);
      pool = createRuntimePool({ size: 2, memoryMb: 64, maxRunsPerProcess: 1, isolation: { ...isolation, required: true } });
    });
    afterAll(() => pool.close());

    it('the probe reports every check as enforced', async () => {
      const report = await probeIsolation(pool, { protectedFile: secretFile, memoryMb: 64 });
      expect(report).toMatchObject({
        ok: true,
        checks: { network: 'blocked', user: 'unprivileged', protectedFile: 'unreadable', memory: 'capped' },
      });
    });

    it('a script that escapes still cannot open a connection', async () => {
      const out = await pool.run({
        code: `${ESCAPE}
          return await new Promise((resolve) => {
            const s = req("net").connect({ host: "1.1.1.1", port: 53 });
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

    it('two runners run as different uids, and one cannot signal or trace the other', async () => {
      const pidFile = path.join('/tmp', `stage-peer-${process.pid}`);
      const holder = pool.run({
        code: `${ESCAPE} req("fs").writeFileSync(${JSON.stringify(pidFile)}, String(p.pid)); await new Promise((r) => setTimeout(r, 1500)); return p.getuid();`,
        globals: {},
        helpers: {},
        timeoutMs: 5000,
      });
      await wait(500);
      const intruder = await pool.run({
        code: `${ESCAPE}
          const peer = Number(req("fs").readFileSync(${JSON.stringify(pidFile)}, "utf8"));
          let signal = "sent"; try { p.kill(peer, 0); } catch (e) { signal = e.code; }
          let mem = "read"; try { req("fs").readFileSync("/proc/" + peer + "/environ"); } catch (e) { mem = e.code; }
          return { uid: p.getuid(), signal, mem };`,
        globals: {},
        helpers: {},
        timeoutMs: 5000,
      });
      const first = await holder;
      fs.rmSync(pidFile, { force: true });
      expect(first.outcome).toBe('ok');
      expect(intruder.value.uid).not.toBe(first.value);
      expect(intruder.value.signal).toBe('EPERM');
      expect(intruder.value.mem).toBe('EACCES');
    });

    it('a process left behind by a script is killed before its uid is reused', async () => {
      const out = await pool.run({
        code: `${ESCAPE} const c = req("child_process").spawn("sleep", ["60"], { detached: true, stdio: "ignore" }); c.unref(); return c.pid;`,
        globals: {},
        helpers: {},
        timeoutMs: 5000,
      });
      expect(out.outcome).toBe('ok');
      // maxRunsPerProcess 1: the runner is recycled now and its uid reaped.
      let alive = true;
      for (let i = 0; i < 40 && alive; i += 1) {
        await wait(100);
        try {
          process.kill(out.value, 0);
        } catch (_error) {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    });
  });

  describe('sidecar mode (the sidecar running in this process as root)', () => {
    let sidecar;
    let pool;
    const socketPath = path.join('/tmp', `stage-sidecar-root-${process.pid}.sock`);

    beforeAll(async () => {
      const isolation = resolveIsolation({ mode: 'container', runnerUids: '61010-61011' });
      if (!isolation.ok) throw new Error(`Sidecar isolation not available: ${isolation.problems.join('; ')}`);
      sidecar = createSidecar({ socketPath, isolation, clientUid: 0 });
      await sidecar.listen();
      pool = createRuntimePool({
        size: 1,
        memoryMb: 64,
        isolation: { ...resolveIsolation({ mode: 'sidecar', socketPath }), required: true },
      });
    });
    afterAll(() => {
      pool.close();
      sidecar.close();
    });

    it('runners are unprivileged, cannot read protected files, and are memory capped', async () => {
      const report = await probeIsolation(pool, { protectedFile: secretFile, memoryMb: 64 });
      // No network is the container's job (network_mode: none), not the sidecar's.
      expect(report.checks).toMatchObject({ user: 'unprivileged', protectedFile: 'unreadable', memory: 'capped' });
    });
  });
});
