'use strict';

/**
 * MCP server download route tests.
 * The route zips the real mcp-server/ directory from the repo, so these
 * tests exercise the actual filesystem path resolution and archive stream.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
  logError: jest.fn(),
}));

jest.mock('../../src/config', () => ({
  api: { basePrefix: '/api/v1' },
  security: { jwtSecret: 'test-secret', apiKey: 'test-api-key' },
}));

jest.mock('../../src/middleware/auth', () => (req, _res, next) => {
  req.user = { id: 'user-1', email: 'admin@example.com', role: 'ORG_ADMIN', orgId: 892 };
  req.orgId = 892;
  next();
});

jest.mock('../../src/middleware/permission', () => ({
  requirePermission: () => (_req, _res, next) => next(),
}));

const mcpServerRouter = require('../../src/routes/mcp-server');

function buildApp() {
  const app = express();
  app.use('/api/v1/mcp-server', mcpServerRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.statusCode || 500).json({ error: err.message });
  });
  return app;
}

describe('GET /api/v1/mcp-server/download', () => {
  it('streams a zip attachment containing the MCP server source', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/mcp-server/download')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toContain('icp-mcp-server.zip');
    // Zip local file headers start with "PK".
    expect(res.body.slice(0, 2).toString()).toBe('PK');
    // Zip entry names are stored as plain bytes, so the buffer is searchable.
    const raw = res.body.toString('latin1');
    expect(raw).toContain('icp-mcp-server/package.json');
    expect(raw).toContain('icp-mcp-server/src/index.js');
    expect(raw).toContain('icp-mcp-server/src/tools.js');
    expect(raw).toContain('icp-mcp-server/src/api-client.js');
    expect(raw).toContain('icp-mcp-server/config.example.json');
  });

  it('never includes node_modules, .env, or test files in the archive', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/v1/mcp-server/download')
      .buffer(true)
      .parse((response, callback) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const raw = res.body.toString('latin1');
    expect(raw).not.toContain('node_modules');
    expect(raw).not.toContain('icp-mcp-server/.env');
    expect(raw).not.toContain('icp-mcp-server/test/');
  });
});
