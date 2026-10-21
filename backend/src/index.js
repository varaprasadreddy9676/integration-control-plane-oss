if (!Object.hasOwn) {
  Object.hasOwn = (obj, prop) => {
    if (obj === null || obj === undefined) {
      throw new TypeError('Cannot convert undefined or null to object');
    }
    return Object.prototype.hasOwnProperty.call(obj, prop);
  };
}

const express = require('express');
const cors = require('cors');

const { requestLogger, log, logError } = require('./logger');
const { closeLogStreams } = require('./logger');
const { armForcedExit } = require('./utils/forced-exit');
const errorHandler = require('./middleware/error-handler');
const auth = require('./middleware/auth');
const rateLimit = require('./middleware/rate-limit');
const requestIdMiddleware = require('./middleware/request-id');
const data = require('./data');
const config = require('./config');
const db = require('./db');
const { describeMysqlHealth } = require('./utils/mysql-health');
const { requestContextMiddleware } = require('./utils/request-context');
const { getWorkerHealthState } = require('./utils/worker-health-state');
const mongodb = require('./mongodb');
const { startDeliveryWorker } = require('./processor/worker');
const { startPendingDeliveriesWorker, stopPendingDeliveriesWorker } = require('./processor/pending-deliveries-worker');
const { startSchedulerWorker } = require('./processor/scheduler-worker');
const { getScheduledJobWorker } = require('./processor/scheduled-job-worker');
const { startDLQWorker, stopDLQWorker } = require('./processor/dlq-worker');
const { startFailureEmailReportScheduler, sendAlertEmail } = require('./services/notifications/failure-report');
const { dispatchAlert, toChannelAlert } = require('./services/notifications/alert-dispatcher');
const { createDeliveryFailureHealthWatcher } = require('./services/delivery-failure-health');
const emailService = require('./services/email-service');
const dailyReportsScheduler = require('./services/daily-reports-scheduler');
const { startDashboardAnalyticsRollupWorker } = require('./services/dashboard-analytics-rollups');

const authRouter = require('./routes/auth');
const usersRouter = require('./routes/users');
const adminRouter = require('./routes/admin');
const internalRouter = require('./routes/internal');
const rolesRouter = require('./routes/roles');
const apiKeysRouter = require('./routes/api-keys');
const mcpServerRouter = require('./routes/mcp-server');
const auditRouter = require('./routes/audit');
const outboundIntegrationsRouter = require('./routes/outbound-integrations');
const inboundIntegrationsRouter = require('./routes/integrations');
const inboundRuntimePublicRouter = require('./routes/inbound-runtime-public');
const logsRouter = require('./routes/logs');
const systemLogsRouter = require('./routes/system-logs');
const systemStatusRouter = require('./routes/system-status');
const clientErrorsRouter = require('./routes/client-errors');
const dashboardRouter = require('./routes/dashboard');
const tenantRouter = require('./routes/tenant');
const analyticsRouter = require('./routes/analytics');
const templatesRouter = require('./routes/templates');
const bulkRouter = require('./routes/bulk');
const importExportRouter = require('./routes/import-export');
const versionsRouter = require('./routes/versions');
const integrationHistoryRouter = require('./routes/integration-history');
const alertChannelsRouter = require('./routes/alert-channels');
const fieldSchemasRouter = require('./routes/field-schemas');
const configRouter = require('./routes/config');
const scheduledIntegrationsRouter = require('./routes/scheduled-integrations');
const scheduledJobsRouter = require('./routes/scheduled-jobs');
const alertCenterRouter = require('./routes/alert-center');
const lookupsRouter = require('./routes/lookups');
const dailyReportsRouter = require('./routes/daily-reports');
const eventsRouter = require('./routes/events');
const eventSourcesRouter = require('./routes/event-sources');
const senderProfilesRouter = require('./routes/sender-profiles');
const providersRouter = require('./routes/providers');
const credentialsRouter = require('./routes/credentials');
const opsRouter = require('./routes/ops');
const executionLogsRouter = require('./routes/execution-logs');
const dlqRouter = require('./routes/dlq');
const portalProfilesRouter = require('./routes/portal-profiles');
const connectionProfilesRouter = require('./routes/connection-profiles');
const gatewaySecretsRouter = require('./routes/gateway-secrets');
const healthMonitor = require('./services/health-monitor');
const { initializeCommunicationAdapters } = require('./services/communication/bootstrap');
const { assertSecretKeyHealth } = require('./services/gateway-secrets');
const { MemoryMonitor } = require('./services/memory-monitor');
const processLifecycle = require('./services/process-lifecycle');

