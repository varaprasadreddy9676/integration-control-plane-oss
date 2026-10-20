/**
 * Event Source Tester Service
 *
 * Validates event source configurations before saving them.
 * Tests live connections, checks that the configured table exists,
 * validates that every columnMapping column actually exists in that table,
 * and returns a sample normalized event so admins can confirm the mapping
 * is correct — all without persisting anything.
 *
 * Also provides column discovery (DESCRIBE table) for orgs with a saved config.
 *
 * Used by:
 *   POST /api/v1/event-sources/test         — test a config before saving
 *   GET  /api/v1/event-sources/:orgId/columns — discover columns for saved config
 */

'use strict';

const db = require('../db');
const { withTimeout } = require('../utils/timeout');
const { log } = require('../logger');
const { sanitizeMysqlSourceConfig } = require('../utils/mysql-safety');

const TEST_TIMEOUT_MS = 10_000; // hard cap on all external I/O during a test

// ---------------------------------------------------------------------------
// SQL injection prevention
// ---------------------------------------------------------------------------

/**
 * Validate and backtick-quote a MySQL identifier (table or column name).
 * Accepts only unquoted identifiers matching [a-zA-Z_][a-zA-Z0-9_$]*.
 * This prevents SQLi in the dynamic DESCRIBE / SELECT queries below.
 *
 * @param {string} name    - The identifier to validate
 * @param {string} context - Human-readable label used in error messages
 * @returns {string} Backtick-quoted identifier, e.g. `my_table`
 * @throws {Error} If the name contains unsafe characters
 */
function quoteIdentifier(name, context = 'identifier') {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error(`${context} must be a non-empty string`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_$]*$/.test(name)) {
    throw new Error(
      `${context} "${name}" contains invalid characters. ` + 'Only letters, digits, underscores, and $ are allowed.'
    );
  }
  return `\`${name}\``;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Test an event source configuration end-to-end.
 * Never persists anything. Always cleans up the connection.
 *
 * @param {string} type         - 'mysql' | 'kafka' | 'http_push' | 'hl7_mllp'
 * @param {Object} sourceConfig - The config block to test
 * @returns {Promise<Object>}   - { success, message, ... } — see per-type docs
 */
async function testConnection(type, sourceConfig) {
  log('info', 'Testing event source connection', { type });
  switch (type) {
    case 'mysql':
      return _testMysql(sourceConfig);
    case 'kafka':
      return _testKafka(sourceConfig);
    case 'http_push':
      return _testHttpPush(sourceConfig);
    case 'hl7_mllp':
      return _testHl7Mllp(sourceConfig);
    default:
      return {
        success: false,
        code: 'UNKNOWN_TYPE',
        error: `Unknown source type: "${type}"`,
        hint: 'Use mysql, kafka, http_push, or hl7_mllp',
      };
  }
}

/**
 * Discover the columns of the table in a source config.
 * Runs DESCRIBE on the configured table and returns column metadata.
 * Used by GET /:orgId/columns after loading the org's saved config.
 *
 * @param {Object} sourceConfig - Must contain `table`; connection creds or useSharedPool
 * @returns {Promise<Object>}   - { success, table, columns: [{name, type, nullable, key}] }
 */
async function describeTable(sourceConfig) {
  return _describeTable(sourceConfig);
}

// ---------------------------------------------------------------------------
// MySQL tester
// ---------------------------------------------------------------------------

/**
 * Test a MySQL event source configuration.
 *
 * Steps:
 *   1. Validate identifiers (table, column names) for SQLi safety
 *   2. Obtain a pool (shared if useSharedPool, dedicated otherwise)
 *   3. Ping the server (SELECT 1)
 *   4. DESCRIBE the table — verify it exists and get schema
 *   5. Validate every columnMapping column against the actual table schema
 *   6. Fetch one sample row and normalize it via the mapping (best-effort)
 *
 * Returns { success: false } for any step failure — never throws 5xx from test.
 *
 * @param {Object} cfg
 * @param {string}  cfg.table
 * @param {Object}  [cfg.columnMapping]
 * @param {boolean} [cfg.useSharedPool]
 * @param {string}  [cfg.host]
 * @param {number}  [cfg.port]
 * @param {string}  [cfg.user]
 * @param {string}  [cfg.password]
 * @param {string}  [cfg.database]
 */
