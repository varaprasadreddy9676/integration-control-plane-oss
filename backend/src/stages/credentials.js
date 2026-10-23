'use strict';

/**
 * Credentials for stage HTTP calls. A stage names its credential explicitly
 * (stage.auth); nothing is forwarded automatically. Values are resolved here, in
 * the parent, at call time (so rotation applies), handed to the recorder only for
 * the stage's allowed origins, and never reach the script or a record.
 *
 *   { credentialRef: 'cred_...' }  an org credential (credential_placeholders);
 *                                  returns its decrypted fields
 *   { source: 'integration' }      the integration's own outgoing auth and custom
 *                                  headers; returns those headers
 *
 * Resolves to null when the credential is missing, not filled in, or belongs to
 * another org: the stage then fails visibly instead of calling without it.
 */

const { log } = require('../logger');

async function integrationHeaders(integration) {
  const { buildAuthHeaders } = require('../processor/auth-helper');
  const headers = { ...(await buildAuthHeaders(integration, 'GET', integration.targetUrl)) };
  for (const [name, value] of Object.entries(integration.customHeaders || {})) {
    if (typeof value === 'string') headers[name] = value;
  }
  return headers;
}

async function resolveCredential(orgId, auth, integration) {
  try {
    if (auth.source === 'integration') return integration ? await integrationHeaders(integration) : null;
    const credentials = require('../data/credentials');
    return await credentials.getCredentialSecretValues(orgId, auth.credentialRef);
  } catch (error) {
    log('warn', 'Stage credential could not be resolved', { orgId, credentialRef: auth.credentialRef || null, error: error.message });
    return null;
  }
}

module.exports = { resolveCredential, integrationHeaders };
