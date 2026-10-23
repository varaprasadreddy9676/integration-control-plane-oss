'use strict';

const { dataLimitMb } = require('./isolation');

/**
 * Prove the isolation from inside a stage, the way a hostile script would see it:
 * escape the vm context, then try to reach the network, read a protected file,
 * check the user, and exhaust memory outside the JavaScript heap. Stages are only
 * allowed to run when every check holds.
 */

const ESCAPE_CHECKS = `
const p = this.constructor.constructor("return process")();
const req = p.mainModule.require;
const network = await new Promise((resolve) => {
  try {
    const socket = req("net").connect({ host: "1.1.1.1", port: 53 });
    socket.on("connect", () => { socket.destroy(); resolve("open"); });
    socket.on("error", () => resolve("blocked"));
    setTimeout(() => { socket.destroy(); resolve("blocked"); }, 1500);
  } catch (e) { resolve("blocked"); }
});
let protectedFile = "unreadable";
try { req("fs").readFileSync(probe.protectedFile); protectedFile = "readable"; } catch (e) {}
return { network, uid: p.getuid ? p.getuid() : null, protectedFile };
`;

// Typed arrays live outside the JavaScript heap (like Buffers) and exist in the
// sandbox; filling them makes the memory really used.
const MEMORY_CHECK = `
const chunks = [];
for (let i = 0; i < probe.chunks; i++) chunks.push(new Uint8Array(16 * 1024 * 1024).fill(1));
return "allocated " + chunks.length;
`;

// Only a genuine allocation failure or an out-of-memory kill counts as capped;
// any other failure (a typo in the probe, a timeout) proves nothing.
const ALLOCATION_FAILURE = /allocation failed|out of memory|cannot allocate|invalid typed array length|crashed or exited/i;

function classifyMemory(result) {
  if (result.outcome === 'ok') return 'uncapped';
  if (result.outcome === 'error' && ALLOCATION_FAILURE.test(result.error || '')) return 'capped';
  return 'unknown';
}

/**
 * Resolves to { ok, checks: { network, user, protectedFile, memory }, problems }.
 * `protectedFile` is a file only the backend's user can read (its .env, for example).
 */
async function probeIsolation(pool, { protectedFile, memoryMb = 128, parentUid = process.getuid ? process.getuid() : null } = {}) {
  const problems = [];
  const escape = await pool.run({ code: ESCAPE_CHECKS, globals: { probe: { protectedFile } }, helpers: {}, timeoutMs: 10000 });
  const checks = { network: 'unknown', user: 'unknown', protectedFile: 'unknown', memory: 'unknown' };

  if (escape.outcome === 'ok' && escape.value) {
    checks.network = escape.value.network;
    const uid = escape.value.uid;
    checks.user = uid !== null && uid !== 0 && uid !== parentUid ? 'unprivileged' : 'privileged';
    checks.protectedFile = escape.value.protectedFile;
  } else {
    problems.push(`The probe could not run: ${escape.error || escape.outcome}`);
  }

  // Allocate well past the OS limit, outside the JS heap where V8's limit does not apply.
  const chunks = Math.ceil((dataLimitMb(memoryMb) + 256) / 16);
  const memory = await pool.run({ code: MEMORY_CHECK, globals: { probe: { chunks } }, helpers: {}, timeoutMs: 15000 });
  checks.memory = classifyMemory(memory);
  if (checks.memory === 'unknown') problems.push(`The memory probe failed for another reason: ${memory.error || memory.outcome}`);

  if (checks.network !== 'blocked') problems.push('A stage can reach the network');
  if (checks.user !== 'unprivileged') problems.push('Stages run as a privileged user');
  if (checks.protectedFile !== 'unreadable') problems.push('A stage can read protected files');
  if (checks.memory !== 'capped') problems.push('Stage memory outside the JavaScript heap is not limited');

  return { ok: problems.length === 0, checks, problems };
}

module.exports = { probeIsolation, classifyMemory };
