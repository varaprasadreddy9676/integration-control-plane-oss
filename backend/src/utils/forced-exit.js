'use strict';

/**
 * Backstop for graceful shutdown. The drain stops every worker and then expects
 * the event loop to empty, but anything started while draining — e.g. a SIGTERM
 * that lands mid-bootstrap, after which bootstrap still schedules cron jobs —
 * keeps the process alive forever. This guarantees it exits. The timer is
 * unref'd, so a clean natural exit still wins when it happens first.
 *
 * @param {{ afterMs: number, exitCode: number, exit?: (code: number) => void }} options
 * @returns {NodeJS.Timeout}
 */
function armForcedExit({ afterMs, exitCode, exit = (code) => process.exit(code) }) {
  const timer = setTimeout(() => exit(exitCode), afterMs);
  if (typeof timer.unref === 'function') timer.unref();
  return timer;
}

module.exports = { armForcedExit };
