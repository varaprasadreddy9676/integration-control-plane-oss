'use strict';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROXY_HEADERS = ['x-forwarded-for', 'forwarded', 'x-real-ip'];

/**
 * Only for calls made on this machine (e.g. a transformation script calling
 * http://localhost:<port>/internal/...). A request relayed by a reverse proxy
 * also arrives from loopback, so any proxy header means it came from outside.
 * Answers 404 so the route isn't advertised.
 */
function localOnly(req, res, next) {
  const remote = req.socket && req.socket.remoteAddress;
  const proxied = PROXY_HEADERS.some((name) => req.headers && req.headers[name]);
  if (LOOPBACK.has(remote) && !proxied) return next();
  return res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
}

module.exports = localOnly;
