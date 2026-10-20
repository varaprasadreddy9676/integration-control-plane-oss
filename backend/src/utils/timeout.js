/**
 * Simple timeout wrapper for database operations
 * Prevents operations from hanging forever
 */

/**
 * Wrap a promise with a timeout
 * @param {Promise} promise - The promise to wrap
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operationName - Name for error message
 * @returns {Promise} - Resolves with promise result or rejects on timeout
 */
function withTimeout(promise, timeoutMs, operationName = 'Operation') {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  // Promise.race never cancels the loser, so whichever side didn't win still had
  // its timer left running for the full timeoutMs on every call — across the
  // delivery pipeline (delivery-engine, scheduler-worker, retry-handler,
  // MysqlEventSource, event-source-tester) that's a real handle leak on every
  // single timeout-guarded operation that completes normally, not just the rare
  // timeout case. Clearing it once either side settles fixes that for good.
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

module.exports = {
  withTimeout,
};
