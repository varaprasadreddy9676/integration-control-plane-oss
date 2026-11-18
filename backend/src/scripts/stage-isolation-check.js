'use strict';
/**
 * Check that stage scripts are isolated on this machine, the way the backend
 * checks it before allowing stages to run. Run it on a server after setting up
 * util-linux, and again after any OS change.
 *
 *   node src/scripts/stage-isolation-check.js --mode=host --uids=61000-61031 --protected-file=/path/to/.env
 *   node src/scripts/stage-isolation-check.js --mode=sidecar --socket=/run/stage-runner/runner.sock
 *
 * Exits 0 when every check holds (network blocked, unprivileged user, protected
 * file unreadable, memory outside the JS heap capped), 1 otherwise.
 */

const { resolveIsolation } = require('../stages/runtime/isolation');
const { createRuntimePool } = require('../stages/runtime/pool');
const { probeIsolation } = require('../stages/runtime/probe');

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

async function main() {
  const mode = arg('mode', 'host');
  const memoryMb = Number(arg('memory-mb', '64'));
  const isolation = resolveIsolation({
    mode,
    runnerUids: arg('uids', process.env.STAGE_RUNNER_UIDS),
    socketPath: arg('socket', process.env.STAGE_RUNNER_SOCKET),
  });
  console.log(`Node ${process.version}, mode ${mode}`);
  if (!isolation.ok) {
    console.log(`Not available:\n  - ${isolation.problems.join('\n  - ')}`);
    process.exitCode = 1;
    return;
  }

  const pool = createRuntimePool({ size: 1, memoryMb, isolation: { ...isolation, required: true } });
  try {
    const report = await probeIsolation(pool, { protectedFile: arg('protected-file', '/etc/shadow'), memoryMb });
    console.log(JSON.stringify(report.checks));
    if (report.ok) {
      const sanity = await pool.run({ code: 'return [1, 2, 3].map((n) => n * 2);', globals: {}, helpers: {}, timeoutMs: 5000 });
      console.log(`A normal stage still runs: ${JSON.stringify(sanity.value)}`);
      console.log('Isolation OK');
    } else {
      console.log(`Isolation NOT OK:\n  - ${report.problems.join('\n  - ')}`);
      process.exitCode = 1;
    }
  } finally {
    pool.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