let server = null;
// Grace period for a natural exit after the drain before it is forced.
const FORCED_EXIT_AFTER_DRAIN_MS = 10000;
let memoryMonitor = null;
let stopDeliveryWorker = async () => {};
let stopSchedulerWorker = () => {};
let stopFailureEmailReportScheduler = () => {};
let stopDeliveryFailureHealthWatcher = () => {};
let stopDashboardAnalyticsRollupWorker = () => {};
let dailyCleanupTimer = null;
let shutdownState = {
  draining: false,
  reason: null,
  startedAt: null,
};

function captureRawJsonBody(req, _res, buf, encoding) {
  if (!buf) return;
  req.rawBody = buf.length > 0 ? buf.toString(encoding || 'utf8') : '';
}

function normalizeHealthStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized === 'ok') return 'healthy';
  if (normalized === 'degraded') return 'warning';
  if (normalized === 'healthy' || normalized === 'warning' || normalized === 'critical' || normalized === 'error') {
    return normalized;
  }
  return 'unknown';
}


async function closeHttpServer() {
  if (!server) return;

  await new Promise((resolve) => {
    try {
      server.close(() => resolve());
      setTimeout(resolve, 5000);
    } catch (_error) {
      resolve();
    }
  });
}

async function initiateGracefulDrain(reason, error = null, options = {}) {
  if (shutdownState.draining) {
    return;
  }

  shutdownState = {
    draining: true,
    reason,
    startedAt: new Date().toISOString(),
  };

  const severity = error ? 'error' : 'warn';
  log(severity, 'Initiating graceful drain', {
    reason,
    error: error?.message || null,
  });

  await processLifecycle
    .markProcessDraining(reason, error, {
      pid: process.pid,
      allowNaturalExit: true,
    })
    .catch((markerError) => {
      log('error', 'Failed to write draining process marker', { error: markerError.message, reason });
    });

  if (memoryMonitor) {
    memoryMonitor.stop();
  }

  if (dailyCleanupTimer) {
    clearTimeout(dailyCleanupTimer);
    dailyCleanupTimer = null;
  }

  dailyReportsScheduler.stop();

  await Promise.allSettled([
    Promise.resolve().then(() => stopDeliveryWorker()),
    Promise.resolve().then(() => stopSchedulerWorker()),
    Promise.resolve().then(() => stopPendingDeliveriesWorker()),
    Promise.resolve().then(() => stopDLQWorker()),
    Promise.resolve().then(() => stopDashboardAnalyticsRollupWorker()),
    Promise.resolve().then(() => getScheduledJobWorker().stop()),
    Promise.resolve().then(() => stopFailureEmailReportScheduler()),
    Promise.resolve().then(() => stopDeliveryFailureHealthWatcher()),
    Promise.resolve().then(() => closeHttpServer()),
    Promise.resolve().then(() => db.closePool?.()),
    Promise.resolve().then(() => mongodb.close?.()),
  ]);

  await processLifecycle
    .markProcessStopped(reason, error, {
      pid: process.pid,
      naturalExitExpected: true,
    })
    .catch((markerError) => {
      log('error', 'Failed to write stopped process marker', { error: markerError.message, reason });
    });

  closeLogStreams();

  if (options.exitCode !== undefined) {
    process.exitCode = options.exitCode;
  }

  armForcedExit({ afterMs: FORCED_EXIT_AFTER_DRAIN_MS, exitCode: process.exitCode ?? 0 });
}

