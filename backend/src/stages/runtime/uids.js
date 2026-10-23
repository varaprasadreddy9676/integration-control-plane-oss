'use strict';

/**
 * Runner slots: each runner process runs as its own uid from a configured range
 * (STAGE_RUNNER_UIDS, e.g. "61000-61031"; the uids need no passwd entries and
 * must own no files). Two runners never share a uid, so a script that escapes
 * cannot trace, read the memory of, or signal another org's runner. Before a uid
 * is given to the next runner, everything still running under it is killed, so
 * a process left behind by one script cannot wait for the next.
 */

const { spawn } = require('child_process');

/** "61000-61031" -> { first: 61000, count: 32 }; null when invalid. */
function parseUidRange(text) {
  const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(text || ''));
  if (!match) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (first <= 0 || last < first || last > 4294967294) return null;
  return { first, count: last - first + 1 };
}

/** Kill every process running as `uid` (kill(-1) from a process with that uid spares only itself). */
function reapUid(uid, gid) {
  return new Promise((resolve) => {
    const reaper = spawn(process.execPath, ['-e', 'try { process.kill(-1, "SIGKILL"); } catch (e) {}'], {
      uid,
      gid,
      env: {},
      stdio: 'ignore',
    });
    reaper.on('exit', () => resolve());
    reaper.on('error', () => resolve());
  });
}

function createUidSlots({ first, count, gid = first, reap = reapUid }) {
  const free = Array.from({ length: count }, (_value, index) => first + index);

  return {
    gid,
    size: count,
    /** A free uid, or null when every slot is in use or still being reaped. */
    acquire() {
      return free.length > 0 ? free.shift() : null;
    },
    /** Give a uid back once nothing runs under it any more. */
    release(uid) {
      return reap(uid, gid).then(() => {
        free.push(uid);
      });
    },
    /** Clear what a previous backend or sidecar may have left running. */
    reapAll() {
      return Promise.all(free.map((uid) => reap(uid, gid)));
    },
  };
}

module.exports = { parseUidRange, createUidSlots, reapUid };
