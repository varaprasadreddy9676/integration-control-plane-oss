'use strict';

/**
 * The inline hooks, run inside a delivery attempt:
 *
 *   before_send     after the request transform, before the target is called.
 *                   A gate can skip the delivery or fail it; it can make the
 *                   delivery retry only when the stage allows it
 *                   (allowDeliveryRetry), since nothing has been sent yet.
 *   after_response  right after the target answered. A gate classifies the answer:
 *                   fail() turns an accepted send into a failure. Resending needs
 *                   the stage's explicit allowDeliveryRetry and fail(..., {
 *                   retryDelivery: true }); an error of the stage itself never
 *                   resends a request the target may have accepted.
 *
 * Stages of a hook run in order and share the attempt's latency budget. Gates
 * stop the stages after them when they skip or fail; gate errors fail closed
 * unless the stage says onError: ignore. Observers record what happened and never
 * change the delivery. Inline retries (retry_stage, gates only) repeat at once,
 * within the budget.
 *
 * runInlineHook(...) resolves to
 *   { decision: 'continue' | 'skip' | 'fail' | 'retry', message, stage, records, outputs }
 */

const { executeStage } = require('./executor');

function shouldRetryInline(stage, result, attempt) {
  const onError = stage.onError || {};
  if (stage.effect !== 'gate' || onError.action !== 'retry_stage') return false;
  if (attempt >= (onError.maxAttempts || 1)) return false;
  if (result.outcome === 'ok' || result.outcome === 'skipped') return false;
  if (result.decision.failed && !result.decision.retryStage) return false; // a deliberate, final no
  if (result.decision.uncertain && !onError.allowUncertainSideEffects) return false;
  return true;
}

function gateVerdict(hook, stage, result) {
  const reason = result.record.error || result.record.reason || `${stage.name} failed`;
  const message = `${stage.name}: ${reason}`;
  if (!stage.allowDeliveryRetry) return { decision: 'fail', message };
  if (hook === 'before_send') {
    // Nothing was sent: an error is worth retrying; a deliberate fail() only when it asks.
    const retry = result.decision.failed ? result.decision.retryDelivery : true;
    return { decision: retry ? 'retry' : 'fail', message };
  }
  // after_response: only an explicit request from the classifier resends.
  return { decision: result.decision.failed && result.decision.retryDelivery ? 'retry' : 'fail', message };
}

/**
 * hook: 'before_send' | 'after_response'
 * stages: the hook's enabled stages, in order
 * scope: { event, delivery, stages, vars } (stages are filled in as they complete)
 * budgetDeadline: epoch ms the attempt's stages must finish by
 * meta: base run metadata (orgId, deliveryId, integrationId, deliveryAttempt, ...)
 * hashes: { stageId: definitionHash }
 */
async function runInlineHook({ hook, stages, integration, scope, budgetDeadline, meta, hashes = {}, deps }) {
  const records = [];
  const outputs = {};
  const stageScope = { ...(scope.stages || {}) };

  for (const stage of stages) {
    let result;
    let attempt = 0;
    do {
      attempt += 1;
      const deadline = Math.min(Date.now() + stage.timeoutMs, budgetDeadline);
      result = await executeStage({
        stage,
        integration,
        scope: { ...scope, stages: stageScope },
        deadline,
        meta: { ...meta, seq: meta.deliveryAttempt || 1, executionAttempt: attempt, definitionHash: hashes[stage.id] },
        deps,
      });
      records.push(result.record);
    } while (shouldRetryInline(stage, result, attempt) && Date.now() < budgetDeadline);

    if (result.outcome === 'ok') {
      outputs[stage.id] = result.data;
      stageScope[stage.id] = { status: result.status, output: result.data };
      continue;
    }
    if (stage.effect !== 'gate') continue; // observers never change the delivery
    if (result.outcome === 'skipped') {
      if (hook === 'before_send') {
        return { decision: 'skip', message: `${stage.name}: ${result.record.reason || 'skipped'}`, stage, records, outputs };
      }
      continue; // a classifier with no opinion leaves the answer as it is
    }
    if ((stage.onError || {}).action === 'ignore' && !result.decision.failed) continue; // fail open, by choice
    return { ...gateVerdict(hook, stage, result), stage, records, outputs };
  }
  return { decision: 'continue', message: null, stage: null, records, outputs };
}

module.exports = { runInlineHook };
