'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

jest.mock('mongodb', () => {
  class ObjectId {
    constructor(value) {
      this.value = String(value);
    }
    toString() {
      return this.value;
    }
  }
  return { ObjectId, MongoClient: class {} };
});
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { applyPreset, rollbackPreset, selectTargets, upgradeScripts } = require('../../src/scripts/apply-follow-up-preset');
const { PRESETS } = require('../../src/services/delivery-follow-up-presets');

const preset = PRESETS.find((p) => p.id === 'qikchat');

/** A collection that applies the $-operators the script uses, over plain documents. */
function fakeDb(docs) {
  const hasNone = (d) => d.deliveryFollowUp === undefined || d.deliveryFollowUp === null;
  const collection = {
    find: (query) => ({
      toArray: async () => docs.filter((d) => (query.$or ? hasNone(d) : true) && typeof d.targetUrl === 'string'),
    }),
    updateMany: jest.fn(async (filter, update) => {
      const ids = filter._id.$in.map(String);
      let modified = 0;
      for (const d of docs) {
        if (!ids.includes(String(d._id))) continue;
        if (filter.$or && !hasNone(d)) continue;
        if (filter['deliveryFollowUp.script'] && !(d.deliveryFollowUp && d.deliveryFollowUp.script === filter['deliveryFollowUp.script'] && d.deliveryFollowUp.enabled === true)) continue;
        // each document gets its own copy, as a real database stores one
        if (update.$set && update.$set.deliveryFollowUp) d.deliveryFollowUp = JSON.parse(JSON.stringify(update.$set.deliveryFollowUp));
        if (update.$unset) delete d.deliveryFollowUp;
        modified += 1;
      }
      return { modifiedCount: modified };
    }),
  };
  return { collection: () => collection, _collection: collection };
}

const qik = (id, extra = {}) => ({ _id: id, orgId: 145, name: `WA ${id}`, isActive: false, targetUrl: 'https://api.qikchat.in/v1/messages', ...extra });
const docs = () => [
  qik('a', { isActive: true }),
  qik('b'),
  qik('off', { deliveryFollowUp: { enabled: false, script: '' } }),
  qik('own', { deliveryFollowUp: { enabled: true, script: 'return null;', checkAfterSeconds: [60] } }),
  { _id: 'other', orgId: 33, name: 'Other', isActive: true, targetUrl: 'https://example.com/hook' },
  { _id: 'nourl', orgId: 33, name: 'NoUrl', isActive: true },
];

