'use strict';
const { ObjectId } = require('mongodb');
const { getDb } = require('../mongodb');
const { getSecret } = require('./gateway-secrets');
const { log } = require('../logger');

async function col() {
  const db = await getDb();
  return db.collection('connection_profiles');
}

async function listProfiles(orgId = null) {
  const c = await col();
  const filter = orgId ? { $or: [{ orgId }, { orgId: null }] } : {};
  return c.find(filter).sort({ name: 1 }).toArray();
}

function visibleProfileQuery(idOrSlug, orgId = null) {
  const byId = ObjectId.isValid(idOrSlug) && idOrSlug.length === 24;
  const identity = byId ? { _id: new ObjectId(idOrSlug) } : { slug: idOrSlug };
  if (!orgId) return identity;
  return { ...identity, $or: [{ orgId }, { orgId: null }, { orgId: { $exists: false } }] };
}

async function getProfile(idOrSlug, orgId = null) {
  const c = await col();
  return c.findOne(visibleProfileQuery(idOrSlug, orgId));
}

async function createProfile(data) {
  const c = await col();
  const doc = { ...data, createdAt: new Date(), updatedAt: new Date() };
  const result = await c.insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

async function updateProfile(idOrSlug, data, orgId = null) {
  const c = await col();
  const byId = ObjectId.isValid(idOrSlug) && idOrSlug.length === 24;
  const filter = byId ? { _id: new ObjectId(idOrSlug), orgId } : { slug: idOrSlug, orgId };
  const { _id, ...update } = data;
  await c.updateOne(filter, { $set: { ...update, updatedAt: new Date() } });
  return c.findOne(filter);
}

async function deleteProfile(idOrSlug, orgId = null) {
  const c = await col();
  const byId = ObjectId.isValid(idOrSlug) && idOrSlug.length === 24;
  await c.deleteOne(byId ? { _id: new ObjectId(idOrSlug), orgId } : { slug: idOrSlug, orgId });
}

// Returns profile with all {{secret.KEY}} references resolved to plaintext values.
async function resolveProfile(idOrSlug, orgId = null) {
  const profile = await getProfile(idOrSlug, orgId);
  if (!profile) throw new Error(`Connection profile not found: ${idOrSlug}`);

  const config = { ...profile.config };

  // Resolve password and any other fields listed in profile.secrets
  // e.g. secrets: { password: 'NOVA_DB_PASSWORD' }
  if (profile.secrets) {
    for (const [field, secretKey] of Object.entries(profile.secrets)) {
      const value = await getSecret(secretKey, orgId);
      if (value !== null) {
        config[field] = value;
      } else {
        log('warn', 'Secret not found for connection profile field', {
          profile: profile.slug || String(profile._id),
          field,
          secretKey,
        });
      }
    }
  }

  return { ...profile, config };
}

module.exports = { listProfiles, getProfile, createProfile, updateProfile, deleteProfile, resolveProfile };
