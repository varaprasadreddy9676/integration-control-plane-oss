'use strict';
/**
 * Script Job Runner
 *
 * Runs a user-authored JavaScript script inside a sandboxed VM with managed
 * helpers. The script cannot require() arbitrary modules, read files, or run
 * shell commands. All I/O goes through the injected helpers.
 *
 * Helpers available inside a Script Job:
 *   mysql        — query the configured MySQL connection profile
 *   email        — send email via the gateway's own email endpoint
 *   http         — make outbound HTTP calls
 *   report       — build HTML email bodies (htmlTable, statusBadge, …)
 *   date         — date helpers (today, yesterday, daysAgo, …)
 *   log          — log.info / log.warn / log.error (captured in execution trace)
 *   secret(key)  — retrieve a gateway secret by key
 *   skip(reason) — stop execution cleanly, mark job as SKIPPED
 *   fail(reason) — stop execution, mark job as FAILED
 */

const mysql2 = require('mysql2/promise');
const axios = require('axios');
const { VM } = require('../utils/secure-vm');
const { resolveProfile } = require('./connection-profiles');
const { getSecret } = require('./gateway-secrets');
const { log } = require('../logger');

// ── Sentinel errors for skip / fail signals ─────────────────────────────────
class ScriptSignal extends Error {
  constructor(type, reason) {
    super(reason || type);
    this.signalType = type;
  }
}

