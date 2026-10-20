'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const hl7 = require('../../src/services/hl7/codec');
const { Hl7MllpEventSource } = require('../../src/adapters/Hl7MllpEventSource');

function writeFrame(port, message) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let received = Buffer.alloc(0);
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    socket.on('connect', () => {
      socket.write(hl7.frameMllp(message));
    });

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const frames = hl7.extractMllpFrames(received);
      if (frames.length > 0) {
        socket.end();
        settle(resolve, frames[0]);
      }
    });

    socket.on('error', (error) => settle(reject, error));
    socket.on('close', () => {
      settle(reject, new Error('connection closed before ACK'));
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      settle(reject, new Error('client timeout waiting for ACK'));
    });
  });
}

function writeTlsFrame(port, message) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, rejectUnauthorized: false });
    let received = Buffer.alloc(0);
    let settled = false;

    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    socket.on('secureConnect', () => {
      socket.write(hl7.frameMllp(message));
    });

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const frames = hl7.extractMllpFrames(received);
      if (frames.length > 0) {
        socket.end();
        settle(resolve, frames[0]);
      }
    });

    socket.on('error', (error) => settle(reject, error));
    socket.on('close', () => {
      settle(reject, new Error('connection closed before ACK'));
    });
    socket.setTimeout(1000, () => {
      socket.destroy();
      settle(reject, new Error('client timeout waiting for ACK'));
    });
  });
}

function openFrame(port, message) {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  let received = Buffer.alloc(0);

  const ack = new Promise((resolve, reject) => {
    socket.on('connect', () => {
      socket.write(hl7.frameMllp(message));
    });

    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      const frames = hl7.extractMllpFrames(received);
      if (frames.length > 0) {
        resolve(frames[0]);
      }
    });

    socket.on('error', reject);
    socket.setTimeout(1000, () => {
      socket.destroy();
      reject(new Error('client timeout waiting for ACK'));
    });
  });

  return { socket, ack };
}

function createSelfSignedCert(tempDirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl7-listener-tls-'));
  tempDirs.push(dir);
  const keyPath = path.join(dir, 'server.key');
  const certPath = path.join(dir, 'server.crt');
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'ignore' }
  );
  return {
    keyPath,
    certPath,
    key: fs.readFileSync(keyPath, 'utf8'),
    cert: fs.readFileSync(certPath, 'utf8'),
  };
}

