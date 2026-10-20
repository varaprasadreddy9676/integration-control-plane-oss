'use strict';

const net = require('net');
const tls = require('tls');
const { EventSourceAdapter } = require('./EventSourceAdapter');
const { log } = require('../logger');
const hl7 = require('../services/hl7/codec');
const { normalizeTlsConfig } = require('../services/hl7/tls-options');
const {
  createOwnerId,
  acquireListenerLock,
  refreshListenerLock,
  releaseListenerLock,
} = require('../services/hl7/listener-lock');

const DEFAULT_MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const DEFAULT_IDLE_TIMEOUT_MS = 30000;
const DEFAULT_DUPLICATE_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_RECENT_MESSAGE_IDS = 50000;

function normalizePort(port) {
  const numeric = Number(port);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 65535) {
    throw new Error('Hl7MllpEventSource: port must be between 0 and 65535');
  }
  return numeric;
}

function normalizePositiveInteger(value, field, { min, max, defaultValue }) {
  const numeric = value === undefined || value === null || value === '' ? defaultValue : Number(value);
  if (!Number.isInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`Hl7MllpEventSource: ${field} must be between ${min} and ${max}`);
  }
  return numeric;
}

function normalizeObject(value, field) {
  if (!value) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Hl7MllpEventSource: ${field} must be an object`);
  }
  return value;
}

function normalizeIp(value) {
  const ip = String(value || '').trim();
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}

function ipv4ToInt(ip) {
  const parts = normalizeIp(ip).split('.');
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const octet = Number(part);
    if (octet < 0 || octet > 255) return null;
    result = (result << 8) + octet;
  }
  return result >>> 0;
}

function ipv4MatchesCidr(ip, cidr) {
  const [range, prefixRaw] = String(cidr || '').split('/');
  const prefix = Number(prefixRaw);
  const ipInt = ipv4ToInt(ip);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function normalizeIpAllowlist(config = {}) {
  const entries = [
    ...(Array.isArray(config.allowedSourceIps) ? config.allowedSourceIps : []),
    ...(Array.isArray(config.allowedSourceCidrs) ? config.allowedSourceCidrs : []),
  ]
    .map((entry) => String(entry || '').trim())
    .filter(Boolean);

  return entries;
}

function isIpAllowed(remoteAddress, allowlist) {
  if (!allowlist.length) return true;
  const ip = normalizeIp(remoteAddress);
  return allowlist.some((entry) => {
    if (entry.includes('/')) {
      return ipv4MatchesCidr(ip, entry);
    }
    return normalizeIp(entry) === ip;
  });
}

function buildDefaultEventType(messageType = {}) {
  const code = String(messageType.code || 'UNKNOWN').toUpperCase();
  const trigger = String(messageType.trigger || '').toUpperCase();
  return trigger ? `HL7_${code}_${trigger}` : `HL7_${code}`;
}

function toSegmentMap(parsed) {
  const map = {};
  for (const segment of parsed.segments || []) {
    if (!map[segment.name]) {
      map[segment.name] = [];
    }
    map[segment.name].push({
      raw: segment.raw,
      fields: segment.fields.map((field) => ({
        raw: field.raw,
        value: field.value,
      })),
    });
  }
  return map;
}

class Hl7MllpEventSource extends EventSourceAdapter {
  constructor(config = {}) {
    super();
    if (!config.orgId) throw new Error('Hl7MllpEventSource: orgId is required');

    this.orgId = Number(config.orgId);
    this.orgUnitRid = config.orgUnitRid || config.entityRid || this.orgId;
    this.host = config.host || '0.0.0.0';
    this.port = normalizePort(config.port);
    this.messageTypeMapping = normalizeObject(config.messageTypeMapping, 'messageTypeMapping');
    this.maxMessageBytes = normalizePositiveInteger(config.maxMessageBytes, 'maxMessageBytes', {
      min: 1024,
      max: 10 * 1024 * 1024,
      defaultValue: DEFAULT_MAX_MESSAGE_BYTES,
    });
    this.idleTimeoutMs = normalizePositiveInteger(config.idleTimeoutMs, 'idleTimeoutMs', {
      min: 1000,
      max: 300000,
      defaultValue: DEFAULT_IDLE_TIMEOUT_MS,
    });
    this.duplicateWindowMs = normalizePositiveInteger(config.duplicateWindowMs, 'duplicateWindowMs', {
      min: 1000,
      max: 24 * 60 * 60 * 1000,
      defaultValue: DEFAULT_DUPLICATE_WINDOW_MS,
    });
    this.deduplicationEnabled = config.deduplicationEnabled !== false;
    this.allowedSourceIps = normalizeIpAllowlist(config);
    this.tlsConfig = normalizeTlsConfig(config, { server: true });
    this.listenerLockEnabled = Boolean(config.listenerLockEnabled || config.primaryOnly || config.useListenerLock);
    this.listenerLockTtlMs = normalizePositiveInteger(config.listenerLockTtlMs, 'listenerLockTtlMs', {
      min: 5000,
      max: 300000,
      defaultValue: 30000,
    });
    this.listenerLockKey =
      config.listenerLockKey || `hl7_mllp:${this.orgId}:${this.host}:${this.port}`;
    this.listenerLockOwnerId = config.listenerLockOwnerId || createOwnerId(`hl7-${this.orgId}`);
    this.listenerLockRefreshTimer = null;
    this.listenerLockAcquired = false;
    this.ackSendingApp = config.ackSendingApp || 'INTEGRATION_GATEWAY';
    this.ackSendingFacility = config.ackSendingFacility || '';
    this.server = null;
    this.sockets = new Set();
    this.inFlightMessageIds = new Set();
    this.acceptedMessageIds = new Map();
    this.running = false;
    this.startedAt = null;
    this.lastMessageAt = null;
    this.lastError = null;
    this.receivedCount = 0;
    this.rejectedCount = 0;
    this.duplicateCount = 0;
  }

  async start(handler) {
    if (this.running) return;
    if (typeof handler !== 'function') {
      throw new Error('Hl7MllpEventSource.start() requires a handler');
    }

    if (this.listenerLockEnabled) {
      const lock = await acquireListenerLock(this.listenerLockKey, this.listenerLockOwnerId, this.listenerLockTtlMs);
      if (!lock) {
        const error = new Error(`HL7 MLLP listener lock is held by another instance: ${this.listenerLockKey}`);
        error.code = 'HL7_LISTENER_LOCKED';
        this.lastError = error.message;
        throw error;
      }
      this.listenerLockAcquired = true;
      this.listenerLockRefreshTimer = setInterval(() => {
        refreshListenerLock(this.listenerLockKey, this.listenerLockOwnerId, this.listenerLockTtlMs).catch((error) => {
          this.lastError = `HL7 listener lock refresh failed: ${error.message}`;
          log('error', `[HL7-MLLP:${this.orgId}] Listener lock refresh failed`, { error: error.message });
        });
      }, Math.max(1000, Math.floor(this.listenerLockTtlMs / 3)));
    }

    this.server = this.tlsConfig
      ? tls.createServer(this.tlsConfig, (socket) => this._handleSocket(socket, handler))
      : net.createServer((socket) => this._handleSocket(socket, handler));

    try {
      await new Promise((resolve, reject) => {
        const onError = (error) => {
          this.lastError = error.message;
          reject(error);
        };
        this.server.once('error', onError);
        this.server.listen(this.port, this.host, () => {
          this.server.off('error', onError);
          const address = this.server.address();
          this.port = typeof address === 'object' && address ? address.port : this.port;
          this.running = true;
          this.startedAt = new Date();
          log('info', `[HL7-MLLP:${this.orgId}] Listening`, { host: this.host, port: this.port });
          resolve();
        });
      });
    } catch (error) {
      clearInterval(this.listenerLockRefreshTimer);
      this.listenerLockRefreshTimer = null;
      if (this.listenerLockAcquired) {
        await releaseListenerLock(this.listenerLockKey, this.listenerLockOwnerId).catch((releaseError) => {
          log('warn', `[HL7-MLLP:${this.orgId}] Failed to release listener lock after start failure`, {
            error: releaseError.message,
          });
        });
        this.listenerLockAcquired = false;
      }
      throw error;
    }
  }

  async stop() {
    this.running = false;
    clearInterval(this.listenerLockRefreshTimer);
    this.listenerLockRefreshTimer = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (!this.server) {
      if (this.listenerLockAcquired) {
        await releaseListenerLock(this.listenerLockKey, this.listenerLockOwnerId).catch((error) => {
          log('warn', `[HL7-MLLP:${this.orgId}] Failed to release listener lock`, { error: error.message });
        });
        this.listenerLockAcquired = false;
      }
      return;
    }
    const server = this.server;
    this.server = null;

    await new Promise((resolve) => {
      server.close(() => resolve());
    });

    if (this.listenerLockAcquired) {
      await releaseListenerLock(this.listenerLockKey, this.listenerLockOwnerId).catch((error) => {
        log('warn', `[HL7-MLLP:${this.orgId}] Failed to release listener lock`, { error: error.message });
      });
      this.listenerLockAcquired = false;
    }

    log('info', `[HL7-MLLP:${this.orgId}] Stopped`);
  }

  getName() {
    return `Hl7MllpEventSource[org=${this.orgId},port=${this.port}]`;
  }

  getRuntimeStatus() {
    return {
      adapterName: this.getName(),
      orgId: this.orgId,
      host: this.host,
      port: this.port,
      protocol: 'hl7_mllp',
      transport: this.tlsConfig ? 'tls' : 'tcp',
      running: this.running,
      connectionStatus: this.running ? 'listening' : 'stopped',
      activeConnections: this.sockets.size,
      receivedCount: this.receivedCount,
      rejectedCount: this.rejectedCount,
      duplicateCount: this.duplicateCount,
      deduplicationEnabled: this.deduplicationEnabled,
      allowlistEnabled: this.allowedSourceIps.length > 0,
      listenerLockEnabled: this.listenerLockEnabled,
      listenerLockAcquired: this.listenerLockAcquired,
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      lastMessageAt: this.lastMessageAt ? this.lastMessageAt.toISOString() : null,
      lastError: this.lastError,
    };
  }

  _handleSocket(socket, handler) {
    this.sockets.add(socket);
    socket.setTimeout(this.idleTimeoutMs);

    const remoteAddress = normalizeIp(socket.remoteAddress);
    if (!isIpAllowed(remoteAddress, this.allowedSourceIps)) {
      this.rejectedCount += 1;
      this.lastError = `HL7 MLLP client ${remoteAddress} is not allowed`;
      log('warn', `[HL7-MLLP:${this.orgId}] Rejected client outside allowlist`, {
        remoteAddress,
        allowlistSize: this.allowedSourceIps.length,
      });
      socket.destroy();
      return;
    }

    let buffer = Buffer.alloc(0);
    let processing = Promise.resolve();

    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > this.maxMessageBytes) {
        this.rejectedCount += 1;
        this._writeAck(socket, null, 'AR', `HL7 message exceeds ${this.maxMessageBytes} bytes`);
        socket.end();
        return;
      }

      const frames = hl7.extractMllpFrames(buffer);
      if (frames.length === 0) return;

      const lastEnd = buffer.lastIndexOf(Buffer.from([hl7.MLLP_END, hl7.CR]));
      buffer = lastEnd >= 0 ? buffer.subarray(lastEnd + 2) : Buffer.alloc(0);

      for (const frame of frames) {
        processing = processing
          .then(() => this._processFrame(socket, frame, handler))
          .catch((error) => {
            this.rejectedCount += 1;
            this.lastError = error.message;
            log('error', `[HL7-MLLP:${this.orgId}] Frame processing failed`, { error: error.message });
          });
      }
    });

    socket.on('timeout', () => {
      this.lastError = 'Socket idle timeout';
      socket.destroy();
    });

    socket.on('error', (error) => {
      this.lastError = error.message;
      log('warn', `[HL7-MLLP:${this.orgId}] Socket error`, { error: error.message });
    });

    socket.on('close', () => {
      this.sockets.delete(socket);
    });
  }

  async _processFrame(socket, rawHl7, handler) {
    let parsed;
    try {
      parsed = hl7.parseMessage(rawHl7);
    } catch (error) {
      this.rejectedCount += 1;
      this.lastError = error.message;
      this._writeAck(socket, null, 'AR', error.message);
      return;
    }

    this.receivedCount += 1;
    this.lastMessageAt = new Date();

    const messageKey = this._messageKey(parsed);
    if (messageKey && this.deduplicationEnabled) {
      this._cleanupAcceptedMessageIds();
      if (this.inFlightMessageIds.has(messageKey)) {
        this.duplicateCount += 1;
        this.lastError = `Duplicate HL7 message already processing: ${messageKey}`;
        this._writeAck(socket, rawHl7, 'AE', 'Duplicate message already processing');
        return;
      }
      if (this.acceptedMessageIds.has(messageKey)) {
        this.duplicateCount += 1;
        this._writeAck(socket, rawHl7, 'AA', 'Duplicate message already processed');
        return;
      }
      this.inFlightMessageIds.add(messageKey);
    }

    const mappingKey = parsed.messageType.trigger
      ? `${parsed.messageType.code}^${parsed.messageType.trigger}`
      : parsed.messageType.code;
    const eventType = this.messageTypeMapping[mappingKey] || this.messageTypeMapping[parsed.messageType.code] || buildDefaultEventType(parsed.messageType);
    const eventId = `hl7-${this.orgId}-${parsed.messageControlId || `${Date.now()}-${this.receivedCount}`}`;

    let responded = false;
    const respond = async (ackCode, reason) => {
      if (responded) return;
      responded = true;
      this._writeAck(socket, rawHl7, ackCode, reason);
    };

    const event = {
      id: eventId,
      eventId,
      orgId: this.orgId,
      org_id: this.orgId,
      orgUnitRid: this.orgUnitRid,
      org_unit_rid: this.orgUnitRid,
      event_type: eventType,
      payload: {
        id: eventId,
        rawHl7: hl7.toMessageString(rawHl7),
        messageType: parsed.messageType,
        messageControlId: parsed.messageControlId,
        version: parsed.version,
        segments: toSegmentMap(parsed),
      },
      created_at: new Date().toISOString(),
      source: 'hl7_mllp',
    };

    try {
      let accepted = false;
      await handler(event, {
        ack: async () => {
          accepted = true;
          return respond('AA', 'Accepted');
        },
        nack: async (_retryDelayMs = 0, reason = 'Processing failed') => respond('AE', reason),
      });
      if (!responded) {
        accepted = true;
        await respond('AA', 'Accepted');
      }
      if (accepted && messageKey && this.deduplicationEnabled) {
        this._rememberAcceptedMessageId(messageKey);
      }
    } catch (error) {
      this.rejectedCount += 1;
      this.lastError = error.message;
      await respond('AE', error.message || 'Processing failed');
    } finally {
      if (messageKey) {
        this.inFlightMessageIds.delete(messageKey);
      }
    }
  }

  _writeAck(socket, originalMessage, code, reason) {
    const ack = hl7.buildAck({
      originalMessage,
      code,
      text: reason,
      sendingApp: this.ackSendingApp,
      sendingFacility: this.ackSendingFacility,
    });
    if (!socket.destroyed && socket.writable) {
      socket.write(hl7.frameMllp(ack));
    }
  }

  _messageKey(parsed) {
    if (!parsed?.messageControlId) return null;
    return `${this.orgId}:${parsed.messageControlId}`;
  }

  _cleanupAcceptedMessageIds(now = Date.now()) {
    const cutoff = now - this.duplicateWindowMs;
    for (const [key, timestamp] of this.acceptedMessageIds.entries()) {
      if (timestamp < cutoff) {
        this.acceptedMessageIds.delete(key);
      }
    }
  }

  _rememberAcceptedMessageId(messageKey) {
    this.acceptedMessageIds.set(messageKey, Date.now());
    if (this.acceptedMessageIds.size <= MAX_RECENT_MESSAGE_IDS) return;

    const evictCount = Math.ceil(MAX_RECENT_MESSAGE_IDS * 0.2);
    let removed = 0;
    for (const key of this.acceptedMessageIds.keys()) {
      this.acceptedMessageIds.delete(key);
      removed += 1;
      if (removed >= evictCount) break;
    }
  }
}

module.exports = { Hl7MllpEventSource };
