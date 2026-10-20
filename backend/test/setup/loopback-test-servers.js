'use strict';

/**
 * supertest starts each test server with app.listen(0) — every interface — and
 * sends the request to 127.0.0.1:<port>. On macOS another process may already
 * listen on 127.0.0.1 at that same port number (editors and Docker Desktop
 * open many), and macOS hands the IPv4 connection to that process: a random
 * 404 from a route that exists. Linux won't assign such a port, so this only
 * bit local runs.
 *
 * When the server is bound to every interface, send the request over IPv6
 * loopback instead, where an IPv4 listener can't intercept it.
 */
const Test = require('supertest/lib/test');

const originalServerAddress = Test.prototype.serverAddress;

Test.prototype.serverAddress = function serverAddress(app, path) {
  const url = originalServerAddress.call(this, app, path);
  const server = this._server || app;
  const address = server && typeof server.address === 'function' ? server.address() : null;
  return address && address.address === '::' ? url.replace('://127.0.0.1:', '://[::1]:') : url;
};
