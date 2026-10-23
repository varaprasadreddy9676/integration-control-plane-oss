'use strict';

/**
 * The stage runtime: scripts run in separate child processes that talk to the
 * parent only over a JSON line protocol. These tests cover the protocol and the
 * process lifecycle without OS isolation (that part is probed and tested
 * separately, on Linux).
 */

const { createRuntimePool } = require('../../../src/stages/runtime/pool');

jest.setTimeout(30000);

let pool;
const helpers = {
  http: async ({ method, url }) => ({ status: 200, body: `${method} ${url}` }),
  lookup: async ({ value, type }) => `${type}:${value}`,
};

beforeAll(() => {
  pool = createRuntimePool({ size: 2, maxRunsPerProcess: 50, memoryMb: 64, isolation: { required: false } });
});
afterAll(() => pool.close());

const run = (code, extra = {}) => pool.run({ code, globals: {}, helpers, timeoutMs: 3000, ...extra });

describe('stage runtime pool', () => {
  it('runs a script and returns its value', async () => {
    const out = await run('return { status: "DELIVERED", n: 1 + 1 };');
    expect(out).toMatchObject({ outcome: 'ok', value: { status: 'DELIVERED', n: 2 } });
    expect(out.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('gives the script its inputs as read-only copies', async () => {
    const globals = { delivery: { response: { data: [{ id: 'm1' }] } } };
    const out = await run('delivery.response.data[0].id = "changed"; return delivery.response.data[0].id;', { globals });
    expect(out.outcome).toBe('error');
    expect(out.error).toMatch(/read.only|Cannot assign/i);
    expect(globals.delivery.response.data[0].id).toBe('m1');
  });

  it('lets the script await http and lookup, served by the parent', async () => {
    const out = await run(`
      const res = await http.get('https://p.example/v1/m?id=1');
      const code = await lookup('A1', 'COUNTRY');
      return { body: res.body, code };
    `);
    expect(out).toMatchObject({ outcome: 'ok', value: { body: 'GET https://p.example/v1/m?id=1', code: 'COUNTRY:A1' } });
  });

  it('reports a helper failure to the script as a normal error it can catch', async () => {
    const failing = { ...helpers, http: async () => { throw Object.assign(new Error('blocked'), { code: 'DESTINATION_BLOCKED' }); } };
    const out = await run(`
      try { await http.get('http://10.0.0.1/'); return 'no'; }
      catch (e) { return e.message + '|' + e.code; }
    `, { helpers: failing });
    expect(out).toMatchObject({ outcome: 'ok', value: 'blocked|DESTINATION_BLOCKED' });
  });

  it('only exposes the helpers the run is given', async () => {
    const out = await run('return typeof lookup;', { helpers: { http: helpers.http } });
    expect(out.value).toBe('undefined');
  });

  it('turns skip() into a skipped outcome with the reason', async () => {
    const out = await run('return skip("No message id");');
    expect(out).toMatchObject({ outcome: 'skipped', reason: 'No message id' });
  });

  it('reports a thrown error', async () => {
    const out = await run('throw new Error("bad response")');
    expect(out).toMatchObject({ outcome: 'error', error: expect.stringContaining('bad response') });
  });

  it('reports a syntax error', async () => {
    const out = await run('return {');
    expect(out.outcome).toBe('error');
  });

  it('collects log() and console output instead of letting it reach the protocol', async () => {
    const out = await run('log("a", { b: 1 }); console.log("c"); console.error("d"); return 1;');
    expect(out.outcome).toBe('ok');
    expect(out.logs.map((l) => l.message)).toEqual(['a {"b":1}', 'c', 'd']);
  });

  it('stops a script at its deadline, and the pool keeps working', async () => {
    const slow = await run('await new Promise(() => {}); return 1;', { timeoutMs: 300 });
    expect(slow).toMatchObject({ outcome: 'timeout' });
    const busy = await run('for (;;) {}', { timeoutMs: 300 });
    expect(busy).toMatchObject({ outcome: 'timeout' });
    expect((await run('return "still fine";')).value).toBe('still fine');
  });

  it('cancels the parent-side http call of a script that times out', async () => {
    let aborted = false;
    const hanging = {
      http: (_args, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new Error('aborted'));
          });
        }),
    };
    const out = await run('return await http.get("https://slow.example/");', { helpers: hanging, timeoutMs: 300 });
    expect(out.outcome).toBe('timeout');
    expect(aborted).toBe(true);
  });

  it('survives a script that exhausts memory: that run fails, the next one works', async () => {
    const out = await run('const a = []; for (;;) a.push(new Array(1e6).fill(1));', { timeoutMs: 15000 });
    expect(out.outcome).toBe('error');
    expect(out.error).toMatch(/memory|crashed|exited/i);
    expect((await run('return 42;')).value).toBe(42);
  });

  it('kills a process whose output breaks the protocol', async () => {
    // Escape the vm context to the process and write garbage to stdout.
    const out = await run('const p = this.constructor.constructor("return process")(); p.stdout.write("not json\\n"); return 1;');
    expect(out.outcome).toBe('error');
    expect(out.error).toMatch(/protocol/i);
    expect((await run('return "recovered";')).value).toBe('recovered');
  });

  it('gives an escaped script none of the parent environment, so there are no secrets to read', async () => {
    process.env.STAGE_TEST_SECRET = 'do-not-leak';
    try {
      const fresh = createRuntimePool({ size: 1, isolation: { required: false } });
      const out = await fresh.run({
        code: 'const p = this.constructor.constructor("return process")(); return p.env;',
        globals: {},
        helpers: {},
        timeoutMs: 3000,
      });
      fresh.close();
      expect(JSON.stringify(out.value)).not.toContain('do-not-leak');
      // macOS adds __CF_USER_TEXT_ENCODING to every process; nothing else may appear.
      expect(Object.keys(out.value).filter((key) => key !== '__CF_USER_TEXT_ENCODING')).toEqual([]);
    } finally {
      delete process.env.STAGE_TEST_SECRET;
    }
  });

  it('gives the script timers that are cleared when the run ends', async () => {
    const out = await run('let n = 0; const t = setInterval(() => n++, 10); await new Promise(r => setTimeout(r, 60)); clearInterval(t); return n > 0;');
    expect(out).toMatchObject({ outcome: 'ok', value: true });
  });

  it('runs scripts in parallel up to the pool size and queues the rest', async () => {
    const started = Date.now();
    const runs = await Promise.all([1, 2, 3, 4].map(() => run('await new Promise(r => setTimeout(r, 300)); return 1;')));
    expect(runs.every((r) => r.outcome === 'ok')).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(550); // 4 runs, 2 at a time
  });

  it('fails a run that waits too long for a free process instead of blocking', async () => {
    const small = createRuntimePool({ size: 1, maxQueueWaitMs: 100, isolation: { required: false } });
    try {
      const first = small.run({ code: 'await new Promise(r => setTimeout(r, 800)); return 1;', globals: {}, helpers: {}, timeoutMs: 3000 });
      const second = await small.run({ code: 'return 2;', globals: {}, helpers: {}, timeoutMs: 3000 });
      expect(second).toMatchObject({ outcome: 'error', error: expect.stringMatching(/busy/i) });
      expect((await first).value).toBe(1);
    } finally {
      small.close();
    }
  });

  it('starts a fresh process after the configured number of runs', async () => {
    const recycling = createRuntimePool({ size: 1, maxRunsPerProcess: 2, isolation: { required: false } });
    try {
      const pids = [];
      for (let i = 0; i < 4; i++) {
        const out = await recycling.run({ code: 'return this.constructor.constructor("return process")().pid;', globals: {}, helpers: {}, timeoutMs: 3000 });
        pids.push(out.value);
      }
      expect(pids[0]).toBe(pids[1]);
      expect(pids[2]).not.toBe(pids[1]);
    } finally {
      recycling.close();
    }
  });

  it('refuses to run when isolation is required but not available', async () => {
    const strict = createRuntimePool({ size: 1, isolation: { required: true, user: null, prlimit: null } });
    try {
      const out = await strict.run({ code: 'return 1;', globals: {}, helpers: {}, timeoutMs: 1000 });
      expect(out).toMatchObject({ outcome: 'error', error: expect.stringMatching(/not isolated/i) });
    } finally {
      strict.close();
    }
  });
});
