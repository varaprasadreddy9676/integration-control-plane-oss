'use strict';

/**
 * Sends an alert to every alert channel of the organization that is enabled and
 * subscribed to that alert. Channels are independent: one that fails (or hangs)
 * does not stop the others, and the outcome is stored on each channel.
 */

const { log } = require('../../logger');
const channels = require('../../data/alert-channels');
const plugins = require('./plugins');
const { RESOLVED_ALERT_TYPES } = require('./alert-events');

const SEND_TIMEOUT_MS = 15000;

const withTimeout = (promise, ms) =>
  Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`No response within ${ms / 1000}s`)), ms).unref?.()),
  ]);

async function sendToChannel(channel, alert) {
  const plugin = plugins.getPlugin(channel.type);
  const startedAt = new Date();
  let result;
  try {
    if (!plugin) throw new Error(`Channel type ${channel.type} is no longer available`);
    await withTimeout(Promise.resolve(plugin.send(alert, channel.config)), SEND_TIMEOUT_MS);
    result = { ok: true, at: startedAt, alertType: alert.type };
  } catch (error) {
    result = { ok: false, at: startedAt, alertType: alert.type, error: String(error.message || error).slice(0, 500) };
    log('warn', 'Alert channel delivery failed', { channelId: channel.id, type: channel.type, error: result.error });
  }
  await channels.recordResult(channel.id, result).catch(() => undefined);
  return { channelId: channel.id, name: channel.name, type: channel.type, ...result };
}

/** Deliver `alert` to the org's channels. Never throws; returns one result per channel. */
async function dispatchAlert(orgId, alert) {
  try {
    if (!alert?.type) return [];
    const targets = await channels.listChannelsForEvent(orgId, alert.type);
    return await Promise.all(targets.map((channel) => sendToChannel(channel, alert)));
  } catch (error) {
    log('error', 'Alert dispatch failed', { orgId, alertType: alert?.type, error: error.message });
    return [];
  }
}

/** Send a sample alert to one channel, enabled or not. Null if it does not exist. */
async function testChannel(orgId, id) {
  const channel = await channels.getChannelForSending(orgId, id);
  if (!channel) return null;
  return sendToChannel(channel, {
    type: 'TEST',
    severity: 'info',
    title: 'Test alert from Integration Gateway',
    message: 'If you can read this, alerts will reach this channel.',
    orgId,
    occurredAt: new Date().toISOString(),
  });
}

/** Console page for each alert type, relative to the console's base URL. */
function consolePath(alert, orgId) {
  const type = String(alert.type || '');
  if (type.startsWith('SCHEDULED_JOB_') && alert.payload?.jobId) {
    return `/scheduled-jobs/${encodeURIComponent(alert.payload.jobId)}?orgId=${orgId}`;
  }
  if (type.startsWith('EVENT_SOURCE_')) return `/settings/event-source?orgId=${orgId}`;
  if (type.startsWith('DLQ_')) return `/dlq?orgId=${orgId}`;
  return `/logs?orgId=${orgId}`;
}

/**
 * The alert format plugins receive, from an alert as recorded in the Alert
 * Center (type, subject, errorMessage, payload, windowEnd).
 * `frontendUrl` is the console's base URL, for the link back to the problem.
 */
function toChannelAlert(orgId, alert, { orgName, frontendUrl } = {}) {
  const payload = alert.payload || {};
  const at = alert.windowEnd ? new Date(alert.windowEnd) : new Date();
  const result = {
    type: alert.type,
    severity: RESOLVED_ALERT_TYPES.has(alert.type) ? 'resolved' : 'critical',
    title: alert.subject,
    message: alert.errorMessage,
    orgId,
    orgName,
    integration: payload.integrationId ? { id: String(payload.integrationId), name: payload.integrationName } : undefined,
    job: payload.jobId ? { id: String(payload.jobId), name: payload.jobName } : undefined,
    occurredAt: at.toISOString(),
    link: frontendUrl ? `${String(frontendUrl).replace(/\/$/, '')}${consolePath(alert, orgId)}` : undefined,
  };
  return JSON.parse(JSON.stringify(result)); // drop undefined fields
}

module.exports = { dispatchAlert, testChannel, toChannelAlert };
