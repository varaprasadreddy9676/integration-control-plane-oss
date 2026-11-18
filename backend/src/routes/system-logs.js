const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const { createExportJobStore, exportSettings, parseBooleanQuery } = require('../services/export-jobs');
const { maskLogSecrets } = require('../utils/integration-secrets');

const router = express.Router();
const { asyncThreshold: SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD, ttlMs: SYSTEM_LOG_EXPORT_JOB_TTL_MS } = exportSettings('SYSTEM_LOG');
const exportJobs = createExportJobStore({
  collection: 'system_log_export_jobs',
  idPrefix: 'slexp',
  basePath: '/api/v1/system-logs',
  tmpDirName: 'integration-control-plane-system-log-exports',
  ttlMs: SYSTEM_LOG_EXPORT_JOB_TTL_MS,
  label: 'system-log',
});
const BACKEND_ROOT = path.join(__dirname, '..', '..');
const APP_ROOT = path.join(BACKEND_ROOT, '..');
const LOG_DIR = process.env.SYSTEM_LOG_DIR || path.join(BACKEND_ROOT, 'logs');
const PROCESS_LOG_FILE = process.env.SYSTEM_PROCESS_LOG_FILE || path.join(APP_ROOT, 'nohup.out');
const DEFAULT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const LOG_SOURCE_VALUES = new Set(['app', 'access', 'all']);
const STATS_CACHE_TTL_MS = 30_000;
const STATS_CACHE_MAX_SIZE = 500;
const _statsCache = new Map();

const parseInteger = (value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, minimum), maximum);
};

const normalizeLogSource = (value) => {
  if (typeof value !== 'string') return 'app';
  const normalized = value.trim().toLowerCase();
  return LOG_SOURCE_VALUES.has(normalized) ? normalized : 'app';
};

const parseSystemLogFilters = (query = {}) => ({
  limit: Math.min(parseInteger(query.limit, 1000, 1, 50000), 50000),
  level: typeof query.level === 'string' ? query.level.trim() : '',
  search: typeof query.search === 'string' ? query.search.trim() : '',
  pollId: typeof query.pollId === 'string' ? query.pollId.trim() : '',
  errorCategory: typeof query.errorCategory === 'string' ? query.errorCategory.trim() : '',
  source: normalizeLogSource(query.source),
});

