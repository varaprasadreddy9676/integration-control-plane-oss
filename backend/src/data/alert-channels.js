'use strict';

/**
 * Per-organization alert channels: where an org's alerts go (Slack, email,
 * a webhook, WhatsApp…). Settings follow the plugin's declared fields; secret
 * fields are encrypted at rest and never returned — reads show a mask.
 */

const mongodb = require('../mongodb');
const plugins = require('../services/notifications/plugins');
const { ALERT_EVENT_TYPES } = require('../services/notifications/alert-events');
const { encrypt, decrypt } = require('../utils/secret-crypto');
const { SECRET_MASK } = require('../utils/integration-secrets');

const COLLECTION = 'alert_channels';
const ENC_PREFIX = 'enc:v1:';

class AlertChannelError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AlertChannelError';
    this.statusCode = 400;
  }
}

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

function transformSecrets(type, config, transform) {
  const out = { ...config };
  for (const key of plugins.secretFields(type)) {
    if (out[key] !== undefined && out[key] !== null && out[key] !== '') out[key] = transform(out[key]);
  }
  return out;
}
const encryptSecrets = (type, config) => transformSecrets(type, config, (value) => ENC_PREFIX + encrypt(String(value)));
const decryptSecrets = (type, config) =>
  transformSecrets(type, config, (value) =>
    typeof value === 'string' && value.startsWith(ENC_PREFIX) ? decrypt(value.slice(ENC_PREFIX.length)) : value
  );
const maskSecrets = (type, config) => transformSecrets(type, config, () => SECRET_MASK);

/** The channel as the API returns it. */
function toPublic(doc) {
  return {
    id: String(doc._id),
    type: doc.type,
    name: doc.name,
    enabled: doc.enabled !== false,
    events: doc.events,
    config: maskSecrets(doc.type, doc.config || {}),
    lastResult: doc.lastResult || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function normalizeEvents(events) {
  if (events === undefined) return [...ALERT_EVENT_TYPES];
  const list = Array.isArray(events) ? events : [];
  const unknown = list.find((event) => !ALERT_EVENT_TYPES.includes(event));
  if (unknown) throw new AlertChannelError(`Unknown alert: ${unknown}`);
  if (list.length === 0) throw new AlertChannelError('Pick at least one alert to send');
  return [...new Set(list)];
}

function validated(type, config) {
  const result = plugins.validateConfig(type, config);
  if (result.error) throw new AlertChannelError(result.error);
  return result.config;
}

function normalizeName(name, fallback) {
  const value = typeof name === 'string' ? name.trim() : '';
  return (value || fallback).slice(0, 100);
}

async function listChannels(orgId) {
  const docs = await (await collection()).find({ orgId }).sort({ createdAt: 1 }).toArray();
  return docs.map(toPublic);
}

async function createChannel(orgId, input = {}) {
  const plugin = plugins.getPlugin(input.type);
  if (!plugin) throw new AlertChannelError(`Unknown channel type: ${input.type}`);
  const now = new Date();
  const doc = {
    orgId,
    type: plugin.type,
    name: normalizeName(input.name, plugin.name),
    enabled: input.enabled !== false,
    events: normalizeEvents(input.events),
    config: encryptSecrets(plugin.type, validated(plugin.type, input.config || {})),
    lastResult: null,
    createdAt: now,
    updatedAt: now,
  };
  const result = await (await collection()).insertOne(doc);
  return toPublic({ ...doc, _id: result.insertedId });
}

async function findOwned(orgId, id) {
  const _id = mongodb.toObjectId(id);
  if (!_id) return null;
  return (await collection()).findOne({ _id, orgId });
}

/** Update; a secret sent back as the mask (or left out) keeps its stored value. Null if not found. */
async function updateChannel(orgId, id, patch = {}) {
  const existing = await findOwned(orgId, id);
  if (!existing) return null;
  const stored = decryptSecrets(existing.type, existing.config || {});
  const incoming = { ...stored, ...(patch.config || {}) };
  for (const key of plugins.secretFields(existing.type)) {
    if (patch.config && (patch.config[key] === SECRET_MASK || patch.config[key] === undefined)) incoming[key] = stored[key];
  }
  const $set = {
    name: patch.name !== undefined ? normalizeName(patch.name, existing.name) : existing.name,
    enabled: patch.enabled !== undefined ? patch.enabled !== false : existing.enabled !== false,
    events: patch.events !== undefined ? normalizeEvents(patch.events) : existing.events,
    config: encryptSecrets(existing.type, validated(existing.type, incoming)),
    updatedAt: new Date(),
  };
  await (await collection()).updateOne({ _id: existing._id, orgId }, { $set });
  return toPublic({ ...existing, ...$set });
}

async function deleteChannel(orgId, id) {
  const _id = mongodb.toObjectId(id);
  if (!_id) return false;
  const result = await (await collection()).deleteOne({ _id, orgId });
  return result.deletedCount > 0;
}

/** Enabled channels subscribed to `eventType`, with settings decrypted for sending. */
async function listChannelsForEvent(orgId, eventType) {
  const docs = await (await collection()).find({ orgId, enabled: true, events: eventType }).toArray();
  return docs.map((doc) => ({ ...doc, id: String(doc._id), config: decryptSecrets(doc.type, doc.config || {}) }));
}

/** One channel with settings decrypted, regardless of enabled state. */
async function getChannelForSending(orgId, id) {
  const doc = await findOwned(orgId, id);
  return doc ? { ...doc, id: String(doc._id), config: decryptSecrets(doc.type, doc.config || {}) } : null;
}

async function recordResult(id, result) {
  const _id = mongodb.toObjectId(id);
  if (!_id) return;
  await (await collection()).updateOne({ _id }, { $set: { lastResult: result } });
}

module.exports = {
  AlertChannelError,
  listChannels,
  createChannel,
  updateChannel,
  deleteChannel,
  listChannelsForEvent,
  getChannelForSending,
  recordResult,
};