async function _testMysql(cfg) {
  const safeConfig = sanitizeMysqlSourceConfig(cfg || {});
  const { columnMapping, table, useSharedPool } = safeConfig;

  // --- 1. Identifier validation (no DB needed) ---
  try {
    quoteIdentifier(table || '', 'table');
  } catch (e) {
    return {
      success: false,
      code: 'INVALID_TABLE',
      error: e.message,
      hint: 'Provide a valid table name using only letters, digits, and underscores',
    };
  }

  if (columnMapping) {
    for (const [field, colName] of Object.entries(columnMapping)) {
      try {
        quoteIdentifier(colName, `columnMapping.${field}`);
      } catch (e) {
        return {
          success: false,
          code: 'INVALID_COLUMN',
          error: e.message,
          hint: 'Column names must use only letters, digits, underscores, and $',
        };
      }
    }
  }

  // --- 2. Obtain pool ---
  let pool = null;
  let ownPool = false;

  try {
    if (useSharedPool !== false && db.isConfigured()) {
      pool = db.getPool();
    } else {
      if (!safeConfig.host || !safeConfig.user || !safeConfig.database) {
        return {
          success: false,
          code: 'MISSING_CREDENTIALS',
          error: 'host, user, and database are required when useSharedPool is false',
          hint: 'Provide MySQL connection credentials or set useSharedPool: true',
        };
      }
      const mysql = require('mysql2/promise');
      pool = mysql.createPool({
        host: safeConfig.host,
        port: safeConfig.port || 3306,
        user: safeConfig.user,
        password: safeConfig.password || '',
        database: safeConfig.database,
        connectionLimit: 2,
        queueLimit: 10,
        waitForConnections: true,
        namedPlaceholders: true,
        connectTimeout: TEST_TIMEOUT_MS,
      });
      ownPool = true;
    }

    // --- 3. Ping ---
    await withTimeout(pool.execute('SELECT 1'), TEST_TIMEOUT_MS, 'MySQL ping');

    // --- 4. DESCRIBE table ---
    const quotedTable = quoteIdentifier(table, 'table');
    const [describeRows] = await withTimeout(
      pool.execute(`DESCRIBE ${quotedTable}`),
      TEST_TIMEOUT_MS,
      'DESCRIBE table'
    );

    const tableColumns = describeRows.map((r) => r.Field);
    const columnMeta = describeRows.map((r) => ({
      name: r.Field,
      type: r.Type,
      nullable: r.Null === 'YES',
      key: r.Key || null,
      default: r.Default ?? null,
    }));
    const columnTypes = Object.fromEntries(describeRows.map((r) => [r.Field, r.Type]));

    // --- 5. Validate columnMapping fields against table schema ---
    const validatedMapping = {};
    const missingColumns = [];

    if (columnMapping) {
      for (const [field, colName] of Object.entries(columnMapping)) {
        const found = tableColumns.includes(colName);
        validatedMapping[field] = { column: colName, found, type: found ? columnTypes[colName] : null };
        if (!found) missingColumns.push(`${field} → "${colName}"`);
      }
    }

    if (missingColumns.length > 0) {
      return {
        success: false,
        code: 'COLUMN_NOT_FOUND',
        error: `Column mapping mismatch: ${missingColumns.join(', ')}`,
        hint: 'The listed columns were not found in the table. Check your columnMapping.',
        tableColumns,
        columnMeta,
        columnTypes,
        validatedMapping,
      };
    }

    // --- 6. Sample row (best-effort) ---
    let sampleEvent = null;
    try {
      const [sampleRows] = await withTimeout(
        pool.execute(`SELECT * FROM ${quotedTable} LIMIT 1`),
        TEST_TIMEOUT_MS,
        'sample row fetch'
      );
      if (sampleRows.length > 0 && columnMapping) {
        const row = sampleRows[0];
        sampleEvent = {};
        for (const [field, colName] of Object.entries(columnMapping)) {
          sampleEvent[field] = row[colName] ?? null;
        }
      }
    } catch (_) {
      // best-effort — don't fail the entire test for a sample row
    }

    return {
      success: true,
      message: `Connected to MySQL and verified table "${table}" (${tableColumns.length} columns)`,
      tableColumns,
      columnMeta,
      columnTypes,
      validatedMapping,
      sampleEvent,
    };
  } catch (err) {
    return _classifyMysqlError(err);
  } finally {
    if (ownPool && pool) {
      pool.end().catch((cleanupErr) => {
        log('debug', 'MySQL event source test cleanup failed', { error: cleanupErr.message });
      });
    }
  }
}