const extractPollId = (message) => {
  if (!message) return null;
  const match = message.match(/\[POLL\s*#(\d+)\]/i);
  return match ? match[1] : null;
};

const categorizeError = (message, level, meta) => {
  if (level !== 'error') return null;
  if (!message) return 'unknown';

  if (meta && meta.category) {
    return meta.category;
  }

  const msg = message.toLowerCase();

  if (meta && meta.source === 'browser') {
    return 'browser_error';
  }

  if (
    msg.includes('400') ||
    msg.includes('401') ||
    msg.includes('403') ||
    msg.includes('404') ||
    msg.includes('bad request')
  ) {
    return 'http_4xx';
  }

  if (
    msg.includes('500') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('server error')
  ) {
    return 'http_5xx';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('connection') ||
    msg.includes('econnrefused') ||
    msg.includes('network')
  ) {
    return 'network';
  }

  if (msg.includes('transform failed') || msg.includes('transformation')) {
    return 'transform';
  }

  if (msg.includes('rate limit') || msg.includes('429')) {
    return 'ratelimit';
  }

  if (
    msg.includes('mongodb') ||
    msg.includes('mysql') ||
    msg.includes('database') ||
    msg.includes('query') ||
    msg.includes('sequelize')
  ) {
    return 'database';
  }

  if (msg.includes('validation') || msg.includes('invalid') || msg.includes('required field')) {
    return 'validation_error';
  }

  return 'other';
};

const groupLogsByPoll = (logs) => {
  const groups = {};

  logs.forEach((entry) => {
    const pollId = extractPollId(entry.message) || 'NO_POLL';

    if (!groups[pollId]) {
      groups[pollId] = {
        pollId,
        logs: [],
        firstTimestamp: entry.timestamp,
        lastTimestamp: entry.timestamp,
        hasError: false,
        hasWarn: false,
        levels: { error: 0, warn: 0, info: 0, debug: 0 },
        eventsProcessed: 0,
        retriesProcessed: 0,
        totalDurationMs: 0,
      };
    }

    const group = groups[pollId];
    group.logs.push(entry);

    if (entry.timestamp < group.firstTimestamp) group.firstTimestamp = entry.timestamp;
    if (entry.timestamp > group.lastTimestamp) group.lastTimestamp = entry.timestamp;

    if (entry.level === 'error') group.hasError = true;
    if (entry.level === 'warn') group.hasWarn = true;
    if (group.levels[entry.level] !== undefined) {
      group.levels[entry.level] += 1;
    }

    if (entry.meta) {
      if (typeof entry.meta.eventsProcessed === 'number') {
        group.eventsProcessed = Math.max(group.eventsProcessed, entry.meta.eventsProcessed);
      }
      if (typeof entry.meta.retriesProcessed === 'number') {
        group.retriesProcessed = Math.max(group.retriesProcessed, entry.meta.retriesProcessed);
      }
      if (typeof entry.meta.durationMs === 'number') {
        group.totalDurationMs += entry.meta.durationMs;
      }
    }
  });

  Object.values(groups).forEach((group) => {
    group.pollDurationMs = new Date(group.lastTimestamp).getTime() - new Date(group.firstTimestamp).getTime();
    group.logs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  });

  return Object.values(groups).sort(
    (a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime()
  );
};

const getSourceTypes = (source) => {
  if (source === 'all') return ['app', 'access'];
  return [source || 'app'];
};

const getLogFilenamePrefix = (sourceType) => (sourceType === 'access' ? 'access' : 'app');

const matchesRotatedLogName = (fileName, prefix) => {
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rotatedPattern = new RegExp(`^${escapedPrefix}-\\d{4}-\\d{2}-\\d{2}\\.log(?:\\.gz)?$`);
  return rotatedPattern.test(fileName) || fileName === `${prefix}.log`;
};

const getRecentLogFiles = async (sourceType) => {
  const prefix = getLogFilenamePrefix(sourceType);
  let entries = [];

  try {
    entries = await fsp.readdir(LOG_DIR, { withFileTypes: true });
  } catch (_error) {
    return [];
  }

  const now = Date.now();
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!matchesRotatedLogName(entry.name, prefix)) continue;

    const filePath = path.join(LOG_DIR, entry.name);

    try {
      const stat = await fsp.stat(filePath);
      files.push({ filePath, mtimeMs: stat.mtimeMs, size: stat.size, name: entry.name });
    } catch (_error) {}
  }

  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.filter((file, index) => index < 3 || now - file.mtimeMs <= 48 * 60 * 60 * 1000);
};

const createReadableStreamForLogFile = (filePath) => {
  const stream = fs.createReadStream(filePath);
  if (filePath.endsWith('.gz')) {
    return stream.pipe(zlib.createGunzip());
  }
  return stream;
};

const readLogFileLines = async (filePath) => {
  const input = createReadableStreamForLogFile(filePath);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  const lines = [];

  for await (const line of rl) {
    if (line.trim()) {
      lines.push(line);
    }
  }

  return lines;
};

const normalizeAppLogEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.timestamp || !entry.level || typeof entry.message !== 'string') return null;

  const normalized = {
    timestamp: entry.timestamp,
    level: entry.level,
    message: entry.message,
    // Lines written before the logger masked credentials still carry them.
    meta: entry.meta && typeof entry.meta === 'object' ? maskLogSecrets(entry.meta) : {},
    category: entry.category || null,
    source: entry.source || (entry.meta && entry.meta.source) || 'server',
    stream: 'app',
  };

  normalized.errorCategory = categorizeError(normalized.message, normalized.level, normalized.meta);
  return normalized;
};

