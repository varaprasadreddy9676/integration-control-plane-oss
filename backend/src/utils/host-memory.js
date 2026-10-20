'use strict';

const fs = require('fs');
const os = require('os');

const kbToMB = (kb) => Math.round(kb / 1024);

/** Parse /proc/meminfo. Returns null when MemAvailable is not reported. */
function parseMeminfo(text) {
  const read = (name) => {
    const match = new RegExp(`^${name}:\\s+(\\d+) kB`, 'm').exec(text);
    return match ? Number(match[1]) : null;
  };
  const available = read('MemAvailable');
  if (available === null) return null;
  const swapTotal = read('SwapTotal') || 0;
  const swapFree = read('SwapFree') || 0;
  return {
    availableMB: kbToMB(available),
    swapTotalMB: kbToMB(swapTotal),
    swapUsedMB: kbToMB(Math.max(0, swapTotal - swapFree)),
  };
}

/**
 * Memory the host can still hand out. os.freemem() excludes reclaimable page
 * cache, so on a database host it reads near zero while plenty is available.
 */
function readHostMemory() {
  let parsed = null;
  try {
    parsed = parseMeminfo(fs.readFileSync('/proc/meminfo', 'utf8'));
  } catch (_err) {
    parsed = null;
  }
  return parsed || { availableMB: kbToMB(os.freemem() / 1024), swapTotalMB: null, swapUsedMB: null };
}

module.exports = { parseMeminfo, readHostMemory };
