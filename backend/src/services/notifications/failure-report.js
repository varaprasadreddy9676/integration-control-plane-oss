const http = require('http');
const https = require('https');
const { URL } = require('url');
const config = require('../../config');
const mongodb = require('../../mongodb');
const { log, logError } = require('../../logger');
const data = require('../../data');
const { isIntegrationMailConfigured, deliverEmail } = require('./integration-mailer');

const COMMUNICATION_SERVICE_URL =
  config.communicationServiceUrl || 'https://notification.example.com/notification-service/api/sendNotification';

function postJson(url, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const body = JSON.stringify(payload);
    const isHttps = parsed.protocol === 'https:';

    const req = (isHttps ? https : http).request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode || 0, body: data });
        });
      }
    );

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy(new Error('Request timed out'));
    });
    req.write(body);
    req.end();
  });
}

const DEFAULT_CONFIG = {
  enabled: false,
  intervalMinutes: 15,
  lookbackMinutes: 60,
  minFailures: 1,
  maxItems: 25,
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function truncateText(value, maxLength = 180) {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
}

function formatDateTime(value) {
  try {
    return new Date(value).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_err) {
    return String(value);
  }
}

async function getFailureReportConfig(orgId) {
  if (!mongodb.isConnected()) {
    return DEFAULT_CONFIG;
  }

  if (orgId) {
    try {
      const uiConfig = await data.getUiConfigForEntity(orgId);
      const configured = uiConfig?.notifications?.failureEmailReports || {};
      return {
        ...DEFAULT_CONFIG,
        ...configured,
      };
    } catch (err) {
      logError(err, { scope: 'failureReport:getFailureReportConfig', orgId });
      return DEFAULT_CONFIG;
    }
  }

  const dbClient = await mongodb.getDbSafe();
  const configDoc = await dbClient.collection('ui_config').findOne({ _id: 'default' });
  const configured = configDoc?.notifications?.failureEmailReports || {};

  return {
    ...DEFAULT_CONFIG,
    ...configured,
  };
}

async function getEntityEmail(orgId) {
  try {
    const uiConfig = await data.getUiConfigForEntity(orgId);
    const overrideEmail = uiConfig?.notifications?.failureEmailReports?.email;
    const tenant = await data.getTenant(orgId);
    if (!tenant) return null;

    return {
      email: overrideEmail || tenant.tenantEmail || null,
      tenantName: tenant.tenantName || `ENT-${orgId}`,
      tenantCode: tenant.tenantCode || String(orgId),
    };
  } catch (err) {
    logError(err, { scope: 'failureReport:getEntityEmail', orgId });
    return null;
  }
}

/**
 * Generate curl command from delivery log for debugging
 */
function generateCurlCommand(log) {
  if (!log.requestHeaders || !log.targetUrl) return null;

  const headers = Object.entries(log.requestHeaders || {})
    .map(([key, value]) => `-H '${key}: ${String(value).replace(/'/g, "\\'")}'`)
    .join(' \\\n  ');

  const payload = log.requestPayload ? `-d '${JSON.stringify(log.requestPayload).replace(/'/g, "\\'")}'` : '';

  return `curl -X ${log.httpMethod || 'POST'} '${log.targetUrl}' \\\n  ${headers}${payload ? ` \\\n  ${payload}` : ''}`;
}

function buildEmailHtml({
  tenantName,
  orgId,
  windowStart,
  windowEnd,
  totalFailures,
  statusCounts,
  topIntegrations,
  recentFailures,
  dashboardBaseUrl,
}) {
  const header = `
    <div style="padding: 20px 24px; background: #0f172a; color: #f8fafc; border-radius: 12px;">
      <h2 style="margin: 0 0 6px; font-size: 20px;">Delivery Failure Report</h2>
      <div style="font-size: 13px; opacity: 0.8;">${escapeHtml(tenantName)} • Entity RID ${escapeHtml(orgId)}</div>
    </div>
  `;

  const summary = `
    <div style="margin-top: 20px; padding: 16px 20px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <div style="font-size: 13px; color: #64748b;">Reporting window</div>
      <div style="font-weight: 600; margin-top: 6px;">${escapeHtml(formatDateTime(windowStart))} → ${escapeHtml(formatDateTime(windowEnd))}</div>
      <div style="margin-top: 12px; display: flex; flex-wrap: wrap; gap: 10px;">
        <span style="background: #fee2e2; color: #b91c1c; padding: 6px 10px; border-radius: 999px; font-weight: 600; font-size: 12px;">${totalFailures} total failures</span>
        ${Object.entries(statusCounts)
          .map(
            ([status, count]) => `
            <span style="background: #e2e8f0; color: #334155; padding: 6px 10px; border-radius: 999px; font-weight: 600; font-size: 12px;">${escapeHtml(status)}: ${count}</span>
          `
          )
          .join('')}
      </div>
    </div>
  `;

  const integrationRows = topIntegrations.length
    ? topIntegrations
        .map(
          (wh) => `
        <tr>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(wh.integrationName || wh.integrationConfigId || 'Unknown')}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0; text-align: right;">${wh.count}</td>
          <td style="padding: 10px 12px; border-bottom: 1px solid #e2e8f0;">${escapeHtml(formatDateTime(wh.lastFailure))}</td>
        </tr>
      `
        )
        .join('')
    : `
      <tr>
        <td colspan="3" style="padding: 12px; color: #64748b;">No failing integrations found.</td>
      </tr>
    `;

  const integrationTable = `
    <div style="margin-top: 20px;">
      <h3 style="margin: 0 0 10px; font-size: 15px;">Top failing integrations</h3>
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f1f5f9; text-align: left;">
            <th style="padding: 10px 12px;">Integration</th>
            <th style="padding: 10px 12px; text-align: right;">Failures</th>
            <th style="padding: 10px 12px;">Last failure</th>
          </tr>
        </thead>
        <tbody>
          ${integrationRows}
        </tbody>
      </table>
    </div>
  `;

  const failureDetails = recentFailures.length
    ? recentFailures
        .slice(0, 5)
        .map((log, index) => {
          const curlCommand = generateCurlCommand(log);
          return `
          <div style="margin-top: ${index === 0 ? '0' : '16px'}; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div>
                <strong style="color: #0f172a;">${escapeHtml(log.integrationName || 'Unknown Integration')}</strong>
                <div style="font-size: 12px; color: #64748b; margin-top: 2px;">
                  ${escapeHtml(log.eventType || '—')} • ${escapeHtml(formatDateTime(log.createdAt))}
                </div>
              </div>
              <span style="background: #fee2e2; color: #b91c1c; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">
                HTTP ${log.responseStatus ?? 'ERROR'}
              </span>
            </div>

            ${
              log.errorMessage
                ? `
              <div style="margin-top: 12px; padding: 10px; background: #fef2f2; border-left: 3px solid #ef4444; border-radius: 4px;">
                <div style="font-size: 11px; color: #991b1b; font-weight: 600; margin-bottom: 4px;">ERROR</div>
                <div style="font-size: 12px; color: #7f1d1d;">${escapeHtml(log.errorMessage)}</div>
              </div>
            `
                : ''
            }

            ${
              log.responseBody
                ? `
              <div style="margin-top: 12px; padding: 10px; background: #fff; border: 1px solid #e5e7eb; border-radius: 4px;">
                <div style="font-size: 11px; color: #6b7280; font-weight: 600; margin-bottom: 4px;">RESPONSE</div>
                <div style="font-size: 11px; font-family: 'Courier New', monospace; color: #374151; white-space: pre-wrap; overflow-wrap: break-word;">${escapeHtml(truncateText(log.responseBody, 300))}</div>
              </div>
            `
                : ''
            }

            ${
              curlCommand
                ? `
              <details style="margin-top: 12px; cursor: pointer;">
                <summary style="font-size: 11px; color: #6b7280; font-weight: 600; padding: 8px 0; user-select: none;">
                  🔧 Debug with curl
                </summary>
                <div style="margin-top: 8px; padding: 12px; background: #1e293b; border-radius: 4px; overflow-x: auto;">
                  <code style="font-size: 11px; font-family: 'Courier New', monospace; color: #e2e8f0; white-space: pre; display: block;">${escapeHtml(curlCommand)}</code>
                </div>
              </details>
            `
                : ''
            }
          </div>
        `;
        })
        .join('')
    : `<div style="padding: 16px; text-align: center; color: #64748b;">No recent failures found.</div>`;

  const failureSection = `
    <div style="margin-top: 20px;">
      <h3 style="margin: 0 0 12px; font-size: 15px;">Detailed Failure Analysis (Latest ${Math.min(5, recentFailures.length)})</h3>
      ${failureDetails}
      ${
        recentFailures.length > 5
          ? `
        <div style="margin-top: 12px; text-align: center; font-size: 12px; color: #64748b;">
          + ${recentFailures.length - 5} more failures • <a href="${escapeHtml(dashboardBaseUrl)}/logs?status=FAILED" style="color: #2563eb;">View all in dashboard</a>
        </div>
      `
          : ''
      }
    </div>
  `;

  const footer = `
    <div style="margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #94a3b8;">
      <div>Open dashboard: <a href="${escapeHtml(dashboardBaseUrl)}/logs?status=FAILED" style="color: #2563eb;">View delivery logs</a></div>
      <div style="margin-top: 6px;">Event Gateway Alerting • ${escapeHtml(new Date().toISOString())}</div>
    </div>
  `;

  return `
    <div style="font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a;">
      ${header}
      ${summary}
      ${integrationTable}
      ${failureSection}
      ${footer}
    </div>
  `;
}

async function sendFailureReportEmail({ payload, subject }) {
  if (isIntegrationMailConfigured()) {
    const message = payload.payload || {};
    const result = await deliverEmail({ to: message.to, subject, html: message.html || message.content });
    return { status: 200, body: JSON.stringify({ messageId: result?.messageId || null }) };
  }
  const response = await postJson(COMMUNICATION_SERVICE_URL, payload, 10000);

  log('info', 'Communication service response', {
    status: response.status,
    body: response.body,
    subject,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Communication service returned ${response.status}: ${response.body}`);
  }

  // Check if provider returned success: false in response body (200 but not actually sent)
  let parsed = null;
  try {
    parsed = JSON.parse(response.body);
  } catch (_e) {
    /* non-JSON response is fine */
  }

  if (parsed && parsed.success === false) {
    throw new Error(`Communication service accepted request but did not send: ${JSON.stringify(parsed)}`);
  }

  return { status: response.status, body: response.body };
}

function buildSubject(totalFailures, tenantName) {
  return `Delivery Failure Report (${totalFailures}) - ${tenantName}`;
}

function buildEmailPayload({ orgId, tenantCode, recipient, subject, htmlContent }) {
  return {
    payload: {
      messageType: 'email',
      source: 'integrationGateway',
      hospitalCode: tenantCode || String(orgId),
      corporateEntityCode: tenantCode || String(orgId),
      to: recipient,
      subject,
      html: htmlContent,
      content: htmlContent,
    },
  };
}

async function processFailureReports() {
  if (!mongodb.isConnected()) {
    log('warn', 'MongoDB not connected, skipping failure report');
    return;
  }

  const defaultConfig = await getFailureReportConfig();
  if (!defaultConfig.enabled) {
    log('debug', 'Failure email reports disabled via default ui_config (checking per-entity overrides).');
  }

  const dbClient = await mongodb.getDbSafe();
  const now = new Date();
  // Use default config lookbackMinutes (fallback to 60 if not set)
  const lookbackStart = new Date(Date.now() - (defaultConfig.lookbackMinutes || 60) * 60 * 1000);
  // Delivery logs store statuses in upper case. Matching lower case only meant
  // this report never found a failure and never sent an email.
  const failureStatuses = ['FAILED', 'ABANDONED', 'RETRYING', 'failed', 'abandoned', 'retrying'];

  const entityRids = await dbClient.collection('execution_logs').distinct('orgId', {
    createdAt: { $gte: lookbackStart },
    status: { $in: failureStatuses },
  });

  if (!entityRids.length) {
    log('info', 'No failures found in lookback window');
    return;
  }

  for (const orgId of entityRids) {
    let windowStart = lookbackStart;
    let totalFailures = 0;
    let tenantInfo = null;
    let subject = null;
    let recipient = null;
    let payload = null;
    try {
      const entityConfig = await getFailureReportConfig(orgId);
      if (!entityConfig.enabled) {
        continue;
      }
      const stateCollection = dbClient.collection('failure_report_state');
      const state = await stateCollection.findOne({ orgId });
      const lastSentAt = state?.lastSentAt ? new Date(state.lastSentAt) : null;

      windowStart = lastSentAt && lastSentAt > lookbackStart ? lastSentAt : lookbackStart;
      const match = {
        orgId,
        createdAt: { $gte: windowStart, $lte: now },
        status: { $in: failureStatuses },
      };

      totalFailures = await dbClient.collection('execution_logs').countDocuments(match);
      tenantInfo = await getEntityEmail(orgId);
      subject = buildSubject(totalFailures, tenantInfo?.tenantName || `ENT-${orgId}`);
      recipient = tenantInfo?.email || null;

      if (totalFailures < entityConfig.minFailures) {
        await data.recordAlertCenterLog(orgId, {
          type: 'DELIVERY_FAILURE_REPORT',
          channel: 'EMAIL',
          status: 'SKIPPED',
          subject,
          recipients: recipient ? [recipient] : [],
          totalFailures,
          windowStart,
          windowEnd: now,
          errorMessage: `Below minimum failure threshold (${entityConfig.minFailures}).`,
        });
        continue;
      }

      if (!recipient) {
        log('warn', 'Skipping failure report: no tenant email configured', { orgId });
        await data.recordAlertCenterLog(orgId, {
          type: 'DELIVERY_FAILURE_REPORT',
          channel: 'EMAIL',
          status: 'SKIPPED',
          subject,
          recipients: [],
          totalFailures,
          windowStart,
          windowEnd: now,
          errorMessage: 'Missing tenant email (ent_mail not configured).',
        });
        continue;
      }

      const statusCounts = await dbClient
        .collection('execution_logs')
        .aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }], { allowDiskUse: true })
        .toArray();

      const statusSummary = statusCounts.reduce((acc, item) => {
        acc[item._id] = item.count;
        return acc;
      }, {});

      const topIntegrations = await dbClient
        .collection('execution_logs')
        .aggregate(
          [
            { $match: match },
            {
              $group: {
                _id: {
                  integrationConfigId: '$integrationConfigId',
                  integrationName: '$integrationName',
                },
                count: { $sum: 1 },
                lastFailure: { $max: '$createdAt' },
              },
            },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          { allowDiskUse: true }
        )
        .toArray();

      // Fetch detailed delivery logs with request/response data
      const recentFailures = await dbClient
        .collection('execution_logs')
        .find(match)
        .sort({ createdAt: -1 })
        .limit(entityConfig.maxItems)
        .project({
          integrationName: 1,
          eventType: 1,
          status: 1,
          errorMessage: 1,
          responseStatus: 1,
          responseBody: 1,
          targetUrl: 1,
          httpMethod: 1,
          requestPayload: 1,
          requestHeaders: 1,
          createdAt: 1,
        })
        .toArray();

      const dashboardBaseUrl = config.frontendUrl || process.env.FRONTEND_URL || 'http://localhost:5174';
      const htmlContent = buildEmailHtml({
        tenantName: tenantInfo.tenantName,
        orgId,
        windowStart,
        windowEnd: now,
        totalFailures,
        statusCounts: statusSummary,
        topIntegrations: topIntegrations.map((item) => ({
          integrationConfigId: item._id.integrationConfigId,
          integrationName: item._id.integrationName,
          count: item.count,
          lastFailure: item.lastFailure,
        })),
        recentFailures,
        dashboardBaseUrl,
      });

      payload = buildEmailPayload({
        orgId,
        tenantCode: tenantInfo.tenantCode,
        recipient,
        subject,
        htmlContent,
      });

      const sendResult = await sendFailureReportEmail({
        payload,
        subject,
      });

      await stateCollection.updateOne({ orgId }, { $set: { lastSentAt: now, updatedAt: now } }, { upsert: true });

      await data.recordAlertCenterLog(orgId, {
        type: 'DELIVERY_FAILURE_REPORT',
        channel: 'EMAIL',
        status: 'SENT',
        subject,
        recipients: [recipient],
        totalFailures,
        windowStart,
        windowEnd: now,
        providerUrl: COMMUNICATION_SERVICE_URL,
        providerResponse: sendResult ? { status: sendResult.status, body: sendResult.body } : null,
        payload,
      });

      log('info', 'Failure report email sent', {
        orgId,
        totalFailures,
        recipient,
      });
    } catch (err) {
      logError(err, { scope: 'failureReport:send', orgId });
      const errorMessage = err instanceof Error ? err.message : String(err);
      await data.recordAlertCenterLog(orgId, {
        type: 'DELIVERY_FAILURE_REPORT',
        channel: 'EMAIL',
        status: 'FAILED',
        subject,
        recipients: recipient ? [recipient] : [],
        totalFailures,
        windowStart,
        windowEnd: now,
        providerUrl: COMMUNICATION_SERVICE_URL,
        errorMessage,
        errorStack: err instanceof Error ? err.stack : null,
        payload,
      });
    }
  }
}

function startFailureEmailReportScheduler() {
  let timer = null;
  let running = false;
  let activeLockId = null;

  const scheduleNext = async () => {
    const intervalMinutes = await data.getSchedulerIntervalMinutes();
    const intervalMs = Math.max(1, intervalMinutes || DEFAULT_CONFIG.intervalMinutes) * 60 * 1000;
    timer = setTimeout(run, intervalMs);
  };

  const run = async () => {
    if (running) {
      return;
    }
    running = true;

    try {
      const dbClient = mongodb.isConnected() ? await mongodb.getDbSafe() : null;
      if (dbClient) {
        const now = new Date();
        await dbClient
          .collection('scheduler_state')
          .updateOne({ _id: 'failure_email_reports' }, { $set: { lastRunAt: now, updatedAt: now } }, { upsert: true });
        const lockId = `lock-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const lockExpiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes

        // First ensure lock document exists
        await dbClient.collection('scheduler_locks').updateOne(
          { _id: 'failure_email_reports' },
          {
            $setOnInsert: {
              _id: 'failure_email_reports',
              lockedUntil: new Date(0),
              lockId: null,
              createdAt: now,
            },
          },
          { upsert: true }
        );

        // Then try to acquire lock
        const lockResult = await dbClient.collection('scheduler_locks').findOneAndUpdate(
          {
            _id: 'failure_email_reports',
            $or: [{ lockedUntil: { $lte: now } }, { lockedUntil: { $exists: false } }],
          },
          {
            $set: {
              lockedUntil: lockExpiresAt,
              lockId,
              lockedAt: now,
            },
          },
          { returnDocument: 'after' }
        );

        if (lockResult?.value?.lockId !== lockId) {
          log('info', 'Failure report scheduler lock held by another instance, skipping run');
          return;
        }

        activeLockId = lockId;
        await processFailureReports();
      } else {
        await processFailureReports();
      }
    } catch (err) {
      logError(err, { scope: 'failureReport:run' });
    } finally {
      if (activeLockId && mongodb.isConnected()) {
        try {
          const dbClient = await mongodb.getDbSafe();
          await dbClient
            .collection('scheduler_locks')
            .updateOne(
              { _id: 'failure_email_reports', lockId: activeLockId },
              { $set: { lockedUntil: new Date(0), releasedAt: new Date() } }
            );
        } catch (unlockErr) {
          logError(unlockErr, { scope: 'failureReport:unlock' });
        }
      }
      activeLockId = null;
      running = false;
      await scheduleNext();
    }
  };

  scheduleNext();
  log('info', 'Failure report scheduler started');

  return () => {
    if (timer) {
      clearTimeout(timer);
    }
  };
}