const ACCESS_LOG_PATTERN = /^(\S+)\s+([A-Z]+)\s+(\S+)\s+(\d{3})\s+(\S+)\s+-\s+([\d.]+)\s+ms$/;

const parseAccessLogLine = (line) => {
  if (!line || typeof line !== 'string') return null;

  const match = line.match(ACCESS_LOG_PATTERN);
  if (!match) {
    const timestampToken = line.split(/\s+/, 1)[0];
    const parsedTime = new Date(timestampToken);
    return {
      timestamp: Number.isNaN(parsedTime.getTime()) ? new Date().toISOString() : parsedTime.toISOString(),
      level: 'info',
      message: line,
      meta: {},
      category: null,
      source: 'server',
      stream: 'access',
      errorCategory: null,
    };
  }

  const [, timestamp, method, url, statusText, contentLengthText, responseTimeText] = match;
  const status = Number.parseInt(statusText, 10);
  const responseTimeMs = Number.parseFloat(responseTimeText);
  const contentLength = contentLengthText === '-' ? null : Number.parseInt(contentLengthText, 10);
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  const meta = {
    method,
    url,
    status,
    contentLength,
    responseTimeMs,
  };

  return {
    timestamp: new Date(timestamp).toISOString(),
    level,
    message: line,
    meta,
    category: null,
    source: 'server',
    stream: 'access',
    errorCategory: categorizeError(line, level, meta),
  };
};

const parseLogLineForSource = (line, sourceType) => {
  if (sourceType === 'access') {
    return parseAccessLogLine(line);
  }

  try {
    const parsed = JSON.parse(line);
    return normalizeAppLogEntry(parsed);
  } catch (_error) {
    return null;
  }
};

const matchesSearch = (entry, search) => {
  if (!search) return true;
  const haystack = [entry.message, entry.stream, entry.source, entry.meta ? JSON.stringify(entry.meta) : '']
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(search.toLowerCase());
};

const matchesPollId = (entry, pollId) => {
  if (!pollId) return true;
  const logPollId = extractPollId(entry.message);
  const acceptedPollIds = String(pollId)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (acceptedPollIds.length === 0) return true;
  if (acceptedPollIds.includes('NO_POLL')) {
    if (logPollId === null) return true;
  }
  return logPollId !== null && acceptedPollIds.includes(logPollId);
};

