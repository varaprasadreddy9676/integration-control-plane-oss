const { log } = require('../logger');

// Event deduplication cache (simple in-memory implementation)
const processedEvents = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
let lastDedupCleanup = Date.now();

function cleanupDedupCache(now = Date.now()) {
  const cutoff = now - DEDUP_WINDOW_MS;
  for (const [key, timestamp] of processedEvents.entries()) {
    if (timestamp < cutoff) {
      processedEvents.delete(key);
    }
  }
  lastDedupCleanup = now;
}

function isEventProcessed(eventKey) {
  const now = Date.now();
  if (now - lastDedupCleanup > DEDUP_WINDOW_MS) {
    cleanupDedupCache(now);
  }
  const lastProcessed = processedEvents.get(eventKey);
  if (!lastProcessed) return false;

  if (now - lastProcessed < DEDUP_WINDOW_MS) {
    // Re-insert to promote to end (LRU access ordering)
    processedEvents.set(eventKey, lastProcessed);
    return true;
  }
  return false;
}

const DEDUP_CACHE_MAX = 10_000;

function markEventProcessed(eventKey) {
  // LRU eviction (least-recently-accessed entries evicted first): when cache exceeds hard cap, delete oldest 20%
  if (processedEvents.size >= DEDUP_CACHE_MAX) {
    const toDelete = Math.floor(DEDUP_CACHE_MAX * 0.2);
    let count = 0;
    for (const k of processedEvents.keys()) {
      if (count++ >= toDelete) break;
      processedEvents.delete(k);
    }
    log('info', 'Evicted oldest dedup cache entries', {
      evicted: toDelete,
      remaining: processedEvents.size,
    });
  }
  processedEvents.set(eventKey, Date.now());
}

/**
 * Get the processed events map (for testing)
 * @returns {Map} The processed events map
 */
function getProcessedEventsMap() {
  return processedEvents;
}

module.exports = {
  cleanupDedupCache,
  isEventProcessed,
  markEventProcessed,
  getProcessedEventsMap,
};