/** Classify a MySQL driver error into an actionable API response. */
function _classifyMysqlError(err) {
  const code = err.code || '';
  const message = err.message || String(err);

  if (code === 'ER_ACCESS_DENIED_ERROR') {
    return { success: false, code: 'AUTH_FAILED', error: message, hint: 'Check your MySQL username and password' };
  }
  if (code === 'ER_BAD_DB_ERROR') {
    return { success: false, code: 'DB_NOT_FOUND', error: message, hint: 'The specified database does not exist' };
  }
  if (code === 'ER_NO_SUCH_TABLE') {
    return {
      success: false,
      code: 'TABLE_NOT_FOUND',
      error: message,
      hint: 'The specified table does not exist. Check the table name.',
    };
  }
  if (code === 'ER_BAD_FIELD_ERROR') {
    return {
      success: false,
      code: 'COLUMN_NOT_FOUND',
      error: message,
      hint: 'A column in your mapping does not exist in the table',
    };
  }
  if (code === 'ECONNREFUSED' || code === 'ENOTFOUND') {
    return {
      success: false,
      code: 'HOST_UNREACHABLE',
      error: message,
      hint: 'Could not connect to MySQL host. Check host and port.',
    };
  }
  if (code === 'ETIMEDOUT' || message.includes('timed out')) {
    return {
      success: false,
      code: 'TIMEOUT',
      error: message,
      hint: 'Connection timed out. Verify the MySQL server is reachable.',
    };
  }
  return { success: false, code: 'UNKNOWN_ERROR', error: message, hint: 'Check server logs for more details' };
}

// ---------------------------------------------------------------------------
// Kafka tester
// ---------------------------------------------------------------------------

async function _testKafka(cfg) {
  const { brokers, topic, clientId } = cfg;

  if (!brokers || (Array.isArray(brokers) && brokers.length === 0)) {
    return {
      success: false,
      code: 'MISSING_BROKERS',
      error: 'brokers array is required',
      hint: 'Provide at least one broker as host:port',
    };
  }

  let admin = null;
  try {
    const { Kafka } = require('kafkajs');
    const kafka = new Kafka({
      clientId: clientId || 'event-gateway-tester',
      brokers: Array.isArray(brokers) ? brokers : [brokers],
      connectionTimeout: TEST_TIMEOUT_MS,
      requestTimeout: TEST_TIMEOUT_MS,
    });

    admin = kafka.admin();
    await withTimeout(admin.connect(), TEST_TIMEOUT_MS, 'Kafka connect');

    const topicList = await withTimeout(admin.listTopics(), TEST_TIMEOUT_MS, 'Kafka listTopics');
    const topicExists = topic ? topicList.includes(topic) : null;

    let topicMeta = null;
    if (topic && topicExists) {
      const meta = await withTimeout(
        admin.fetchTopicMetadata({ topics: [topic] }),
        TEST_TIMEOUT_MS,
        'Kafka fetchTopicMetadata'
      );
      const t = meta.topics[0];
      topicMeta = { name: t.name, partitions: t.partitions.length };
    }

    const message =
      topicExists === false
        ? `Connected to Kafka broker(s), but topic "${topic}" was not found`
        : topicMeta
          ? `Connected to Kafka — topic "${topic}" has ${topicMeta.partitions} partition(s)`
          : 'Connected to Kafka broker(s) successfully';

    return { success: true, message, topicExists, topicMeta, availableTopics: topicList };
  } catch (err) {
    return _classifyKafkaError(err);
  } finally {
    if (admin) {
      admin.disconnect().catch((cleanupErr) => {
        log('debug', 'Kafka event source test cleanup failed', { error: cleanupErr.message });
      });
    }
  }
}

