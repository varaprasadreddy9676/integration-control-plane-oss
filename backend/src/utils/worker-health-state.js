'use strict';

function getWorkerHealthState(worker) {
  if (!worker) {
    return {
      enabled: true,
      state: 'unknown',
      available: false,
      hardFailure: true,
      degraded: false,
    };
  }

  if (worker.enabled === false) {
    return {
      enabled: false,
      state: 'disabled',
      available: true,
      hardFailure: false,
      degraded: false,
    };
  }

  const state = worker.status || (worker.alive ? 'healthy' : worker.running ? 'stale' : 'stopped');

  return {
    enabled: true,
    state,
    available: worker.available !== undefined ? Boolean(worker.available) : state !== 'stopped',
    hardFailure: state === 'stopped' || state === 'unknown',
    // 'starting' is bounded by the startup grace period (it turns 'stale' if
    // no heartbeat arrives), so it is not a degradation: every restart used to
    // report 'warning' until the worker's first run.
    degraded: state === 'stale',
  };
}

module.exports = { getWorkerHealthState };
