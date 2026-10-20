const path = require('path');
const fs = require('fs');
const express = require('express');
const archiver = require('archiver');
const auth = require('../middleware/auth');
const asyncHandler = require('../utils/async-handler');
const { requirePermission } = require('../middleware/permission');
const { ServiceUnavailableError } = require('../utils/errors');
const { log } = require('../logger');

const router = express.Router();

router.use(auth);

// Deployment layouts differ per server (repo root locally, app root on the
// servers), so probe the known locations instead of hardcoding one.
const CANDIDATE_DIRS = [
  process.env.MCP_SERVER_DIR,
  path.resolve(__dirname, '../../../mcp-server'),
  path.resolve(__dirname, '../../mcp-server'),
  path.resolve(process.cwd(), 'mcp-server'),
  path.resolve(process.cwd(), '../mcp-server'),
].filter(Boolean);

function resolveMcpServerDir() {
  return CANDIDATE_DIRS.find(
    (dir) => fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'src'))
  );
}

/**
 * GET /api/v1/mcp-server/download
 * Streams a zip of the MCP server source and safe setup files.
 * Whitelist only — never ships node_modules, .env, or anything else that
 * happens to be sitting in the directory.
 */
router.get(
  '/download',
  requirePermission('api_keys:view'),
  asyncHandler(async (req, res, next) => {
    const dir = resolveMcpServerDir();
    if (!dir) {
      throw new ServiceUnavailableError('MCP server package is not available on this deployment');
    }

    const srcFiles = fs
      .readdirSync(path.join(dir, 'src'))
      .filter((name) => name.endsWith('.js'));
    if (srcFiles.length === 0) {
      throw new ServiceUnavailableError('MCP server package is incomplete on this deployment');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="icp-mcp-server.zip"');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      log('error', 'MCP server zip failed', { error: err.message });
      // Headers may already be flushed mid-stream; destroying is the only
      // honest signal left to the client at that point.
      if (res.headersSent) {
        res.destroy(err);
      } else {
        next(err);
      }
    });
    archive.pipe(res);

    const optionalFiles = [];
    archive.file(path.join(dir, 'package.json'), { name: 'icp-mcp-server/package.json' });
    if (fs.existsSync(path.join(dir, 'README.md'))) {
      archive.file(path.join(dir, 'README.md'), { name: 'icp-mcp-server/README.md' });
      optionalFiles.push('README.md');
    }
    if (fs.existsSync(path.join(dir, 'config.example.json'))) {
      archive.file(path.join(dir, 'config.example.json'), { name: 'icp-mcp-server/config.example.json' });
      optionalFiles.push('config.example.json');
    }
    srcFiles.forEach((name) => {
      archive.file(path.join(dir, 'src', name), { name: `icp-mcp-server/src/${name}` });
    });

    await archive.finalize();

    log('info', 'MCP server package downloaded', {
      userId: req.user.id,
      orgId: req.orgId,
      files: srcFiles.length + optionalFiles.length + 1,
    });
  })
);

module.exports = router;
