#!/usr/bin/env node
// Credential leak audit: plants a uniquely tagged secret in every credential
// slot, generates logs, then calls every GET route of the API and reports each
// response field that still contains a planted secret.
//
// Run against a disposable install only: it creates integrations, jobs,
// templates and alert channels in the target org. See README.md.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API = (process.env.API_URL || 'http://localhost:3545/api/v1').replace(/\/$/, '');
const EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD || 'ChangeMe123!';
const ORG_ID = process.env.ORG_ID || '1';
// Targets must not echo requests back, or every echoed header looks like a leak.
const TARGET = (process.env.TARGET_BASE || 'https://httpbin.org').replace(/\/$/, '');
const BACKEND_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend/src');

// Names carry TAG so the run's records are easy to find; only SECRET_TAG is searched for.
const TAG = `AUDIT${Date.now().toString(36).toUpperCase()}`;
const SECRET_TAG = `LEAKED${TAG}`;
const secret = (name) => `${SECRET_TAG}_${name}`;
// Routes that exist to show stored credentials to a super admin (audited).
const INTENTIONAL_REVEALS = [/\/credentials$/, /\/reveal$/];
const SKIP = [/\/stream/, /\/sse/, /\/download$/];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function login() {
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status}). Set ADMIN_EMAIL / ADMIN_PASSWORD.`);
  return { Authorization: `Bearer ${(await res.json()).accessToken}` };
}

function withOrg(url) {
  return `${API}${url}${url.includes('?') ? '&' : '?'}orgId=${ORG_ID}`;
}

async function call(auth, method, url, body, extraHeaders = {}) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await fetch(withOrg(url), {
      method,
      headers: { ...auth, 'Content-Type': 'application/json', ...extraHeaders },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    }).catch((error) => ({ status: 0, headers: new Headers(), text: async () => String(error) }));
    if (res.status === 429) {
      await sleep(1000 * Number(res.headers.get('retry-after') || 5));
      continue;
    }
    const text = await res.text();
    let parsed = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // CSV and other text responses are searched as plain text
    }
    return { status: res.status, body: parsed };
  }
  return { status: 429, body: null };
}

async function plant(auth) {
  const created = async (url, body) => {
    const res = await call(auth, 'POST', url, body);
    if (res.status >= 300) console.warn(`  could not create via ${url}: ${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    return res.body || {};
  };
  const outbound = (name, extra) =>
    created('/outbound-integrations', {
      name: `${TAG} ${name}`,
      eventType: `${TAG}_EVENT`,
      scope: 'ENTITY_ONLY',
      httpMethod: 'POST',
      timeoutMs: 10000,
      retryCount: 0,
      isActive: true,
      targetUrl: `${TARGET}/status/200`,
      outgoingAuthType: 'NONE',
      outgoingAuthConfig: {},
      ...extra,
    });

  await outbound('bearer', {
    outgoingAuthType: 'BEARER',
    outgoingAuthConfig: { token: secret('OB_BEARER') },
    targetUrl: `${TARGET}/status/200?api_key=${secret('OB_URLKEY')}`,
    customHeaders: { Authorization: secret('OB_CUSTOMHDR'), 'X-Trace': 'plain' },
  });
  await outbound('api key', { outgoingAuthType: 'API_KEY', outgoingAuthConfig: { headerName: 'X-Key', apiKey: secret('OB_APIKEY') } });
  await outbound('basic', { outgoingAuthType: 'BASIC', outgoingAuthConfig: { username: 'audit', password: secret('OB_BASIC') } });
  await outbound('oauth2', {
    outgoingAuthType: 'OAUTH2',
    outgoingAuthConfig: { tokenEndpoint: `${TARGET}/status/401`, clientId: 'audit', clientSecret: secret('OB_CLIENTSECRET') },
  });
  await outbound('custom headers', {
    outgoingAuthType: 'CUSTOM_HEADERS',
    outgoingAuthConfig: { headers: { 'X-Partner-Token': secret('OB_AUTHHDR') } },
  });
  await outbound('slack url, failing', { targetUrl: `https://hooks.slack.com/services/T0/B0/${secret('SLACKPATH')}` });

  const type = TAG.toLowerCase();
  await created('/inbound-integrations', {
    name: `${TAG} inbound key`,
    type: `${type}-key`,
    targetUrl: `${TARGET}/status/200`,
    httpMethod: 'POST',
    inboundAuthType: 'API_KEY',
    inboundAuthConfig: { headerName: 'X-API-Key', apiKey: secret('IN_APIKEY') },
    outgoingAuthType: 'BEARER',
    outgoingAuthConfig: { token: secret('IN_OUTBEARER') },
    isActive: true,
  });
  await created('/inbound-integrations', {
    name: `${TAG} inbound hmac`,
    type: `${type}-hmac`,
    targetUrl: `${TARGET}/status/200`,
    httpMethod: 'POST',
    inboundAuthType: 'HMAC',
    inboundAuthConfig: { secret: secret('IN_HMAC') },
    outgoingAuthType: 'BASIC',
    outgoingAuthConfig: { username: 'audit', password: secret('IN_OUTBASIC') },
    isActive: true,
  });

  const schedule = { type: 'CRON', expression: '0 3 * * *', timezone: 'UTC' };
  const jobs = [
    await created('/scheduled-jobs', {
      name: `${TAG} api job`,
      direction: 'SCHEDULED',
      isActive: false,
      schedule,
      dataSource: { type: 'API', url: `${TARGET}/json?token=${secret('SJ_SRCTOKEN')}`, method: 'GET', headers: { Authorization: secret('SJ_SRCHDR') } },
      targetUrl: `${TARGET}/status/200?api_key=${secret('SJ_URLKEY')}`,
      httpMethod: 'POST',
      outgoingAuthType: 'BEARER',
      outgoingAuthConfig: { token: secret('SJ_BEARER') },
      transformation: { mode: 'SCRIPT', script: 'return payload;' },
    }),
    await created('/scheduled-jobs', {
      name: `${TAG} sql job`,
      direction: 'SCHEDULED',
      isActive: false,
      schedule,
      dataSource: { type: 'SQL', connectionString: `mysql://reader:${secret('SJ_DBPASS')}@db.invalid:3306/x`, query: 'SELECT 1', password: secret('SJ_DSPASS') },
      targetUrl: `${TARGET}/status/200`,
      httpMethod: 'POST',
      outgoingAuthType: 'NONE',
    }),
    await created('/scheduled-jobs', {
      name: `${TAG} script job`,
      direction: 'SCRIPT_JOB',
      runtime: 'VM_SANDBOX',
      isActive: false,
      schedule,
      script: 'return 1;',
      environmentVariables: [{ key: 'PARTNER_TOKEN', value: secret('SJ_ENVVAR') }],
    }),
  ];

  await created('/alert-channels', { type: 'slack', name: `${TAG} slack`, enabled: false, config: { webhookUrl: `https://hooks.slack.com/services/T1/B1/${secret('AC_SLACK')}` } });
  await created('/alert-channels', { type: 'webhook', name: `${TAG} webhook`, enabled: false, config: { url: `${TARGET}/status/200`, bearerToken: secret('AC_BEARER'), signingSecret: secret('AC_SIGN') } });
  await created('/alert-channels', { type: 'whatsapp', name: `${TAG} whatsapp`, enabled: false, config: { phoneNumberId: '1', accessToken: secret('AC_WATOKEN'), recipients: '+15550001111' } });

  await created('/templates', {
    name: `${TAG} template`,
    category: 'Audit',
    eventType: `${TAG}_EVENT`,
    targetUrl: `${TARGET}/status/200?token=${secret('TPL_URLTOKEN')}`,
    httpMethod: 'POST',
    authType: 'BEARER',
    authConfig: { token: secret('TPL_TOKEN') },
    headers: { Authorization: secret('TPL_HDR') },
  });

  return { jobs: jobs.map((job) => job._id || job.id).filter(Boolean), type };
}

