'use strict';

/**
 * The one background-export implementation (services/export-jobs) that the delivery
 * log, event audit, admin audit, system log and alert center exports all use: the
 * job's life (queued, claimed once, completed or failed with its file cleaned up),
 * its status shape, the download, and the shared settings and stream helpers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const request = require('supertest');

// A small in-memory collection: just what the store uses.
const mockDocs = [];
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => doc[key] === value);
const mockCollection = {
  createIndex: jest.fn(async () => {}),
  insertOne: jest.fn(async (doc) => {
    mockDocs.push({ ...doc });
  }),
  findOne: jest.fn(async (filter) => mockDocs.find((doc) => matches(doc, filter)) || null),
  findOneAndUpdate: jest.fn(async (filter, update) => {
    const doc = mockDocs.find((candidate) => matches(candidate, filter));
    if (doc) Object.assign(doc, update.$set);
    return { value: doc ? { ...doc } : null };
  }),
  updateOne: jest.fn(async (filter, update) => {
    const doc = mockDocs.find((candidate) => matches(candidate, filter));
    if (doc) Object.assign(doc, update.$set);
  }),
};
jest.mock('../../src/mongodb', () => ({ getDbSafe: async () => ({ collection: () => mockCollection }) }));
jest.mock('../../src/logger', () => ({ log: jest.fn(), logError: jest.fn() }));

const { createExportJobStore, exportSettings, parseBooleanQuery, writeFileChunk, writeWithBackpressure, trackAbort } = require('../../src/services/export-jobs');

const store = (extra = {}) =>
  createExportJobStore({ collection: 'jobs', idPrefix: 'tst', basePath: '/api/v1/things', tmpDirName: `export-jobs-test-${process.pid}`, orgScoped: true, label: 'test', ...extra });

beforeEach(() => {
  mockDocs.length = 0;
  jest.clearAllMocks();
});

describe('creating and reading a job', () => {
  it('queues a job with its file name, the org, and whatever is specific to the export', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 7, format: 'csv', fileStem: 'things', totalRecords: '12', fields: { filters: { a: 1 } } });
    expect(job).toMatchObject({ orgId: 7, format: 'csv', status: 'QUEUED', totalRecords: 12, processedRecords: 0, filters: { a: 1 }, filePath: null });
    expect(job.jobId).toMatch(/^tst_\d+_[0-9a-f]{8}$/);
    expect(job.fileName).toBe(`things-${new Date().toISOString().split('T')[0]}-${job.jobId}.csv`);
    expect(job.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(mockCollection.createIndex).toHaveBeenCalledWith({ orgId: 1, createdAt: -1 });
  });

  it('an org-scoped job is visible to its own org only; an unscoped one has no org', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 7, format: 'json', fileStem: 'x' });
    expect(await jobs.get(job.jobId, 7)).toMatchObject({ jobId: job.jobId });
    expect(await jobs.get(job.jobId, 8)).toBeNull();
    const open = store({ orgScoped: false });
    const mine = await open.create({ orgId: 7, format: 'json', fileStem: 'x' });
    expect(mine).not.toHaveProperty('orgId');
    expect(await open.get(mine.jobId)).toMatchObject({ jobId: mine.jobId });
  });

  it('describes a job to the console with where to poll and download', async () => {
    const job = await store().create({ orgId: 1, format: 'csv', fileStem: 'x' });
    expect(store().toResponse(job)).toMatchObject({
      jobId: job.jobId,
      status: 'QUEUED',
      statusPath: `/api/v1/things/export/jobs/${job.jobId}`,
      downloadPath: `/api/v1/things/export/jobs/${job.jobId}/download`,
      fileSizeBytes: 0,
      errorMessage: null,
    });
  });
});

describe('running a job', () => {
  it('claims it once, lets the export write its file, then completes it with the size and count', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 1, format: 'csv', fileStem: 'x', totalRecords: 3 });
    const work = jest.fn(async ({ openStream, progress }) => {
      const stream = openStream();
      for (let n = 1; n <= 3; n += 1) {
        await writeFileChunk(stream, `row ${n}\n`);
        await progress(n);
      }
      return { processedRecords: 3 };
    });
    await jobs.run(job.jobId, work);
    await jobs.run(job.jobId, work); // already claimed: nothing happens
    expect(work).toHaveBeenCalledTimes(1);

    const done = await jobs.get(job.jobId, 1);
    expect(done).toMatchObject({ status: 'COMPLETED', processedRecords: 3, fileSizeBytes: 'row 1\nrow 2\nrow 3\n'.length });
    expect(fs.readFileSync(done.filePath, 'utf8')).toBe('row 1\nrow 2\nrow 3\n');
    expect(done.finishedAt).toBeInstanceOf(Date);
    fs.rmSync(done.filePath, { force: true });
  });

  it('stores progress every hundred rows and can set the final total', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 1, format: 'json', fileStem: 'x' });
    await jobs.run(job.jobId, async ({ filePath, progress }) => {
      fs.writeFileSync(filePath, '[]');
      await progress(100);
      expect(mockDocs[0]).toMatchObject({ status: 'PROCESSING', processedRecords: 100 });
      return { processedRecords: 120, totalRecords: 120 };
    });
    expect(mockDocs[0]).toMatchObject({ status: 'COMPLETED', processedRecords: 120, totalRecords: 120 });
    fs.rmSync(mockDocs[0].filePath, { force: true });
  });

  it('a failing export is marked FAILED with its message and progress, and its half-written file is removed', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 1, format: 'csv', fileStem: 'x' });
    let written;
    await jobs.run(job.jobId, async ({ openStream, progress, filePath }) => {
      written = filePath;
      await writeFileChunk(openStream(), 'partial');
      await progress(50);
      throw new Error('database went away');
    });
    expect(mockDocs[0]).toMatchObject({ status: 'FAILED', errorMessage: 'database went away', processedRecords: 50 });
    expect(mockDocs[0].filePath).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.existsSync(written)).toBe(false);
  });

  it('start runs the job after the response and survives a failure', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 1, format: 'csv', fileStem: 'x' });
    expect(jobs.start(job, async () => {
      throw new Error('boom');
    })).toBe(job);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mockDocs[0]).toMatchObject({ status: 'FAILED', errorMessage: 'boom' });
  });
});

describe('downloading', () => {
  const app = (jobs) => {
    const router = express.Router();
    router.get('/export/jobs/:jobId/download', jobs.downloadHandler());
    const server = express();
    server.use((req, _res, next) => {
      req.orgId = Number(req.headers['x-org'] || 1);
      next();
    });
    server.use(router);
    server.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
    return server;
  };

  it('answers for a missing, unfinished, file-less or expired job in its own words', async () => {
    const jobs = store();
    const server = app(jobs);
    expect((await request(server).get('/export/jobs/nope/download')).status).toBe(404);

    const queued = await jobs.create({ orgId: 1, format: 'csv', fileStem: 'x' });
    expect(await request(server).get(`/export/jobs/${queued.jobId}/download`)).toMatchObject({ status: 409, body: { code: 'EXPORT_NOT_READY', status: 'QUEUED' } });

    mockDocs[0].status = 'COMPLETED';
    expect(await request(server).get(`/export/jobs/${queued.jobId}/download`)).toMatchObject({ status: 500, body: { code: 'EXPORT_FILE_MISSING' } });

    mockDocs[0].filePath = path.join(os.tmpdir(), 'export-jobs-test-missing-file.csv');
    expect(await request(server).get(`/export/jobs/${queued.jobId}/download`)).toMatchObject({ status: 410, body: { code: 'EXPORT_FILE_EXPIRED' } });
  });

  it('streams a finished file with its type and name, to its own org only', async () => {
    const jobs = store();
    const job = await jobs.create({ orgId: 1, format: 'csv', fileStem: 'things' });
    await jobs.run(job.jobId, async ({ openStream }) => {
      await writeFileChunk(openStream(), 'a,b\n1,2\n');
      return { processedRecords: 1 };
    });
    const server = app(jobs);
    const res = await request(server).get(`/export/jobs/${job.jobId}/download`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toContain(job.fileName);
    expect(res.text).toBe('a,b\n1,2\n');
    expect((await request(server).get(`/export/jobs/${job.jobId}/download`).set('x-org', '2')).status).toBe(404);
    fs.rmSync(mockDocs[0].filePath, { force: true });
  });
});

describe('settings and helpers', () => {
  it('reads its threshold and retention from its own env names, never below the floor', () => {
    process.env.THING_EXPORT_ASYNC_THRESHOLD = '250';
    process.env.THING_EXPORT_JOB_TTL_MS = '1000';
    expect(exportSettings('THING')).toEqual({ asyncThreshold: 250, ttlMs: 5 * 60 * 1000 });
    delete process.env.THING_EXPORT_ASYNC_THRESHOLD;
    delete process.env.THING_EXPORT_JOB_TTL_MS;
    expect(exportSettings('THING')).toEqual({ asyncThreshold: 5000, ttlMs: 6 * 60 * 60 * 1000 });
  });

  it('reads truthy query values', () => {
    expect(['1', 'true', 'YES', ' y '].map(parseBooleanQuery)).toEqual([true, true, true, true]);
    expect([undefined, '0', 'no', 5].map(parseBooleanQuery)).toEqual([false, false, false, false]);
    expect(parseBooleanQuery(true)).toBe(true);
  });

  it('tracks a client leaving, and stops writing to a response when it has', async () => {
    const listeners = {};
    const req = { on: (event, fn) => (listeners[event] = fn), once: jest.fn(), off: jest.fn() };
    const aborted = trackAbort(req);
    expect(aborted()).toBe(false);
    listeners.close();
    expect(aborted()).toBe(true);
    const res = { write: jest.fn(() => true) };
    expect(await writeWithBackpressure(req, res, 'x', () => true)).toBe(false);
    expect(res.write).not.toHaveBeenCalled();
    expect(await writeWithBackpressure(req, res, 'x', () => false)).toBe(true);
  });
});