function _classifyKafkaError(err) {
  const message = err.message || String(err);
  if (message.includes('ECONNREFUSED') || message.includes('ENOTFOUND')) {
    return {
      success: false,
      code: 'BROKER_UNREACHABLE',
      error: message,
      hint: 'Could not connect to Kafka broker. Check the address and port.',
    };
  }
  if (message.includes('timed out') || message.includes('ETIMEDOUT')) {
    return {
      success: false,
      code: 'TIMEOUT',
      error: message,
      hint: 'Connection to Kafka timed out. Verify the broker is reachable.',
    };
  }
  return { success: false, code: 'KAFKA_ERROR', error: message, hint: 'Check Kafka broker logs for details' };
}

// ---------------------------------------------------------------------------
// HTTP Push tester
// ---------------------------------------------------------------------------

function _testHttpPush(cfg) {
  const numericFields = ['pollIntervalMs', 'batchSize', 'maxAttempts', 'staleAfterMs'];
  const invalidField = numericFields.find(
    (field) => cfg[field] !== undefined && (!Number.isInteger(Number(cfg[field])) || Number(cfg[field]) <= 0)
  );
  if (invalidField) {
    return Promise.resolve({
      success: false,
      code: 'INVALID_CONFIG',
      error: `${invalidField} must be a positive integer`,
      hint: 'Use a positive whole number or leave the field empty to use the default',
    });
  }
  return Promise.resolve({
    success: true,
    message:
      'HTTP Push configuration is valid. Events are received at POST /api/v1/events/push — no outbound connection to verify.',
  });
}

// ---------------------------------------------------------------------------
// HL7 MLLP tester
// ---------------------------------------------------------------------------

function _testHl7Mllp(cfg = {}) {
  const issues = [];
  const port = Number(cfg.port);
  const host = String(cfg.host || '0.0.0.0').trim();
  const maxMessageBytes = cfg.maxMessageBytes === undefined ? undefined : Number(cfg.maxMessageBytes);
  const idleTimeoutMs = cfg.idleTimeoutMs === undefined ? undefined : Number(cfg.idleTimeoutMs);
  const duplicateWindowMs = cfg.duplicateWindowMs === undefined ? undefined : Number(cfg.duplicateWindowMs);
  const listenerLockTtlMs = cfg.listenerLockTtlMs === undefined ? undefined : Number(cfg.listenerLockTtlMs);
  const tlsConfig = cfg.tls || cfg.tlsConfig || {};
  const tlsEnabled = Boolean(tlsConfig.enabled);
  const listenerLockEnabled = Boolean(cfg.listenerLockEnabled || cfg.primaryOnly || cfg.useListenerLock);

  if (!host) {
    issues.push('host is required');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    issues.push('port must be between 1 and 65535');
  }
  if (maxMessageBytes !== undefined && (!Number.isInteger(maxMessageBytes) || maxMessageBytes < 1024 || maxMessageBytes > 10485760)) {
    issues.push('maxMessageBytes must be between 1024 and 10485760 when provided');
  }
  if (idleTimeoutMs !== undefined && (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs < 1000 || idleTimeoutMs > 300000)) {
    issues.push('idleTimeoutMs must be between 1000 and 300000 when provided');
  }
  if (
    duplicateWindowMs !== undefined &&
    (!Number.isInteger(duplicateWindowMs) || duplicateWindowMs < 1000 || duplicateWindowMs > 86400000)
  ) {
    issues.push('duplicateWindowMs must be between 1000 and 86400000 when provided');
  }
  if (
    listenerLockTtlMs !== undefined &&
    (!Number.isInteger(listenerLockTtlMs) || listenerLockTtlMs < 5000 || listenerLockTtlMs > 300000)
  ) {
    issues.push('listenerLockTtlMs must be between 5000 and 300000 when provided');
  }
  if (cfg.messageTypeMapping !== undefined && (typeof cfg.messageTypeMapping !== 'object' || Array.isArray(cfg.messageTypeMapping))) {
    issues.push('messageTypeMapping must be an object when provided');
  }
  if (cfg.allowedSourceIps !== undefined && !Array.isArray(cfg.allowedSourceIps)) {
    issues.push('allowedSourceIps must be an array when provided');
  }
  if (cfg.allowedSourceCidrs !== undefined && !Array.isArray(cfg.allowedSourceCidrs)) {
    issues.push('allowedSourceCidrs must be an array when provided');
  }
  if (tlsEnabled) {
    const hasInlineIdentity = Boolean(tlsConfig.key && tlsConfig.cert);
    const hasFileIdentity = Boolean(tlsConfig.keyPath && tlsConfig.certPath);
    if (!hasInlineIdentity && !hasFileIdentity) {
      issues.push('tls key/cert or keyPath/certPath are required when TLS is enabled');
    }
  }

  if (issues.length > 0) {
    return Promise.resolve({
      success: false,
      code: 'INVALID_CONFIG',
      error: issues.join('; '),
      hint: 'Fix the HL7 MLLP listener configuration',
    });
  }

  return Promise.resolve({
    success: true,
    message:
      'HL7 MLLP configuration is valid. The worker will listen for HL7 messages and ACK/NACK each message over MLLP.',
    listener: {
      host,
      port,
      protocol: 'hl7_mllp',
      transport: tlsEnabled ? 'tls' : 'tcp',
      listenerLockEnabled,
    },
  });
}

