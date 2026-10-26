const { log } = require('../logger');
const { applyLookups, resolveLookup } = require('./lookup-service');
const { getGlobalUtilities } = require('./script-utilities');
const { maskLogSecrets } = require('../utils/integration-secrets');

const MAX_DEPTH = 50;

function truncateForTrace(data, maxLen = 3000) {
  if (data === null || data === undefined) return null;
  const str = typeof data === 'string' ? data : JSON.stringify(data);
  return str.length > maxLen ? str.slice(0, maxLen) + '…[truncated]' : str;
}
const TRANSFORMATION_SKIP_MARKER = '__integrationControlPlaneSkip__';

function normalizeTransformationSkipReason(value) {
  if (!value || typeof value !== 'object') return null;
  const candidates = [value.reason, value.errorMessage, value.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function createTransformationSkip(reason, details = null) {
  const normalizedReason = typeof reason === 'string' && reason.trim() ? reason.trim() : 'transformation skipped';
  const normalizedDetails = details && typeof details === 'object' && !Array.isArray(details) ? details : null;
  return {
    [TRANSFORMATION_SKIP_MARKER]: true,
    skip: true,
    reason: normalizedReason,
    errorMessage: normalizedReason,
    details: normalizedDetails,
  };
}

function isTransformationSkipped(value) {
  return Boolean(
    value && typeof value === 'object' && (value[TRANSFORMATION_SKIP_MARKER] === true || value.skip === true)
  );
}

function getTransformationSkipReason(value) {
  if (!isTransformationSkipped(value)) return null;
  return normalizeTransformationSkipReason(value) || 'transformation skipped';
}

function depth(obj, current = 0) {
  if (obj === null || typeof obj !== 'object') return current;
  for (const key of Object.keys(obj)) {
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      const newDepth = depth(obj[key], current + 1);
      // Return early if max depth exceeded (return actual depth, not capped)
      if (newDepth > MAX_DEPTH) return newDepth;
      current = Math.max(current, newDepth);
    }
  }
  return current;
}

function validateScript(script) {
  if (!script || typeof script !== 'string') return false;
  try {
    // Basic parse check using async wrapper to allow await in script bodies
    // eslint-disable-next-line no-new-func
    new Function('payload', 'context', `async function __transform(payload, context) { ${script} }`);
    return true;
  } catch (err) {
    log('warn', 'Script validation failed', { error: err.message });
    return false;
  }
}

const FIELD_MAPPINGS_REMOVED =
  'This transformation uses field mappings, which were removed. Rewrite it as a script (Transformation > JavaScript).';

/**
 * Whether a stored transformation still carries field mappings (or static fields), the mode that
 * was removed. One with none of them sends the payload as it is, as it always did.
 */
function usesFieldMappings(transformation) {
  if (!transformation || typeof transformation !== 'object') return false;
  return (
    (Array.isArray(transformation.mappings) && transformation.mappings.length > 0) ||
    (Array.isArray(transformation.staticFields) && transformation.staticFields.length > 0)
  );
}

/**
 * Apply transformation to payload
 * Step 1: Apply the script transformation, if any
 * Step 2: Apply lookups (code mappings)
 */
async function applyTransform(integration, payload, context = {}, _spansOut = null) {
  if (!integration) return payload;

  // Step 1: Apply standard transformation
  let transformed = payload;
  const event = {
    orgId: context.orgId || integration.orgId,
    orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
  };

  // Scheduled jobs store the mode inside the transformation object.
  switch (integration.transformationMode || integration.transformation?.mode) {
    case 'SIMPLE':
      // The removed mode: a configuration that never had mappings is a pass-through; one that has them must not
      // be sent unmapped without a word.
      if (usesFieldMappings(integration.transformation)) throw new Error(FIELD_MAPPINGS_REMOVED);
      transformed = payload;
      break;
    case 'SCRIPT':
      if (!validateScript(integration.transformation?.script)) {
        throw new Error('Invalid script transformation');
      }
      transformed = await applyScriptTransform(
        integration.transformation.script,
        payload,
        context,
        integration,
        _spansOut,
        'request_transform'
      );
      break;
    default:
      transformed = payload;
  }

  if (transformed === null || isTransformationSkipped(transformed)) {
    return transformed;
  }

  // Step 2: Apply lookups (if configured)
  if (integration.lookups && integration.lookups.length > 0) {
    const event = {
      orgId: context.orgId || integration.orgId,
      orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
    };
    transformed = await applyLookups(transformed, integration.lookups, event);
  }

  return transformed;
}

/**
 * Create HTTP helper for transformation scripts
 * Allows scripts to make external API calls with security controls
 */
function createHttpHelper(context, _spansOut = null, _parentSpanName = null) {
  const axios = require('axios');

  // Only a caller that asks (context.captureHttpHeaders) gets request headers on the span, masked.
  const headersFor = (options) =>
    context && context.captureHttpHeaders
      ? { requestHeaders: maskLogSecrets({ requestHeaders: (options && options.headers) || {} }).requestHeaders }
      : {};

  const recordSpan = async (method, url, requestBody, options, requestFn) => {
    const startedAt = Date.now();
    try {
      const response = await requestFn();
      if (_spansOut) {
        _spansOut.push({
          name: 'script_http',
          kind: 'HTTP',
          method: method.toUpperCase(),
          url,
          statusCode: response.status,
          status: response.status < 400 ? 'ok' : 'error',
          duration: Date.now() - startedAt,
          startedAt,
          requestBody: truncateForTrace(requestBody),
          responseBody: truncateForTrace(response.data),
          ...headersFor(options),
          _parentSpanName,
        });
      }
      return response;
    } catch (error) {
      if (_spansOut) {
        _spansOut.push({
          name: 'script_http',
          kind: 'HTTP',
          method: method.toUpperCase(),
          url,
          status: 'error',
          duration: Date.now() - startedAt,
          startedAt,
          error: error.message,
          ...headersFor(options),
          _parentSpanName,
        });
      }
      throw error;
    }
  };

  return {
    get: async (url, options = {}) => {
      log('debug', 'Script HTTP GET request', { url, context: context.eventType });
      try {
        return await recordSpan('GET', url, null, options, () =>
          axios
            .get(url, {
              timeout: options.timeout || 30000,
              headers: options.headers || {},
              params: options.params || {},
              validateStatus: () => true,
            })
            .then((r) => ({ status: r.status, data: r.data, headers: r.headers }))
        );
      } catch (error) {
        log('error', 'Script HTTP GET failed', { url, error: error.message });
        throw new Error(`HTTP GET failed: ${error.message}`);
      }
    },

    post: async (url, data, options = {}) => {
      log('debug', 'Script HTTP POST request', { url, context: context.eventType });
      try {
        return await recordSpan('POST', url, data, options, () =>
          axios
            .post(url, data, {
              timeout: options.timeout || 30000,
              headers: options.headers || {},
              validateStatus: () => true,
            })
            .then((r) => ({ status: r.status, data: r.data, headers: r.headers }))
        );
      } catch (error) {
        log('error', 'Script HTTP POST failed', { url, error: error.message });
        throw new Error(`HTTP POST failed: ${error.message}`);
      }
    },

    put: async (url, data, options = {}) => {
      log('debug', 'Script HTTP PUT request', { url, context: context.eventType });
      try {
        return await recordSpan('PUT', url, data, options, () =>
          axios
            .put(url, data, {
              timeout: options.timeout || 30000,
              headers: options.headers || {},
              validateStatus: () => true,
            })
            .then((r) => ({ status: r.status, data: r.data, headers: r.headers }))
        );
      } catch (error) {
        log('error', 'Script HTTP PUT failed', { url, error: error.message });
        throw new Error(`HTTP PUT failed: ${error.message}`);
      }
    },

    patch: async (url, data, options = {}) => {
      log('debug', 'Script HTTP PATCH request', { url, context: context.eventType });
      try {
        return await recordSpan('PATCH', url, data, options, () =>
          axios
            .patch(url, data, {
              timeout: options.timeout || 30000,
              headers: options.headers || {},
              validateStatus: () => true,
            })
            .then((r) => ({ status: r.status, data: r.data, headers: r.headers }))
        );
      } catch (error) {
        log('error', 'Script HTTP PATCH failed', { url, error: error.message });
        throw new Error(`HTTP PATCH failed: ${error.message}`);
      }
    },

    delete: async (url, options = {}) => {
      log('debug', 'Script HTTP DELETE request', { url, context: context.eventType });
      try {
        return await recordSpan('DELETE', url, null, options, () =>
          axios
            .delete(url, {
              timeout: options.timeout || 30000,
              headers: options.headers || {},
              validateStatus: () => true,
            })
            .then((r) => ({ status: r.status, data: r.data, headers: r.headers }))
        );
      } catch (error) {
        log('error', 'Script HTTP DELETE failed', { url, error: error.message });
        throw new Error(`HTTP DELETE failed: ${error.message}`);
      }
    },

    getBuffer: async (url, options = {}) => {
      log('debug', 'Script HTTP getBuffer request', { url, context: context.eventType });
      const startedAt = Date.now();
      try {
        const response = await axios.get(url, {
          timeout: options.timeout || 30000,
          headers: options.headers || {},
          responseType: 'arraybuffer',
          validateStatus: () => true,
        });
        const base64 = Buffer.from(response.data).toString('base64');
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        if (_spansOut) {
          _spansOut.push({
            name: 'script_http',
            kind: 'HTTP',
            method: 'GET_BUFFER',
            url,
            statusCode: response.status,
            status: response.status < 400 ? 'ok' : 'error',
            duration: Date.now() - startedAt,
            startedAt,
            responseBody: `[binary ${contentType}, base64 length: ${base64.length}]`,
            _parentSpanName,
          });
        }
        return { status: response.status, base64, contentType };
      } catch (error) {
        log('error', 'Script HTTP getBuffer failed', { url, error: error.message });
        if (_spansOut) {
          _spansOut.push({
            name: 'script_http',
            kind: 'HTTP',
            method: 'GET_BUFFER',
            url,
            status: 'error',
            duration: Date.now() - startedAt,
            startedAt,
            error: error.message,
            _parentSpanName,
          });
        }
        throw new Error(`HTTP getBuffer failed: ${error.message}`);
      }
    },
  };
}

async function applyScriptTransform(
  script,
  payload,
  context,
  integration = null,
  _spansOut = null,
  _parentSpanName = null
) {
  try {
    // Use secure VM wrapper (replacement for vm2) for script execution with async support
    const { VM } = require('../utils/secure-vm');
    const hl7 = require('./hl7/codec');

    // Create HTTP helper with span collection support
    const http = createHttpHelper(context, _spansOut, _parentSpanName);

    // Build lookup() helper — resolves a value via the lookup table for this org.
    // Usage in script: lookup(value, 'LOOKUP_TYPE')
    // Returns the mapped value, or the original value if no mapping found (pass-through).
    const orgId = context.orgId || integration?.orgId;
    const orgUnitRid = context.orgUnitRid || integration?.orgUnitRid || integration?.entityRid;
    const LOOKUP_TIMEOUT_MS = 8000;
    const lookupFn = async (value, type) => {
      if (!value || !type) return value;
      let lookupTimeoutHandle;
      try {
        const mapped = await Promise.race([
          resolveLookup(value, type, orgId, orgUnitRid),
          new Promise((_, reject) => {
            lookupTimeoutHandle = setTimeout(
              () => reject(new Error(`lookup(${type}) timed out after ${LOOKUP_TIMEOUT_MS}ms`)),
              LOOKUP_TIMEOUT_MS
            );
          }),
        ]);
        return mapped !== null && mapped !== undefined ? mapped : value;
      } catch (err) {
        log('warn', 'lookup() failed in transform script, returning original value', {
          value,
          type,
          error: err.message,
          orgId,
        });
        return value;
      } finally {
        // Same leak class already fixed in src/utils/timeout.js: Promise.race
        // never cancels the loser, so on every lookup() call that resolves
        // normally (the common case), this timer was left running for the
        // full 8s — a real handle leak on a helper a transform script can
        // call many times per event.
        clearTimeout(lookupTimeoutHandle);
      }
    };

    // context.log() — captured into the execution trace as script_log spans
    const scriptLog = (...args) => {
      if (_spansOut) {
        _spansOut.push({
          name: 'script_log',
          kind: 'LOG',
          message: args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' '),
          startedAt: Date.now(),
          duration: 0,
          status: 'ok',
          _parentSpanName,
        });
      }
    };

    const vm = new VM({
      timeout: 60000, // 60 second timeout for complex workflows
      sandbox: {
        payload,
        context: { ...context, http, log: scriptLog },
        // Inject global utility functions
        ...getGlobalUtilities(),
        // Allow scripts to intentionally skip while preserving a human-readable reason
        skip: (reason, details = null) => createTransformationSkip(reason, details),
        // Inject HTTP helper for external API calls
        http,
        // Inject lookup() for explicit code mapping inside scripts
        lookup: lookupFn,
        // Inject HL7 helpers for JSON <-> HL7 transformations
        hl7,
        // Note: console.log is provided by SecureVM automatically
      },
      allowAsync: true, // ENABLE async/await for complex workflows
    });

    // Execute the transformation inside the VM so timeout/memory guards always apply.
    // Wrap in Promise.race — VM timeout covers sync code, this covers async hangs (e.g. lookup() deadlock).
    const SCRIPT_ASYNC_TIMEOUT_MS = 30000;
    const secureScript = `
      return (async function transform(payload, context) {
        ${script}
      })(payload, context)
    `;

    let asyncTimeoutHandle;
    const asyncTimeoutPromise = new Promise((_, reject) => {
      asyncTimeoutHandle = setTimeout(
        () => reject(new Error(`Transform script async timeout after ${SCRIPT_ASYNC_TIMEOUT_MS}ms`)),
        SCRIPT_ASYNC_TIMEOUT_MS
      );
      // unref so this timer never prevents process/worker exit on its own
      if (asyncTimeoutHandle.unref) asyncTimeoutHandle.unref();
    });

    let result;
    try {
      result = await Promise.race([vm.run(secureScript), asyncTimeoutPromise]);
    } finally {
      // Always clear the timeout — prevents the handle from lingering after success or throw
      clearTimeout(asyncTimeoutHandle);
    }
    if (isTransformationSkipped(result)) {
      return createTransformationSkip(result.reason, result.details);
    }
    if (depth(result) > MAX_DEPTH) {
      throw new Error('Transformed object too deep');
    }
    return result;
  } catch (error) {
    throw new Error(`Script execution failed: ${error.message}`);
  }
}