function assertReadOnlySqlQuery(query) {
  const normalized = String(query || '')
    .replace(/^\s*--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim()
    .toUpperCase();

  if (!normalized.startsWith('SELECT') && !normalized.startsWith('WITH')) {
    throw new Error('Script Job MySQL helper only allows read-only SELECT/WITH queries');
  }

  const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|REPLACE|GRANT|REVOKE|CALL|LOAD|LOCK|UNLOCK)\b/i;
  if (forbidden.test(normalized)) {
    throw new Error('Script Job MySQL helper blocked a non-read-only SQL statement');
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Date helpers ─────────────────────────────────────────────────────────────
function makeDateHelpers() {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  return {
    today: () => fmt(new Date()),
    yesterday: () => { const d = new Date(); d.setDate(d.getDate() - 1); return fmt(d); },
    daysAgo: (n) => { const d = new Date(); d.setDate(d.getDate() - n); return fmt(d); },
    format: fmt,
  };
}

// ── Report helpers ───────────────────────────────────────────────────────────
function makeReportHelpers() {
  return {
    htmlTable({ title = 'Report', date: reportDate, rows = [], emptyMessage = 'No data' } = {}) {
      const allOk = rows.every((r) => r.ok !== false);
      const failCount = rows.filter((r) => r.ok === false).length;

      const statusBadge = allOk
        ? `<span style="background:#16a34a;color:#fff;padding:4px 14px;border-radius:4px;font-size:13px;font-weight:600;">ALL OK</span>`
        : `<span style="background:#dc2626;color:#fff;padding:4px 14px;border-radius:4px;font-size:13px;font-weight:600;">${failCount} ISSUE${failCount !== 1 ? 'S' : ''}</span>`;

      const tableRows = rows.map((r) => {
        const countDisplay =
          r.count !== null && r.count !== undefined
            ? Number(r.count).toLocaleString()
            : r.error
              ? `<em style="color:#9ca3af">Query Error</em>`
              : '—';
        const statusCell =
          r.ok !== false
            ? `<span style="color:#16a34a;font-weight:600;">&#10003; OK</span>`
            : `<span style="color:#dc2626;font-weight:600;">&#10007; ${r.error ? 'Error' : 'No Data'}</span>`;
        const rowBg = r.ok !== false ? '#ffffff' : '#fff7f7';
        return `
          <tr style="background:${rowBg};border-bottom:1px solid #e5e7eb;">
            <td style="padding:11px 16px;font-size:14px;color:#111827;">${escapeHtml(r.name || r.label || '')}</td>
            <td style="padding:11px 16px;font-size:14px;text-align:right;font-weight:500;">${countDisplay}</td>
            <td style="padding:11px 16px;font-size:14px;text-align:center;">${statusCell}</td>
            ${r.error ? `<td style="padding:11px 16px;font-size:12px;color:#dc2626;">${escapeHtml(r.error)}</td>` : ''}
          </tr>`;
      }).join('');

      return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:680px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.1);">
    <div style="background:#1e3a5f;padding:24px 32px;">
      <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">${escapeHtml(title)}</h1>
      ${reportDate ? `<p style="margin:6px 0 0;color:#bfdbfe;font-size:13px;">${escapeHtml(reportDate)}</p>` : ''}
    </div>
    <div style="padding:18px 32px;background:${allOk ? '#f0fdf4' : '#fff7f7'};border-bottom:1px solid ${allOk ? '#bbf7d0' : '#fecaca'};">
      <p style="margin:0;font-size:15px;color:#374151;">Overall Status &nbsp;${statusBadge}</p>
      <p style="margin:8px 0 0;font-size:13px;color:${allOk ? '#15803d' : '#dc2626'};">
        ${allOk ? 'All checks passed.' : 'One or more checks failed — please review.'}
      </p>
    </div>
    <div style="padding:24px 32px 32px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
            <th style="padding:10px 16px;text-align:left;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Check</th>
            <th style="padding:10px 16px;text-align:right;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Count</th>
            <th style="padding:10px 16px;text-align:center;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:0.5px;">Status</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows || `<tr><td colspan="3" style="padding:16px;text-align:center;color:#9ca3af;">${escapeHtml(emptyMessage)}</td></tr>`}
        </tbody>
      </table>
    </div>
    <div style="padding:14px 32px;background:#f9fafb;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:11px;color:#9ca3af;">
        Auto-generated · ${new Date().toLocaleDateString('en-IN')} · Integration Gateway
      </p>
    </div>
  </div>
</body></html>`;
    },

    statusBadge(ok, label) {
      return ok
        ? `<span style="background:#16a34a;color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;">${label || 'OK'}</span>`
        : `<span style="background:#dc2626;color:#fff;padding:3px 10px;border-radius:4px;font-size:12px;">${label || 'FAILED'}</span>`;
    },
  };
}

// ── MySQL helper ─────────────────────────────────────────────────────────────
function makeMysqlHelper(profile) {
  const opts = {
    host: profile.config.host || profile.config.hostname,
    port: profile.config.port ? Number(profile.config.port) : 3306,
    user: profile.config.user || profile.config.username,
    password: profile.config.password,
    database: profile.config.database,
    connectTimeout: 10000,
  };

  async function withConn(fn) {
    let conn;
    try {
      conn = await mysql2.createConnection(opts);
      return await fn(conn);
    } finally {
      if (conn) await conn.end().catch(() => {});
    }
  }

  return {
    async query(queryStr, params = []) {
      assertReadOnlySqlQuery(queryStr);
      return withConn(async (conn) => {
        const [rows] = await conn.execute(queryStr, params);
        return rows;
      });
    },

    async queryMany(queries = [], { continueOnError = true } = {}) {
      const results = [];
      if (queries.length > 50) {
        throw new Error('mysql.queryMany supports at most 50 queries per Script Job run');
      }
      for (const q of queries) {
        try {
          assertReadOnlySqlQuery(q.query);
          const rows = await withConn(async (conn) => {
            const [r] = await conn.execute(q.query, q.params || []);
            return r;
          });
          // Normalise count: prefer a column named count or cnt, fallback to row count
          const first = rows[0] || {};
          const rawCount = first.count ?? first.cnt ?? first.COUNT ?? rows.length;
          const count = Number(rawCount);
          results.push({
            name: q.name,
            table: q.table,
            rows,
            count,
            ok: count > 0 || q.ignoreZero === true,
            error: null,
          });
        } catch (err) {
          if (!continueOnError) throw err;
          results.push({ name: q.name, table: q.table, rows: null, count: null, ok: false, error: err.message });
        }
      }
      return results;
    },
  };
}

// Placeholder injected when no mysql connection profile is configured for the job
function makeMysqlPlaceholder() {
  const err = () => { throw new Error('No MySQL connection configured. Add a mysql connection profile to this Script Job.'); };
  return { query: err, queryMany: err };
}

// ── Email helper ─────────────────────────────────────────────────────────────
function makeEmailHelper(orgId) {
  const port = process.env.PORT || 3545;
  const base = process.env.GATEWAY_INTERNAL_URL || `http://localhost:${port}`;

  return {
    async send({ from, to, subject, html, text }) {
      const toArr = Array.isArray(to) ? to : [to];
      const res = await axios.post(
        `${base}/api/v1/public/integrations/email?orgId=${orgId}`,
        { from, to: toArr, subject, html, text },
        { timeout: 15000 }
      );
      return res.data;
    },
  };
}

// ── HTTP helper ───────────────────────────────────────────────────────────────
function makeHttpHelper() {
  const call = (method) => async (url, bodyOrOptions, options = {}) => {
    const hasBody = ['post', 'put', 'patch'].includes(method);
    const body = hasBody ? bodyOrOptions : undefined;
    const opts = hasBody ? options : (bodyOrOptions || {});
    const res = await axios({ method, url, data: body, headers: opts.headers || {}, timeout: opts.timeout || 15000 });
    return res.data;
  };
  return { get: call('get'), post: call('post'), put: call('put'), patch: call('patch'), delete: call('delete') };
}

async function resolveEnvironmentVariables(jobConfig, orgId) {
  const env = {};
  const rows = Array.isArray(jobConfig.environmentVariables) ? jobConfig.environmentVariables : [];

  for (const row of rows) {
    const key = String(row?.key || '').trim();
    if (!key) continue;

    if (Object.hasOwn(row, 'value') && row.value !== undefined && row.value !== null) {
      env[key] = String(row.value);
      continue;
    }

    if (!row.secretKey) continue;
    const value = await getSecret(row.secretKey, orgId);
    if (value === null) {
      throw new Error(`Environment variable secret not found: ${key}`);
    }
    env[key] = value;
  }

  return Object.freeze(env);
}

// ── Main runner ───────────────────────────────────────────────────────────────
async function runScriptJob(jobConfig) {
  const scriptLogs = [];
  const orgId = jobConfig.orgId;
  const env = await resolveEnvironmentVariables(jobConfig, orgId);

  // Resolve every connection profile referenced in job.connections
  const connections = jobConfig.connections || {};
  const resolved = {};
  for (const [alias, profileId] of Object.entries(connections)) {
    if (!profileId) continue;
    try {
      resolved[alias] = await resolveProfile(profileId, orgId);
    } catch (err) {
      log('warn', `Script Job: failed to resolve connection profile '${profileId}' (alias: ${alias})`, { error: err.message });
    }
  }

  // Build mysql helper from whichever alias is the primary DB
  const mysqlProfile = resolved.mysql || resolved.db || resolved.database;
  const mysqlHelper = mysqlProfile ? makeMysqlHelper(mysqlProfile) : makeMysqlPlaceholder();

  // Named connections map — scripts can do connections.novaDb.query(...)
  const namedConnections = Object.fromEntries(
    Object.entries(resolved).map(([alias, profile]) => {
      const type = String(profile.type || '').toUpperCase();
      if (type === 'MYSQL') return [alias, makeMysqlHelper(profile)];
      return [alias, profile]; // passthrough for other types
    })
  );

  const captureLog = (level) => (...args) => {
    const msg = args.map((a) => (a !== null && typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
    scriptLogs.push({ level, message: msg, ts: new Date().toISOString() });
    log(level, `[ScriptJob:${jobConfig._id}] ${msg}`);
  };

  const sandbox = {
    mysql: mysqlHelper,
    email: makeEmailHelper(orgId),
    http: makeHttpHelper(),
    report: makeReportHelpers(),
    date: makeDateHelpers(),
    env,
    log: { info: captureLog('info'), warn: captureLog('warn'), error: captureLog('error') },
    secret: async (key) => {
      const v = await getSecret(key, orgId);
      if (v === null) throw new Error(`Secret not found: ${key}`);
      return v;
    },
    skip: (reason) => { throw new ScriptSignal('SKIP', reason); },
    fail: (reason) => { throw new ScriptSignal('FAIL', reason); },
    connections: namedConnections,
  };

  const vm = new VM({ timeout: 120000, sandbox, allowAsync: true });

  const wrappedScript = `return (async function scriptJob() {\n${jobConfig.script}\n})();`;

  try {
    const result = await vm.run(wrappedScript);
    return { status: 'SUCCESS', scriptLogs, result: result ?? null };
  } catch (err) {
    if (err instanceof ScriptSignal && err.signalType === 'SKIP') {
      return { status: 'SKIPPED', reason: err.message, scriptLogs };
    }
    if (err instanceof ScriptSignal && err.signalType === 'FAIL') {
      return { status: 'FAILED', reason: err.message, scriptLogs, error: err.message };
    }
    return { status: 'FAILED', error: err.message, scriptLogs };
  }
}

module.exports = { runScriptJob };