describe('apply-follow-up-preset', () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fu-preset-'));
  });

  it('finds only integrations of the provider that have no follow-up setting', async () => {
    const targets = await selectTargets(fakeDb(docs()), preset);
    expect(targets.map((t) => t._id)).toEqual(['a', 'b']);
  });

  it('changes nothing without --commit, and says what it would do', async () => {
    const data = docs();
    const out = await applyPreset({ db: fakeDb(data), preset, commit: false, backupDir: dir });
    expect(out.applied).toBe(0);
    expect(out.summary).toEqual({ total: 2, byOrg: { 145: { active: 1, inactive: 1 } } });
    expect(data.find((d) => d._id === 'a').deliveryFollowUp).toBeUndefined();
    expect(fs.readdirSync(dir)).toHaveLength(0);
  });

  it('applies the preset, writes a backup first, and leaves isActive and the other integrations alone', async () => {
    const data = docs();
    const out = await applyPreset({ db: fakeDb(data), preset, commit: true, backupDir: dir });
    expect(out.applied).toBe(2);
    expect(JSON.parse(fs.readFileSync(out.backupFile, 'utf8')).ids).toEqual(['a', 'b']);
    expect(data.find((d) => d._id === 'a').deliveryFollowUp).toMatchObject({ enabled: true, checkAfterSeconds: [30, 300, 3600, 86400] });
    expect(data.find((d) => d._id === 'a').isActive).toBe(true);
    expect(data.find((d) => d._id === 'b').isActive).toBe(false);
    // switched off, own script, other providers: untouched
    expect(data.find((d) => d._id === 'off').deliveryFollowUp).toEqual({ enabled: false, script: '' });
    expect(data.find((d) => d._id === 'own').deliveryFollowUp.script).toBe('return null;');
    expect(data.find((d) => d._id === 'other').deliveryFollowUp).toBeUndefined();
  });

  it('is safe to run twice', async () => {
    const data = docs();
    await applyPreset({ db: fakeDb(data), preset, commit: true, backupDir: dir });
    const second = await applyPreset({ db: fakeDb(data), preset, commit: true, backupDir: dir });
    expect(second.applied).toBe(0);
  });

  it('rolls back what it applied, but not what someone edited since', async () => {
    const data = docs();
    const { backupFile } = await applyPreset({ db: fakeDb(data), preset, commit: true, backupDir: dir });
    data.find((d) => d._id === 'b').deliveryFollowUp.script = 'return { status: "READ" };'; // edited since
    const out = await rollbackPreset({ db: fakeDb(data), preset, backupFile });
    expect(out).toEqual({ requested: 2, removed: 1 });
    expect(data.find((d) => d._id === 'a').deliveryFollowUp).toBeUndefined();
    expect(data.find((d) => d._id === 'b').deliveryFollowUp.script).toContain('READ');
  });

  describe('upgrading an earlier script', () => {
    const OLD = preset.previousScripts[0];
    const withScript = (id, script, extra = {}) => qik(id, { deliveryFollowUp: { enabled: true, script, checkAfterSeconds: [30, 300] }, ...extra });
    const upgradeDb = (data) => ({
      collection: () => ({
        find: () => ({ toArray: async () => data.filter((d) => d.deliveryFollowUp && preset.previousScripts.includes(d.deliveryFollowUp.script)) }),
        updateMany: jest.fn(async (filter, update) => {
          let modified = 0;
          for (const d of data) {
            if (!filter._id.$in.map(String).includes(String(d._id))) continue;
            if (!d.deliveryFollowUp || d.deliveryFollowUp.script !== filter['deliveryFollowUp.script']) continue;
            d.deliveryFollowUp.script = update.$set['deliveryFollowUp.script'];
            modified += 1;
          }
          return { modifiedCount: modified };
        }),
      }),
    });

    it('moves only integrations that still have the earlier script, keeping their schedule and switch', async () => {
      const data = [withScript('a', OLD), withScript('b', 'return null; // my own'), withScript('c', OLD, { isActive: true })];
      const out = await upgradeScripts({ db: upgradeDb(data), preset, commit: true, backupDir: dir });
      expect(out.applied).toBe(2);
      expect(data[0].deliveryFollowUp.script).toBe(preset.config.script);
      expect(data[2].deliveryFollowUp).toMatchObject({ enabled: true, script: preset.config.script, checkAfterSeconds: [30, 300] });
      expect(data[1].deliveryFollowUp.script).toBe('return null; // my own');
      expect(data[2].isActive).toBe(true);
    });

    it('changes nothing without --commit', async () => {
      const data = [withScript('a', OLD)];
      const out = await upgradeScripts({ db: upgradeDb(data), preset, commit: false, backupDir: dir });
      expect(out).toMatchObject({ applied: 0, summary: { total: 1 } });
      expect(data[0].deliveryFollowUp.script).toBe(OLD);
    });

    it('can be undone from its backup, but only where the script is still the new one', async () => {
      const data = [withScript('a', OLD), withScript('b', OLD)];
      const { backupFile } = await upgradeScripts({ db: upgradeDb(data), preset, commit: true, backupDir: dir });
      data[1].deliveryFollowUp.script = 'return null; // edited after the upgrade';
      const rollbackDb = {
        collection: () => ({
          updateMany: jest.fn(async (filter, update) => {
            let modified = 0;
            for (const d of data) {
              if (!filter._id.$in.map(String).includes(String(d._id))) continue;
              if (d.deliveryFollowUp.script !== filter['deliveryFollowUp.script']) continue;
              d.deliveryFollowUp.script = update.$set['deliveryFollowUp.script'];
              modified += 1;
            }
            return { modifiedCount: modified };
          }),
        }),
      };
      const out = await rollbackPreset({ db: rollbackDb, preset, backupFile });
      expect(out).toEqual({ requested: 2, removed: 1 });
      expect(data[0].deliveryFollowUp.script).toBe(OLD);
      expect(data[1].deliveryFollowUp.script).toContain('edited after');
    });
  });
});
