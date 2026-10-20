'use strict';

const mongodb = require('../mongodb');
const { ValidationError, NotFoundError } = require('../utils/errors');

const COLLECTION = 'integration_providers';

const normalizeName = (value) =>
  String(value || '').trim();

const normalizeSlug = (value) =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');

const mapProvider = (doc) => ({
  id: doc._id.toString(),
  orgId: doc.orgId,
  name: doc.name,
  slug: doc.slug,
  description: doc.description || '',
  isActive: doc.isActive !== false,
  createdAt: doc.createdAt || null,
  updatedAt: doc.updatedAt || null,
  createdBy: doc.createdBy || null,
});

async function ensureIndexes() {
  const db = await mongodb.getDbSafe();
  await db.collection(COLLECTION).createIndexes([
    { key: { orgId: 1, slug: 1 }, unique: true, name: 'org_slug_unique_idx' },
    { key: { orgId: 1, isActive: 1 }, name: 'org_active_idx' },
    { key: { orgId: 1, name: 1 }, name: 'org_name_idx' },
  ]);
}

function validateProviderInput(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Provider payload must be an object');
  }

  const name = input.name !== undefined ? normalizeName(input.name) : undefined;
  const slug = input.name !== undefined ? normalizeSlug(input.name) : undefined;
  const description = input.description !== undefined ? String(input.description || '').trim() : undefined;
  const isActive = input.isActive === undefined ? undefined : input.isActive !== false;

  if (!partial) {
    if (!name) throw new ValidationError('name is required');
  } else {
    if (input.name !== undefined && !name) throw new ValidationError('name cannot be empty');
  }

  const result = {};
  if (name !== undefined) { result.name = name; result.slug = slug; }
  if (description !== undefined) result.description = description;
  if (isActive !== undefined) result.isActive = isActive;
  return result;
}

async function listProviders(orgId, { activeOnly = false } = {}) {
  const db = await mongodb.getDbSafe();
  const query = { orgId };
  if (activeOnly) query.isActive = true;
  const items = await db.collection(COLLECTION).find(query).sort({ name: 1 }).toArray();
  return items.map(mapProvider);
}

async function getProvider(orgId, id) {
  const db = await mongodb.getDbSafe();
  const doc = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!doc) throw new NotFoundError('Provider not found');
  return mapProvider(doc);
}

async function createProvider(orgId, input, { createdBy = 'system' } = {}) {
  const db = await mongodb.getDbSafe();
  const payload = validateProviderInput(input);
  const now = new Date();

  const existing = await db.collection(COLLECTION).findOne({ orgId, slug: payload.slug });
  if (existing) {
    throw new ValidationError(`A provider named "${payload.name}" already exists`);
  }

  const doc = {
    orgId,
    name: payload.name,
    slug: payload.slug,
    description: payload.description || '',
    isActive: payload.isActive !== false,
    createdAt: now,
    updatedAt: now,
    createdBy,
  };

  await db.collection(COLLECTION).insertOne(doc);
  return mapProvider(doc);
}

async function updateProvider(orgId, id, input) {
  const db = await mongodb.getDbSafe();
  const existing = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!existing) throw new NotFoundError('Provider not found');

  const payload = validateProviderInput(input, { partial: true });

  // Check slug uniqueness if name is changing
  if (payload.slug && payload.slug !== existing.slug) {
    const conflict = await db.collection(COLLECTION).findOne({
      orgId,
      slug: payload.slug,
      _id: { $ne: existing._id },
    });
    if (conflict) throw new ValidationError(`A provider named "${payload.name}" already exists`);
  }

  const updated = {
    ...existing,
    ...payload,
    updatedAt: new Date(),
  };

  await db.collection(COLLECTION).updateOne({ _id: existing._id }, { $set: updated });
  return mapProvider(updated);
}

async function deleteProvider(orgId, id) {
  const db = await mongodb.getDbSafe();
  const existing = await db.collection(COLLECTION).findOne({ _id: mongodb.toObjectId(id), orgId });
  if (!existing) throw new NotFoundError('Provider not found');
  await db.collection(COLLECTION).deleteOne({ _id: existing._id });
}

module.exports = {
  COLLECTION,
  ensureIndexes,
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
};