const listSystemLogs = async (filters) => {
  const effectiveFilters = {
    limit: filters.limit || 1000,
    level: filters.level || '',
    search: filters.search || '',
    pollId: filters.pollId || '',
    errorCategory: filters.errorCategory || '',
    source: normalizeLogSource(filters.source),
  };

  // Check cache FIRST (before any file I/O) using a stable key. Must include every
  // filter that affects `logs`/`stats` below — a source-only key previously let a
  // filtered request's cached response leak out to a differently-filtered request
  // made within the same 30s TTL window.
  const cacheKey = `${effectiveFilters.source}:${effectiveFilters.level}:${effectiveFilters.search}:${effectiveFilters.pollId}:${effectiveFilters.errorCategory}:${effectiveFilters.limit}`;
  const cached = _statsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < STATS_CACHE_TTL_MS) {
    return cached.value;
  }

  const now = Date.now();
  const oneDayAgo = now - DEFAULT_LOOKBACK_MS;
  const sourceTypes = getSourceTypes(effectiveFilters.source);
  const allLogsForStats = [];

  for (const sourceType of sourceTypes) {
    const files = await getRecentLogFiles(sourceType);
    for (const file of files) {
      const lines = await readLogFileLines(file.filePath);
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const entry = parseLogLineForSource(lines[index], sourceType);
        if (!entry) continue;

        const logTime = new Date(entry.timestamp).getTime();
        if (!Number.isFinite(logTime)) continue;
        if (logTime < oneDayAgo) break;

        allLogsForStats.push(entry);
      }
    }
  }

  allLogsForStats.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const logs = allLogsForStats
    .filter((entry) => {
      if (effectiveFilters.level && entry.level !== effectiveFilters.level) return false;
      if (!matchesSearch(entry, effectiveFilters.search)) return false;
      if (!matchesPollId(entry, effectiveFilters.pollId)) return false;
      if (effectiveFilters.errorCategory && entry.errorCategory !== effectiveFilters.errorCategory) return false;
      return true;
    })
    .slice(0, effectiveFilters.limit);

  const errorLogsAll = allLogsForStats.filter((entry) => entry.level === 'error');
  const stats = {
    total: allLogsForStats.length,
    error: errorLogsAll.length,
    warn: allLogsForStats.filter((entry) => entry.level === 'warn').length,
    info: allLogsForStats.filter((entry) => entry.level === 'info').length,
    debug: allLogsForStats.filter((entry) => entry.level === 'debug').length,
    byStream: {
      app: allLogsForStats.filter((entry) => entry.stream === 'app').length,
      access: allLogsForStats.filter((entry) => entry.stream === 'access').length,
    },
    errorCategories: {
      ui_error: errorLogsAll.filter((entry) => entry.errorCategory === 'ui_error').length,
      api_error: errorLogsAll.filter((entry) => entry.errorCategory === 'api_error').length,
      validation_error: errorLogsAll.filter((entry) => entry.errorCategory === 'validation_error').length,
      business_logic: errorLogsAll.filter((entry) => entry.errorCategory === 'business_logic').length,
      unhandled: errorLogsAll.filter((entry) => entry.errorCategory === 'unhandled').length,
      browser_error: errorLogsAll.filter((entry) => entry.errorCategory === 'browser_error').length,
      http_4xx: errorLogsAll.filter((entry) => entry.errorCategory === 'http_4xx').length,
      http_5xx: errorLogsAll.filter((entry) => entry.errorCategory === 'http_5xx').length,
      network: errorLogsAll.filter((entry) => entry.errorCategory === 'network').length,
      transform: errorLogsAll.filter((entry) => entry.errorCategory === 'transform').length,
      ratelimit: errorLogsAll.filter((entry) => entry.errorCategory === 'ratelimit').length,
      database: errorLogsAll.filter((entry) => entry.errorCategory === 'database').length,
      other: errorLogsAll.filter((entry) => entry.errorCategory === 'other').length,
      unknown: errorLogsAll.filter((entry) => entry.errorCategory === 'unknown').length,
    },
  };

  const pollGroups = groupLogsByPoll(logs.filter((entry) => entry.stream === 'app'));

  // Compute pollStats from ALL logs (unfiltered) so stat cards stay correct
  // regardless of the levelFilter the user applied for the table.
  const allPollGroups = groupLogsByPoll(allLogsForStats.filter((entry) => entry.stream === 'app'));
  const pollStats = {
    total: allPollGroups.length,
    withErrors: allPollGroups.filter((group) => group.hasError).length,
    withWarnings: allPollGroups.filter((group) => group.hasWarn && !group.hasError).length,
    healthy: allPollGroups.filter((group) => !group.hasError && !group.hasWarn).length,
  };

  const pollPerformance = pollGroups
    .filter((group) => group.pollId !== 'NO_POLL')
    .slice(0, 10)
    .map((group) => ({
      pollId: group.pollId,
      durationMs: group.pollDurationMs,
      eventsProcessed: group.eventsProcessed,
      retriesProcessed: group.retriesProcessed,
      logCount: group.logs.length,
      hasError: group.hasError,
      hasWarn: group.hasWarn,
    }));

  const result = {
    logs,
    displayed: logs.length,
    totalInPeriod: allLogsForStats.length,
    limit: effectiveFilters.limit,
    filters: {
      level: effectiveFilters.level || undefined,
      search: effectiveFilters.search || undefined,
      pollId: effectiveFilters.pollId || undefined,
      errorCategory: effectiveFilters.errorCategory || undefined,
      source: effectiveFilters.source,
    },
    stats,
    pollStats,
    pollPerformance,
    pollGroups,
  };

  // Cache the full response with 30s TTL, LRU eviction
  if (_statsCache.size >= STATS_CACHE_MAX_SIZE) {
    const nowMs = Date.now();
    for (const [key, entry] of _statsCache) {
      if (nowMs - entry.ts >= STATS_CACHE_TTL_MS) _statsCache.delete(key);
    }
    if (_statsCache.size >= STATS_CACHE_MAX_SIZE) {
      let oldest = null;
      for (const [key, entry] of _statsCache) {
        if (!oldest || entry.ts < oldest[1].ts) oldest = [key, entry];
      }
      if (oldest) _statsCache.delete(oldest[0]);
    }
  }
  _statsCache.set(cacheKey, { ts: Date.now(), value: result });

  return result;
};

