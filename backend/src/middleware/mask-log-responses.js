'use strict';

const { maskLogSecrets } = require('../utils/integration-secrets');

/**
 * For routers whose responses include delivery logs: every JSON response has
 * the credentials in its URLs and request headers masked.
 */
function maskLogResponses(_req, res, next) {
  const json = res.json.bind(res);
  res.json = (body) => json(maskLogSecrets(body));
  next();
}

module.exports = { maskLogResponses };
