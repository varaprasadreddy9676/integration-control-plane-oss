import test from 'node:test';
import assert from 'node:assert/strict';
import { isCheckCommand, loadConfig } from '../src/config.js';

const baseEnv = {
  ICP_ENV: 'validation',
  ICP_API_BASE_URL: 'https://validation.example.com/integration-gateway-server/api/v1',
  ICP_API_KEY: 'test-key',
};

test('loads a validated environment configuration', () => {
  const config = loadConfig({ env: baseEnv, argv: [] });
  assert.equal(config.env, 'validation');
  assert.equal(config.baseUrl, baseEnv.ICP_API_BASE_URL);
  assert.equal(config.apiKey, 'test-key');
  assert.equal(config.timeoutMs, 30_000);
  assert.equal(config.maxRetries, 2);
});

test('rejects ambiguous or unsafe authentication configuration', () => {
  assert.throws(
    () => loadConfig({ env: { ...baseEnv, ICP_AUTH_TOKEN: 'jwt' }, argv: [] }),
    /only one of ICP_API_KEY or ICP_AUTH_TOKEN/
  );
  assert.throws(
    () => loadConfig({ env: { ...baseEnv, ICP_API_KEY: undefined, ICP_API_BASE_URL: 'https://user:pass@example.com/api/v1' }, argv: [] }),
    /must not contain credentials/
  );
  assert.throws(
    () => loadConfig({ env: { ...baseEnv, ICP_API_KEY: undefined }, argv: [] }),
    /Set ICP_API_KEY or ICP_AUTH_TOKEN/
  );
});

test('allows anonymous local development only when explicitly enabled', () => {
  const config = loadConfig({
    env: {
      ICP_ENV: 'local',
      ICP_API_BASE_URL: 'http://localhost:3001/api/v1',
      ICP_ALLOW_ANONYMOUS: 'true',
    },
    argv: [],
  });
  assert.equal(config.apiKey, undefined);
  assert.throws(
    () => loadConfig({
      env: {
        ICP_ENV: 'production',
        ICP_API_BASE_URL: 'https://production.example.com/api/v1',
        ICP_ALLOW_ANONYMOUS: 'true',
      },
      argv: [],
    }),
    /only allowed for local development/
  );
});

test('validates timeout and retry bounds and recognizes doctor mode', () => {
  assert.throws(
    () => loadConfig({ env: { ...baseEnv, ICP_REQUEST_TIMEOUT_MS: '100' }, argv: [] }),
    /ICP_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000/
  );
  assert.throws(
    () => loadConfig({ env: { ...baseEnv, ICP_MAX_RETRIES: '6' }, argv: [] }),
    /ICP_MAX_RETRIES must be an integer between 0 and 5/
  );
  assert.equal(isCheckCommand(['--config', 'config.json', '--check']), true);
});
