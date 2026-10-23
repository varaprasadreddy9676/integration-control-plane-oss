'use strict';

/**
 * One runner process, reached either directly (a child process of this backend)
 * or through the stage-runner sidecar's Unix socket. Both look the same to the
 * pool: `write(message)`, `kill()`, and the events
 *   'line'  a line the runner wrote (protocol messages, see child.js)
 *   'exit'  { code, signal, error, stderr } once, when the runner is gone
 */

const os = require('os');
const net = require('net');
const path = require('path');
const readline = require('readline');
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { buildLauncher } = require('./isolation');

const CHILD = path.join(__dirname, 'child.js');
const STDERR_TAIL = 2000;

/** Call `onLine` for each line of `stream`; stream errors are left to the stream's owner. */
function readLines(stream, onLine) {
  return readline.createInterface({ input: stream }).on('line', onLine).on('error', () => {});
}

function nodeCommand(memoryMb) {
  return [process.execPath, `--max-old-space-size=${memoryMb}`, CHILD];
}

/**
 * Start a runner as a child process of this process (modes host and none, and the
 * sidecar itself), as `account` ({ uid, gid }) when isolated. With `lines: false`
 * stdout is left unread for the caller to pipe.
 */
function spawnRunner({ isolation, memoryMb, account, lines = true }) {
  const runner = new EventEmitter();
  const { command, args } = buildLauncher(isolation, nodeCommand(memoryMb), memoryMb, account);
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'], env: {}, cwd: os.tmpdir() });
  let stderr = '';
  let exited = false;
  const exit = (info) => {
    if (exited) return;
    exited = true;
    runner.emit('exit', { ...info, stderr });
  };

  // readline re-emits stream errors (Node 16+); 'exit' reports what matters.
  if (lines) readLines(child.stdout, (line) => runner.emit('line', line));
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_TAIL);
  });
  child.on('exit', (code, signal) => exit({ code, signal }));
  child.on('error', (error) => exit({ error }));
  child.stdin.on('error', () => {}); // a dying child closes its stdin; 'exit' reports it

  runner.child = child;
  runner.write = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  runner.kill = () => {
    try {
      child.kill('SIGKILL');
    } catch (_error) {
      // already gone
    }
  };
  return runner;
}

/**
 * Open a runner in the stage-runner sidecar (mode sidecar). The sidecar starts one
 * runner per connection and kills it when the connection closes; after the runner
 * exits it sends one last line, { type: 'exit', code, signal, stderr }, and closes.
 */
function connectRunner({ socketPath, memoryMb }) {
  const runner = new EventEmitter();
  const socket = net.connect(socketPath);
  let exitInfo = null;
  let exited = false;
  const exit = (info) => {
    if (exited) return;
    exited = true;
    runner.emit('exit', info);
  };

  readLines(socket, (line) => {
    if (line === '') return; // the sidecar separates its exit line with a newline
    if (line.startsWith('{"type":"exit"')) {
      try {
        const { code = null, signal = null, stderr = '', error = null } = JSON.parse(line);
        exitInfo = { code, signal, stderr, error: error ? new Error(error) : null };
        return;
      } catch (_error) {
        // not an exit line after all; the pool treats it as a protocol message
      }
    }
    runner.emit('line', line);
  });
  socket.on('error', (error) => {
    if (!exitInfo) exitInfo = { code: null, signal: null, stderr: '', error: new Error(`Stage runner sidecar: ${error.message}`) };
  });
  socket.on('close', () =>
    exit(exitInfo || { code: null, signal: null, stderr: '', error: new Error('The stage runner sidecar closed the connection') })
  );

  socket.write(`${JSON.stringify({ type: 'hello', memoryMb })}\n`);
  runner.write = (message) => {
    if (!socket.destroyed) socket.write(`${JSON.stringify(message)}\n`);
  };
  runner.kill = () => socket.destroy();
  return runner;
}

module.exports = { spawnRunner, connectRunner, nodeCommand, readLines };
