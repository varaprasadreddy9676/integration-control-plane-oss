'use strict';

const express = require('express');
const request = require('supertest');

const mockJobs = {
  createIndex: jest.fn().mockResolvedValue(undefined),
  insertOne: jest.fn().mockResolvedValue({ acknowledged: true }),
  findOneAndUpdate: jest.fn().mockResolvedValue({ value: null }),
  findOne: jest.fn().mockResolvedValue(null),
  updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
};
const mockDb = { collection: jest.fn((name) => (name === 'lookup_export_jobs' ? mockJobs : {})) };

jest.mock('../../src/mongodb', () => ({
  getDbSafe: jest.fn().mockResolvedValue(mockDb),
  isConnected: jest.fn(() => true),
  toObjectId: jest.fn(),
}));
jest.mock('../../src/data', () => ({
  listLookups: jest.fn(), streamLookupsForExport: jest.fn(), getLookup: jest.fn(), addLookup: jest.fn(),
  updateLookup: jest.fn(), deleteLookup: jest.fn(), bulkCreateLookups: jest.fn(), bulkDeleteLookups: jest.fn(),
  resolveLookup: jest.fn(), resolveLookupObject: jest.fn(), reverseLookup: jest.fn(), getLookupStats: jest.fn(), getLookupTypes: jest.fn(),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));
jest.mock('../../src/middleware/audit', () => ({ auditLookup: {} }));
jest.mock('../../src/services/lookup-validator', () => ({}));
jest.mock('../../src/services/lookup-service', () => ({}));
jest.mock('../../src/services/lookup-import-export', () => ({
  parseImportFile: jest.fn(), generateExportFile: jest.fn(), generateSimpleCSV: jest.fn(), generateImportTemplate: jest.fn(),
  createStreamingLookupXlsxWriter: jest.fn(),
}));

const app = express();
app.use((req, _res, next) => { req.user = { id: 'admin-1', role: 'SUPER_ADMIN' }; next(); });
app.use('/api/v1/lookups', require('../../src/routes/lookups'));

describe('lookup export route', () => {
  beforeEach(() => jest.clearAllMocks());

  it('queues an XLSX export with org and UI filters', async () => {
    const res = await request(app).get('/api/v1/lookups/export?orgId=33&type=ICD&isActive=true&format=xlsx');

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ status: 'QUEUED', format: 'xlsx' });
    expect(res.body.statusPath).toContain('/lookups/export/jobs/');
    expect(mockJobs.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      orgId: 33,
      ownerUserId: 'admin-1',
      format: 'xlsx',
      filters: expect.objectContaining({ type: 'ICD', isActive: true }),
    }));
  });
});
