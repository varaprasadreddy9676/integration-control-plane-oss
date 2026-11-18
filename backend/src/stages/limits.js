'use strict';

/**
 * Our own limits on stage HTTP calls, shared by every backend process through
 * MongoDB (stage_limits, short-lived counter documents):
 *
 *   per host        calls per second to one host, across all integrations and orgs,
 *                   so a provider's rate limit is respected as volume grows
 *   per host & org  one org may use at most half of a host's budget, so it cannot
 *                   starve the others
 *   per org         stage HTTP calls per day (every check costs a provider call)
 *
 * admit() throws RATE_LIMITED or QUOTA_EXCEEDED with retryAfterMs; the recorder
 * records the blocked call and the job is rescheduled without using up an attempt.
 *
 * config.stages.hostLimits: { 'api.example.com': { perSecond: 5 } }
 */

const config = require('../config');
const mongodb = require('../mongodb');

const COLLECTION = 'stage_limits';
const DEFAULT_PER_SECOND = 20;
const DEFAULT_DAILY_QUOTA = 100000;
const DAY_MS = 24 * 3600 * 1000;

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);
const unwrap = (result) => (result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result);

class LimitError extends Error {
  constructor(code, message, retryAfterMs) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

function settings() {
  const stages = config.stages || {};
  return {
    hostLimits: stages.hostLimits || {},
    perSecond: Number(stages.hostPerSecond) || DEFAULT_PER_SECOND,
    dailyQuota: Number(stages.orgDailyQuota) || DEFAULT_DAILY_QUOTA,
  };
}

async function bump(col, id, expiresAt) {
  const doc = unwrap(
    await col.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, returnDocument: 'after' })
  );
  return doc ? doc.count : 1;
}

/** Count one call of `orgId` to `url`, or throw when a limit says no. */
async function admit({ orgId, url, now = Date.now() }) {
  const host = new URL(url).hostname.toLowerCase();
  const { hostLimits, perSecond: defaultPerSecond, dailyQuota } = settings();
  const perSecond = (hostLimits[host] && Number(hostLimits[host].perSecond)) || defaultPerSecond;
  const col = await collection();

  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const used = await bump(col, `q:${orgId}:${day}`, new Date(day + 2 * DAY_MS));
  if (used > dailyQuota) {
    throw new LimitError('QUOTA_EXCEEDED', `This organization reached its ${dailyQuota} stage calls for today`, day + DAY_MS - now);
  }

  const second = Math.floor(now / 1000) * 1000;
  const expiresAt = new Date(second + 60000);
  const retryAfterMs = Math.max(100, second + 1000 - now);
  const orgShare = Math.max(1, Math.floor(perSecond / 2));
  if ((await bump(col, `ho:${host}:${orgId}:${second}`, expiresAt)) > orgShare) {
    throw new LimitError('RATE_LIMITED', `Too many calls to ${host} from this organization right now`, retryAfterMs);
  }
  if ((await bump(col, `h:${host}:${second}`, expiresAt)) > perSecond) {
    throw new LimitError('RATE_LIMITED', `Too many calls to ${host} right now`, retryAfterMs);
  }
}

/** Stage calls an org made today (console). */
async function usageToday(orgId, now = Date.now()) {
  const col = await collection();
  const day = Math.floor(now / DAY_MS) * DAY_MS;
  const doc = await col.findOne({ _id: `q:${orgId}:${day}` });
  return { used: doc ? doc.count : 0, quota: settings().dailyQuota };
}

async function ensureLimitIndexes(db, safeCreateIndexes = (c, specs) => c.createIndexes(specs)) {
  await safeCreateIndexes(db.collection(COLLECTION), [{ key: { expiresAt: 1 }, expireAfterSeconds: 0, name: 'expires_ttl_idx' }]);
}

module.exports = { admit, usageToday, ensureLimitIndexes, LimitError, COLLECTION };
