'use strict';

/**
 * Asynchronous exports: the one implementation of a background export job, used by
 * every export route (delivery logs, event audit, admin audit, system logs, alert
 * center). A route supplies what is specific to it (the data and how a row is
 * written) and this module does the rest:
 *
 *   const jobs = createExportJobStore({ collection, idPrefix, basePath, tmpDirName, ttlMs, orgScoped, label });
 *   jobs.create({ orgId, format, fileStem, totalRecords, fields })   a QUEUED job
 *   jobs.start(jobId, work)             run it in the background (after the response)
 *   jobs.run(jobId, work)               claim it, give `work` a file, then complete or fail it
 *   jobs.get(jobId, orgId) / jobs.toResponse(job)
 *   router.get('/export/jobs/:jobId/download', jobs.downloadHandler(...))
 *
 * `work({ job, filePath, openStream, progress })` writes the file and resolves to
 * `{ processedRecords, totalRecords? }`; `openStream()` gives a write stream on the
 * file, closed by the store; `progress(n)` records how far it got (stored every
 * PROGRESS_EVERY rows, and kept if the job fails).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { uuidv4 } = require('../utils/runtime');
const mongodb = require('../mongodb');
const { log } = require('../logger');

const PROGRESS_EVERY = 100;
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_ASYNC_THRESHOLD = 5000;

const parseBooleanQuery = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return false;
  return ['1', 'true', 'yes', 'y'].includes(value.trim().toLowerCase());
};

const envNumber = (name, fallback, min) => Math.max(min, Number.parseInt(process.env[name] || String(fallback), 10));

/**
 * What every export reads from its own env names, `<PREFIX>_EXPORT_ASYNC_THRESHOLD`
 * (rows from which it runs in the background) and `<PREFIX>_EXPORT_JOB_TTL_MS`
 * (how long a finished file is kept, at least 5 minutes).
 */
const exportSettings = (envPrefix) => ({
  asyncThreshold: envNumber(`${envPrefix}_EXPORT_ASYNC_THRESHOLD`, DEFAULT_ASYNC_THRESHOLD, 1),
  ttlMs: envNumber(`${envPrefix}_EXPORT_JOB_TTL_MS`, DEFAULT_TTL_MS, 5 * 60 * 1000),
});

/** `isAborted()` for a streamed response: true once the client has gone away. */
const trackAbort = (req) => {
  let aborted = false;
  const mark = () => {
    aborted = true;
  };
  req.on('close', mark);
  req.on('aborted', mark);
  return () => aborted;
};

const writeFileChunk = (stream, chunk) =>
  new Promise((resolve, reject) => {
    const onError = (err) => {
      cleanup();
      reject(err);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      stream.off('error', onError);
      stream.off('drain', onDrain);
    };
    stream.once('error', onError);
    if (stream.write(chunk)) {
      cleanup();
      resolve();
    } else {
      stream.once('drain', onDrain);
    }
  });

const closeFileStream = (stream) =>
  new Promise((resolve, reject) => {
    stream.once('error', reject);
    stream.end(() => resolve());
  });

/** Write to a response, waiting for drain; false when the client went away. */
const writeWithBackpressure = (req, res, chunk, isAborted) => {
  if (isAborted()) return Promise.resolve(false);
  if (res.write(chunk)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onDrain = () => cleanup(true);
    const onClose = () => cleanup(false);
    const cleanup = (canContinue) => {
      res.off('drain', onDrain);
      req.off('close', onClose);
      req.off('aborted', onClose);
      resolve(canContinue);
    };
    res.once('drain', onDrain);
    req.once('close', onClose);
    req.once('aborted', onClose);
  });
};

const CONTENT_TYPES = { csv: 'text/csv; charset=utf-8', json: 'application/json; charset=utf-8' };

/** Stream a finished export file to the response (an error response when it cannot be). */
function sendExportFile(res, job, { contentType } = {}) {
  if (!job) return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  if (job.status !== 'COMPLETED') {
    return res.status(409).json({ error: 'Export job is not ready', code: 'EXPORT_NOT_READY', status: job.status });
  }
  if (!job.filePath) return res.status(500).json({ error: 'Export file path missing', code: 'EXPORT_FILE_MISSING' });
  return fsp.access(job.filePath, fs.constants.R_OK).then(
    () => {
      res.setHeader('Content-Type', contentType || CONTENT_TYPES[job.format] || CONTENT_TYPES.json);
      res.setHeader('Content-Disposition', `attachment; filename="${job.fileName || path.basename(job.filePath)}"`);
      return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(job.filePath);
        const onClose = () => {
          cleanup();
          resolve();
        };
        const onError = (err) => {
          cleanup();
          if (res.headersSent) resolve();
          else reject(err);
        };
        const cleanup = () => {
          stream.off('error', onError);
          stream.off('end', onClose);
          res.off('close', onClose);
        };
        stream.on('error', onError);
        stream.on('end', onClose);
        res.on('close', onClose);
        stream.pipe(res);
      });
    },
    () => res.status(410).json({ error: 'Export file expired', code: 'EXPORT_FILE_EXPIRED' })
  );
}

