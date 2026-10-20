'use strict';

jest.mock('../../src/services/connection-profiles', () => ({
  resolveProfile: jest.fn(),
}));
jest.mock('../../src/services/gateway-secrets', () => ({
  getSecret: jest.fn(),
}));
jest.mock('../../src/logger', () => ({ log: jest.fn() }));

const fs = require('fs');
const os = require('os');
const path = require('path');

describe('node-script-runner', () => {
  let runner;
  let tmpRoot;

  beforeAll(() => {
    jest.resetModules();
    runner = require('../../src/services/node-script-runner');
  });

  afterEach(() => {
    if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  test('normalizeDependencies keeps only valid npm package names', () => {
    const deps = runner.normalizeDependencies([
      { name: 'axios', version: '^1.6.0' },
      { name: '@scope/pkg', version: '2.0.0' },
      { name: 'rm -rf /', version: '1.0.0' },
      { name: '', version: '1.0.0' },
    ]);
    expect(deps).toEqual({ axios: '^1.6.0', '@scope/pkg': '2.0.0' });
  });

  test('runNodeScriptJob captures console.log output and reports SUCCESS', async () => {
    const jobId = 'test-job-' + Date.now();
    const jobConfig = {
      _id: jobId,
      orgId: 33,
      script: "console.log('hello from script'); console.error('warn line');",
      timeoutMs: 5000,
      environmentVariables: [],
      connections: {},
    };

    const result = await runner.runNodeScriptJob(jobConfig);
    tmpRoot = runner.getJobDir(jobId);

    expect(result.status).toBe('SUCCESS');
    expect(result.scriptLogs.some((l) => l.message.includes('hello from script'))).toBe(true);
    expect(result.scriptLogs.some((l) => l.level === 'error' && l.message.includes('warn line'))).toBe(true);
  });

  test('runNodeScriptJob reports FAILED on non-zero exit', async () => {
    const jobId = 'test-job-fail-' + Date.now();
    const jobConfig = {
      _id: jobId,
      orgId: 33,
      script: "throw new Error('boom');",
      timeoutMs: 5000,
    };

    const result = await runner.runNodeScriptJob(jobConfig);
    tmpRoot = runner.getJobDir(jobId);

    expect(result.status).toBe('FAILED');
  });

  test('runNodeScriptJob kills a script that exceeds its timeout', async () => {
    const jobId = 'test-job-timeout-' + Date.now();
    const jobConfig = {
      _id: jobId,
      orgId: 33,
      script: 'setInterval(() => {}, 1000);',
      timeoutMs: 500,
    };

    const result = await runner.runNodeScriptJob(jobConfig);
    tmpRoot = runner.getJobDir(jobId);

    expect(result.status).toBe('TIMEOUT');
  }, 10000);

  test('resolveEnvironmentVariables exposes connection profile fields as prefixed env vars', async () => {
    const { resolveProfile } = require('../../src/services/connection-profiles');
    resolveProfile.mockResolvedValue({
      config: { host: '1.2.3.4', port: 3306, user: 'u', password: 'p', database: 'd' },
    });

    const jobId = 'test-job-env-' + Date.now();
    const jobConfig = {
      _id: jobId,
      orgId: 33,
      script: 'console.log(process.env.MYSQL_HOST, process.env.MYSQL_PASSWORD);',
      timeoutMs: 5000,
      connections: { mysql: 'some-profile' },
    };

    const result = await runner.runNodeScriptJob(jobConfig);
    tmpRoot = runner.getJobDir(jobId);

    expect(result.status).toBe('SUCCESS');
    expect(result.scriptLogs.some((l) => l.message.includes('1.2.3.4 p'))).toBe(true);
  });
});
