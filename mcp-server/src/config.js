import fs from 'node:fs';

const ALLOWED_ENVIRONMENTS = new Set(['local', 'development', 'test', 'staging', 'validation', 'production']);

function readJsonConfig(path) {
  if (!path) return {};
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read MCP config file ${path}: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`MCP config file ${path} must contain a JSON object`);
  }
  return parsed;
}

function positiveInteger(value, name, { min, max }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function resolveConfigPath(argv = process.argv.slice(2), env = process.env) {
  const index = argv.indexOf('--config');
  if (index >= 0) {
    if (!argv[index + 1]) throw new Error('--config requires a JSON file path');
    return argv[index + 1];
  }
  return env.ICP_CONFIG_FILE || null;
}

export function loadConfig({ env = process.env, argv = process.argv.slice(2), requireAuth = true } = {}) {
  const fileConfig = readJsonConfig(resolveConfigPath(argv, env));
  const get = (key, fallback) => env[key] ?? fileConfig[key] ?? fallback;
  const environment = String(get('ICP_ENV', 'unknown')).trim().toLowerCase();
  const baseUrl = String(get('ICP_API_BASE_URL', 'http://localhost:3001/api/v1')).trim();
  const apiKey = get('ICP_API_KEY');
  const authToken = get('ICP_AUTH_TOKEN');
  const allowAnonymous = String(get('ICP_ALLOW_ANONYMOUS', 'false')).toLowerCase() === 'true';

  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    throw new Error(
      `ICP_ENV must be one of ${Array.from(ALLOWED_ENVIRONMENTS).join(', ')}; received ${environment || '(empty)'}`
    );
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(baseUrl);
  } catch {
    throw new Error('ICP_API_BASE_URL must be an absolute http(s) URL');
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('ICP_API_BASE_URL must use http or https');
  }
  if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
    throw new Error('ICP_API_BASE_URL must not contain credentials, query parameters, or a fragment');
  }

  if (apiKey && authToken) {
    throw new Error('Set only one of ICP_API_KEY or ICP_AUTH_TOKEN, not both');
  }
  if (requireAuth && !allowAnonymous && !apiKey && !authToken) {
    throw new Error('Set ICP_API_KEY or ICP_AUTH_TOKEN; use ICP_ALLOW_ANONYMOUS=true only for local development');
  }
  if (environment === 'production' && allowAnonymous) {
    throw new Error('ICP_ALLOW_ANONYMOUS=true is only allowed for local development');
  }
  if (environment === 'production' && !apiKey && !authToken) {
    throw new Error('Production MCP connections cannot run without authentication');
  }

  const timeoutMs = positiveInteger(get('ICP_REQUEST_TIMEOUT_MS', 30_000), 'ICP_REQUEST_TIMEOUT_MS', {
    min: 1_000,
    max: 120_000,
  });
  const maxRetries = positiveInteger(get('ICP_MAX_RETRIES', 2), 'ICP_MAX_RETRIES', { min: 0, max: 5 });

  return {
    env: environment,
    baseUrl,
    apiKey: apiKey ? String(apiKey) : undefined,
    authToken: authToken ? String(authToken) : undefined,
    clientName: String(get('ICP_MCP_CLIENT_NAME', 'integration-control-plane-mcp')),
    timeoutMs,
    maxRetries,
    configFile: resolveConfigPath(argv, env),
  };
}

export function isCheckCommand(argv = process.argv.slice(2)) {
  return argv.includes('--check');
}