async function bootstrap() {
  const lifecycleInfo = await processLifecycle.markProcessStart({
    status: 'starting',
    pid: process.pid,
    startedAt: new Date().toISOString(),
  });
  if (lifecycleInfo.crashMarker) {
    log('error', 'Detected previous abrupt process stop', {
      markerPath: lifecycleInfo.crashMarker.markerPath,
      previousPid: lifecycleInfo.crashMarker.previousState?.pid || null,
      previousStatus: lifecycleInfo.crashMarker.previousState?.status || null,
      previousStartedAt: lifecycleInfo.crashMarker.previousState?.startedAt || null,
      detectedAt: lifecycleInfo.crashMarker.detectedAt,
    });
  }

  await data.initDataLayer();

  // Initialize communication adapters (email, SMS, WhatsApp, etc.)
  initializeCommunicationAdapters();

  // Initialize audit log indexes
  const { ensureAuditIndexes } = require('./services/audit-logger');
  ensureAuditIndexes();

  // Initialize user activity indexes
  const { ensureActivityIndexes } = require('./services/user-activity-tracker');
  ensureActivityIndexes();

  // Apply runtime system config from MongoDB, overriding config.json defaults in-place
  const { applyRuntimeConfig } = require('./data/system-config');
  await applyRuntimeConfig();

  // A fresh database has no UI config; create the default so the console works out of the box.
  await require('./data/ui-config')
    .ensureDefaultUiConfig()
    .then((created) => created && log('info', 'Created default UI configuration'))
    .catch((err) => log('warn', 'Failed to ensure default UI configuration', { error: err.message }));

  // Core collection indexes (delivery, logs, audits, scheduled jobs — 21 collections).
  // This was previously only reachable via src/scripts/ensure-mongodb-indexes.js, so
  // dropping a collection left hinted queries failing until someone ran that script by
  // hand; a restart did not help. It is idempotent, so running it every boot is safe.
  // Large production datasets can make index builds take minutes; don't block
  // HTTP startup on that maintenance work.
  mongodb.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure core MongoDB indexes', { error: err.message });
  });

  // Initialize portal access profile indexes
  const portalProfileData = require('./data/portal-access-profiles');
  await portalProfileData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure portal_access_profiles indexes', { error: err.message });
  });
  const providerData = require('./data/providers');
  await providerData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure integration_providers indexes', { error: err.message });
  });
  const senderProfileData = require('./data/sender-profiles');
  await senderProfileData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure communication_sender_profiles indexes', { error: err.message });
  });
  const eventAuditData = require('./data/event-audit');
  await eventAuditData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure event_audit indexes', { error: err.message });
  });
  const credentialData = require('./data/credentials');
  await credentialData.ensureIndexes().catch((err) => {
    log('warn', 'Failed to ensure credential_placeholders indexes', { error: err.message });
  });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.server?.trustProxy ?? false);
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'X-API-Key',
        'Authorization',
        'X-Integration-Signature',
        'X-Integration-Timestamp',
        'X-Integration-ID',
      ],
      exposedHeaders: ['X-Request-Id', 'X-Total-Count'],
    })
  );
  app.use(express.json({ limit: '1mb', verify: captureRawJsonBody }));
  app.use(requestIdMiddleware); // Add request ID first for tracking
  app.use(requestContextMiddleware); // Lets the data layer see who is making a change
  app.use(requestLogger);
  app.use(rateLimit); // Rate limiting before auth

  // Public inbound runtime endpoint. Uses per-integration inbound auth inside the runtime handler.
  app.use(`${config.api.basePrefix}/public/integrations`, inboundRuntimePublicRouter);

  // Auth routes (no API key required)
  app.use(`${config.api.basePrefix}/auth`, authRouter);
  app.use(`${config.api.basePrefix}/users`, usersRouter); // User management (auth required inside routes)
  // IMPORTANT: Mount more specific routes BEFORE general routes
  app.use(`${config.api.basePrefix}/admin/audit`, auth, auditRouter);
  app.use(`${config.api.basePrefix}/admin/roles`, auth, rolesRouter);
  app.use(`${config.api.basePrefix}/api-keys`, auth, apiKeysRouter);
  app.use(`${config.api.basePrefix}/mcp-server`, auth, mcpServerRouter);
  app.use(`${config.api.basePrefix}/admin`, auth, adminRouter);

  // Liveness: the process is up and serving. /health reports dependencies.
  app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'integration-gateway' });
  });

  app.get('/health', async (req, res) => {
    try {
      if (shutdownState.draining) {
        return res.status(503).json({
          status: 'draining',
          timestamp: new Date().toISOString(),
          reason: shutdownState.reason,
          startedAt: shutdownState.startedAt,
        });
      }

      const { checkWorkers } = require('./worker-heartbeat');

      // Get orgId from auth middleware if present, otherwise use default
      const orgId = req.orgId || 1;

      const healthStatus = await healthMonitor.getSystemHealth(orgId);
      const workerStatus = checkWorkers();
      const mysql = describeMysqlHealth({ configured: db.isConfigured(), available: data.isMysqlAvailable() });

      const coreWorkers = {
        deliveryWorker: getWorkerHealthState(workerStatus.deliveryWorker),
        schedulerWorker: getWorkerHealthState(workerStatus.schedulerWorker),
      };
      const workerHardFailure = Object.values(coreWorkers).some((worker) => worker.hardFailure);
      const workerDegraded = Object.values(coreWorkers).some((worker) => worker.degraded);

      // Set appropriate HTTP status based on health AND worker status
      let statusCode = 200;
      let overallStatus = normalizeHealthStatus(healthStatus.status);

      // A configured MySQL that is down is a warning, not a critical failure (API/UI still work)
      if (mysql.degradesHealth && overallStatus === 'healthy') {
        overallStatus = 'warning';
      }

      if (workerHardFailure) {
        statusCode = 503; // Service Unavailable - core worker is stopped/unavailable
        overallStatus = 'critical';
      } else if (workerDegraded && overallStatus === 'healthy') {
        overallStatus = 'warning';
      } else if (overallStatus === 'critical') {
        statusCode = 503;
      } else if (overallStatus === 'error') {
        statusCode = 500;
      }

      res.status(statusCode).json({
        ...healthStatus,
        status: overallStatus,
        workers: workerStatus,
        workerSummary: {
          coreWorkers,
          hardFailure: workerHardFailure,
          degraded: workerDegraded,
        },
        mysql: mysql.report,
      });
    } catch (err) {
      logError(err, { scope: 'health endpoint' });
      res.status(500).json({
        status: 'error',
        timestamp: new Date().toISOString(),
        error: 'Health check failed',
      });
    }
  });

  app.use(`${config.api.basePrefix}/outbound-integrations`, auth, outboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/inbound-integrations`, auth, inboundIntegrationsRouter);
  app.use(`${config.api.basePrefix}/integrations`, auth, inboundIntegrationsRouter); // Runtime proxy endpoint
  app.use(`${config.api.basePrefix}/logs`, auth, logsRouter);
  app.use(`${config.api.basePrefix}/system-status`, auth, systemStatusRouter);
  app.use(`${config.api.basePrefix}/events`, auth, eventsRouter);
  app.use(`${config.api.basePrefix}/event-sources`, auth, eventSourcesRouter);
  app.use(`${config.api.basePrefix}/system-logs`, auth, systemLogsRouter);
  app.use(`${config.api.basePrefix}/client-errors`, auth, clientErrorsRouter);
  app.use(`${config.api.basePrefix}/dashboard`, auth, dashboardRouter);
  app.use(`${config.api.basePrefix}/tenant`, auth, tenantRouter);
  app.use(`${config.api.basePrefix}/analytics`, auth, analyticsRouter);
  app.use(`${config.api.basePrefix}/templates`, auth, templatesRouter);
  app.use(`${config.api.basePrefix}/bulk`, auth, bulkRouter);
  app.use(`${config.api.basePrefix}/import-export`, auth, importExportRouter);
  app.use(`${config.api.basePrefix}/versions`, auth, versionsRouter);
  app.use(`${config.api.basePrefix}/integration-history`, auth, integrationHistoryRouter);
  app.use(`${config.api.basePrefix}/alert-channels`, auth, alertChannelsRouter);
  app.use(`${config.api.basePrefix}/field-schemas`, auth, fieldSchemasRouter);
  app.use(`${config.api.basePrefix}/config`, auth, configRouter);
  app.use(`${config.api.basePrefix}/scheduled-integrations`, auth, scheduledIntegrationsRouter);
  app.use(`${config.api.basePrefix}/scheduled-jobs`, auth, scheduledJobsRouter);
  app.use(`${config.api.basePrefix}/alert-center`, auth, alertCenterRouter);
  app.use(`${config.api.basePrefix}/lookups`, auth, lookupsRouter);
  app.use(`${config.api.basePrefix}/sender-profiles`, auth, senderProfilesRouter);
  app.use(`${config.api.basePrefix}/providers`, auth, providersRouter);
  app.use(`${config.api.basePrefix}/credentials`, auth, credentialsRouter);
  app.use(`${config.api.basePrefix}/ops`, auth, opsRouter);
  app.use(`${config.api.basePrefix}/daily-reports`, auth, dailyReportsRouter);
  app.use(`${config.api.basePrefix}/execution-logs`, auth, executionLogsRouter);
  app.use(`${config.api.basePrefix}/dlq`, auth, dlqRouter);
  // Portal Access Profile management (auth inside routes, supports SUPER_ADMIN / ADMIN / ORG_ADMIN)
  app.use(`${config.api.basePrefix}/portal-profiles`, portalProfilesRouter);
  app.use(`${config.api.basePrefix}/connection-profiles`, auth, connectionProfilesRouter);
  app.use(`${config.api.basePrefix}/gateway-secrets`, auth, gatewaySecretsRouter);

  // Internal routes — no auth, localhost-only use by transform scripts
  // Callable only from this machine: it answers questions about patient
  // records and has no authentication of its own.
  app.use('/internal', require('./middleware/local-only'), internalRouter);

  app.use((req, res) => {
    log('warn', 'Route not found', { path: req.path });
    res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' });
  });

  app.use(errorHandler);

  // Surface a dangerous secret-key configuration at boot. The failure mode
  // otherwise stays invisible until a Mongo credential change makes every
  // stored secret undecryptable, with no way back.
  assertSecretKeyHealth();
  if (config.security?.apiKey && !config.security?.apiKeyOrgIds) {
    log(
      'warn',
      'The shared API_KEY can act for every organization. Set API_KEY_ORG_IDS to the orgs that use it, or give each caller its own integration key.',
      {
        remediation: 'API_KEY_ORG_IDS=33,84 (comma-separated org ids)',
      }
    );
  }

  server = app.listen(config.port, async () => {
    log('info', `Integration Gateway API listening on port ${config.port}`);

    // Initialize memory monitor for production stability
    memoryMonitor = new MemoryMonitor({
      heapThresholdMB: config.memory?.heapThresholdMB || undefined, // Auto-detect if not configured
      checkIntervalMs: config.memory?.checkIntervalMs || 60000, // Check every minute
      gracefulShutdown: config.memory?.gracefulShutdown !== false, // Default true
    });
    memoryMonitor.start();

    // Log initial memory stats
    log('info', 'Memory monitor initialized', memoryMonitor.getMemoryReport());
    await processLifecycle
      .markProcessRunning({
        port: config.port,
        pid: process.pid,
        memoryGracefulShutdownEnabled: config.memory?.gracefulShutdown !== false,
      })
      .catch((markerError) => {
        log('error', 'Failed to write running process marker', { error: markerError.message });
      });
  });

  stopDeliveryWorker = await startDeliveryWorker();
  stopSchedulerWorker = startSchedulerWorker(); // Start scheduler for delayed/recurring integrations
  startDLQWorker(); // Start DLQ worker for automatic retries
  stopFailureEmailReportScheduler = startFailureEmailReportScheduler(); // Periodic failure report emails

  // Alerts when an integration's deliveries keep failing (org 783's event
  // source going quiet is covered by DeliveryWorkerManager's own watcher —
  // this is the delivery-outcome half, e.g. NCX's 401s from 27 Sep onward).
  const deliveryFailureWatcher = createDeliveryFailureHealthWatcher({
    listCandidates: (trackedIds) => data.listFailingOrTrackedIntegrations(trackedIds),
    recordAlert: (orgId, alert) => data.recordAlertCenterLog(orgId, alert),
    // Reach people, not just the Alert Center (Oval's expired certificate went
    // unnoticed for a day), and do not re-raise an episode after a restart.
    notify: async (orgId, alert) => {
      const [emailed] = await Promise.all([
        sendAlertEmail(orgId, alert),
        // Plugins: Slack, email lists, webhooks, WhatsApp — configured per org.
        data
          .getTenant(orgId)
          .catch(() => null)
          .then((tenant) =>
            dispatchAlert(
              orgId,
              toChannelAlert(orgId, alert, { orgName: tenant?.name || tenant?.tenantName, frontendUrl: config.frontendUrl })
            )
          ),
      ]);
      if (!emailed.sent) log('warn', 'Integration alert not emailed', { orgId, reason: emailed.reason });
    },
    wasAlertedSince: (integrationId, orgId, since) => data.wasIntegrationAlertedSince(integrationId, orgId, since),
    log,
  });
  deliveryFailureWatcher.start();
  stopDeliveryFailureHealthWatcher = () => deliveryFailureWatcher.stop();
  startPendingDeliveriesWorker(); // Start worker for INBOUND COMMUNICATION jobs

  // Start scheduled job worker for cron-based batch integrations
  const scheduledJobWorker = getScheduledJobWorker();
  await scheduledJobWorker.start();

  // Materialize dashboard analytics outside the request path. The analytics
  // routes retain a raw aggregation fallback until each org has full coverage.
  stopDashboardAnalyticsRollupWorker = startDashboardAnalyticsRollupWorker({
    mongodb,
    config,
    logger: log,
  });

  // Initialize email service for daily reports
  emailService.initialize();

  // Start daily reports scheduler (11:59 PM by default)
  dailyReportsScheduler.start();

  // Schedule daily cleanup at 2 AM
  scheduleDailyCleanup();
}

function scheduleDailyCleanup() {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(2, 0, 0, 0); // 2:00 AM

  const msUntil2AM = tomorrow.getTime() - now.getTime();

  dailyCleanupTimer = setTimeout(() => {
    runDailyCleanup();
    // Schedule again for next day
    scheduleDailyCleanup();
  }, msUntil2AM);

  log('info', `Daily cleanup scheduled for ${tomorrow.toISOString()}`);
}

async function runDailyCleanup() {
  try {
    log('info', 'Starting daily data cleanup');
    await data.cleanupOldData();
    log('info', 'Daily data cleanup completed');
  } catch (err) {
    logError(err, { scope: 'dailyCleanup' });
  }
}

bootstrap().catch((err) => {
  logError(err, { scope: 'bootstrap' });
  processLifecycle.markProcessStopped('bootstrap_failed', err, { pid: process.pid }).finally(() => {
    process.exit(1);
  });
});

process.on('unhandledRejection', (reason) => {
  log('error', 'Unhandled promise rejection', { reason });
});

process.on('uncaughtException', (err) => {
  logError(err, { scope: 'uncaughtException' });
  initiateGracefulDrain('uncaughtException', err, { exitCode: 1 }).catch((drainError) => {
    logError(drainError, { scope: 'uncaughtExceptionDrain' });
    process.exitCode = 1;
  });
});

process.on('SIGTERM', () => {
  initiateGracefulDrain('SIGTERM', null, { exitCode: 0 }).catch((err) => {
    logError(err, { scope: 'sigtermDrain' });
  });
});

process.on('SIGINT', () => {
  initiateGracefulDrain('SIGINT', null, { exitCode: 0 }).catch((err) => {
    logError(err, { scope: 'sigintDrain' });
  });
});
