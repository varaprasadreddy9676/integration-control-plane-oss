'use strict';

/**
 * stage_definitions: content-addressed stage revisions. The hash of a stage's
 * normalized definition (the fields that decide what it does) is its revision;
 * jobs and runs reference the hash, so pinning a revision costs one shared
 * document, not a copy per job. The org is part of the hash, so two orgs never
 * share a document.
 */

const crypto = require('crypto');
const mongodb = require('../../mongodb');

const COLLECTION = 'stage_definitions';

// What a stage does. Its name, enabled flag and position are not part of it:
// renaming, pausing or reordering a stage is not a new revision.
const DEFINITION_FIELDS = [
  'hook',
  'effect',
  'runner',
  'schedule',
  'contract',
  'auth',
  'onError',
  'timeoutMs',
  'recording',
  'outputs',
  'inputs',
];

const collection = async () => (await mongodb.getDbSafe()).collection(COLLECTION);

/** JSON with object keys sorted and undefined values dropped, so equal definitions hash equally. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function normalizeDefinition(stage) {
  const definition = {};
  for (const field of DEFINITION_FIELDS) {
    if (stage[field] !== undefined) definition[field] = JSON.parse(JSON.stringify(stage[field]));
  }
  return definition;
}

function definitionHash(orgId, stage) {
  const text = stableStringify({ orgId, definition: normalizeDefinition(stage) });
  return crypto.createHash('sha256').update(text).digest('hex');
}

/** Store the stage's current revision (once) and resolve to its hash. */
async function saveDefinition(orgId, stage) {
  const hash = definitionHash(orgId, stage);
  const col = await collection();
  try {
    await col.updateOne(
      { _id: hash },
      { $setOnInsert: { orgId, definition: normalizeDefinition(stage), createdAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    if (error.code !== 11000) throw error; // a concurrent save stored the same document
  }
  return hash;
}

/** The definition stored under `hash` for this org, or null. */
async function getDefinition(orgId, hash) {
  const col = await collection();
  const doc = await col.findOne({ _id: hash, orgId });
  return doc ? doc.definition : null;
}

module.exports = { saveDefinition, getDefinition, definitionHash, normalizeDefinition, stableStringify, DEFINITION_FIELDS, COLLECTION };