async function generateTraffic(auth, { jobs, type }) {
  for (let i = 0; i < 2; i++) await call(auth, 'POST', '/events/push', { eventType: `${TAG}_EVENT`, payload: { auditRun: TAG, n: i } });
  await call({}, 'POST', `/public/integrations/${type}-key`, { auditRun: TAG }, { 'X-API-Key': secret('IN_APIKEY') });
  await call({}, 'POST', `/public/integrations/${type}-key`, { auditRun: TAG }, { 'X-API-Key': 'wrong' });
  await call({}, 'POST', `/public/integrations/${type}-hmac`, { auditRun: TAG });
  for (const id of jobs) await call(auth, 'POST', `/scheduled-jobs/${id}/execute`, {});
}

/** GET routes from the app's mounts in backend/src/index.js and each router file. */
function readGetRoutes() {
  const index = fs.readFileSync(path.join(BACKEND_SRC, 'index.js'), 'utf8');
  const requires = Object.fromEntries([...index.matchAll(/const (\w+) = require\('(\.\/routes\/[^']+)'\)/g)].map((m) => [m[1], m[2]]));
  const mounts = [...index.matchAll(/app\.use\(`\$\{config\.api\.basePrefix\}([^`]*)`,([^)]*?)(\w+)\)/g)].map((m) => ({ prefix: m[1], router: m[3] }));
  const routes = new Set();
  for (const { prefix, router } of mounts) {
    const file = requires[router];
    if (!file) continue;
    const code = fs.readFileSync(path.join(BACKEND_SRC, file.endsWith('.js') ? file : `${file}.js`), 'utf8');
    for (const m of code.matchAll(/router\.get\(\s*['"`]([^'"`]+)['"`]/g)) {
      routes.add(`${prefix}${m[1] === '/' ? '' : m[1]}`.replace(/\([^)]*\)/g, ''));
    }
  }
  return [...routes].filter((route) => ![...INTENTIONAL_REVEALS, ...SKIP].some((pattern) => pattern.test(route)));
}

async function crawl(auth, routes) {
  const ID_KEYS = /^(id|_id|traceId|dlqId|eventId|jobId)$/;
  const idsBySection = {};
  const section = (route) => route.split('/')[1];
  const findings = new Map();
  let requests = 0;

  const scan = (value, where, url, jsonPath) => {
    if (typeof value === 'string') {
      if (ID_KEYS.test(jsonPath.split('.').pop()) && value.length < 120) (idsBySection[section(url)] ||= new Set()).add(encodeURIComponent(value));
      if (value.includes(SECRET_TAG)) {
        const at = value.indexOf(SECRET_TAG);
        const key = `${where}  ${jsonPath.replace(/\[\d+\]/g, '[]')}`;
        if (!findings.has(key)) findings.set(key, value.slice(Math.max(0, at - 40), at + SECRET_TAG.length + 20));
      }
      if (/^\$2[aby]\$\d\d\$/.test(value)) findings.set(`${where}  ${jsonPath}`, '<password hash>');
    } else if (Array.isArray(value)) value.forEach((item, i) => scan(item, where, url, `${jsonPath}[${i}]`));
    else if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) scan(child, where, url, `${jsonPath}.${key}`);
  };
  const get = async (url) => {
    requests++;
    const { body } = await call(auth, 'GET', url);
    scan(body, url.replace(/\/[^/]*\d[^/]*(?=\/|$)/g, (part) => (part.length > 12 ? '/:id' : part)), url, '$');
  };

  for (const route of routes.filter((r) => !r.includes(':'))) await get(route);

  const RELATED = {
    'integration-history': ['outbound-integrations', 'inbound-integrations', 'scheduled-jobs'],
    versions: ['outbound-integrations', 'inbound-integrations', 'scheduled-jobs'],
    integrations: ['outbound-integrations', 'inbound-integrations', 'scheduled-jobs'],
    ops: ['outbound-integrations', 'inbound-integrations', 'scheduled-jobs'],
    'execution-logs': ['logs', 'execution-logs'],
  };
  for (const route of routes.filter((r) => r.includes(':'))) {
    const ids = [...new Set((RELATED[section(route)] || [section(route)]).flatMap((name) => [...(idsBySection[name] || [])]))].slice(0, 40);
    const values = (param) => (/revision/i.test(param) ? ['1', '2'] : /^key$/.test(param) ? ['PARTNER_TOKEN'] : ids);
    let urls = [route];
    for (const [, param] of route.matchAll(/:(\w+)/g)) urls = urls.flatMap((url) => values(param).map((value) => url.replace(`:${param}`, value)));
    for (const url of urls.slice(0, 200)) await get(url);
  }
  return { findings, requests };
}

const auth = await login();
console.log(`Planting secrets tagged ${TAG} in org ${ORG_ID}…`);
const planted = await plant(auth);
console.log('Generating deliveries, inbound calls and job runs…');
await generateTraffic(auth, planted);
await sleep(Number(process.env.SETTLE_MS || 20000));
const routes = readGetRoutes();
console.log(`Calling ${routes.length} GET routes…`);
const { findings, requests } = await crawl(auth, routes);
console.log(`${requests} requests made.\n`);
if (findings.size === 0) {
  console.log('No planted secret appeared in any response.');
} else {
  console.log(`${findings.size} response field(s) contain a planted secret:\n`);
  for (const [where, sample] of findings) console.log(`${where}\n    …${sample}…`);
  process.exitCode = 1;
}