// ---------------------------------------------------------------------------
// Column discovery (shared by testConnection and GET /:orgId/columns)
// ---------------------------------------------------------------------------

async function _describeTable(sourceConfig) {
  const safeConfig = sanitizeMysqlSourceConfig(sourceConfig || {});
  const { table, useSharedPool } = safeConfig;

  try {
    quoteIdentifier(table || '', 'table');
  } catch (e) {
    return { success: false, code: 'INVALID_TABLE', error: e.message };
  }

  let pool = null;
  let ownPool = false;

  try {
    if (useSharedPool !== false && db.isConfigured()) {
      pool = db.getPool();
    } else {
      if (!safeConfig.host || !safeConfig.user || !safeConfig.database) {
        return {
          success: false,
          code: 'MISSING_CREDENTIALS',
          error: 'No connection credentials found for this org',
          hint: 'Configure dedicated MySQL credentials or set useSharedPool: true',
        };
      }
      const mysql = require('mysql2/promise');
      pool = mysql.createPool({
        host: safeConfig.host,
        port: safeConfig.port || 3306,
        user: safeConfig.user,
        password: safeConfig.password || '',
        database: safeConfig.database,
        connectionLimit: 2,
        queueLimit: 10,
        waitForConnections: true,
        namedPlaceholders: true,
        connectTimeout: TEST_TIMEOUT_MS,
      });
      ownPool = true;
    }

    const quotedTable = quoteIdentifier(table, 'table');
    const [rows] = await withTimeout(pool.execute(`DESCRIBE ${quotedTable}`), TEST_TIMEOUT_MS, 'DESCRIBE');

    return {
      success: true,
      table,
      columns: rows.map((r) => ({
        name: r.Field,
        type: r.Type,
        nullable: r.Null === 'YES',
        key: r.Key || null,
        default: r.Default ?? null,
      })),
    };
  } catch (err) {
    return _classifyMysqlError(err);
  } finally {
    if (ownPool && pool) {
      pool.end().catch((cleanupErr) => {
        log('debug', 'MySQL column discovery cleanup failed', { error: cleanupErr.message });
      });
    }
  }
}

module.exports = { testConnection, describeTable, quoteIdentifier };