const readSystemLogs = async (filters) => {
  const response = await listSystemLogs(filters);
  return response.logs;
};

const getProcessLogTail = async ({ lines = 200, maxBytes = 256 * 1024 } = {}) => {
  const filePath = PROCESS_LOG_FILE;
  const lineLimit = Math.min(Math.max(Number(lines) || 200, 1), 2000);
  const maxReadBytes = Math.min(Math.max(Number(maxBytes) || 256 * 1024, 1024), 2 * 1024 * 1024);

  if (!filePath || !fs.existsSync(filePath)) {
    return {
      fileName: filePath ? path.basename(filePath) : 'nohup.out',
      fileExists: false,
      updatedAt: null,
      sizeBytes: 0,
      totalLines: 0,
      returnedLines: 0,
      truncated: false,
      lines: [],
    };
  }

  const stat = await fsp.stat(filePath);
  const readLength = Math.min(stat.size, maxReadBytes);
  const startPosition = Math.max(0, stat.size - readLength);
  const handle = await fsp.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(readLength);
    await handle.read(buffer, 0, readLength, startPosition);
    let content = buffer.toString('utf8');

    if (startPosition > 0) {
      const firstNewline = content.indexOf('\n');
      if (firstNewline >= 0) {
        content = content.slice(firstNewline + 1);
      }
    }

    const allLines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const visibleLines = allLines.slice(-lineLimit);
    const lineNumberOffset = Math.max(0, allLines.length - visibleLines.length);

    return {
      fileName: path.basename(filePath),
      fileExists: true,
      updatedAt: stat.mtime.toISOString(),
      sizeBytes: stat.size,
      totalLines: allLines.length,
      returnedLines: visibleLines.length,
      truncated: startPosition > 0 || allLines.length > visibleLines.length,
      lines: visibleLines.map((line, index) => ({
        lineNumber: lineNumberOffset + index + 1,
        text: line,
      })),
    };
  } finally {
    await handle.close();
  }
};

const SYSTEM_LOG_CSV_HEADERS = ['Timestamp', 'Level', 'Stream', 'Message', 'Error Category', 'Metadata'];

const csvCell = (cell) => {
  const str = String(cell);
  return str.includes(',') || str.includes('\n') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
};

const systemLogsCsv = (logs) =>
  [
    SYSTEM_LOG_CSV_HEADERS.join(','),
    ...logs.map((entry) =>
      [entry.timestamp, entry.level, entry.stream || 'app', entry.message || '', entry.errorCategory || '', entry.meta ? JSON.stringify(entry.meta) : '']
        .map(csvCell)
        .join(',')
    ),
  ].join('\n');

// A file name stem naming the source (system-logs, system-logs-access).
const systemLogsStem = (filters) => `system-logs${filters.source && filters.source !== 'app' ? `-${filters.source}` : ''}`;

