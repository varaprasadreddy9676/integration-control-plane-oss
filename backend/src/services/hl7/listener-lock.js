'use strict';

const os = require('os');
const mongodb = require('../../mongodb');

function createOwnerId(prefix = 'hl7-listener') {
  return `${prefix}-${os.hostname()}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function acquireListenerLock(lockKey, ownerId, ttlMs = 30000) {
  const db = await mongodb.getDbSafe();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + ttlMs);

  await db.collection('hl7_listener_locks').updateOne(
    { _id: lockKey },
    {
      $setOnInsert: {
        createdAt: now,
      },
    },
    { upsert: true }
  );

  const result = await db.collection('hl7_listener_locks').findOneAndUpdate(
    {
      _id: lockKey,
      $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }, { ownerId }],
    },
    {
      $set: {
        ownerId,
        lockedUntil,
        lockedAt: now,
        updatedAt: now,
      },
    },
    {
      returnDocument: 'after',
    }
  );

  if (result?.value?.ownerId !== ownerId) return null;
  return result.value;
}

async function refreshListenerLock(lockKey, ownerId, ttlMs = 30000) {
  const db = await mongodb.getDbSafe();
  const now = new Date();
  const result = await db.collection('hl7_listener_locks').findOneAndUpdate(
    { _id: lockKey, ownerId },
    {
      $set: {
        lockedUntil: new Date(now.getTime() + ttlMs),
        updatedAt: now,
      },
    },
    { returnDocument: 'after' }
  );
  return result?.value?.ownerId === ownerId;
}

async function releaseListenerLock(lockKey, ownerId) {
  const db = await mongodb.getDbSafe();
  await db.collection('hl7_listener_locks').updateOne(
    { _id: lockKey, ownerId },
    {
      $set: {
        lockedUntil: new Date(0),
        releasedAt: new Date(),
      },
      $unset: {
        ownerId: '',
      },
    }
  );
}

module.exports = {
  createOwnerId,
  acquireListenerLock,
  refreshListenerLock,
  releaseListenerLock,
};
