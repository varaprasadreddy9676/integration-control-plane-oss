const { fetch, AbortController } = require('../utils/runtime');
const config = require('../config');
const data = require('../data');
const _mongodb = require('../mongodb');
const { log } = require('../logger');
const transformer = require('../services/transformer');
const { validateTargetUrl } = require('../utils/url-check');
const { buildAuthHeaders } = require('./auth-helper');
const { resolveReplayCustomHeaders } = require('../utils/custom-headers');
const { generateSignatureHeaders } = require('../services/integration-signing');
const { withTimeout } = require('../utils/timeout');
const { createExecutionLogger } = require('../utils/execution-logger');
const { checkRateLimit } = require('../middleware/rate-limiter');
const dlqData = require('../data/dlq');
const { evaluateCondition } = require('./condition-evaluator');
const { generateCorrelationId, sleep, isTestEvent, safeRead } = require('../utils/event-utils');
const { applyTransform, applyResponseTransform } = transformer;
const getTransformationSkipReason = transformer.getTransformationSkipReason || (() => null);
const isTransformationSkipped = transformer.isTransformationSkipped || (() => false);
const hl7 = require('../services/hl7/codec');
const { sendMllpMessage } = require('../services/hl7/mllp-client');

// Move dynamic require to top-level (was inside deliverSingleAction)
const adapterRegistry = require('../services/communication/adapter-registry');
const { isSenderRoutingEnabled, resolveSenderRoute } = require('../services/communication/sender-routing');
const { applyProviderRef } = require('../services/operation-templates');

/**
 * Returns true for SMTP/communication credential errors that will never
 * succeed on retry (wrong password, account locked, auth rejected).
 * These should be failed immediately — no DLQ, no retry.
 */
function isCredentialError(errMsg) {
  if (!errMsg) return false;
  const msg = errMsg.toLowerCase();
  return (
    msg.includes('invalid login') ||
    msg.includes('too many login attempts') ||
    msg.includes('username and password not accepted') ||
    msg.includes('authentication failed') ||
    msg.includes('authentication unsuccessful') ||
    msg.includes('authentication credentials invalid') ||
    msg.includes('535 ') || // SMTP 535: auth failed
    msg.includes('534 ') || // SMTP 534: auth required
    msg.includes('530 ') // SMTP 530: auth required
  );
}

async function resolveMultiActionDelayMs(orgId) {
  const defaultDelay = config.worker?.multiActionDelayMs || 0;

  if (!orgId) {
    return defaultDelay;
  }

  try {
    const uiConfig = await data.getUiConfigForEntity(orgId);
    const overrideDelay = uiConfig?.worker?.multiActionDelayMs;
    if (Number.isFinite(overrideDelay)) {
      return overrideDelay;
    }
  } catch (err) {
    log('warn', 'Failed to read ui_config for multi-action delay; using config.json value', {
      orgId,
      error: err.message,
    });
  }

  return defaultDelay;
}