function createExportJobStore({ collection, idPrefix, basePath, tmpDirName, ttlMs = DEFAULT_TTL_MS, orgScoped = false, label }) {
  const tmpDir = path.join(os.tmpdir(), tmpDirName);
  let indexesEnsured = false;

  const jobsOf = async () => {
    const db = await mongodb.getDbSafe();
    if (!indexesEnsured) {
      const jobs = db.collection(collection);
      try {
        await jobs.createIndex({ jobId: 1 }, { unique: true });
        await jobs.createIndex(orgScoped ? { orgId: 1, createdAt: -1 } : { createdAt: -1 });
        await jobs.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      } catch (error) {
        log('warn', `Failed to ensure ${label} export indexes`, { error: error.message });
      }
      indexesEnsured = true;
    }
    return db.collection(collection);
  };

  const toResponse = (job) => ({
    jobId: job.jobId,
    status: job.status,
    format: job.format,
    totalRecords: job.totalRecords || 0,
    processedRecords: job.processedRecords || 0,
    fileSizeBytes: job.fileSizeBytes || 0,
    fileName: job.fileName || null,
    errorMessage: job.errorMessage || null,
    createdAt: job.createdAt,
    startedAt: job.startedAt || null,
    finishedAt: job.finishedAt || null,
    expiresAt: job.expiresAt || null,
    statusPath: `${basePath}/export/jobs/${encodeURIComponent(job.jobId)}`,
    downloadPath: `${basePath}/export/jobs/${encodeURIComponent(job.jobId)}/download`,
  });

  /** `fields`: what is specific to this export (filters, query, selected IDs...), stored on the job. */
  const create = async ({ orgId, format, fileStem, totalRecords = 0, fields = {} }) => {
    const jobs = await jobsOf();
    const now = new Date();
    const jobId = `${idPrefix}_${Date.now()}_${uuidv4().replace(/-/g, '').slice(0, 8)}`;
    const doc = {
      jobId,
      ...(orgScoped ? { orgId } : {}),
      format,
      ...fields,
      status: 'QUEUED',
      totalRecords: Number(totalRecords) || 0,
      processedRecords: 0,
      filePath: null,
      fileName: `${fileStem}-${now.toISOString().split('T')[0]}-${jobId}.${format}`,
      fileSizeBytes: 0,
      errorMessage: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
      expiresAt: new Date(now.getTime() + ttlMs),
    };
    await jobs.insertOne(doc);
    return doc;
  };

  const get = async (jobId, orgId) => (await jobsOf()).findOne(orgScoped ? { orgId, jobId } : { jobId });

  const run = async (jobId, work) => {
    const jobs = await jobsOf();
    const claimed = await jobs.findOneAndUpdate(
      { jobId, status: 'QUEUED' },
      { $set: { status: 'PROCESSING', startedAt: new Date(), updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
    const job = claimed.value;
    if (!job) return;

    await fsp.mkdir(tmpDir, { recursive: true });
    const filePath = path.join(tmpDir, `${job.jobId}.${job.format}`);
    let stream = null;
    let processedRecords = 0;
    const openStream = () => {
      stream = stream || fs.createWriteStream(filePath, { encoding: 'utf8' });
      return stream;
    };
    const progress = async (count) => {
      processedRecords = count;
      if (count % PROGRESS_EVERY !== 0) return;
      await jobs.updateOne({ jobId }, { $set: { processedRecords: count, updatedAt: new Date() } });
      await new Promise((resolve) => setImmediate(resolve)); // let other requests in during a long export
    };
    const expiry = () => new Date(Date.now() + ttlMs);

    try {
      const result = (await work({ job, filePath, openStream, progress })) || {};
      if (stream) await closeFileStream(stream);
      const stat = await fsp.stat(filePath);
      processedRecords = result.processedRecords === undefined ? processedRecords : result.processedRecords;
      await jobs.updateOne(
        { jobId },
        {
          $set: {
            status: 'COMPLETED',
            ...(result.totalRecords === undefined ? {} : { totalRecords: result.totalRecords }),
            processedRecords,
            filePath,
            fileSizeBytes: stat.size,
            finishedAt: new Date(),
            updatedAt: new Date(),
            expiresAt: expiry(),
          },
        }
      );
      log('info', `${label} export job completed`, { jobId, processedRecords, fileSizeBytes: stat.size });
    } catch (error) {
      try {
        if (stream) stream.destroy();
      } catch (_err) {
        // The stream is being thrown away; nothing more to do.
      }
      try {
        await fsp.rm(filePath, { force: true });
      } catch (_err) {
        // A leftover temporary file is removed with the temp directory.
      }
      await jobs.updateOne(
        { jobId },
        { $set: { status: 'FAILED', processedRecords, errorMessage: error.message, finishedAt: new Date(), updatedAt: new Date(), expiresAt: expiry() } }
      );
      log('error', `${label} export job failed`, { jobId, error: error.message });
    }
  };

  /** Run the job after the response is sent. */
  const start = (job, work) => {
    setImmediate(() => {
      run(job.jobId, work).catch((error) => {
        log('error', `Unhandled ${label} export job failure`, { jobId: job.jobId, error: error.message });
      });
    });
    return job;
  };

  /**
   * An Express handler for GET .../export/jobs/:jobId/download. `orgOf(req)`
   * returns the organization for an org-scoped store; `contentType` fixes the type
   * for exports that are always one format.
   */
  const downloadHandler =
    ({ orgOf = (req) => req.orgId, contentType } = {}) =>
    async (req, res, next) => {
      try {
        if (orgScoped && !orgOf(req)) return res.status(400).json({ error: 'orgId missing', code: 'VALIDATION_ERROR' });
        return await sendExportFile(res, await get(req.params.jobId, orgOf(req)), { contentType });
      } catch (error) {
        return next(error);
      }
    };

  return { create, get, run, start, toResponse, downloadHandler, tmpDir, ttlMs };
}

module.exports = {
  createExportJobStore,
  exportSettings,
  sendExportFile,
  parseBooleanQuery,
  writeFileChunk,
  closeFileStream,
  writeWithBackpressure,
  trackAbort,
  PROGRESS_EVERY,
};