/** What a background system-log export writes: the logs, as JSON or CSV, in one go. */
const writeExport = async ({ job, filePath }) => {
  const logs = await readSystemLogs(job.filters || {});
  await fsp.writeFile(filePath, job.format === 'json' ? JSON.stringify(logs) : systemLogsCsv(logs), 'utf8');
  return { processedRecords: logs.length };
};

const startExportJob = async (format, filters, totalRecords) =>
  exportJobs.start(await exportJobs.create({ format, fileStem: systemLogsStem(filters), totalRecords, fields: { filters } }), writeExport);

router.get('/', async (req, res) => {
  try {
    const filters = parseSystemLogFilters(req.query || {});
    const grouped = req.query.grouped === 'true';
    const response = await listSystemLogs(filters);
    // listSystemLogs() can return a cached object by reference — deleting a field
    // directly on it would mutate the shared cache entry, silently dropping
    // pollGroups from a later ?grouped=true request that hits the same cache key.
    res.json(grouped ? response : { ...response, pollGroups: undefined });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read logs',
      message: err.message,
    });
  }
});

router.get('/process-tail', async (req, res) => {
  try {
    const lines = parseInteger(req.query.lines, 200, 1, 2000);
    const payload = await getProcessLogTail({ lines });
    res.json(payload);
  } catch (err) {
    res.status(500).json({
      error: 'Failed to read process log',
      message: err.message,
    });
  }
});

router.get('/export/json', async (req, res) => {
  const filters = parseSystemLogFilters(req.query || {});
  const useAsyncExport =
    parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD);
  if (useAsyncExport) {
    const job = await startExportJob('json', filters, filters.limit || 0);
    return res.status(202).json({
      ...exportJobs.toResponse(job),
      message: 'System log export queued.',
    });
  }

  try {
    const logs = await readSystemLogs(filters);
    const filename = `${systemLogsStem(filters)}-${new Date().toISOString().split('T')[0]}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

router.get('/export/csv', async (req, res) => {
  const filters = parseSystemLogFilters(req.query || {});
  const useAsyncExport =
    parseBooleanQuery(req.query.async) || (filters.limit && filters.limit >= SYSTEM_LOG_EXPORT_ASYNC_THRESHOLD);
  if (useAsyncExport) {
    const job = await startExportJob('csv', filters, filters.limit || 0);
    return res.status(202).json({
      ...exportJobs.toResponse(job),
      message: 'System log export queued.',
    });
  }

  try {
    const logs = await readSystemLogs(filters);
    const filename = `${systemLogsStem(filters)}-${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(systemLogsCsv(logs));
  } catch (err) {
    res.status(500).json({ error: 'Export failed', message: err.message });
  }
});

router.get('/export/jobs/:jobId', async (req, res) => {
  const job = await exportJobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Export job not found', code: 'NOT_FOUND' });
  }
  return res.json(exportJobs.toResponse(job));
});

router.get('/export/jobs/:jobId/download', exportJobs.downloadHandler());

router.delete('/clear', async (_req, res) => {
  const archivedFiles = [];

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const targets = [];

    for (const sourceType of ['app', 'access']) {
      const files = await getRecentLogFiles(sourceType);
      const currentFile = files.find((file) => file.filePath.endsWith('.log'));
      if (currentFile) {
        targets.push(currentFile.filePath);
      }
    }

    for (const filePath of targets) {
      const archiveFile = `${filePath}.${timestamp}.archive`;
      await fsp.copyFile(filePath, archiveFile);
      await fsp.truncate(filePath, 0);
      archivedFiles.push(archiveFile);
    }

    res.json({
      message: 'System logs cleared successfully',
      archived: archivedFiles.join(', '),
    });
  } catch (err) {
    res.status(500).json({
      error: 'Failed to clear logs',
      message: err.message,
    });
  }
});

module.exports = router;
