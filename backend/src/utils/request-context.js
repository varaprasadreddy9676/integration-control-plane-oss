'use strict';

/**
 * The current HTTP request, available to code below the routes (the data layer)
 * without threading it through every call. Set once per request in index.js;
 * read lazily, so auth that runs later has already filled in req.user.
 */

const { AsyncLocalStorage } = require('async_hooks');

const storage = new AsyncLocalStorage();

function requestContextMiddleware(req, _res, next) {
  storage.run({ req }, next);
}

/** The signed-in user making the current request, or null outside a request. */
function currentActor() {
  const user = storage.getStore()?.req?.user;
  if (!user) return null;
  return { id: user.id != null ? String(user.id) : null, email: user.email || null };
}

module.exports = { requestContextMiddleware, currentActor, runWithRequest: (req, fn) => storage.run({ req }, fn) };
