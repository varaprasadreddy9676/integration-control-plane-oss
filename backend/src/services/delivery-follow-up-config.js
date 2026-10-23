'use strict';

/**
 * The delivery follow-up configuration of an integration: what is valid and
 * how it is stored. Kept free of dependencies so the integration data layer and
 * the routes can use it. The behaviour is in delivery-follow-up.js.
 */

// A script returns any status word it likes and says `done: true` when there is
// nothing more to wait for. Scripts written before `done` existed returned READ
// or FAILED for that, so those two still end the follow-up unless done is given.
// PENDING (no answer yet), UNKNOWN (gave up) and NOT_TRACKED (skip) are the gateway's own.
const FINAL_BY_DEFAULT = new Set(['READ', 'FAILED', 'NOT_TRACKED']);

const DEFAULT_SCHEDULE_SECONDS = [30, 300, 3600, 86400];
const MIN_CHECK_SECONDS = 10;
const MAX_CHECK_SECONDS = 7 * 24 * 3600;
const MAX_CHECKS = 8;
const MAX_SCRIPT_LENGTH = 20000;

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** An error message for an invalid deliveryFollowUp value, or null. */
function validateDeliveryFollowUp(config) {
  if (config === undefined || config === null) return null;
  if (!isPlainObject(config)) return 'deliveryFollowUp must be an object';
  if (config.enabled !== true) return null;

  const script = typeof config.script === 'string' ? config.script.trim() : '';
  if (!script) return 'Delivery follow-up script is required';
  if (script.length > MAX_SCRIPT_LENGTH) {
    return `Delivery follow-up script is too long (at most ${MAX_SCRIPT_LENGTH} characters)`;
  }
  try {
    // eslint-disable-next-line no-new-func
    new Function('payload', 'context', `async function __followUp(payload, context) { ${script} }`);
  } catch (error) {
    return `Delivery follow-up script is not valid JavaScript: ${error.message}`;
  }

  if (config.checkAfterSeconds !== undefined) {
    const schedule = config.checkAfterSeconds;
    if (!Array.isArray(schedule) || schedule.length === 0) return 'Add at least one check time';
    if (schedule.length > MAX_CHECKS) return `Use at most ${MAX_CHECKS} check times`;
    for (const seconds of schedule) {
      if (!Number.isInteger(seconds)) return 'Each check time must be a whole number of seconds';
      if (seconds < MIN_CHECK_SECONDS || seconds > MAX_CHECK_SECONDS) {
        return `Each check time must be between ${MIN_CHECK_SECONDS} seconds and 7 days`;
      }
    }
  }
  return null;
}

/** The stored form of deliveryFollowUp (null when there is none). */
function normalizeDeliveryFollowUp(config) {
  if (!isPlainObject(config)) return null;
  const schedule = Array.isArray(config.checkAfterSeconds) ? config.checkAfterSeconds : DEFAULT_SCHEDULE_SECONDS;
  return {
    enabled: config.enabled === true,
    script: typeof config.script === 'string' ? config.script.trim() : '',
    checkAfterSeconds: [...new Set(schedule)].sort((a, b) => a - b),
  };
}

const isActive = (config) => Boolean(config && config.enabled === true && config.script);

/** Counts by status as the scripts reported them, plus how many are followed at all. */
function summarizeFollowUpStats(byStatus = {}) {
  const total = Object.values(byStatus).reduce((sum, value) => sum + value, 0);
  return { total, tracked: total - (byStatus.NOT_TRACKED || 0), byStatus };
}

module.exports = {
  summarizeFollowUpStats,
  FINAL_BY_DEFAULT,
  DEFAULT_SCHEDULE_SECONDS,
  validateDeliveryFollowUp,
  normalizeDeliveryFollowUp,
  isActive,
};
