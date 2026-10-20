'use strict';

const http = require('http');
const express = require('express');
const request = require('supertest');

// Guards test/setup/loopback-test-servers.js: a process listening on
// 127.0.0.1 at the test server's port must not receive supertest's request.
it('reaches the test server even when another process holds 127.0.0.1 on the same port', async () => {
  const app = express();
  app.get('/ping', (_req, res) => res.send('test server'));
  const server = http.createServer(app).listen(0);
  const { port, address } = server.address();
  const intruder = http.createServer((_req, res) => res.writeHead(404).end('other app'));
  try {
    if (address === '::') {
      // macOS lets the intruder share the port (the bug); Linux refuses with
      // EADDRINUSE, so there the collision can't happen at all.
      await new Promise((resolve) => {
        intruder.once('error', () => resolve(false));
        intruder.listen(port, '127.0.0.1', () => resolve(true));
      });
    }
    const res = await request(server).get('/ping');
    expect(res.status).toBe(200);
    expect(res.text).toBe('test server');
  } finally {
    if (intruder.listening) intruder.close();
    server.close();
  }
});