/**
 * Whether a response transformation is actually configured. An empty SCRIPT
 * is what the create endpoint stores when none is given, so it means "none",
 * not an invalid script.
 */
function hasResponseTransform(responseTransformation) {
  if (!responseTransformation) return false;
  if (responseTransformation.mode === 'SCRIPT') return Boolean(String(responseTransformation.script || '').trim());
  // Not a script: a leftover field mapping counts as configured (applying it says it was removed), and so do lookups.
  return usesFieldMappings(responseTransformation) || (Array.isArray(responseTransformation.lookups) && responseTransformation.lookups.length > 0);
}

/**
 * Apply response transformation for INBOUND integrations
 * Transforms external API response back to the client app format
 *
 * @param {Object} integration - Integration config with responseTransformation
 * @param {Object} response - Raw response from external API
 * @param {Object} context - Context object with orgId/orgUnitRid, etc.
 * @returns {Object} Transformed response in client app format
 */
async function applyResponseTransform(integration, response, context = {}, _spansOut = null) {
  if (!integration || !hasResponseTransform(integration.responseTransformation)) {
    // No transformation configured, return response as-is
    return response;
  }

  const event = {
    orgId: context.orgId || integration.orgId,
    orgUnitRid: context.orgUnitRid || integration.orgUnitRid || integration.entityRid,
  };

  let transformed = response;

  // Apply transformation based on mode
  const mode = integration.responseTransformation.mode || 'SIMPLE';

  switch (mode) {
    case 'SIMPLE':
      if (usesFieldMappings(integration.responseTransformation)) throw new Error(FIELD_MAPPINGS_REMOVED);
      transformed = response;
      break;
    case 'SCRIPT':
      if (!validateScript(integration.responseTransformation?.script)) {
        throw new Error('Invalid response transformation script');
      }
      transformed = await applyScriptTransform(
        integration.responseTransformation.script,
        response,
        context,
        null,
        _spansOut,
        'response_transform'
      );
      break;
    default:
      transformed = response;
  }

  // Apply lookups if configured (optional for response transformations)
  if (integration.responseTransformation.lookups && integration.responseTransformation.lookups.length > 0) {
    transformed = await applyLookups(transformed, integration.responseTransformation.lookups, event);
  }

  return transformed;
}

module.exports = {
  createTransformationSkip,
  getGlobalUtilities,
  getTransformationSkipReason,
  isTransformationSkipped,
  validateScript,
  applyScriptTransform,
  applyTransform,
  usesFieldMappings,
  applyResponseTransform,
  hasResponseTransform,
  truncateForTrace,
};
