const { log } = require('../logger');
const { applyLookups, resolveLookup } = require('./lookup-service');

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

/**
 * Get nested value from object using dot notation
 * e.g., getNestedValue(obj, 'patient.phoneNumber') => obj.patient.phoneNumber
 */
function getNestedValue(obj, path) {
  if (!path || !obj) return undefined;
  const keys = path.split('.');
  let value = obj;
  for (const key of keys) {
    value = value?.[key];
    if (value === undefined) return undefined;
  }
  return value;
}

async function applySimpleTransform(payload, transformation = {}, event = {}) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const result = { ...source }; // Start with original payload, then apply mappings
  const mappings = transformation && Array.isArray(transformation.mappings) ? transformation.mappings : [];

  for (const row of mappings) {
    if (!row.targetField || !row.sourceField) continue;

    // Support nested field access with dot notation
    const sourceVal = getNestedValue(source, row.sourceField);
    let val = sourceVal;

    switch (row.transform) {
      case 'trim':
        val = typeof sourceVal === 'string' ? sourceVal.trim() : sourceVal;
        break;
      case 'upper':
        val = typeof sourceVal === 'string' ? sourceVal.toUpperCase() : sourceVal;
        break;
      case 'lower':
        val = typeof sourceVal === 'string' ? sourceVal.toLowerCase() : sourceVal;
        break;
      case 'date':
        val = sourceVal ? new Date(sourceVal).toISOString() : sourceVal;
        break;
      case 'default':
        val = sourceVal ?? row.defaultValue;
        break;
      case 'lookup':
        if (row.lookupType && sourceVal) {
          // Apply inline lookup transformation
          const { resolveLookup } = require('./lookup-service');
          val = await resolveLookup(sourceVal, row.lookupType, event.orgId, event.orgUnitRid);
          // If no mapping found, keep original value (PASSTHROUGH behavior)
          if (val === null || val === undefined) {
            val = sourceVal;
          }
        }
        break;
      default:
        break;
    }

    if (val !== undefined) {
      result[row.targetField] = val;
    }
  }

  const staticFields = transformation && Array.isArray(transformation.staticFields) ? transformation.staticFields : [];
  staticFields.forEach((field) => {
    if (field?.key) {
      result[field.key] = field.value;
    }
  });

  return result;
}

/**
 * Apply transformation to payload
 * Step 1: Apply standard transformation (SIMPLE or SCRIPT)
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
      transformed = await applySimpleTransform(payload, integration.transformation, event);
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
 * Global utility functions available to all transformation scripts
 */
function getGlobalUtilities() {
  // Define epoch as a standalone function so datetime can reference it directly
  const epochFn = (dateStr) => {
    if (!dateStr) return null;
    try {
      let date;
      if (typeof dateStr === 'number') {
        date = dateStr > 10000000000 ? new Date(dateStr) : new Date(dateStr * 1000);
      } else if (dateStr.includes('/')) {
        // Handle DD/MM/YYYY or DD/MM/YYYY HH:MM AM/PM format
        const parts = dateStr.split(' ');
        const [day, month, year] = parts[0].split('/');

        if (parts.length > 1) {
          // Has time component like "04/02/2026 04:07 PM"
          const timeStr = parts.slice(1).join(' ');
          const isoDateStr = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')} ${timeStr}`;
          date = new Date(isoDateStr);
        } else {
          // Date only like "04/02/2026"
          date = new Date(year, month - 1, day);
        }
      } else if (dateStr.match(/^\d{1,2}-[A-Za-z]{3}-\d{4}/)) {
        const parts = dateStr.split(/[\s-]+/);
        const monthMap = {
          jan: 0,
          feb: 1,
          mar: 2,
          apr: 3,
          may: 4,
          jun: 5,
          jul: 6,
          aug: 7,
          sep: 8,
          oct: 9,
          nov: 10,
          dec: 11,
        };
        date = new Date(parts[2], monthMap[parts[1].toLowerCase().substring(0, 3)], parts[0]);
      } else {
        date = new Date(dateStr);
      }
      return Number.isNaN(date.getTime()) ? null : Math.floor(date.getTime() / 1000);
    } catch (_e) {
      return null;
    }
  };

  return {
    // Date/Time utilities
    epoch: epochFn,

    datetime: (date, time, timezone) => {
      if (!date) return null;
      const tz = timezone || '+05:30';
      const dateTimeStr = time ? `${date}T${time}${tz}` : `${date}T00:00:00${tz}`;
      return epochFn(dateTimeStr); // Call epochFn directly instead of this.epoch
    },

    // String utilities
    uppercase: (str) => (str ? String(str).toUpperCase() : str),

    lowercase: (str) => (str ? String(str).toLowerCase() : str),

    trim: (str) => (str ? String(str).trim() : str),

    // Phone utilities
    formatPhone: (phone, countryCode) => {
      if (!phone) return phone;
      const cc = countryCode || '91';
      const cleaned = String(phone).replace(/\D/g, '');
      if (cleaned.startsWith(cc)) return `+${cleaned}`;
      return `+${cc}${cleaned}`;
    },

    // Object utilities
    get: (obj, path, defaultValue) => {
      if (!path || !obj) return defaultValue;
      const keys = path.split('.');
      let value = obj;
      for (const key of keys) {
        value = value?.[key];
        if (value === undefined) return defaultValue;
      }
      return value;
    },
  };
}

/**
 * Create HTTP helper for transformation scripts
 * Allows scripts to make external API calls with security controls
 */
function createHttpHelper(context, _spansOut = null, _parentSpanName = null) {
  const axios = require('axios');

  const recordSpan = async (method, url, requestBody, requestFn) => {
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
        return await recordSpan('GET', url, null, () =>
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
        return await recordSpan('POST', url, data, () =>
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
        return await recordSpan('PUT', url, data, () =>
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
        return await recordSpan('PATCH', url, data, () =>
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
        return await recordSpan('DELETE', url, null, () =>
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
  const mode = responseTransformation.mode || 'SIMPLE';
  return mode !== 'SCRIPT' || Boolean(String(responseTransformation.script || '').trim());
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
      transformed = await applySimpleTransform(response, integration.responseTransformation, event);
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
  applyTransform,
  applyResponseTransform,
  hasResponseTransform,
  truncateForTrace,
};