describe('Hl7MllpEventSource', () => {
  let adapter;
  let tempDirs = [];

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  it('receives HL7 over MLLP, emits normalized event, and returns AA ACK', async () => {
    const receivedEvents = [];
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
      messageTypeMapping: {
        'ORM^O01': 'RIS_ORDER_CREATED',
      },
    });

    await adapter.start(async (event, ctx) => {
      receivedEvents.push(event);
      await ctx.ack();
    });

    const ackFrame = await writeFrame(
      adapter.getRuntimeStatus().port,
      'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-100|P|2.3\rPID|||P-100||Rao\r'
    );
    const ack = hl7.parseAck(ackFrame);

    expect(ack.accepted).toBe(true);
    expect(ack.code).toBe('AA');
    expect(ack.messageControlId).toBe('MSG-100');
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0]).toEqual(
      expect.objectContaining({
        orgId: 812,
        org_id: 812,
        event_type: 'RIS_ORDER_CREATED',
        eventId: 'hl7-812-MSG-100',
      })
    );
    expect(receivedEvents[0].payload).toEqual(
      expect.objectContaining({
        messageType: { code: 'ORM', trigger: 'O01' },
        messageControlId: 'MSG-100',
        rawHl7: expect.stringContaining('ORM^O01'),
      })
    );
    expect(receivedEvents[0].payload.segments.PID[0].fields[2].value).toBe('P-100');
    expect(receivedEvents[0].payload.id).toBe('hl7-812-MSG-100');
  });

  it('returns AE ACK with handler reason when processing fails', async () => {
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
    });

    await adapter.start(async (_event, ctx) => {
      await ctx.nack(0, 'Downstream validation failed');
    });

    const ackFrame = await writeFrame(
      adapter.getRuntimeStatus().port,
      'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORU^R01|MSG-101|P|2.3\rPID|||P-101||Rao\r'
    );
    const ack = hl7.parseAck(ackFrame);

    expect(ack.accepted).toBe(false);
    expect(ack.code).toBe('AE');
    expect(ack.messageControlId).toBe('MSG-101');
    expect(ack.errorMessage).toBe('Downstream validation failed');
  });

  it('returns AR ACK for malformed HL7 and does not call handler', async () => {
    const handler = jest.fn();
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
    });

    await adapter.start(handler);

    const ackFrame = await writeFrame(adapter.getRuntimeStatus().port, 'PID|||P-102||Rao\r');
    const ack = hl7.parseAck(ackFrame);

    expect(handler).not.toHaveBeenCalled();
    expect(ack.accepted).toBe(false);
    expect(ack.code).toBe('AR');
    expect(ack.errorMessage).toMatch(/MSH/);
  });

  it('reports listener runtime status', async () => {
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
    });

    await adapter.start(async (_event, ctx) => ctx.ack());

    expect(adapter.getRuntimeStatus()).toEqual(
      expect.objectContaining({
        connectionStatus: 'listening',
        running: true,
        orgId: 812,
        host: '127.0.0.1',
        port: expect.any(Number),
        protocol: 'hl7_mllp',
        transport: 'tcp',
        duplicateCount: 0,
      })
    );
  });

  it('receives HL7 over TLS MLLP when tls.enabled is configured', async () => {
    const cert = createSelfSignedCert(tempDirs);
    const receivedEvents = [];
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
      tls: {
        enabled: true,
        key: cert.key,
        cert: cert.cert,
      },
    });

    await adapter.start(async (event, ctx) => {
      receivedEvents.push(event);
      await ctx.ack();
    });

    const ackFrame = await writeTlsFrame(
      adapter.getRuntimeStatus().port,
      'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-TLS-IN|P|2.3\rPID|||P-TLS||Rao\r'
    );
    const ack = hl7.parseAck(ackFrame);

    expect(ack.code).toBe('AA');
    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].payload.messageControlId).toBe('MSG-TLS-IN');
    expect(adapter.getRuntimeStatus()).toEqual(expect.objectContaining({ transport: 'tls' }));
  });

  it('rejects concurrent duplicates with the same message control ID without invoking handler twice', async () => {
    let releaseHandler;
    const handlerStarted = new Promise((resolve) => {
      releaseHandler = resolve;
    });
    const handler = jest.fn(async (_event, ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      await ctx.ack();
      handlerStarted.then(() => {});
    });
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
    });

    await adapter.start(async (event, ctx) => {
      releaseHandler();
      await handler(event, ctx);
    });

    const message = 'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-DUP|P|2.3\rPID|||P-DUP||Rao\r';
    const first = openFrame(adapter.getRuntimeStatus().port, message);
    await handlerStarted;
    const secondAck = hl7.parseAck(await writeFrame(adapter.getRuntimeStatus().port, message));
    const firstAck = hl7.parseAck(await first.ack);
    first.socket.end();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(secondAck.code).toBe('AE');
    expect(secondAck.errorMessage).toMatch(/already processing/i);
    expect(firstAck.code).toBe('AA');
    expect(adapter.getRuntimeStatus().duplicateCount).toBe(1);
  });

  it('ACKs recently accepted duplicates without invoking the handler again', async () => {
    const handler = jest.fn(async (_event, ctx) => ctx.ack());
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
      duplicateWindowMs: 60000,
    });

    await adapter.start(handler);

    const message = 'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-ACCEPTED|P|2.3\rPID|||P-DUP||Rao\r';
    const firstAck = hl7.parseAck(await writeFrame(adapter.getRuntimeStatus().port, message));
    const secondAck = hl7.parseAck(await writeFrame(adapter.getRuntimeStatus().port, message));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(firstAck.code).toBe('AA');
    expect(secondAck.code).toBe('AA');
    expect(secondAck.errorMessage).toMatch(/already processed/i);
    expect(adapter.getRuntimeStatus().duplicateCount).toBe(1);
  });

  it('rejects listener config with unsafe limits', () => {
    expect(() => new Hl7MllpEventSource({ orgId: 812, port: 2575, maxMessageBytes: 100 })).toThrow(/maxMessageBytes/i);
    expect(() => new Hl7MllpEventSource({ orgId: 812, port: 2575, idleTimeoutMs: 10 })).toThrow(/idleTimeoutMs/i);
    expect(() => new Hl7MllpEventSource({ orgId: 812, port: 2575, messageTypeMapping: [] })).toThrow(/messageTypeMapping/i);
  });

  it('blocks clients outside the optional source IP allowlist', async () => {
    const handler = jest.fn();
    adapter = new Hl7MllpEventSource({
      orgId: 812,
      host: '127.0.0.1',
      port: 0,
      allowedSourceIps: ['10.0.0.1'],
    });

    await adapter.start(handler);

    await expect(
      writeFrame(adapter.getRuntimeStatus().port, 'MSH|^~\\&|HIS|MAIN|GW|INT|20260101010101||ORM^O01|MSG-BLOCK|P|2.3\r')
    ).rejects.toThrow(/timeout|reset|socket hang up|closed/i);
    expect(handler).not.toHaveBeenCalled();
    expect(adapter.getRuntimeStatus()).toEqual(
      expect.objectContaining({
        rejectedCount: 1,
        lastError: expect.stringMatching(/not allowed/i),
      })
    );
  });
});