async function deliverSingleAction(
  integration,
  action,
  evt,
  pollCount = 0,
  actionIndex = 0,
  correlationId = null,
  executionLogger = null,
  options = {}
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const actionName = action.name || `Action ${actionIndex + 1}`;
  const start = Date.now();
  const attemptCount = (evt.attempt_count || 0) + 1;
  const isTest = isTestEvent(evt);
  const triggerType = options.triggerType || 'EVENT';
  const existingLogId = options.existingLogId || null;
  const manualReason = options.retryReason || options.reason || null;
  const orgId = evt.orgId || integration.orgId;

  const maybeCreateActionDLQ = async ({ logId, errorMessage, errorCode, responseStatus, responseBody }) => {
    if (isTest) return;
    if (!errorMessage && !errorCode) return;
    // A delivery that is itself a DLQ retry must not create a second DLQ entry.
    // The worker already tracks the original via recordRetryAttempt, which
    // increments retryCount and can abandon it once maxRetries is reached.
    // Creating a new entry here instead reset retryCount to 0 every time, so
    // maxRetries never terminated anything: one misconfigured Communication
    // integration produced ~6,000 fresh DLQ rows an hour on production, each
    // with a full retry budget, and the disk pressure that came with it.
    if (options.fromDlqRetry) return;

    try {
      await dlqData.createDLQEntry({
        traceId: traceId,
        messageId: evt.eventId || evt.id || null,
        integrationConfigId: integration.id,
        orgId,
        direction: integration.direction || 'OUTBOUND', // FIX: Use integration's direction
        payload: evt.payload,
        error: {
          message: errorMessage || 'Action delivery failed',
          code: errorCode || 'ACTION_FAILURE',
          statusCode: responseStatus || null,
        },
        metadata: {
          logId,
          actionName,
          actionIndex,
          eventType: evt.event_type,
          integrationName: integration.name,
          targetUrl: action.targetUrl || integration.targetUrl,
          httpMethod:
            action.httpMethod || integration.httpMethod || (action.kind === 'COMMUNICATION' ? 'COMMUNICATION' : 'POST'),
          responseBody,
        },
      });
    } catch (err) {
      log('warn', 'Failed to create DLQ entry for action failure', {
        integrationId: integration.id,
        actionName,
        error: err.message,
      });
    }
  };

  // ============================================
  // PROVIDER REF: Resolve operation template if action references one.
  // e.g. action.providerRef = { providerKey: 'partnerhub', operationKey: 'fetch-profile',
  //                              placeholders: { partnerId: '...' } }
  // Resolved fields (targetUrl, auth, headers) are merged under the action;
  // explicit action-level fields still take precedence.
  // ============================================
  let resolvedAction = action;
  try {
    resolvedAction = await applyProviderRef(orgId, action);
  } catch (err) {
    log('warn', 'Failed to resolve providerRef on action, using raw action config', {
      integrationId: integration.id,
      actionName,
      error: err.message,
    });
  }

  // ============================================
  // EARLY CHECK: Handle COMMUNICATION actions first (skip URL validation)
  // ============================================
  const isCommunicationAction = resolvedAction.kind === 'COMMUNICATION';
  const isHl7MllpAction = resolvedAction.kind === 'HL7_MLLP';
  const isProtocolAction = isCommunicationAction || isHl7MllpAction;
  const targetUrl = resolvedAction.targetUrl || integration.targetUrl;

  // Validate target URL for HTTP actions only
  if (!isProtocolAction) {
    const urlCheck = validateTargetUrl(targetUrl, config.security);
    if (!urlCheck.valid) {
      if (executionLogger) {
        await executionLogger
          .addStep('action_url_validation', {
            status: 'failed',
            durationMs: 0,
            metadata: { actionName, actionIndex, url: targetUrl },
            error: { message: urlCheck.reason },
          })
          .catch((err) => log('warn', 'Failed to record action URL validation step', { error: err.message }));
      }

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: 'FAILED',
        responseStatus: 400,
        responseTimeMs: 0,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: evt.payload,
        errorMessage: `${prefix}${urlCheck.reason}`,
        targetUrl,
        httpMethod: action.httpMethod || integration.httpMethod || 'POST',
        // Distributed tracing
        correlationId: traceId,
        traceId: traceId,
        // Request details (not available yet at URL validation stage)
        requestHeaders: null,
      });
      await maybeCreateActionDLQ({
        logId,
        errorMessage: `${prefix}${urlCheck.reason}`,
        errorCode: 'INVALID_URL',
        responseStatus: 400,
      });
      return { status: 'FAILED', logId };
    }
  }

  // Apply action-specific or integration-level transformation
  let transformed = evt.payload;
  const transformStart = Date.now();
  try {
    const hasActionTransformation = action.transformation && typeof action.transformation === 'object';
    const hasActionScript =
      typeof action.transformation?.script === 'string' && action.transformation.script.trim().length > 0;
    const actionTransformationMode =
      action.transformationMode || (hasActionTransformation ? (hasActionScript ? 'SCRIPT' : 'SIMPLE') : null);

    if (hasActionTransformation || actionTransformationMode) {
      // Action has its own transformation
      const actionAsIntegration = {
        ...integration,
        transformation: hasActionTransformation ? action.transformation : integration.transformation,
        transformationMode: actionTransformationMode || integration.transformationMode,
      };
      transformed = await applyTransform(actionAsIntegration, evt.payload, {
        eventType: evt.event_type,
        orgId,
      });
    } else {
      // Use integration-level transformation
      transformed = await applyTransform(integration, evt.payload, {
        eventType: evt.event_type,
        orgId,
      });
    }

    const transformedIsNull = transformed === null || isTransformationSkipped(transformed);
    const transformationSkipReason = getTransformationSkipReason(transformed);
    if (executionLogger) {
      await executionLogger
        .addStep('action_transformation', {
          status: transformedIsNull ? 'warning' : 'success',
          durationMs: Date.now() - transformStart,
          metadata: { actionName, actionIndex, result: transformedIsNull ? 'skipped' : 'transformed' },
        })
        .catch(() => {});
    }

    if (transformedIsNull) {
      const skipMessage = `${prefix}Skipping delivery for ${actionName}: ${transformationSkipReason || 'transformation returned null'}`;
      log('info', skipMessage, {
        integrationId: integration.id,
        actionName,
      });

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: 'SKIPPED',
        responseStatus: 204,
        responseTimeMs: Date.now() - start,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: null,
        errorMessage: skipMessage,
        targetUrl,
        httpMethod: action.httpMethod || integration.httpMethod || 'POST',
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: null,
      });

      await data.recordDeliverySuccess(integration.id);
      if (executionLogger) {
        await executionLogger.updateStatus('skipped').catch(() => {});
      }

      return {
        status: 'SKIPPED',
        logId,
        skipReason: transformationSkipReason || 'transformation returned null',
      };
    }
  } catch (err) {
    const errorMessage = `${prefix}Transform failed for ${actionName}: ${err.message}`;
    log('error', errorMessage, {
      integrationId: integration.id,
      actionName,
      stack: err.stack,
    });

    if (executionLogger) {
      await executionLogger
        .addStep('action_transformation', {
          status: 'failed',
          durationMs: Date.now() - transformStart,
          metadata: { actionName, actionIndex },
          error: { message: err.message, stack: err.stack },
        })
        .catch(() => {});
    }
    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      integrationConfigId: integration.id,
      integrationName: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: integration.direction || 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at transformation stage)
      requestHeaders: null,
    });
    await maybeCreateActionDLQ({
      logId,
      errorMessage,
      errorCode: 'TRANSFORMATION_ERROR',
      responseStatus: 500,
    });
    return { status: 'FAILED', logId };
  }

  // Rate limit check (per integration)
  if (integration.rateLimits?.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      if (executionLogger) {
        await executionLogger
          .addStep('rate_limit', {
            status: rateResult.allowed ? 'success' : 'failed',
            durationMs,
            metadata: {
              actionName,
              actionIndex,
              remaining: rateResult.remaining,
              resetAt: rateResult.resetAt,
              maxRequests,
              windowSeconds,
            },
            error: rateResult.allowed ? null : { message: 'Rate limit exceeded' },
          })
          .catch((err) => log('warn', 'Failed to record rate limit step', { error: err.message }));
      }

      if (!rateResult.allowed) {
        const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
        const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

        const logId = await data.recordLog(orgId, {
          id: existingLogId,
          integrationConfigId: integration.id,
          integrationName: `${integration.name} - ${actionName}`,
          eventId: evt.id || null,
          eventType: evt.event_type,
          direction: integration.direction || 'OUTBOUND',
          triggerType,
          actionName,
          actionIndex,
          status: 'RETRYING',
          responseStatus: 429,
          responseTimeMs: 0,
          attemptCount,
          originalPayload: evt.payload,
          requestPayload: transformed,
          errorMessage,
          shouldRetry: true,
          targetUrl,
          httpMethod: action.httpMethod || integration.httpMethod || 'POST',
          correlationId: traceId,
          traceId: traceId,
          requestHeaders: null,
        });

        if (executionLogger) {
          await executionLogger.updateStatus('retrying').catch(() => {});
        }

        return { status: 'RETRYING', logId };
      }
    } catch (error) {
      log('warn', 'Rate limit check failed', {
        integrationId: integration.id,
        actionName,
        error: error.message,
      });
    }
  }

  if (isHl7MllpAction) {
    const hl7Start = Date.now();
    const hl7Config = action.hl7Config || action.mllpConfig || integration.hl7Config || integration.mllpConfig || {};
    const host = String(hl7Config.host || '').trim();
    const port = Number(hl7Config.port);
    const mllpTarget = host && Number.isInteger(port) ? `mllp://${host}:${port}` : 'mllp://unconfigured';

    try {
      const hl7Message = hl7.toMessageString(transformed);
      const parsedMessage = hl7.parseMessage(hl7Message);

      if (executionLogger) {
        await executionLogger
          .addStep('hl7_message_validation', {
            status: 'success',
            durationMs: Date.now() - hl7Start,
            metadata: {
              actionName,
              actionIndex,
              messageType: parsedMessage.messageType,
              messageControlId: parsedMessage.messageControlId,
            },
          })
          .catch((err) => log('warn', 'Failed to record HL7 validation step', { error: err.message }));
      }

      const sendStart = Date.now();
      const result = await sendMllpMessage(hl7Message, hl7Config);
      const responseTimeMs = Date.now() - hl7Start;
      const ackCode = result.ack?.code || null;
      const ackReason = result.ack?.errorMessage || null;
      const messageControlId = result.ack?.messageControlId || parsedMessage.messageControlId || null;

      if (executionLogger) {
        await executionLogger
          .addStep('hl7_mllp_delivery', {
            status: result.accepted ? 'success' : 'failed',
            durationMs: Date.now() - sendStart,
            metadata: {
              actionName,
              actionIndex,
              target: mllpTarget,
              ackCode,
              messageControlId,
            },
            error: result.accepted ? null : { message: ackReason || `HL7 ACK ${ackCode || 'rejected'}` },
          })
          .catch((err) => log('warn', 'Failed to record HL7 delivery step', { error: err.message }));
      }

      const metadata = {
        hl7: {
          messageType: parsedMessage.messageType,
          messageControlId: parsedMessage.messageControlId,
          ackCode,
          ackMessageControlId: messageControlId,
          accepted: result.accepted,
          requestBytes: result.requestBytes || Buffer.byteLength(hl7Message),
          responseBytes: result.responseBytes || (result.rawAck ? Buffer.byteLength(result.rawAck) : 0),
        },
      };

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: result.accepted ? 'SUCCESS' : 'FAILED',
        responseStatus: result.accepted ? 200 : 422,
        responseTimeMs,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: hl7Message,
        responseBody: result.rawAck || null,
        errorMessage: result.accepted
          ? null
          : `${prefix}HL7 ACK rejected message: ${ackReason || ackCode || 'Unknown reason'}`,
        targetUrl: mllpTarget,
        httpMethod: 'HL7_MLLP',
        correlationId: traceId,
        traceId,
        requestHeaders: null,
        metadata,
      });

      if (result.accepted) {
        await data.recordDeliverySuccess(integration.id);
        if (executionLogger) {
          await executionLogger
            .updateStatus('success')
            .catch((err) => log('warn', 'Failed to update HL7 execution status', { error: err.message }));
        }
        return { status: 'SUCCESS', logId };
      }

      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: false });
      await maybeCreateActionDLQ({
        logId,
        errorMessage: `${prefix}HL7 ACK rejected message: ${ackReason || ackCode || 'Unknown reason'}`,
        errorCode: 'HL7_ACK_REJECTED',
        responseStatus: 422,
        responseBody: result.rawAck || null,
      });
      if (executionLogger) {
        await executionLogger
          .updateStatus('failed')
          .catch((err) => log('warn', 'Failed to update HL7 execution status', { error: err.message }));
      }
      return { status: 'FAILED', logId };
    } catch (error) {
      const responseTimeMs = Date.now() - hl7Start;
      const isConfigOrMessageError =
        error.code === 'HL7_CONFIG_ERROR' ||
        error.code === 'HL7_ACK_PARSE_ERROR' ||
        /HL7 message|MSH/i.test(error.message);
      const responseStatus = error.code === 'HL7_ACK_TIMEOUT' ? 504 : isConfigOrMessageError ? 400 : 502;
      const errorMessage = `${prefix}HL7 MLLP delivery failed for ${actionName}: ${error.message}`;

      log('error', errorMessage, {
        integrationId: integration.id,
        actionName,
        error: error.message,
        code: error.code,
      });

      if (executionLogger) {
        await executionLogger
          .addStep('hl7_mllp_delivery', {
            status: 'failed',
            durationMs: responseTimeMs,
            metadata: { actionName, actionIndex, target: mllpTarget },
            error: { message: error.message, code: error.code },
          })
          .catch((err) => log('warn', 'Failed to record HL7 delivery failure step', { error: err.message }));
      }

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: integration.direction || 'OUTBOUND',
        triggerType,
        actionName,
        actionIndex,
        status: 'FAILED',
        responseStatus,
        responseTimeMs,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: transformed,
        errorMessage,
        errorCode: error.code || 'HL7_MLLP_ERROR',
        targetUrl: mllpTarget,
        httpMethod: 'HL7_MLLP',
        correlationId: traceId,
        traceId,
        requestHeaders: null,
      });

      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: !isConfigOrMessageError });
      await maybeCreateActionDLQ({
        logId,
        errorMessage,
        errorCode: error.code || 'HL7_MLLP_ERROR',
        responseStatus,
      });
      if (executionLogger) {
        await executionLogger
          .updateStatus('failed')
          .catch((err) => log('warn', 'Failed to update HL7 execution status', { error: err.message }));
      }
      return { status: 'FAILED', logId };
    }
  }

  // ============================================
  // NEW: Handle COMMUNICATION actions
  // ============================================
  if (action.kind === 'COMMUNICATION') {
    const communicationStart = Date.now();
    let senderRoutingMetadata = null;
    const { channel, provider, ...providerConfig } = action.communicationConfig || {};
    let effectiveProvider = provider;
    let effectivePayload = transformed;
    try {
      log('info', `${prefix}Delivering COMMUNICATION action via ${channel}:${provider}`, {
        integrationId: integration.id,
        actionName,
        channel,
        provider,
      });

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'running',
            durationMs: 0,
            metadata: { actionName, actionIndex, channel, provider },
          })
          .catch(() => {});
      }

      // Normalize provider name to config key
      // SMTP → smtp, GMAIL_OAUTH → gmail, OUTLOOK_OAUTH → outlook, TWILIO → twilio
      const normalizeProviderKey = (providerName) => {
        const normalized = providerName.split('_')[0].toLowerCase(); // Take first part before underscore
        return normalized;
      };

      const providerKey = normalizeProviderKey(provider);

      // Send via communication adapter
      // Try provider-specific config first (e.g., "smtp", "gmail"), then fall back to entire config
      let adapterConfig = providerConfig[providerKey] || providerConfig;

      if (isSenderRoutingEnabled(action.communicationConfig)) {
        const senderRoute = await resolveSenderRoute({
          orgId,
          communicationConfig: action.communicationConfig,
          payload: transformed,
        });
        effectiveProvider = senderRoute.provider;
        effectivePayload = senderRoute.payload;
        adapterConfig = senderRoute.adapterConfig;
        senderRoutingMetadata = {
          enabled: true,
          requestedFrom: senderRoute.requestedFrom,
          routingDecision: senderRoute.routingDecision,
          senderProfile: senderRoute.senderProfile
            ? {
                id: senderRoute.senderProfile.id,
                key: senderRoute.senderProfile.key,
                name: senderRoute.senderProfile.name,
                fromEmail: senderRoute.senderProfile.fromEmail,
                provider: senderRoute.senderProfile.provider,
                isDefault: senderRoute.senderProfile.isDefault,
              }
            : null,
        };
      }

      const result = await adapterRegistry.send(channel, effectiveProvider, effectivePayload, adapterConfig);

      const communicationTimeMs = Date.now() - communicationStart;

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'success',
            durationMs: communicationTimeMs,
            metadata: {
              actionName,
              actionIndex,
              channel,
              provider: effectiveProvider,
              messageId: result.messageId,
            },
          })
          .catch(() => {});
      }

      // Record successful delivery log
      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: 'COMMUNICATION', // Use COMMUNICATION direction for filtering
        triggerType,
        actionName,
        actionIndex,
        status: 'SUCCESS',
        responseStatus: 200,
        responseTimeMs: communicationTimeMs,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: effectivePayload,
        responseBody: JSON.stringify(result, null, 2),
        targetUrl: `${channel}:${effectiveProvider}`,
        httpMethod: 'COMMUNICATION',
        correlationId: traceId,
        traceId: traceId,
        messageId: result.messageId,
        requestHeaders: { channel, provider: effectiveProvider, requestedProvider: provider },
        metadata: senderRoutingMetadata ? { senderRouting: senderRoutingMetadata } : {},
      });

      await data.recordDeliverySuccess(integration.id);

      if (executionLogger) {
        await executionLogger.updateStatus('success').catch(() => {});
      }

      log('info', `${prefix}COMMUNICATION action delivered successfully`, {
        integrationId: integration.id,
        actionName,
        messageId: result.messageId,
        responseTimeMs: communicationTimeMs,
        provider: effectiveProvider,
      });

      return { status: 'SUCCESS', logId };
    } catch (error) {
      const errorMessage = `${prefix}COMMUNICATION delivery failed for ${actionName}: ${error.message}`;
      log('error', errorMessage, {
        integrationId: integration.id,
        actionName,
        error: error.message,
        stack: error.stack,
      });

      if (executionLogger) {
        await executionLogger
          .addStep('communication_delivery', {
            status: 'failed',
            durationMs: Date.now() - communicationStart,
            metadata: { actionName, actionIndex },
            error: { message: error.message, stack: error.stack },
          })
          .catch(() => {});
      }

      const credentialFailure = isCredentialError(error.message);
      const errorCode = credentialFailure ? 'AUTH_ERROR' : 'COMMUNICATION_ERROR';

      if (credentialFailure) {
        log('warn', `${prefix}COMMUNICATION credential error — skipping DLQ (no retry)`, {
          integrationId: integration.id,
          actionName,
          error: error.message,
        });
      }

      const logId = await data.recordLog(orgId, {
        id: existingLogId,
        integrationConfigId: integration.id,
        integrationName: `${integration.name} - ${actionName}`,
        eventId: evt.id || null,
        eventType: evt.event_type,
        direction: 'COMMUNICATION', // Use COMMUNICATION direction for filtering
        triggerType,
        actionName,
        actionIndex,
        status: 'FAILED',
        responseStatus: credentialFailure ? 401 : 500,
        responseTimeMs: Date.now() - communicationStart,
        attemptCount,
        originalPayload: evt.payload,
        requestPayload: effectivePayload,
        errorMessage,
        errorCode,
        targetUrl: action.communicationConfig
          ? `${action.communicationConfig.channel}:${effectiveProvider}`
          : 'unknown',
        httpMethod: 'COMMUNICATION',
        correlationId: traceId,
        traceId: traceId,
        requestHeaders: { channel, provider: effectiveProvider, requestedProvider: provider },
        metadata: senderRoutingMetadata ? { senderRouting: senderRoutingMetadata } : {},
      });

      // Do NOT create a DLQ entry for credential errors — retrying won't help
      // and will only worsen rate-limiting / account lockouts.
      if (!credentialFailure) {
        await maybeCreateActionDLQ({
          logId,
          errorMessage,
          errorCode: 'COMMUNICATION_ERROR',
          responseStatus: 500,
        });
      }

      if (executionLogger) {
        await executionLogger.updateStatus('failed').catch(() => {});
      }

      return { status: 'FAILED', logId };
    }
  }

  // ============================================
  // Existing: Handle HTTP actions
  // ============================================
  let headers = null;
  let messageId = null;
  let timestamp = null;
  let signatureHeaders = null;
  try {
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    const httpMethod = resolvedAction.httpMethod || action.httpMethod || integration.httpMethod || 'POST';
    // If the action resolved a provider template with its own auth config, use that.
    // Otherwise fall back to the integration-level auth config.
    const authSource =
      resolvedAction.outgoingAuthType && resolvedAction.outgoingAuthType !== 'NONE'
        ? {
            ...integration,
            outgoingAuthType: resolvedAction.outgoingAuthType,
            outgoingAuthConfig: {
              ...resolvedAction.outgoingAuthConfig,
            },
          }
        : integration;
    headers = await buildAuthHeaders(authSource, httpMethod, targetUrl);
    headers['Content-Type'] = 'application/json';
    // Merge extra headers from resolved operation template (e.g. x-partner-id, x-partner-name for PartnerHub)
    if (resolvedAction.customHeaders && typeof resolvedAction.customHeaders === 'object') {
      Object.assign(headers, resolvedAction.customHeaders);
    }
    // DISTRIBUTED TRACING: Add correlation ID header
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;

    // TOKEN QUERY PARAM: If auth config specifies tokenLocation=query, move token from header to URL
    let requestUrl = targetUrl;
    const authCfg = integration.outgoingAuthConfig || integration.authConfig;
    if (authCfg?.tokenLocation === 'query' && authCfg?.tokenQueryParamName) {
      const paramName = authCfg.tokenQueryParamName;
      const headerName = authCfg.tokenHeaderName || 'Authorization';
      const headerValue = headers[headerName] || '';
      const token = headerValue.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const sep = requestUrl.includes('?') ? '&' : '?';
        requestUrl = `${requestUrl}${sep}${paramName}=${encodeURIComponent(token)}`;
        delete headers[headerName];
      }
    }

    // WEBHOOK SIGNING: Generate signature for payload authentication
    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4(); // Unique message identifier
        timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        const payloadString = JSON.stringify(transformed); // Payload as string

        // Generate signature headers (supports multiple secrets for rotation)
        signatureHeaders = generateSignatureHeaders(integration.signingSecrets, messageId, timestamp, payloadString);

        // Add signature headers to request
        Object.assign(headers, signatureHeaders);

        log('debug', `${pollCount > 0 ? `[POLL #${pollCount}] ` : ''}Integration signature generated`, {
          messageId,
          timestamp,
          integrationId: integration.id,
          actionName,
          secretCount: integration.signingSecrets.length,
        });
      } catch (signError) {
        log('error', `${pollCount > 0 ? `[POLL #${pollCount}] ` : ''}Failed to generate integration signature`, {
          error: signError.message,
          integrationId: integration.id,
          actionName,
        });
        const error = new Error(`Signing is enabled but signature generation failed: ${signError.message}`);
        error.code = 'SIGNING_FAILED';
        throw error;
      }
    }

    const resp = await fetch(requestUrl, {
      method: httpMethod,
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });

    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    let statusOk = resp.status >= 200 && resp.status < 300;

    // RESPONSE TRANSFORMATION: run after 2xx to normalize body and detect business-level failures.
    // Works for any API regardless of how it signals errors (body field, envelope, etc.).
    // Script can call skip(reason, { shouldRetry: true/false }) to signal failure.
    let responseTransformSkip = null;
    if (statusOk && integration.responseTransformation) {
      try {
        const bodyText = await resp
          .clone()
          .text()
          .catch(() => '');
        let parsedBody;
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          parsedBody = bodyText;
        }
        const transformedResponse = await applyResponseTransform(integration, parsedBody, {
          orgId: evt.orgId || integration.orgId,
          orgUnitRid: evt.orgUnitRid || integration.orgUnitRid,
          eventType: evt.event_type,
        });
        if (isTransformationSkipped(transformedResponse)) {
          statusOk = false;
          const skipReason = getTransformationSkipReason(transformedResponse);
          const shouldRetryOnSkip = transformedResponse.details?.shouldRetry === true;
          responseTransformSkip = { message: skipReason, shouldRetry: shouldRetryOnSkip };
          log('warn', `${prefix}Response transformation signalled failure`, {
            correlationId: traceId,
            integrationId: integration.id,
            actionName,
            reason: skipReason,
            shouldRetry: shouldRetryOnSkip,
          });
        }
      } catch (err) {
        log('warn', `${prefix}Response transformation error`, { error: err.message });
      }
    }

    if (executionLogger) {
      await executionLogger
        .addStep('action_http_request', {
          status: statusOk ? 'success' : 'failed',
          durationMs: responseTimeMs,
          metadata: {
            actionName,
            actionIndex,
            statusCode: resp.status,
            method: httpMethod,
            url: targetUrl,
          },
          error: statusOk ? null : { message: responseTransformSkip?.message || `HTTP ${resp.status}` },
        })
        .catch(() => {});
    }

    // Check for token expiration in 200 OK responses (for multi-action)
    let tokenExpiredInBody = false;
    if (statusOk && integration.outgoingAuthConfig?.tokenExpirationDetection?.enabled) {
      try {
        const { extractValueByPath } = require('./auth-helper');
        const responseBody = await safeRead(resp);
        const detection = integration.outgoingAuthConfig.tokenExpirationDetection;

        const extractedValue = extractValueByPath(responseBody, detection.responseBodyPath || 'error');
        if (extractedValue && detection.expirationValues && detection.expirationValues.length > 0) {
          const valueStr = String(extractedValue).toLowerCase();
          const isExpired = detection.expirationValues.some((expVal) =>
            valueStr.includes(String(expVal).toLowerCase())
          );

          if (isExpired) {
            tokenExpiredInBody = true;
            log('info', 'Token expiration detected in 200 OK response (action)', {
              integrationId: integration._id?.toString(),
              actionName,
              extractedValue,
            });
          }
        }
      } catch (err) {
        log('warn', 'Failed to check token expiration in response body (action)', {
          error: err.message,
        });
      }
    }

    let shouldRetry = false;
    let errorMessage = statusOk ? null : 'Non-2xx response';

    // Handle token expiration detected in 200 OK response body
    if (tokenExpiredInBody) {
      shouldRetry = true;
      errorMessage = `${prefix}Token expired (detected in response body)`;

      if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
        const { clearCachedToken } = require('./auth-helper');
        clearCachedToken(integration._id).catch((err) => {
          log('warn', 'Failed to clear cached token after body expiration (action)', {
            integrationId: integration._id?.toString(),
            error: err.message,
          });
        });
        log('info', 'Cleared cached token after detecting expiration in response body (action)', {
          integrationId: integration._id?.toString(),
          actionName,
        });
      }
    } else if (responseTransformSkip) {
      // Response transformation returned skip() → business-level failure
      shouldRetry = responseTransformSkip.shouldRetry;
      errorMessage = `${prefix}${responseTransformSkip.message}`;
    } else if (!statusOk) {
      if (resp.status >= 500) {
        shouldRetry = true;
        errorMessage = `${prefix}Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        shouldRetry = true;
        errorMessage = `${prefix}Rate limited`;
      } else if (resp.status === 401 || resp.status === 403) {
        // Authentication/authorization errors - clear cached token and retry
        shouldRetry = true;
        errorMessage = `${prefix}Auth error: ${resp.status} - Token may be expired`;

        // Clear cached token for OAuth2/Custom auth (async, don't wait)
        if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
          const { clearCachedToken } = require('./auth-helper');
          clearCachedToken(integration._id).catch((err) => {
            log('warn', 'Failed to clear cached token after auth error (action)', {
              integrationId: integration._id?.toString(),
              status: resp.status,
              error: err.message,
            });
          });
          log('info', 'Cleared cached token after auth error (action)', {
            integrationId: integration._id?.toString(),
            status: resp.status,
            authType: integration.outgoingAuthType,
            actionName,
          });
        }
      } else if (resp.status >= 400 && resp.status < 500) {
        shouldRetry = false;
        errorMessage = `${prefix}Client error: ${resp.status}`;
      }
    }
    if (isTest && !statusOk) {
      shouldRetry = false;
      errorMessage = `${prefix}Test event - not retrying`;
    }

    // Check if we've reached max retries and mark as ABANDONED
    // Note: attemptCount is already incremented (current attempt)
    // maxRetries is the TOTAL number of attempts allowed
    // So if maxRetries=3, we allow attempts 1, 2, 3 (stop at 4)
    const maxRetries = integration.retryCount || 3;
    let finalStatus = statusOk ? 'SUCCESS' : shouldRetry ? 'RETRYING' : 'FAILED';
    if (shouldRetry && attemptCount > maxRetries) {
      finalStatus = 'ABANDONED';
      errorMessage = `${errorMessage} - Max retries (${maxRetries}) reached`;
    }

    const responseBody = await safeRead(resp);
    const attemptDetails =
      attemptCount > 1
        ? {
            attemptNumber: attemptCount,
            requestHeaders: headers,
            targetUrl,
            httpMethod,
            retryReason: manualReason || (shouldRetry ? errorMessage : null),
          }
        : null;

    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      integrationConfigId: integration.id,
      integrationName: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: finalStatus,
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount,
      originalPayload: evt.payload, // Store original payload from notification_queue
      requestPayload: transformed, // Store transformed payload actually sent
      responseBody,
      errorMessage,
      shouldRetry: shouldRetry && attemptCount <= maxRetries, // Don't retry if exceeded max
      targetUrl,
      httpMethod,
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers,
      attemptDetails,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Record success or failure
    if (finalStatus === 'SUCCESS') {
      await data.recordDeliverySuccess(integration.id);
    } else {
      // Only trip circuit breaker on infrastructure failures (5xx errors), not business logic failures (4xx errors)
      const shouldTripCircuit = resp.status >= 500 || resp.status === 429; // 5xx or rate limit
      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit, lastErrorMessage: errorMessage });
    }

    if (finalStatus === 'FAILED' || finalStatus === 'ABANDONED') {
      const errorCode =
        resp.status === 429
          ? 'RATE_LIMIT'
          : resp.status >= 500
            ? 'SERVER_ERROR'
            : resp.status >= 400
              ? 'CLIENT_ERROR'
              : 'HTTP_ERROR';
      await maybeCreateActionDLQ({
        logId,
        errorMessage,
        errorCode,
        responseStatus: resp.status,
        responseBody,
      });
    }

    return { status: finalStatus, logId };
  } catch (err) {
    const catchErrorMessage = `${prefix}${actionName} delivery failed: ${err.message}`;
    log('error', catchErrorMessage, {
      integrationId: integration.id,
      actionName,
      stack: err.stack,
    });

    if (executionLogger) {
      await executionLogger
        .addStep('action_http_request', {
          status: 'failed',
          durationMs: Date.now() - start,
          metadata: { actionName, actionIndex },
          error: { message: err.message, stack: err.stack, code: err.code },
        })
        .catch(() => {});
    }

    // Network/connection errors should be retried (timeout, DNS, connection refused, etc.)
    const maxRetries = integration.retryCount || 3;
    // attemptCount > maxRetries means we've exceeded the limit
    const isSigningFailure = err.code === 'SIGNING_FAILED';
    const finalStatus = isTest || isSigningFailure ? 'FAILED' : attemptCount > maxRetries ? 'ABANDONED' : 'RETRYING';
    const finalErrorMessage = isTest
      ? `${catchErrorMessage} - Test event (no retry)`
      : isSigningFailure
        ? `${catchErrorMessage} - Signing configuration error (no retry)`
        : attemptCount > maxRetries
          ? `${catchErrorMessage} - Max retries (${maxRetries}) reached`
          : catchErrorMessage;

    const logId = await data.recordLog(orgId, {
      id: existingLogId,
      integrationConfigId: integration.id,
      integrationName: `${integration.name} - ${actionName}`,
      eventId: evt.id || null,
      eventType: evt.event_type,
      direction: 'OUTBOUND',
      triggerType,
      actionName,
      actionIndex,
      status: finalStatus,
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage: finalErrorMessage,
      targetUrl,
      httpMethod: action.httpMethod || integration.httpMethod || 'POST',
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers || null,
      attemptDetails:
        attemptCount > 1
          ? {
              attemptNumber: attemptCount,
              requestHeaders: headers || null,
              targetUrl,
              httpMethod: action.httpMethod || integration.httpMethod || 'POST',
              retryReason: manualReason || (finalStatus === 'RETRYING' ? finalErrorMessage : null),
            }
          : null,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Always record failure on exceptions
    await data.recordDeliveryFailure(integration.id, { lastErrorMessage: finalErrorMessage || err?.message });

    if (finalStatus === 'FAILED' || finalStatus === 'ABANDONED') {
      const errorCode =
        err.code === 'SIGNING_FAILED'
          ? 'SIGNING_FAILED'
          : err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED'
            ? 'TIMEOUT'
            : err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND'
              ? 'NETWORK_ERROR'
              : 'NETWORK_ERROR';
      await maybeCreateActionDLQ({
        logId,
        errorMessage: finalErrorMessage,
        errorCode,
        responseStatus: 500,
      });
    }

    return { status: finalStatus, logId };
  }
}

/**
 * Process multi-action integration - execute multiple actions sequentially
 */

async function deliverMultiActionIntegration(
  integration,
  evt,
  pollCount = 0,
  correlationId = null,
  executionLogger = null
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const actions = integration.actions || [];
  const orgId = evt.orgId || integration.orgId;
  const multiActionDelayMs = await resolveMultiActionDelayMs(orgId);

  log('info', `${prefix}Processing multi-action integration`, {
    correlationId: traceId,
    integrationId: integration.id,
    integrationName: integration.name,
    actionCount: actions.length,
  });

  const results = [];
  const logIds = [];
  let successCount = 0;
  let failureCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    const actionName = action.name || `Action ${i + 1}`;

    // Evaluate condition if present
    const conditionContext = {
      eventType: evt.event_type,
      orgId,
      payload: evt.payload,
    };

    const shouldExecute = evaluateCondition(action.condition, conditionContext);

    if (!shouldExecute) {
      if (executionLogger) {
        await executionLogger
          .addStep('action_condition', {
            status: 'warning',
            durationMs: 0,
            metadata: {
              actionName,
              actionIndex: i,
              result: 'skipped',
            },
          })
          .catch(() => {});
      }

      log('info', `${prefix}Skipping action due to condition`, {
        actionName,
        condition: action.condition,
      });
      results.push({ action: actionName, status: 'SKIPPED' });
      continue;
    }

    if (executionLogger) {
      await executionLogger
        .addStep('action_condition', {
          status: 'success',
          durationMs: 0,
          metadata: {
            actionName,
            actionIndex: i,
            result: 'executed',
          },
        })
        .catch(() => {});
    }

    log('info', `${prefix}Executing action`, {
      actionName,
      targetUrl: action.targetUrl || integration.targetUrl,
    });

    // eslint-disable-next-line no-await-in-loop
    const result = await deliverSingleAction(integration, action, evt, pollCount, i, traceId, executionLogger, {
      triggerType: 'EVENT',
    });
    const actionStatus = result?.status || 'FAILED';
    results.push({ action: actionName, status: actionStatus });
    if (result?.logId) {
      logIds.push(result.logId);
    }

    if (actionStatus === 'SUCCESS') {
      successCount++;
    } else if (actionStatus === 'SKIPPED') {
      skippedCount++;
    } else {
      failureCount++;
    }

    if (multiActionDelayMs > 0 && i < actions.length - 1) {
      // eslint-disable-next-line no-await-in-loop
      await sleep(multiActionDelayMs);
    }
  }

  log('info', `${prefix}Multi-action integration completed`, {
    integrationId: integration.id,
    successCount,
    failureCount,
    skippedCount,
    results,
  });

  // Return overall status and record circuit breaker state
  let overallStatus;
  if (failureCount === 0 && successCount > 0) {
    overallStatus = 'SUCCESS';
    // CIRCUIT BREAKER: All actions succeeded - reset circuit
    await data.recordDeliverySuccess(integration.id);
  } else if (successCount > 0 && failureCount > 0) {
    overallStatus = 'PARTIAL_SUCCESS';
    // CIRCUIT BREAKER: Partial failure - treat as failure
    await data.recordDeliveryFailure(integration.id);
  } else if (failureCount === 0 && successCount === 0 && skippedCount > 0) {
    overallStatus = 'SKIPPED';
    // CIRCUIT BREAKER: Skipped actions should not count as failure
    await data.recordDeliverySuccess(integration.id);
  } else {
    overallStatus = 'FAILED';
    // CIRCUIT BREAKER: All actions failed - record failure
    await data.recordDeliveryFailure(integration.id);
  }

  if (executionLogger) {
    const hasRetrying = results.some((result) => result.status === 'RETRYING');
    if (overallStatus === 'SUCCESS') {
      await executionLogger
        .success({
          response: {
            statusCode: 200,
            body: { results },
          },
          metadata: { successCount, failureCount, skippedCount },
        })
        .catch(() => {});
    } else if (overallStatus === 'SKIPPED') {
      await executionLogger.updateStatus('skipped').catch(() => {});
    } else if (hasRetrying) {
      await executionLogger.updateStatus('retrying').catch(() => {});
    } else {
      const error = new Error(
        overallStatus === 'PARTIAL_SUCCESS' ? 'One or more actions failed' : 'All actions failed'
      );
      error.code = overallStatus === 'PARTIAL_SUCCESS' ? 'PARTIAL_FAILURE' : 'ACTION_FAILURE';
      await executionLogger
        .fail(error, {
          createDLQ: false,
          response: {
            statusCode: 500,
            body: { results },
          },
          metadata: { successCount, failureCount, skippedCount },
        })
        .catch(() => {});
    }
  }

  return { status: overallStatus, logIds };
}

async function deliverToIntegration(
  integration,
  evt,
  isReplay = false,
  pollCount = 0,
  existingLogId = null,
  correlationId = null,
  returnLogId = false,
  options = {}
) {
  const prefix = pollCount > 0 ? `[POLL #${pollCount}] ` : '';
  const traceId = correlationId || generateCorrelationId();
  const buildResult = (status, logId = null, logIds = null, meta = null) =>
    returnLogId ? { status, logId, logIds, ...(meta && typeof meta === 'object' ? meta : {}) } : status;
  const forceDelivery = Boolean(options.forceDelivery || options.force || options.ignoreCircuit || evt?.forceDelivery);
  const allowBypassCircuit = forceDelivery && isReplay;
  const retryReason = options.retryReason || options.reason || null;
  const orgId = evt.orgId || integration.orgId;
  const buildAttemptDetails = (requestHeaders, targetUrl, httpMethod) => {
    if (!existingLogId) return null;
    return {
      attemptNumber: (evt.attempt_count || 0) + 1,
      requestHeaders: requestHeaders || null,
      targetUrl,
      httpMethod: httpMethod || 'POST',
      retryReason,
    };
  };

  // Create execution logger for new DLQ + trace viewer system
  const executionLogger = createExecutionLogger({
    traceId,
    direction: 'OUTBOUND',
    triggerType: isReplay ? 'REPLAY' : 'EVENT',
    integrationConfigId: integration.id,
    integrationName: integration.name,
    eventType: evt.event_type,
    eventId: evt.id || evt.eventId || null,
    orgId,
    messageId: evt.eventId || evt.id || null,
    request: {
      url: integration.targetUrl,
      method: integration.httpMethod || 'POST',
      headers: {},
      body: evt.payload,
    },
    // Retries must reuse the original execution log. Starting a fresh logger
    // here leaves the original RETRYING record eligible for another retry.
    executionLogId: existingLogId || null,
  });

  // Check if this is a multi-action integration (check early to avoid creating parent log)
  const isMultiAction = integration.actions && Array.isArray(integration.actions) && integration.actions.length > 0;

  // Start execution logging (non-blocking - failures won't stop delivery)
  // Skip creating parent log for multi-action integrations - each action will create its own log
  await (!isMultiAction
    ? executionLogger.start().catch((err) => {
        log('warn', 'Failed to start execution logger', { error: err.message, traceId });
        return null;
      })
    : Promise.resolve(null));

  // Use execution log ID for updates instead of creating new logs
  const logIdForUpdates = existingLogId || executionLogger.executionLogId;

  // CIRCUIT BREAKER: Check if circuit is open before attempting delivery
  const circuitStatus = await data.checkCircuitState(integration.id);
  if (circuitStatus.isOpen && !allowBypassCircuit) {
    log('warn', `${prefix}Circuit breaker is OPEN - queuing for retry after recovery`, {
      correlationId: traceId,
      integrationId: integration.id,
      integrationName: integration.name,
      circuitState: circuitStatus.state,
      reason: circuitStatus.reason,
    });

    const circuitRecoveryMs = integration.circuitRecoveryTimeMs || 5 * 60 * 1000;
    const nextRetryAt = new Date(Date.now() + circuitRecoveryMs);
    const errorMessage = `${prefix}Circuit breaker OPEN: ${circuitStatus.reason}`;
    const circuitAttemptCount = (evt.attempt_count || 0) + 1;
    const circuitMaxRetries = integration.retryCount || 3;
    const circuitFinalStatus = circuitAttemptCount > circuitMaxRetries ? 'ABANDONED' : 'RETRYING';

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: circuitFinalStatus,
      responseStatus: 503,
      responseTimeMs: 0,
      attemptCount: circuitAttemptCount,
      originalPayload: evt.payload,
      requestPayload: evt.payload,
      errorMessage,
      shouldRetry: circuitFinalStatus === 'RETRYING',
      targetUrl: integration.targetUrl || integration.actions?.[0]?.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(
        null,
        integration.targetUrl || integration.actions?.[0]?.targetUrl,
        integration.httpMethod || 'POST'
      ),
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null,
    });

    // Only queue in DLQ if still within retry budget
    if (circuitFinalStatus === 'RETRYING') {
      const circuitError = new Error(errorMessage);
      circuitError.code = 'CIRCUIT_OPEN';
      circuitError.statusCode = 503;
      await dlqData
        .createDLQEntry({
          traceId,
          messageId: evt.id || evt.eventId || null,
          executionLogId: logId,
          integrationConfigId: integration.id,
          orgId,
          direction: 'OUTBOUND',
          payload: evt.payload,
          error: circuitError,
          maxRetries: integration.retryCount || 3,
          nextRetryAt, // pin retry to circuit recovery time
          retryStrategy: 'exponential',
          metadata: {
            circuitOpenedAt: integration.circuitOpenedAt,
            circuitRecoveryMs,
            eventType: evt.event_type,
          },
        })
        .catch((err) => log('warn', 'Failed to create DLQ entry for circuit-open event', { error: err.message }));
    }

    return buildResult(circuitFinalStatus, logId);
  }

  if (circuitStatus.isOpen && allowBypassCircuit) {
    log('warn', `${prefix}Force retry requested - bypassing OPEN circuit`, {
      correlationId: traceId,
      integrationId: integration.id,
      integrationName: integration.name,
      circuitState: circuitStatus.state,
      reason: circuitStatus.reason,
    });
  }

  log('debug', `${prefix}Circuit breaker check passed`, {
    correlationId: traceId,
    integrationId: integration.id,
    circuitState: circuitStatus.state,
  });

  // Handle multi-action integration (each action creates its own log, no parent log needed)
  if (isMultiAction) {
    const result = await deliverMultiActionIntegration(integration, evt, pollCount, traceId, executionLogger);
    if (typeof result === 'string') {
      return buildResult(result, null, null);
    }
    return buildResult(result.status, null, result.logIds || null);
  }

  // Legacy single-action integration delivery
  const urlCheck = validateTargetUrl(integration.targetUrl, config.security);
  if (!urlCheck.valid) {
    // Log validation step failure
    await executionLogger
      .addStep('url_validation', {
        status: 'failed',
        durationMs: 0,
        error: { message: urlCheck.reason },
      })
      .catch(() => {});

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'FAILED',
      responseStatus: 400,
      responseTimeMs: 0,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: evt.payload,
      errorMessage: `${prefix}${urlCheck.reason}`,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at URL validation stage)
      requestHeaders: null,
    });
    // CIRCUIT BREAKER: Don't trip circuit for URL validation errors (business logic failure)
    await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: false });

    // Mark execution as failed with DLQ entry
    const error = new Error(urlCheck.reason);
    error.code = 'INVALID_URL';
    await executionLogger
      .fail(error, {
        payload: evt.payload,
        statusCode: 400,
      })
      .catch(() => {});

    return buildResult('FAILED', logId);
  }

  // Log successful URL validation
  await executionLogger
    .addStep('url_validation', {
      status: 'success',
      durationMs: 0,
    })
    .catch(() => {});

  const start = Date.now();
  let transformed = evt.payload;
  let errorMessage;
  let transformationSkipReason = null;
  const transformStart = Date.now();
  try {
    if (Object.prototype.hasOwnProperty.call(options, 'preparedPayload')) {
      transformed = options.preparedPayload;
    } else {
      transformed = await applyTransform(integration, evt.payload, {
        eventType: evt.event_type,
        orgId,
      });
    }
    const transformedIsNull = transformed === null || isTransformationSkipped(transformed);
    transformationSkipReason = getTransformationSkipReason(transformed);
    // Log transformation (success or skipped)
    await executionLogger
      .addStep('transformation', {
        status: transformedIsNull ? 'warning' : 'success',
        durationMs: Date.now() - transformStart,
        metadata: { result: transformedIsNull ? 'skipped' : 'transformed' },
      })
      .catch(() => {});
  } catch (err) {
    errorMessage = `${prefix}Transform failed: ${err.message}`;
    log('error', errorMessage, {
      integrationId: integration.id,
      integrationName: integration.name,
      eventType: evt.event_type,
      pollCount,
      stack: err.stack,
    });

    // Log transformation failure
    await executionLogger
      .addStep('transformation', {
        status: 'failed',
        durationMs: Date.now() - transformStart,
        error: { message: err.message, stack: err.stack },
      })
      .catch(() => {});
  }

  if (errorMessage) {
    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'FAILED',
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details (not available yet at transformation stage)
      requestHeaders: null,
    });
    // CIRCUIT BREAKER: Don't trip circuit for transformation errors (business logic failure)
    await data.recordDeliveryFailure(integration.id, { shouldTripCircuit: false });

    // Mark execution as failed with DLQ entry
    const error = new Error(errorMessage);
    error.code = 'TRANSFORMATION_ERROR';
    await executionLogger
      .fail(error, {
        payload: evt.payload,
        statusCode: 500,
      })
      .catch(() => {});

    return buildResult('FAILED', logId);
  }

  if (transformed === null || isTransformationSkipped(transformed)) {
    const skipMessage = `${prefix}Skipping delivery: ${transformationSkipReason || 'transformation returned null'}`;
    log('info', skipMessage, {
      integrationId: integration.id,
      integrationName: integration.name,
      eventType: evt.event_type,
    });

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: 'SKIPPED',
      responseStatus: 204,
      responseTimeMs: Date.now() - start,
      attemptCount: (evt.attempt_count || 0) + 1,
      originalPayload: evt.payload,
      requestPayload: null,
      errorMessage: skipMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      correlationId: traceId,
      traceId: traceId,
      requestHeaders: null,
    });

    await data.recordDeliverySuccess(integration.id);
    await executionLogger.updateStatus('skipped').catch(() => {});

    return buildResult('SKIPPED', logId, null, {
      skipReason: transformationSkipReason || 'transformation returned null',
    });
  }

  // Rate limit check (per integration)
  if (integration.rateLimits?.enabled) {
    const rateStart = Date.now();
    try {
      const rateResult = await checkRateLimit(integration.id, orgId, integration.rateLimits);
      const durationMs = Date.now() - rateStart;
      const maxRequests = integration.rateLimits.maxRequests || 100;
      const windowSeconds = integration.rateLimits.windowSeconds || 60;

      await executionLogger
        .addStep('rate_limit', {
          status: rateResult.allowed ? 'success' : 'failed',
          durationMs,
          metadata: {
            remaining: rateResult.remaining,
            resetAt: rateResult.resetAt,
            maxRequests,
            windowSeconds,
          },
          error: rateResult.allowed ? null : { message: 'Rate limit exceeded' },
        })
        .catch(() => {});

      if (!rateResult.allowed) {
        const attemptCount = (evt.attempt_count || 0) + 1;
        const retryAfter = rateResult.retryAfter ? `, retry after ${rateResult.retryAfter}s` : '';
        const errorMessage = `${prefix}Rate limit exceeded${retryAfter}`;

        const logId = await data.recordLog(orgId, {
          id: logIdForUpdates,
          integrationConfigId: integration.id,
          integrationName: integration.name,
          eventId: evt.id || null,
          eventType: evt.event_type,
          status: 'RETRYING',
          responseStatus: 429,
          responseTimeMs: 0,
          attemptCount,
          originalPayload: evt.payload,
          requestPayload: transformed,
          errorMessage,
          shouldRetry: true,
          targetUrl: integration.targetUrl,
          httpMethod: integration.httpMethod || 'POST',
          attemptDetails: buildAttemptDetails(null, integration.targetUrl, integration.httpMethod || 'POST'),
          correlationId: traceId,
          traceId: traceId,
          requestHeaders: null,
        });

        await executionLogger.updateStatus('retrying').catch(() => {});
        return buildResult('RETRYING', logId);
      }
    } catch (error) {
      log('warn', 'Rate limit check failed', {
        integrationId: integration.id,
        error: error.message,
      });
    }
  }

  // Declare variables before try block for catch block access
  let headers = null;
  let messageId = null;
  let timestamp = null;
  let signatureHeaders = null;
  const isTest = isTestEvent(evt);

  try {
    const controller = new AbortController();
    const timeout = integration.timeoutMs || config.worker?.timeoutMs || 10000;
    const timer = setTimeout(() => controller.abort(), timeout);

    // Build headers with authentication
    const httpMethod = integration.httpMethod || 'POST';
    headers = await buildAuthHeaders(integration, httpMethod, integration.targetUrl);
    headers['Content-Type'] = 'application/json';
    // Replaying an inbound call: send its {{partnerId}}-style customHeaders again, as the live call did.
    if (integration.direction === 'INBOUND' && evt.isReplay) {
      Object.assign(
        headers,
        resolveReplayCustomHeaders(integration.customHeaders, evt.inboundHeaders, evt.priorUpstreamHeaders)
      );
    }
    // DISTRIBUTED TRACING: Add correlation ID header
    headers['X-Correlation-ID'] = traceId;
    headers['X-Trace-ID'] = traceId;

    // TOKEN QUERY PARAM: If auth config specifies tokenLocation=query, move token from header to URL
    const legacyAuthCfg = integration.outgoingAuthConfig || integration.authConfig;
    let legacyRequestUrl = integration.targetUrl;
    if (legacyAuthCfg?.tokenLocation === 'query' && legacyAuthCfg?.tokenQueryParamName) {
      const paramName = legacyAuthCfg.tokenQueryParamName;
      const headerName = legacyAuthCfg.tokenHeaderName || 'Authorization';
      const headerValue = headers[headerName] || '';
      const token = headerValue.replace(/^Bearer\s+/i, '').trim();
      if (token) {
        const sep = legacyRequestUrl.includes('?') ? '&' : '?';
        legacyRequestUrl = `${legacyRequestUrl}${sep}${paramName}=${encodeURIComponent(token)}`;
        delete headers[headerName];
      }
    }

    // WEBHOOK SIGNING: Generate signature for payload authentication

    if (integration.enableSigning && integration.signingSecrets && integration.signingSecrets.length > 0) {
      try {
        messageId = uuidv4(); // Unique message identifier
        timestamp = Math.floor(Date.now() / 1000); // Unix timestamp in seconds
        const payloadString = JSON.stringify(transformed); // Payload as string

        // Generate signature headers (supports multiple secrets for rotation)
        signatureHeaders = generateSignatureHeaders(integration.signingSecrets, messageId, timestamp, payloadString);

        // Add signature headers to request
        Object.assign(headers, signatureHeaders);

        log('debug', `${prefix}Integration signature generated`, {
          messageId,
          timestamp,
          integrationId: integration.id,
          integrationName: integration.name,
          secretCount: integration.signingSecrets.length,
        });
      } catch (signError) {
        log('error', `${prefix}Failed to generate integration signature`, {
          error: signError.message,
          integrationId: integration.id,
          integrationName: integration.name,
        });
        const error = new Error(`Signing is enabled but signature generation failed: ${signError.message}`);
        error.code = 'SIGNING_FAILED';
        throw error;
      }
    }

    const httpStart = Date.now();
    const resp = await fetch(legacyRequestUrl, {
      method: httpMethod,
      headers,
      body: JSON.stringify(transformed),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const responseTimeMs = Date.now() - start;
    const httpDuration = Date.now() - httpStart;
    let statusOk = resp.status >= 200 && resp.status < 300;
    const attemptCount = (evt.attempt_count || 0) + 1;

    // RESPONSE TRANSFORMATION: run after 2xx to normalize body and detect business-level failures.
    // Works for any API regardless of how it signals errors (body field, envelope, etc.).
    // Script can call skip(reason, { shouldRetry: true/false }) to signal failure.
    let responseTransformSkip = null;
    if (statusOk && integration.responseTransformation) {
      try {
        const bodyText = await resp
          .clone()
          .text()
          .catch(() => '');
        let parsedBody;
        try {
          parsedBody = JSON.parse(bodyText);
        } catch {
          parsedBody = bodyText;
        }
        const transformedResponse = await applyResponseTransform(integration, parsedBody, {
          orgId: evt.orgId || integration.orgId,
          orgUnitRid: evt.orgUnitRid || integration.orgUnitRid,
          eventType: evt.event_type,
        });
        if (isTransformationSkipped(transformedResponse)) {
          statusOk = false;
          const skipReason = getTransformationSkipReason(transformedResponse);
          const shouldRetryOnSkip = transformedResponse.details?.shouldRetry === true;
          responseTransformSkip = { message: skipReason, shouldRetry: shouldRetryOnSkip };
          log('warn', `${prefix}Response transformation signalled failure`, {
            correlationId: traceId,
            integrationId: integration.id,
            reason: skipReason,
            shouldRetry: shouldRetryOnSkip,
          });
        }
      } catch (err) {
        log('warn', `${prefix}Response transformation error`, { error: err.message });
      }
    }

    // Log HTTP request step
    await executionLogger
      .addStep('http_request', {
        status: statusOk ? 'success' : 'failed',
        durationMs: httpDuration,
        metadata: {
          statusCode: resp.status,
          method: httpMethod,
          url: integration.targetUrl,
        },
        error: statusOk ? null : { message: responseTransformSkip?.message || `HTTP ${resp.status}` },
      })
      .catch(() => {});

    // Check for token expiration in 200 OK responses (some APIs return errors in response body)
    let tokenExpiredInBody = false;
    if (statusOk && integration.outgoingAuthConfig?.tokenExpirationDetection?.enabled) {
      try {
        const { extractValueByPath } = require('./auth-helper');
        const responseBody = await safeRead(resp);
        const detection = integration.outgoingAuthConfig.tokenExpirationDetection;

        // Extract value from response using configured path
        const extractedValue = extractValueByPath(responseBody, detection.responseBodyPath || 'error');

        // Check if extracted value matches any configured expiration values
        if (extractedValue && detection.expirationValues && detection.expirationValues.length > 0) {
          const valueStr = String(extractedValue).toLowerCase();
          const isExpired = detection.expirationValues.some((expVal) =>
            valueStr.includes(String(expVal).toLowerCase())
          );

          if (isExpired) {
            tokenExpiredInBody = true;
            log('info', 'Token expiration detected in 200 OK response body', {
              integrationId: integration._id?.toString(),
              extractedValue,
              bodyPath: detection.responseBodyPath,
              expirationValues: detection.expirationValues,
            });
          }
        }
      } catch (err) {
        log('warn', 'Failed to check token expiration in response body', {
          integrationId: integration._id?.toString(),
          error: err.message,
        });
      }
    }

    // Industry-standard status code intelligence
    let shouldRetry = false;
    let errorMessage = statusOk ? null : 'Non-2xx response';

    // Handle token expiration detected in 200 OK response body
    if (tokenExpiredInBody) {
      shouldRetry = true;
      errorMessage = `${prefix}Token expired (detected in response body)`;

      // Clear cached token for OAuth2/Custom auth (async, don't wait)
      if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
        const { clearCachedToken } = require('./auth-helper');
        clearCachedToken(integration._id).catch((err) => {
          log('warn', 'Failed to clear cached token after body expiration detection', {
            integrationId: integration._id?.toString(),
            error: err.message,
          });
        });
        log('info', 'Cleared cached token after detecting expiration in response body', {
          integrationId: integration._id?.toString(),
          authType: integration.outgoingAuthType,
        });
      }
    } else if (responseTransformSkip) {
      // Response transformation returned skip() → business-level failure
      shouldRetry = responseTransformSkip.shouldRetry;
      errorMessage = `${prefix}${responseTransformSkip.message}`;
    } else if (!statusOk) {
      if (resp.status >= 500) {
        shouldRetry = true; // Server errors - retry
        errorMessage = `${prefix}Server error: ${resp.status}`;
      } else if (resp.status === 429) {
        shouldRetry = true; // Rate limit - retry with longer delay
        errorMessage = `${prefix}Rate limited`;
      } else if (resp.status === 401 || resp.status === 403) {
        // Authentication/authorization errors - clear cached token and retry
        shouldRetry = true;
        errorMessage = `${prefix}Auth error: ${resp.status} - Token may be expired`;

        // Clear cached token for OAuth2/Custom auth (async, don't wait)
        if (integration.outgoingAuthType === 'OAUTH2' || integration.outgoingAuthType === 'CUSTOM') {
          const { clearCachedToken } = require('./auth-helper');
          clearCachedToken(integration._id).catch((err) => {
            log('warn', 'Failed to clear cached token after auth error', {
              integrationId: integration._id?.toString(),
              status: resp.status,
              error: err.message,
            });
          });
          log('info', 'Cleared cached token after auth error', {
            integrationId: integration._id?.toString(),
            status: resp.status,
            authType: integration.outgoingAuthType,
          });
        }
      } else if (resp.status >= 400 && resp.status < 500) {
        shouldRetry = false; // Client errors - don't retry
        errorMessage = `${prefix}Client error: ${resp.status}`;
      }
    }
    if (isTest && !statusOk) {
      shouldRetry = false;
      errorMessage = `${prefix}Test event - not retrying`;
    }

    // Check if we've reached max retries and mark as ABANDONED
    // Note: attemptCount is already incremented (current attempt)
    // maxRetries is the TOTAL number of attempts allowed
    // So if maxRetries=3, we allow attempts 1, 2, 3 (stop at 4)
    const maxRetries = integration.retryCount || 3;
    let finalStatus = statusOk ? 'SUCCESS' : shouldRetry ? 'RETRYING' : 'FAILED';
    if (shouldRetry && attemptCount > maxRetries) {
      finalStatus = 'ABANDONED';
      errorMessage = `${errorMessage} - Max retries (${maxRetries}) reached`;
    }

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: finalStatus,
      responseStatus: resp.status,
      responseTimeMs,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      responseBody: await safeRead(resp),
      errorMessage: errorMessage,
      shouldRetry: shouldRetry && attemptCount <= maxRetries, // Don't retry if exceeded max
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, httpMethod),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details for debugging
      requestHeaders: headers,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Record success or failure based on final status
    if (statusOk) {
      await data.recordDeliverySuccess(integration.id);

      // Mark execution as successful
      await executionLogger
        .success({
          response: {
            statusCode: resp.status,
            body: await safeRead(resp),
          },
        })
        .catch(() => {});

      return buildResult('SUCCESS', logId);
    } else {
      // Only trip circuit breaker on infrastructure failures (5xx errors), not business logic failures (4xx errors)
      const shouldTripCircuit = resp.status >= 500 || resp.status === 429; // 5xx or rate limit
      await data.recordDeliveryFailure(integration.id, { shouldTripCircuit, lastErrorMessage: errorMessage });

      // Mark execution as failed with DLQ entry (only if not retrying or already at max retries)
      if (!shouldRetry || attemptCount > maxRetries) {
        const error = new Error(errorMessage || `HTTP ${resp.status}`);
        error.code = resp.status === 429 ? 'RATE_LIMIT' : resp.status >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR';
        error.statusCode = resp.status;
        await executionLogger
          .fail(error, {
            payload: evt.payload,
            statusCode: resp.status,
            response: { statusCode: resp.status, body: await safeRead(resp) },
          })
          .catch(() => {});
      } else {
        // For retrying status, update execution log but don't create DLQ yet
        await executionLogger.updateStatus('retrying').catch(() => {});
      }

      if (shouldRetry) {
        return buildResult('RETRYING', logId);
      } else {
        return buildResult('FAILED', logId);
      }
    }
  } catch (err) {
    const catchErrorMessage = `${prefix}${err.message}`;
    log('error', catchErrorMessage, {
      integrationId: integration.id,
      integrationName: integration.name,
      eventType: evt.event_type,
      pollCount,
      stack: err.stack,
    });

    // Log HTTP request failure
    await executionLogger
      .addStep('http_request', {
        status: 'failed',
        durationMs: Date.now() - start,
        error: { message: err.message, stack: err.stack, code: err.code },
      })
      .catch(() => {});

    // Network/connection errors should be retried (timeout, DNS, connection refused, etc.)
    // These are transient errors, not permanent failures like 4xx client errors
    const attemptCount = (evt.attempt_count || 0) + 1;
    const maxRetries = integration.retryCount || 3;
    // isTest is already defined earlier in the try block
    const isSigningFailure = err.code === 'SIGNING_FAILED';
    const finalStatus = isTest || isSigningFailure ? 'FAILED' : attemptCount > maxRetries ? 'ABANDONED' : 'RETRYING';
    const finalErrorMessage = isTest
      ? `${catchErrorMessage} - Test event (no retry)`
      : isSigningFailure
        ? `${catchErrorMessage} - Signing configuration error (no retry)`
        : attemptCount > maxRetries
          ? `${catchErrorMessage} - Max retries (${maxRetries}) reached`
          : catchErrorMessage;

    const logId = await data.recordLog(orgId, {
      id: logIdForUpdates,
      integrationConfigId: integration.id,
      integrationName: integration.name,
      eventId: evt.id || null,
      eventType: evt.event_type,
      status: finalStatus,
      responseStatus: 500,
      responseTimeMs: Date.now() - start,
      attemptCount,
      originalPayload: evt.payload,
      requestPayload: transformed,
      errorMessage: finalErrorMessage,
      targetUrl: integration.targetUrl,
      httpMethod: integration.httpMethod || 'POST',
      attemptDetails: buildAttemptDetails(logIdForUpdates, integration.targetUrl, integration.httpMethod || 'POST'),
      // Distributed tracing
      correlationId: traceId,
      traceId: traceId,
      // Request details
      requestHeaders: headers || null,
      // Integration signing audit trail
      messageId,
      timestamp,
      signature: signatureHeaders ? signatureHeaders['X-Integration-Signature'] : null,
      signatureHeaders,
    });

    // CIRCUIT BREAKER: Always record failure on exceptions
    await data.recordDeliveryFailure(integration.id, { lastErrorMessage: err?.message });

    // Mark execution as failed with DLQ entry (only if not retrying or already at max retries)
    if (finalStatus !== 'RETRYING') {
      const error = new Error(err.message);
      error.code = err.code || (err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK_ERROR');
      error.stack = err.stack;
      error.statusCode = 500;
      await executionLogger
        .fail(error, {
          payload: evt.payload,
          statusCode: 500,
        })
        .catch(() => {});
    } else {
      // For retrying status, update execution log but don't create DLQ yet
      await executionLogger.updateStatus('retrying').catch(() => {});
    }

    return buildResult(finalStatus, logId);
  }
}

module.exports = {
  resolveMultiActionDelayMs,
  deliverSingleAction,
  deliverMultiActionIntegration,
  deliverToIntegration,
};
