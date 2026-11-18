'use strict';

/**
 * What the old code decided, in the shape shadow comparisons use
 * ({ decision: continue | fail | retry, message }), for the send paths.
 */

/** checkBeforeDelivery's answer: null (go ahead) or { retryable, errorMessage }. */
function preDeliveryDecision(checkFailure) {
  if (!checkFailure) return { decision: 'continue', message: null };
  return { decision: checkFailure.retryable ? 'retry' : 'fail', message: checkFailure.errorMessage };
}

/** The response transform's answer: a skip ({ message, shouldRetry }) or nothing. */
function responseDecision(skip) {
  if (!skip) return { decision: 'continue', message: null };
  return { decision: skip.shouldRetry ? 'retry' : 'fail', message: skip.message };
}

module.exports = { preDeliveryDecision, responseDecision };
