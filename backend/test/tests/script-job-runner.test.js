'use strict';

jest.mock('../../src/services/connection-profiles', () => ({
  resolveProfile: jest.fn(),
}));

jest.mock('../../src/services/gateway-secrets', () => ({
  getSecret: jest.fn(),
}));

jest.mock('mysql2/promise', () => ({
  createConnection: jest.fn(),
}));

jest.mock('axios', () => ({
  post: jest.fn(),
}));

jest.mock('../../src/logger', () => ({
  log: jest.fn(),
}));

const mysql = require('mysql2/promise');
const { resolveProfile } = require('../../src/services/connection-profiles');
const { getSecret } = require('../../src/services/gateway-secrets');
const { runScriptJob } = require('../../src/services/script-job-runner');

describe('script-job-runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resolveProfile.mockResolvedValue({
      type: 'MYSQL',
      config: {
        host: '127.0.0.1',
        user: 'report',
        password: 'secret',
        database: 'reporting',
      },
    });
    getSecret.mockResolvedValue(null);
  });

  it('blocks non-read-only SQL before opening a MySQL connection', async () => {
    const result = await runScriptJob({
      _id: 'job-1',
      orgId: 33,
      connections: { mysql: 'reporting-db' },
      script: "await mysql.query('DELETE FROM rpt_patient_details');",
    });

    expect(result.status).toBe('FAILED');
    expect(result.error).toMatch(/read-only|blocked/i);
    expect(mysql.createConnection).not.toHaveBeenCalled();
  });

  it('escapes HTML in generated report content', async () => {
    const result = await runScriptJob({
      _id: 'job-2',
      orgId: 33,
      script: `
        return report.htmlTable({
          title: '<script>alert(1)</script>',
          rows: [{ name: '<b>Unsafe</b>', count: 1, ok: true }]
        });
      `,
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.result).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.result).toContain('&lt;b&gt;Unsafe&lt;/b&gt;');
    expect(result.result).not.toContain('<script>alert(1)</script>');
  });

  it('injects decrypted script job environment variables as env', async () => {
    getSecret.mockImplementation(async (key) => {
      if (key === 'script-job:job-3:NOVA_DB_PASSWORD') return 'super-secret';
      if (key === 'script-job:job-3:REPORT_TO') return 'ops@example.com';
      return null;
    });

    const result = await runScriptJob({
      _id: 'job-3',
      orgId: 33,
      environmentVariables: [
        { key: 'NOVA_DB_PASSWORD', secretKey: 'script-job:job-3:NOVA_DB_PASSWORD' },
        { key: 'REPORT_TO', secretKey: 'script-job:job-3:REPORT_TO' },
      ],
      script: 'return { password: env.NOVA_DB_PASSWORD, to: env.REPORT_TO };',
    });

    expect(result.status).toBe('SUCCESS');
    expect(result.result).toEqual({
      password: 'super-secret',
      to: 'ops@example.com',
    });
  });
});