/**
 * Email one integration alert (failing / recovered) to the org's failure-report
 * recipient, under the same on/off switch as the periodic failure report.
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
async function sendAlertEmail(orgId, alert, { send = sendFailureReportEmail } = {}) {
  const reportConfig = await getFailureReportConfig(orgId);
  if (!reportConfig.enabled) return { sent: false, reason: 'failure emails disabled' };

  const tenantInfo = await getEntityEmail(orgId);
  if (!tenantInfo?.email) return { sent: false, reason: 'no recipient configured' };

  const dashboardBaseUrl = config.frontendUrl || process.env.FRONTEND_URL || '';
  const recovered = alert.type === 'INTEGRATION_DELIVERY_RECOVERED';
  const htmlContent = `
    <div style="font-family: Arial, sans-serif; font-size: 14px; color: #111827;">
      <h2 style="margin: 0 0 12px; color: ${recovered ? '#15803d' : '#b91c1c'};">${escapeHtml(alert.subject)}</h2>
      <div>Organization: ${escapeHtml(tenantInfo.tenantName)} (${escapeHtml(orgId)})</div>
      ${alert.errorMessage ? `<div style="margin-top: 8px;">Last error: <code>${escapeHtml(alert.errorMessage)}</code></div>` : ''}
      ${dashboardBaseUrl ? `<div style="margin-top: 12px;"><a href="${escapeHtml(dashboardBaseUrl)}/logs?orgId=${escapeHtml(orgId)}">Open delivery logs</a></div>` : ''}
    </div>`;

  const payload = buildEmailPayload({
    orgId,
    tenantCode: tenantInfo.tenantCode,
    recipient: tenantInfo.email,
    subject: alert.subject,
    htmlContent,
  });
  await send({ payload, subject: alert.subject });
  return { sent: true };
}

module.exports = {
  startFailureEmailReportScheduler,
  processFailureReports,
  sendAlertEmail,
};
