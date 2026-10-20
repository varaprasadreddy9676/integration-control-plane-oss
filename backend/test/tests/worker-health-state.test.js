'use strict';

const { getWorkerHealthState } = require('../../src/utils/worker-health-state');

describe('getWorkerHealthState', () => {
  it('does not report a worker that is still starting as degraded', () => {
    expect(getWorkerHealthState({ enabled: true, status: 'starting' })).toMatchObject({
      state: 'starting',
      degraded: false,
      hardFailure: false,
    });
  });

  it('reports a stale worker as degraded', () => {
    expect(getWorkerHealthState({ enabled: true, status: 'stale' }).degraded).toBe(true);
  });

  it('reports a stopped or missing worker as a hard failure', () => {
    expect(getWorkerHealthState({ enabled: true, status: 'stopped' }).hardFailure).toBe(true);
    expect(getWorkerHealthState(undefined).hardFailure).toBe(true);
  });
});
