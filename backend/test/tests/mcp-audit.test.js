'use strict';

jest.mock('../../src/services/audit-logger', () => ({
  logAudit: jest.fn(async () => {}),
  ACTION_TYPES: { READ: 'read' },
  RESOURCE_TYPES: { CONFIG: 'config' },
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const { redactSensitive, logMcpAudit } = require('../../src/services/mcp-audit');
const { logAudit } = require('../../src/services/audit-logger');

describe('MCP audit helpers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('redacts nested secret-like keys', () => {
    const redacted = redactSensitive({
      username: 'api-user',
      password: 'secret',
      nested: {
        apiKey: 'key',
        headers: {
          Authorization: 'Bearer token',
        },
      },
      list: [{ clientSecret: 'client-secret' }],
    });

    expect(redacted.username).toBe('api-user');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.nested.apiKey).toBe('[REDACTED]');
    expect(redacted.nested.headers.Authorization).toBe('[REDACTED]');
    expect(redacted.list[0].clientSecret).toBe('[REDACTED]');
  });

  it('writes MCP metadata without exposing secret arguments', async () => {
    const req = {
      id: 'req-1',
      orgId: 7,
      user: { id: 'user-1' },
      ip: '127.0.0.1',
      get: (name) => (name === 'x-mcp-client' ? 'codex' : null),
    };

    await logMcpAudit(req, {
      toolName: 'set_credential_values',
      arguments: { values: { apiKey: 'secret' } },
      result: { ok: true },
    });

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 7,
        metadata: expect.objectContaining({
          source: 'MCP',
          clientName: 'codex',
          arguments: { values: { apiKey: '[REDACTED]' } },
        }),
      })
    );
  });
});
