'use strict';

/**
 * Startup gate of the stage runtime: stages get a pool only when isolation is
 * proven, or when isolation is off and explicitly allowed (development).
 */

const path = require('path');
const { startStageRuntime, getStageRuntime, stopStageRuntime, defaultProtectedFile } = require('../../../src/stages/runtime');
const { createSidecar } = require('../../../src/stages/runtime/sidecar');
const { createUidSlots } = require('../../../src/stages/runtime/uids');

jest.setTimeout(60000);

afterEach(() => stopStageRuntime());

describe('stage runtime startup', () => {
  it('is not ready before it starts', () => {
    expect(getStageRuntime()).toMatchObject({ ready: false, pool: null, problems: [expect.stringMatching(/not started/)] });
  });

  it('with isolation off, refuses stages unless unisolated stages are allowed', async () => {
    const refused = await startStageRuntime({ isolation: 'none', allowUnisolated: false });
    expect(refused).toMatchObject({ ready: false, isolated: false, pool: null });

    const allowed = await startStageRuntime({ isolation: 'none', allowUnisolated: true, poolSize: 1, memoryMb: 32 });
    expect(allowed).toMatchObject({ ready: true, isolated: false });
    const out = await allowed.pool.run({ code: 'return 7;', globals: {}, helpers: {}, timeoutMs: 5000 });
    expect(out.value).toBe(7);
  });

  it('reports what is missing when the configured isolation is not available', async () => {
    const state = await startStageRuntime({ isolation: 'sidecar', runnerSocket: '/nonexistent/runner.sock' });
    expect(state).toMatchObject({ ready: false, pool: null });
    expect(state.problems.join(' ')).toMatch(/not listening/);
  });

  it('refuses stages when the probe finds the runners are not really isolated', async () => {
    // A sidecar that does not isolate (mode none): the socket is there, the boundary is not.
    const socketPath = path.join('/tmp', `stage-startup-${process.pid}.sock`);
    const sidecar = createSidecar({
      socketPath,
      isolation: { mode: 'none' },
      clientUid: process.getuid(),
      slots: createUidSlots({ first: 1, count: 2, reap: () => Promise.resolve() }),
    });
    await sidecar.listen();
    try {
      const state = await startStageRuntime({
        isolation: 'sidecar',
        runnerSocket: socketPath,
        protectedFile: __filename,
        poolSize: 1,
        memoryMb: 32,
      });
      expect(state).toMatchObject({ ready: false, isolated: false, pool: null });
      expect(state.checks).toMatchObject({ protectedFile: 'readable', memory: 'uncapped' });
    } finally {
      sidecar.close();
    }
  });

  it('tests a root-only file in the sidecar, where the backend files do not exist', () => {
    expect(defaultProtectedFile('sidecar')).toBe('/etc/shadow');
  });
});
