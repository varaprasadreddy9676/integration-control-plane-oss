'use strict';
/**
 * Give every existing integration of a known provider its delivery follow-up
 * (see services/delivery-follow-up-presets.js). New integrations get it when
 * they are created; this covers the ones that already exist.
 *
 * It only fills in integrations that have no follow-up setting at all, so an
 * integration that was switched off, or has its own script, is left alone. It
 * never touches isActive.
 *
 *   # What would change (no writes):
 *   node src/scripts/apply-follow-up-preset.js --preset=qikchat
 *
 *   # Apply it (writes a backup of the affected ids first):
 *   node src/scripts/apply-follow-up-preset.js --preset=qikchat --commit
 *
 *   # Move integrations that still have an earlier version of the preset's script
 *   # to the current one (their schedule and on/off setting are kept):
 *   node src/scripts/apply-follow-up-preset.js --preset=qikchat --upgrade [--commit]
 *
 *   # Undo a --commit or an --upgrade --commit, from its backup file (only where
 *   # the follow-up is still exactly what the script put there):
 *   node src/scripts/apply-follow-up-preset.js --preset=qikchat --rollback=<backup file>
 *
 * Reads MONGODB_URI and MONGODB_DATABASE from the environment (.env).
 */

const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');
const { PRESETS, copyConfig } = require('../services/delivery-follow-up-presets');

const COLLECTION = 'integration_configs';
const noFollowUp = { $or: [{ deliveryFollowUp: { $exists: false } }, { deliveryFollowUp: null }] };

/** Integrations of the preset's provider that have no follow-up setting. */
async function selectTargets(db, preset) {
  const candidates = await db
    .collection(COLLECTION)
    .find({ ...noFollowUp, targetUrl: { $type: 'string' } }, { projection: { name: 1, orgId: 1, isActive: 1, targetUrl: 1 } })
    .toArray();
  return candidates.filter((integration) => preset.matches(integration));
}

function summarize(targets) {
  const byOrg = {};
  for (const target of targets) {
    const org = (byOrg[target.orgId] = byOrg[target.orgId] || { active: 0, inactive: 0 });
    org[target.isActive ? 'active' : 'inactive'] += 1;
  }
  return { total: targets.length, byOrg };
}

/** Plan or apply the preset. Resolves to { summary, applied, backupFile }. */
async function applyPreset({ db, preset, commit = false, backupDir = '.' }) {
  const targets = await selectTargets(db, preset);
  const summary = summarize(targets);
  if (!commit || targets.length === 0) return { summary, applied: 0, backupFile: null };

  // The ids first: a rollback needs nothing else, because the previous state was "no setting".
  const backupFile = path.join(backupDir, `follow-up-preset-${preset.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify({ preset: preset.id, ids: targets.map((t) => String(t._id)) }, null, 2));

  const result = await db
    .collection(COLLECTION)
    .updateMany(
      { _id: { $in: targets.map((t) => t._id) }, ...noFollowUp },
      { $set: { deliveryFollowUp: copyConfig(preset), updatedAt: new Date() } }
    );
  return { summary, applied: result.modifiedCount, backupFile };
}

/** Integrations whose follow-up script is an earlier version of the preset's. */
async function selectUpgradeTargets(db, preset) {
  const previous = preset.previousScripts || [];
  if (previous.length === 0) return [];
  return db
    .collection(COLLECTION)
    .find(
      { 'deliveryFollowUp.script': { $in: previous } },
      { projection: { name: 1, orgId: 1, isActive: 1, 'deliveryFollowUp.script': 1 } }
    )
    .toArray();
}

/** Plan or apply the move from an earlier script to the current one. */
async function upgradeScripts({ db, preset, commit = false, backupDir = '.' }) {
  const targets = await selectUpgradeTargets(db, preset);
  const summary = summarize(targets);
  if (!commit || targets.length === 0) return { summary, applied: 0, backupFile: null };

  const backupFile = path.join(backupDir, `follow-up-upgrade-${preset.id}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ preset: preset.id, kind: 'upgrade', ids: targets.map((t) => String(t._id)), previousScripts: preset.previousScripts }, null, 2)
  );

  let applied = 0;
  for (const previous of preset.previousScripts) {
    const ids = targets.filter((t) => t.deliveryFollowUp.script === previous).map((t) => t._id);
    if (ids.length === 0) continue;
    const result = await db
      .collection(COLLECTION)
      .updateMany(
        { _id: { $in: ids }, 'deliveryFollowUp.script': previous },
        { $set: { 'deliveryFollowUp.script': preset.config.script, updatedAt: new Date() } }
      );
    applied += result.modifiedCount;
  }
  return { summary, applied, backupFile };
}

/** Undo an apply (remove the follow-up) or an upgrade (put the earlier script back), where nothing was edited since. */
async function rollbackPreset({ db, preset, backupFile }) {
  const backup = JSON.parse(fs.readFileSync(backupFile, 'utf8'));
  const { ids } = backup;
  const { ObjectId } = require('mongodb');
  const objectIds = ids.map((id) => new ObjectId(id));
  if (backup.kind === 'upgrade') {
    const result = await db
      .collection(COLLECTION)
      .updateMany(
        { _id: { $in: objectIds }, 'deliveryFollowUp.script': preset.config.script },
        { $set: { 'deliveryFollowUp.script': backup.previousScripts[0], updatedAt: new Date() } }
      );
    return { requested: ids.length, removed: result.modifiedCount };
  }
  const current = copyConfig(preset);
  const result = await db.collection(COLLECTION).updateMany(
    {
      _id: { $in: objectIds },
      'deliveryFollowUp.script': current.script,
      'deliveryFollowUp.enabled': true,
    },
    { $unset: { deliveryFollowUp: '' }, $set: { updatedAt: new Date() } }
  );
  return { requested: ids.length, removed: result.modifiedCount };
}

async function main() {
  const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').split('=').slice(1).join('=');
  const has = (name) => process.argv.includes(`--${name}`);
  const preset = PRESETS.find((p) => p.id === arg('preset'));
  if (!preset) {
    console.error(`Choose a preset: --preset=${PRESETS.map((p) => p.id).join('|')}`);
    process.exitCode = 1;
    return;
  }
  require('dotenv').config({ path: process.env.ENVFILE || '.env' });
  const client = new MongoClient(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DATABASE);
    if (arg('rollback')) {
      console.log('Rollback:', JSON.stringify(await rollbackPreset({ db, preset, backupFile: arg('rollback') })));
      return;
    }
    const commit = has('commit');
    const upgrade = has('upgrade');
    const run = upgrade ? upgradeScripts : applyPreset;
    const out = await run({ db, preset, commit, backupDir: process.env.BACKUP_DIR || '.' });
    const verb = upgrade ? 'upgrade the script of' : 'apply';
    console.log(`${commit ? 'Done:' : 'Would'} ${verb} "${preset.id}" on ${out.summary.total} integration(s):`);
    console.log(JSON.stringify(out.summary.byOrg));
    if (commit) console.log(`Updated ${out.applied}. Backup: ${out.backupFile}`);
    else console.log('Dry run: nothing changed. Add --commit to apply.');
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { selectTargets, selectUpgradeTargets, summarize, applyPreset, upgradeScripts, rollbackPreset };
