'use strict';

const net = require('net');
const tls = require('tls');
const crypto = require('crypto');
const hl7 = require('./codec');
const { normalizeTlsConfig } = require('./tls-options');

function buildError(message, code, details = {}) {
  const err = new Error(message);
  err.code = code;
  Object.assign(err, details);
  return err;
}

function validateConfig(config = {}) {
  const host = String(config.host || '').trim();
  const port = Number(config.port);

  if (!host) {
    throw buildError('HL7 MLLP host is required', 'HL7_CONFIG_ERROR');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw buildError('HL7 MLLP port must be between 1 and 65535', 'HL7_CONFIG_ERROR');
  }

  return {
    host,
    port,
    connectTimeoutMs: Math.max(100, Number(config.connectTimeoutMs || config.timeoutMs || 5000)),
    ackTimeoutMs: Math.max(100, Number(config.ackTimeoutMs || config.timeoutMs || 15000)),
    ackRequired: config.ackRequired !== false,
    keepAlive: Boolean(config.keepAlive || config.persistentConnection),
    idleTimeoutMs: Math.max(1000, Number(config.idleTimeoutMs || 60000)),
    tls: normalizeTlsConfig(config),
  };
}

function createSocket(config) {
  if (config.tls) {
    return tls.connect({
      ...config.tls,
      host: config.host,
      port: config.port,
    });
  }
  const socket = new net.Socket();
  socket.connect(config.port, config.host);
  return socket;
}

function waitForConnect(socket, config) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const eventName = config.tls ? 'secureConnect' : 'connect';
    const cleanup = () => {
      clearTimeout(timer);
      socket.off(eventName, onConnect);
      socket.off('error', onError);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const onError = (error) => {
      cleanup();
      reject(buildError(`HL7 MLLP connection failed: ${error.message}`, 'HL7_CONNECT_ERROR', { cause: error }));
    };

    timer = setTimeout(() => {
      cleanup();
      socket.destroy();
      reject(buildError(`HL7 MLLP connection timed out after ${config.connectTimeoutMs}ms`, 'HL7_CONNECT_TIMEOUT'));
    }, config.connectTimeoutMs);

    socket.once(eventName, onConnect);
    socket.once('error', onError);
  });
}

function waitForAck(socket, framedPayload, config, { cleanupSocket = true, reusedConnection = false } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let received = Buffer.alloc(0);
    let ackTimer = null;

    const cleanup = () => {
      clearTimeout(ackTimer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      if (cleanupSocket && !socket.destroyed) {
        socket.destroy();
      }
    };
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };
    const onData = (chunk) => {
      received = Buffer.concat([received, chunk]);
      const frames = hl7.extractMllpFrames(received);
      if (frames.length === 0) return;

      try {
        const ack = hl7.parseAck(frames[0]);
        finish(resolve, {
          accepted: ack.accepted,
          ack,
          rawAck: frames[0],
          requestBytes: framedPayload.length,
          responseBytes: Buffer.byteLength(frames[0]),
          reusedConnection,
        });
      } catch (error) {
        finish(reject, buildError(`HL7 MLLP response was not a valid ACK: ${error.message}`, 'HL7_ACK_PARSE_ERROR'));
      }
    };
    const onError = (error) => {
      finish(reject, buildError(`HL7 MLLP connection failed: ${error.message}`, 'HL7_CONNECT_ERROR', { cause: error }));
    };
    const onClose = () => {
      if (config.ackRequired) {
        finish(reject, buildError('HL7 MLLP connection closed before ACK was received', 'HL7_CONNECTION_CLOSED'));
      }
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);

    socket.write(framedPayload, () => {
      if (!config.ackRequired) {
        finish(resolve, {
          accepted: true,
          ackRequired: false,
          requestBytes: framedPayload.length,
          reusedConnection,
        });
        return;
      }

      ackTimer = setTimeout(() => {
        finish(reject, buildError(`HL7 MLLP ACK timed out after ${config.ackTimeoutMs}ms`, 'HL7_ACK_TIMEOUT'));
      }, config.ackTimeoutMs);
    });
  });
}

const pooledConnections = new Map();

function ignoreQueueError() {
  return undefined;
}

function hashValue(value) {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.map((entry) => hashValue(entry)).join(',');
  }
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : String(value)).digest('hex').slice(0, 16);
}

function poolKey(config) {
  if (!config.tls) return `tcp://${config.host}:${config.port}`;
  const tlsIdentity = [
    config.tls.servername || '',
    config.tls.minVersion || '',
    config.tls.requestCert ? 'request-cert' : '',
    config.tls.rejectUnauthorized === false ? 'insecure' : 'verify',
    hashValue(config.tls.ca),
    hashValue(config.tls.cert),
    hashValue(config.tls.key),
  ].join('|');
  return `tls://${config.host}:${config.port}:${tlsIdentity}`;
}

class PersistentMllpConnection {
  constructor(config) {
    this.config = config;
    this.socket = null;
    this.connecting = null;
    this.queue = Promise.resolve();
    this.idleTimer = null;
  }

  send(payload) {
    const run = this.queue.catch(ignoreQueueError).then(() => this._send(payload));
    this.queue = run.catch(ignoreQueueError);
    return run;
  }

  async _connect() {
    if (this.socket && !this.socket.destroyed) return this.socket;
    if (this.connecting) return this.connecting;

    const socket = createSocket(this.config);
    socket.once('close', () => {
      if (this.socket === socket) this.socket = null;
    });
    this.connecting = waitForConnect(socket, this.config)
      .then(() => {
        this.socket = socket;
        return socket;
      })
      .finally(() => {
        this.connecting = null;
      });
    return this.connecting;
  }

  async _send(payload) {
    clearTimeout(this.idleTimer);
    const framedPayload = hl7.frameMllp(payload);
    const socket = await this._connect();

    try {
      const result = await waitForAck(socket, framedPayload, this.config, {
        cleanupSocket: false,
        reusedConnection: true,
      });
      this.idleTimer = setTimeout(() => this.close(), this.config.idleTimeoutMs);
      return result;
    } catch (error) {
      this.close();
      throw error;
    }
  }

  close() {
    clearTimeout(this.idleTimer);
    if (this.socket && !this.socket.destroyed) {
      this.socket.destroy();
    }
    this.socket = null;
  }
}

function sendPersistentMllpMessage(payload, config) {
  const key = poolKey(config);
  let connection = pooledConnections.get(key);
  if (!connection) {
    connection = new PersistentMllpConnection(config);
    pooledConnections.set(key, connection);
  }
  return connection.send(payload);
}

async function sendMllpMessage(message, config = {}) {
  const normalizedConfig = validateConfig(config);
  const payload = hl7.toMessageString(message);

  if (normalizedConfig.keepAlive) {
    return sendPersistentMllpMessage(payload, normalizedConfig);
  }

  const framedPayload = hl7.frameMllp(payload);
  const socket = createSocket(normalizedConfig);
  await waitForConnect(socket, normalizedConfig);
  return waitForAck(socket, framedPayload, normalizedConfig);
}

function closeMllpPools() {
  for (const connection of pooledConnections.values()) {
    connection.close();
  }
  pooledConnections.clear();
}

module.exports = {
  sendMllpMessage,
  closeMllpPools,
};
