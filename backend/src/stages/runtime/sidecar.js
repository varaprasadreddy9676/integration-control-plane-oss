'use strict';

/**
 * The stage-runner sidecar: where stage runners start when the backend itself
 * cannot isolate them (in Docker the backend is a non-root user without
 * CAP_SYS_ADMIN). It runs as root in a container with no network and no
 * secrets, listens on a Unix socket that only the backend's user may open, and
 * for each connection starts one runner (mode container: OS memory and process
 * limits, then the runner drops to its own uid from STAGE_RUNNER_UIDS; see
 * uids.js). Lines are passed through unchanged in
 * both directions; when the runner exits the sidecar sends one last line,
 * { type: 'exit', code, signal, stderr }, and closes the connection. Closing the
 * connection kills the runner.
 *
 * Environment:
 *   STAGE_RUNNER_SOCKET          socket path (default /run/stage-runner/runner.sock)
 *   STAGE_RUNNER_UIDS            uid range for runners, one uid each (required);
 *                                its size is the number of concurrent runners
 *   STAGE_RUNNER_CLIENT_UID      uid allowed to connect: the backend's (required)
 *   STAGE_RUNNER_MAX_MEMORY_MB   ceiling for the memory a client may ask for (default 256)
 */

const fs = require('fs');
const net = require('net');
const { resolveIsolation } = require('./isolation');
const { spawnRunner, readLines } = require('./transport');
const { createUidSlots } = require('./uids');

const MIN_MEMORY_MB = 16;

function createSidecar({ socketPath, isolation, clientUid, maxMemoryMb = 256, slots = createUidSlots(isolation.uids), log = () => {} }) {
  const live = new Set();

  const server = net.createServer((socket) => {
    let runner = null;
    let closed = false;
    const finish = (info) => {
      if (closed) return;
      closed = true;
      const line = JSON.stringify({
        type: 'exit',
        code: info.code === undefined ? null : info.code,
        signal: info.signal || null,
        stderr: info.stderr || '',
        error: info.error ? info.error.message || String(info.error) : null,
      });
      socket.end(`\n${line}\n`);
    };

    socket.on('error', () => {});
    socket.on('close', () => {
      closed = true;
      if (runner) {
        runner.kill();
        live.delete(runner);
      }
    });

    readLines(socket, (line) => {
      if (closed) return;
      if (runner) {
        runner.child.stdin.write(`${line}\n`);
        return;
      }
      let hello = null;
      try {
        hello = JSON.parse(line);
      } catch (_error) {
        hello = null;
      }
      if (!hello || hello.type !== 'hello') return finish({ error: new Error('Expected a hello message') });
      const uid = slots.acquire();
      if (uid === null) return finish({ error: new Error('The stage-runner sidecar is at capacity') });

      const memoryMb = Math.min(Math.max(Number(hello.memoryMb) || 128, MIN_MEMORY_MB), maxMemoryMb);
      runner = spawnRunner({ isolation, memoryMb, account: { uid, gid: slots.gid }, lines: false });
      live.add(runner);
      runner.child.stdout.pipe(socket, { end: false });
      runner.on('exit', (info) => {
        live.delete(runner);
        slots.release(uid);
        // 'exit' can come before stdout is drained; wait for the stream to end.
        if (runner.child.stdout.readableEnded) finish(info);
        else runner.child.stdout.once('end', () => finish(info));
      });
    });
  });

  async function listen() {
    await slots.reapAll();
    await new Promise((resolve, reject) => {
      try {
        fs.unlinkSync(socketPath);
      } catch (_error) {
        // no stale socket
      }
      server.once('error', reject);
      server.listen(socketPath, () => {
        // Only the backend's user may connect; runners (another uid) cannot.
        // (Node 14 needs an explicit gid; keep the current one.)
        fs.chownSync(socketPath, clientUid, fs.statSync(socketPath).gid);
        fs.chmodSync(socketPath, 0o600);
        log(`Stage-runner sidecar listening on ${socketPath}`);
        resolve();
      });
    });
  }

  function close() {
    for (const runner of live) runner.kill();
    live.clear();
    server.close();
  }

  return { listen, close, server };
}

async function main() {
  const socketPath = process.env.STAGE_RUNNER_SOCKET || '/run/stage-runner/runner.sock';
  const clientUid = Number(process.env.STAGE_RUNNER_CLIENT_UID);
  const isolation = resolveIsolation({ mode: 'container', runnerUids: process.env.STAGE_RUNNER_UIDS });
  const problems = [...isolation.problems];
  if (!Number.isInteger(clientUid) || clientUid <= 0) problems.push('STAGE_RUNNER_CLIENT_UID must be the backend user\'s uid');
  if (problems.length > 0) {
    console.error(`Stage-runner sidecar cannot start:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
  }
  const sidecar = createSidecar({
    socketPath,
    isolation,
    clientUid,
    maxMemoryMb: Number(process.env.STAGE_RUNNER_MAX_MEMORY_MB) || 256,
    log: (message) => console.log(message),
  });
  await sidecar.listen();
  const stop = () => {
    sidecar.close();
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { createSidecar };
