'use strict';
/**
 * Base64 Redact Scheduler
 *
 * Runs daily at 23:00 (11 PM) to redact base64/image blobs from all MongoDB
 * collections older than KEEP_DAYS (default 7). Keeps last 7 days unredacted
 * so recent logs are still readable for debugging.
 *
 * Starts/stops with the server process via startDeliveryWorker().
 * Progress is logged via the standard logger.
 */

const cron = require('node-cron');
const mongodb = require('../mongodb');
const { log, logError } = require('../logger');

const KEEP_DAYS = 7;
const BATCH_SIZE = 300;
const BASE64_MIN_LEN = 500;
const DATA_URI_RE = /^data:[^;]+;base64,/;
const BASE64_CHARS_RE = /^[A-Za-z0-9+/\r\n]+=*$/;

// Collections and their payload fields to scan
const COLLECTIONS = [
  {
    name: 'execution_logs',
    fields: ['requestPayload', 'originalPayload', 'transformedPayload', 'request', 'response'],
  },
  { name: 'event_audit', fields: ['payload', 'eventPayload'] },
  { name: 'failed_deliveries', fields: ['payload', 'requestBody', 'responseBody'] },
  { name: 'delivery_attempts', fields: ['requestPayload', 'responseBody'] },
  { name: 'alert_center_logs', fields: ['payload'] },
];

// --- redaction helpers ---

function looksLikeBase64(s) {
  if (s.length < BASE64_MIN_LEN) return false;
  return BASE64_CHARS_RE.test(s.replace(/[\r\n]/g, ''));
}

function redactString(s) {
  if (DATA_URI_RE.test(s)) {
    const commaIdx = s.indexOf(',');
    return `${s.slice(0, commaIdx)},[BASE64_REDACTED: ${s.length - commaIdx - 1} chars]`;
  }
  if (looksLikeBase64(s)) return `[BASE64_REDACTED: ${s.length} chars]`;
  return s;
}

function redact(value, depth = 0) {
  if (depth > 15) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = redact(v, depth + 1);
    return out;
  }
  return value;
}

function hasBase64(value, depth = 0) {
  if (depth > 15) return false;
  if (typeof value === 'string') return DATA_URI_RE.test(value) || looksLikeBase64(value);
  if (Array.isArray(value)) return value.some((v) => hasBase64(v, depth + 1));
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    return Object.values(value).some((v) => hasBase64(v, depth + 1));
  }
  return false;
}

// --- main job ---

async function runRedactJob() {
  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  log('info', 'Base64 redact job started', {
    keepDays: KEEP_DAYS,
    redactingOlderThan: cutoff.toISOString().slice(0, 10),
  });

  let db;
  try {
    db = await mongodb.getDbSafe();
  } catch (err) {
    logError(err, { scope: 'base64RedactJob.connect' });
    return;
  }

  const startMs = Date.now();
  let grandScanned = 0;
  let grandModified = 0;

  for (const { name, fields } of COLLECTIONS) {
    const col = db.collection(name);

    // Only filter by createdAt if the collection uses it
    const sample = await col.findOne({}, { projection: { createdAt: 1 } });
    if (!sample) continue;
    const baseFilter = sample.createdAt ? { createdAt: { $lt: cutoff } } : {};

    let lastId = null;
    let colScanned = 0;
    let colModified = 0;

    while (true) {
      const filter = lastId ? { ...baseFilter, _id: { $gt: lastId } } : baseFilter;

      const docs = await col
        .find(filter)
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .project(fields.reduce((acc, f) => { acc[f] = 1; return acc; }, { _id: 1 }))
        .toArray();

      if (docs.length === 0) break;

      lastId = docs[docs.length - 1]._id;
      colScanned += docs.length;

      const bulkOps = [];
      for (const doc of docs) {
        const updates = {};
        for (const field of fields) {
          if (doc[field] !== undefined && hasBase64(doc[field])) {
            updates[field] = redact(doc[field]);
          }
        }
        if (Object.keys(updates).length > 0) {
          updates.updatedAt = new Date();
          bulkOps.push({ updateOne: { filter: { _id: doc._id }, update: { $set: updates } } });
        }
      }

      if (bulkOps.length > 0) {
        const result = await col.bulkWrite(bulkOps, { ordered: false });
        colModified += result.modifiedCount;
      }
    }

    if (colModified > 0) {
      log('info', 'Base64 redact: collection done', { collection: name, scanned: colScanned, modified: colModified });
    }

    grandScanned += colScanned;
    grandModified += colModified;
  }

  const elapsedS = ((Date.now() - startMs) / 1000).toFixed(1);
  log('info', 'Base64 redact job completed', {
    elapsedS,
    totalScanned: grandScanned,
    totalModified: grandModified,
  });
}

// --- scheduler lifecycle ---

let task = null;

function startBase64RedactScheduler() {
  if (task) return; // already running

  // Run daily at 23:00 server time
  task = cron.schedule('0 23 * * *', async () => {
    try {
      await runRedactJob();
    } catch (err) {
      logError(err, { scope: 'base64RedactScheduler' });
    }
  });

  log('info', 'Base64 redact scheduler started (daily at 23:00)');
}

function stopBase64RedactScheduler() {
  if (task) {
    task.stop();
    task = null;
    log('info', 'Base64 redact scheduler stopped');
  }
}

module.exports = { startBase64RedactScheduler, stopBase64RedactScheduler, runRedactJob };
