#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { IntegrationControlPlaneClient } from './api-client.js';
import { registerTools } from './tools.js';
import { isCheckCommand, loadConfig } from './config.js';

async function main() {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    process.stderr.write(`[icp-mcp] Configuration error: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }

  const client = new IntegrationControlPlaneClient(config);

  if (isCheckCommand()) {
    try {
      const health = await client.getGatewayHealth();
      const auth = await client.checkCredentials();
      process.stdout.write(`${JSON.stringify({ ok: auth.ok, auth, ...health }, null, 2)}\n`);
      if (!auth.ok) process.exitCode = 1;
    } catch (error) {
      process.stdout.write(
        `${JSON.stringify({ ok: false, status: error.status ?? 'UNKNOWN', message: error.message, requestId: error.requestId ?? null }, null, 2)}\n`
      );
      process.exitCode = 1;
    }
    return;
  }

  const server = new McpServer({
    name: `integration-control-plane (${config.env})`,
    version: '0.5.0',
  });

  registerTools(server, client);

  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    process.stderr.write(
      '[icp-mcp] NOTE: GITHUB_TOKEN/GITHUB_REPO not set — report_issue and request_feature will return filed: false rather than filing anything.\n'
    );
  }
  process.stderr.write(`[icp-mcp] Starting — env=${config.env} base=${config.baseUrl}\n`);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  process.stderr.write(`[icp-mcp] Fatal error: ${error.stack || error.message}\n`);
  process.exitCode = 1;
});
