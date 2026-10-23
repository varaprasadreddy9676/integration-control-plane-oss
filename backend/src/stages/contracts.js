'use strict';

/**
 * Script contracts: what a script stage's code sees and how its answer is read.
 *
 *   1                             ctx (event, delivery, stages, run, vars, inputs)
 *                                 and http, lookup, log, skip, fail; returns
 *                                 { status, done, data }. Inputs are read-only.
 *   legacy:follow-up              a migrated delivery follow-up, as it ran before
 *   legacy:response-transform     a migrated SCRIPT response transformation
 *   legacy:pre-delivery-checks    migrated pre-delivery checks (url-check runner;
 *                                 no script, only its old messages and limits)
 *
 * A legacy contract reproduces the old execution environment instead of asking
 * for the script to be rewritten: the script is the body of
 * `async function transform(payload, context)`, with mutable inputs, the utility
 * functions, the old `http` helper (any status is returned, a network failure
 * throws "HTTP GET failed: ..."), 30 s per call, and the old way of reading the
 * answer.
 *
 * Credentials for migrated follow-ups: `context.headers` holds opaque references,
 * not values. When the script sends one as a header to one of the stage's
 * allowed origins (runner.config.allowedOrigins), the parent puts the real value
 * in its place (and masks it in the record); a script that sends one anywhere
 * else, or puts one in a URL or body, fails with an error saying it is not
 * supported. Only what the script sends is sent, as before.
 */

const crypto = require('crypto');

const LEGACY_LIMITS = { callTimeoutMs: 30000 };

function legacyCode(code, prefix = '') {
  return `return (async function transform(payload, context) {\n${prefix}${code}\n})(payload, context);`;
}

const originOf = (url) => {
  try {
    return new URL(String(url)).origin;
  } catch (_error) {
    return null;
  }
};

/** The old helper's behavior on top of the recorder: errors read "HTTP GET failed: ...". */
function legacyHttp(ctx, transform = (args) => args) {
  return async (args, options) => {
    const prepared = transform(args);
    try {
      return await ctx.http(prepared, options);
    } catch (error) {
      const method = prepared.responseType === 'base64' ? 'getBuffer' : String(prepared.method || 'GET').toUpperCase();
      const wrapped = new Error(`HTTP ${method} failed: ${error.message}`);
      wrapped.code = error.code;
      throw wrapped;
    }
  };
}

/** Opaque references for the integration's header values, and the guard for calls. */
function credentialReferences(names) {
  const nonce = crypto.randomBytes(6).toString('hex');
  const refs = {};
  names.forEach((name, index) => {
    refs[name] = `@@stage-credential-${index}-${nonce}@@`;
  });
  const tokens = new Set(Object.values(refs));
  const contains = (value) => {
    if (typeof value === 'string') return [...tokens].some((token) => value.includes(token));
    if (Array.isArray(value)) return value.some(contains);
    if (value && typeof value === 'object') return Object.values(value).some(contains);
    return false;
  };
  return { refs, tokens, contains };
}

