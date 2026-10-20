'use strict';

const net = require('net');
const tls = require('tls');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const hl7 = require('../../src/services/hl7/codec');
const { sendMllpMessage, closeMllpPools } = require('../../src/services/hl7/mllp-client');

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  if (server.__sockets) {
    for (const socket of server.__sockets) {
      socket.destroy();
    }
  }
  return new Promise((resolve) => server.close(resolve));
}

function trackSockets(server) {
  server.__sockets = new Set();
  server.on('connection', (socket) => {
    server.__sockets.add(socket);
    socket.on('close', () => server.__sockets.delete(socket));
  });
  return server;
}

describe('HL7 MLLP client', () => {
  let servers = [];
  let tempDirs = [];

  afterEach(async () => {
    closeMllpPools();
    await Promise.all(servers.map((server) => close(server).catch(() => {})));
    servers = [];
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs = [];
  });

  function createSelfSignedCert() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hl7-tls-'));
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
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  }

  it('sends framed HL7 and resolves accepted ACK details', async () => {
    let receivedPayload = null;
    const server = trackSockets(net.createServer((socket) => {
      let data = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
        const frames = hl7.extractMllpFrames(data);
        if (frames.length > 0) {
          receivedPayload = frames[0];
          socket.write(hl7.frameMllp('MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-1|P|2.3\rMSA|AA|MSG-1|OK\r'));
        }
      });
    }));
    servers.push(server);
    const port = await listen(server);

    const result = await sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-1|P|2.3\r', {
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 1000,
      ackTimeoutMs: 1000,
    });

    expect(receivedPayload).toContain('ORM^O01');
    expect(result.accepted).toBe(true);
    expect(result.ack.code).toBe('AA');
    expect(result.ack.messageControlId).toBe('MSG-1');
  });

  it('returns rejected ACK details without hiding the vendor reason', async () => {
    const server = trackSockets(net.createServer((socket) => {
      socket.on('data', () => {
        socket.write(hl7.frameMllp('MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-2|P|2.3\rMSA|AR|MSG-2|Invalid order\r'));
      });
    }));
    servers.push(server);
    const port = await listen(server);

    const result = await sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-2|P|2.3\r', {
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 1000,
      ackTimeoutMs: 1000,
    });

    expect(result.accepted).toBe(false);
    expect(result.ack.code).toBe('AR');
    expect(result.ack.errorMessage).toBe('Invalid order');
  });

  it('times out cleanly when ACK is not received', async () => {
    const server = trackSockets(net.createServer((_socket) => {}));
    servers.push(server);
    const port = await listen(server);

    await expect(
      sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-3|P|2.3\r', {
        host: '127.0.0.1',
        port,
        connectTimeoutMs: 1000,
        ackTimeoutMs: 50,
      })
    ).rejects.toMatchObject({
      code: 'HL7_ACK_TIMEOUT',
    });
  });

  it('reuses a persistent MLLP socket when keepAlive is enabled', async () => {
    let connectionCount = 0;
    const server = trackSockets(net.createServer((socket) => {
      connectionCount += 1;
      let data = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        data = Buffer.concat([data, chunk]);
        const frames = hl7.extractMllpFrames(data);
        if (frames.length === 0) return;
        data = Buffer.alloc(0);
        for (const frame of frames) {
          const parsed = hl7.parseMessage(frame);
          socket.write(hl7.frameMllp(`MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-${parsed.messageControlId}|P|2.3\rMSA|AA|${parsed.messageControlId}|OK\r`));
        }
      });
    }));
    servers.push(server);
    const port = await listen(server);

    const config = {
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 1000,
      ackTimeoutMs: 1000,
      keepAlive: true,
    };
    const first = await sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-KA-1|P|2.3\r', config);
    const second = await sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-KA-2|P|2.3\r', config);

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(first.reusedConnection).toBe(true);
    expect(second.reusedConnection).toBe(true);
    expect(connectionCount).toBe(1);
  });

  it('sends HL7 over TLS when tls.enabled is set', async () => {
    const cert = createSelfSignedCert();
    let receivedPayload = null;
    const server = trackSockets(tls.createServer({ key: cert.key, cert: cert.cert }, (socket) => {
      socket.on('data', (chunk) => {
        const frames = hl7.extractMllpFrames(chunk);
        if (frames.length > 0) {
          receivedPayload = frames[0];
          socket.write(hl7.frameMllp('MSH|^~\\&|RIS|RAD|GW|HIS|20260101010101||ACK^O01|ACK-TLS|P|2.3\rMSA|AA|MSG-TLS|OK\r'));
        }
      });
    }));
    servers.push(server);
    const port = await listen(server);

    const result = await sendMllpMessage('MSH|^~\\&|GW|HIS|RIS|RAD|20260101010101||ORM^O01|MSG-TLS|P|2.3\r', {
      host: '127.0.0.1',
      port,
      connectTimeoutMs: 1000,
      ackTimeoutMs: 1000,
      tls: {
        enabled: true,
        rejectUnauthorized: false,
      },
    });

    expect(receivedPayload).toContain('MSG-TLS');
    expect(result.accepted).toBe(true);
    expect(result.ack.code).toBe('AA');
  });
});