const followUp = {
  id: 'legacy:follow-up',
  limits: LEGACY_LIMITS,
  freezeInputs: false,
  extras: ['utilities', 'contextLog', 'contextHttp'],
  code: (stage) => legacyCode(stage.runner.config.code, 'const delivery = payload;\n'),

  async prepare(ctx) {
    const integration = ctx.integration || {};
    const { integrationHeaders } = require('./credentials');
    const real = await integrationHeaders(integration).catch(() => ({}));
    const names = Object.keys(real);
    const { refs, tokens, contains } = credentialReferences(names);
    const valueOf = new Map(names.map((name) => [refs[name], real[name]]));
    const allowed = new Set((ctx.stage.runner.config.allowedOrigins || []).map(originOf));
    const response = ctx.scope.delivery.response || {};

    const http = legacyHttp(ctx, (args) => {
      const options = args.options || {};
      const headers = { ...(options.headers || {}) };
      const carried = Object.entries(headers).filter(([, value]) => typeof value === 'string' && tokens.has(value));
      if (carried.length && !allowed.has(originOf(args.url))) {
        throw Object.assign(new Error(`Not supported: this script sends the integration's credentials to ${originOf(args.url)}, which is not an allowed origin`), {
          code: 'UNSUPPORTED_CREDENTIAL_USE',
        });
      }
      if (contains(args.url) || contains(args.body) || contains(options.params)) {
        throw Object.assign(new Error('Not supported: this script puts the integration\'s credentials somewhere other than request headers'), {
          code: 'UNSUPPORTED_CREDENTIAL_USE',
        });
      }
      for (const [name, token] of carried) {
        const value = valueOf.get(token);
        if (ctx.addSecret) ctx.addSecret(value);
        headers[name] = value;
      }
      return { ...args, options: { ...options, headers } };
    });

    return {
      globals: {
        payload: {
          statusCode: response.status === undefined ? null : response.status,
          response: response.body === undefined ? null : response.body,
          sentAt: ctx.scope.delivery.acceptedAt ? new Date(ctx.scope.delivery.acceptedAt).toISOString() : null,
          check: ctx.scope.run ? ctx.scope.run.seq : 1,
        },
        context: {
          orgId: ctx.orgId,
          integrationId: String(integration.id || integration._id || ''),
          eventType: integration.eventType || integration.type || null,
          headers: refs,
        },
      },
      helpers: { http },
    };
  },

  /** The old reading: status words, done by status, a known status is never replaced by PENDING. */
  readResult(result, scope) {
    const run = scope.run || {};
    const lastCheck = run.of !== undefined && run.seq >= run.of;
    if (result.outcome === 'skipped') {
      return { ...result, outcome: 'ok', value: { status: 'NOT_TRACKED', done: true, data: {} }, reason: result.reason || 'Not tracked' };
    }
    if (result.outcome !== 'ok') return result;
    let read;
    try {
      const { normalizeFollowUpResult } = require('../services/delivery-follow-up');
      read = normalizeFollowUpResult(result.value);
    } catch (error) {
      return { ...result, outcome: 'error', errorCode: 'BAD_RESULT', error: error.message };
    }
    const known = run.lastStatus && run.lastStatus !== 'PENDING' ? run.lastStatus : null;
    let status = read.status !== 'PENDING' ? read.status : known || 'PENDING';
    const done = read.done || lastCheck;
    if (done && status === 'PENDING') status = 'UNKNOWN';
    const iso = (date) => (date ? date.toISOString() : null);
    return {
      ...result,
      value: {
        status,
        done,
        data: {
          deliveredAt: iso(read.deliveredAt),
          readAt: iso(read.readAt),
          errorCode: read.errorCode === undefined ? null : read.errorCode,
          errorMessage: read.errorMessage === undefined ? null : read.errorMessage,
        },
      },
    };
  },
  outputs: [
    { name: 'deliveredAt', type: 'string' },
    { name: 'readAt', type: 'string' },
    { name: 'errorCode', type: 'string' },
    { name: 'errorMessage', type: 'string' },
  ],
};

const responseTransform = {
  id: 'legacy:response-transform',
  limits: LEGACY_LIMITS,
  freezeInputs: false,
  extras: ['utilities', 'hl7', 'contextLog', 'contextHttp'],
  code: (stage) => legacyCode(stage.runner.config.code),
  /** It ran only for a 2xx answer. */
  shouldRun: (scope) => {
    const status = scope.delivery.response && scope.delivery.response.status;
    return status >= 200 && status < 300;
  },
  async prepare(ctx) {
    const integration = ctx.integration || {};
    const response = ctx.scope.delivery.response || {};
    return {
      globals: {
        payload: response.body === undefined ? null : response.body,
        context: {
          orgId: ctx.orgId,
          orgUnitRid: ctx.orgUnitRid,
          eventType: integration.eventType || integration.type || null,
        },
      },
      helpers: { http: legacyHttp(ctx) },
    };
  },
  /** skip(reason, { shouldRetry }) was the only answer that mattered: a failed send. */
  readResult(result) {
    if (result.outcome === 'skipped') {
      return {
        ...result,
        outcome: 'failed',
        error: result.reason || 'transformation skipped',
        retryStage: false,
        retryDelivery: Boolean(result.details && result.details.shouldRetry === true),
      };
    }
    if (result.outcome === 'ok') return { ...result, value: null };
    return result;
  },
};

const preDeliveryChecks = { id: 'legacy:pre-delivery-checks', limits: {} };

const CONTRACTS = new Map([followUp, responseTransform, preDeliveryChecks].map((contract) => [contract.id, contract]));

/** The contract a stage runs under; null for contract 1. */
function getContract(id) {
  return CONTRACTS.get(id) || null;
}

/** Legacy stages keep their old limits: they are exempt from the inline latency budget. */
function isBudgetExempt(stage) {
  return stage.contract === 'legacy:pre-delivery-checks' || stage.contract === 'legacy:response-transform';
}

module.exports = { getContract, isBudgetExempt, legacyCode, CONTRACTS };
