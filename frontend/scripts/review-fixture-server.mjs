import http from 'node:http';
import { createServer } from 'vite';

const orgId = 33;
const now = new Date().toISOString();
const tenant = {
  orgId,
  tenantName: 'Northstar Health Network',
  tenantCode: 'NSH-033',
  region: 'North America',
  timezone: 'America/Chicago',
  childEntities: [{ rid: 3301, name: 'Northstar Central', code: 'NS-CENTRAL' }],
};

const outbound = [
  {
    id: 'review-outbound',
    direction: 'OUTBOUND',
    name: 'Appointment Created to Scheduling',
    eventType: 'APPOINTMENT_CREATED',
    tenantId: orgId,
    entityName: tenant.tenantName,
    scope: 'INCLUDE_CHILDREN',
    targetUrl: 'https://scheduling.example.test/hooks/appointments',
    httpMethod: 'POST',
    outgoingAuthType: 'BEARER',
    isActive: true,
    timeoutMs: 5000,
    retryCount: 3,
    transformationMode: 'SCRIPT',
    transformation: "function transform(payload) { return { event: 'appointment.created', id: payload.id }; }",
    deliveryFollowUp: {
      enabled: true,
      script: "return { status: 'DELIVERED', done: true };",
      checkAfterSeconds: [30, 300],
    },
    stages: [
      {
        id: 'validate-request',
        name: 'Validate request',
        hook: 'before_send',
        effect: 'gate',
        enabled: true,
        runner: { type: 'script', config: { code: 'return { ok: true };' } },
      },
    ],
    provider: 'northstar-scheduling',
    updatedAt: now,
  },
  {
    id: 'review-outbound-2',
    direction: 'OUTBOUND',
    name: 'Visit Completed to Analytics',
    eventType: 'VISIT_COMPLETED',
    tenantId: orgId,
    entityName: tenant.tenantName,
    scope: 'ENTITY_ONLY',
    targetUrl: 'https://analytics.example.test/events',
    httpMethod: 'POST',
    outgoingAuthType: 'NONE',
    isActive: false,
    timeoutMs: 8000,
    retryCount: 2,
    transformationMode: 'NONE',
    updatedAt: now,
  },
];

const inbound = {
  _id: 'review-inbound',
  id: 'review-inbound',
  direction: 'INBOUND',
  name: 'Partner Appointment Intake',
  type: 'partner-appointment-intake',
  orgId,
  inboundAuthType: 'API_KEY',
  inboundAuthConfig: { headerName: 'x-partner-key', apiKey: '••••••••' },
  targetUrl: 'https://api.partner.example.test/v2/appointments',
  httpMethod: 'POST',
  timeout: 10000,
  retryCount: 2,
  contentType: 'application/json',
  isActive: true,
  requestTransformEnabled: true,
  requestTransformScript: 'return { appointmentId: payload.id, startAt: payload.start };',
  responseTransformEnabled: false,
  rateLimits: { enabled: true, requestsPerMinute: 120 },
  createdAt: now,
  updatedAt: now,
};

const logs = [
  {
    id: 'review-log-1',
    integrationName: outbound[0].name,
    integrationConfigId: outbound[0].id,
    __KEEP___KEEP_integrationConfig__Id__: outbound[0].id,
    __KEEP_integrationName__: outbound[0].name,
    eventType: 'APPOINTMENT_CREATED',
    status: 'SUCCESS',
    httpMethod: 'HL7_MLLP',
    responseStatus: 202,
    responseTimeMs: 184,
    attemptCount: 1,
    createdAt: now,
    provider: 'northstar-scheduling',
    requestPayload: 'MSH|^~\\&|NORTHSTAR|HOSP|MEDICS|HOSP|202611230930||ADT^A01|MSG-DEMO-1042|P|2.5\rPID|1||PAT-DEMO-1042^^^MRN||DOE^JANE',
    responseBody: 'MSH|^~\\&|MEDICS|HOSP|NORTHSTAR|HOSP|202611230930||ACK|ACK-DEMO-1042|P|2.5\rMSA|AA|MSG-DEMO-1042|Accepted',
    metadata: { hl7: { accepted: true, ackCode: 'AA', requestBytes: 112, responseBytes: 86 } },
  },
  {
    id: 'review-log-2',
    integrationName: outbound[1].name,
    integrationConfigId: outbound[1].id,
    __KEEP___KEEP_integrationConfig__Id__: outbound[1].id,
    __KEEP_integrationName__: outbound[1].name,
    eventType: 'VISIT_COMPLETED',
    status: 'FAILED',
    responseStatus: 503,
    responseTimeMs: 3000,
    attemptCount: 3,
    createdAt: new Date(Date.now() - 90_000).toISOString(),
    provider: 'northstar-analytics',
    traceId: 'review-trace-1',
    errorMessage: 'Remote service temporarily unavailable',
    requestPayload: { visitId: 'visit-demo-2206' },
  },
];

const reviewDlqEntry = {
  dlqId: 'review-dlq-1',
  traceId: 'review-trace-1',
  integrationConfigId: outbound[1].id,
  orgId,
  direction: 'OUTBOUND',
  payload: { visitId: 'visit-demo-2206', eventType: 'VISIT_COMPLETED' },
  error: {
    message: 'Scheduling API temporarily unavailable',
    code: 'REMOTE_503',
    category: 'REMOTE_5XX',
    statusCode: 503,
  },
  status: 'pending',
  retryCount: 2,
  maxRetries: 5,
  retryStrategy: 'exponential',
  failedAt: new Date(Date.now() - 90_000).toISOString(),
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  updatedAt: now,
};

const reviewTrace = {
  summary: {
    traceId: 'review-trace-1',
    status: 'FAILED',
    direction: 'OUTBOUND',
    triggerType: 'EVENT',
    totalDuration: 3042,
    startedAt: new Date(Date.now() - 95_000).toISOString(),
    finishedAt: new Date(Date.now() - 92_000).toISOString(),
    stepCount: 2,
    errorStep: 'Send Request',
  },
  timeline: [
    {
      name: 'Transform Payload',
      status: 'SUCCESS',
      timestamp: new Date(Date.now() - 94_000).toISOString(),
      durationMs: 42,
      gapMs: 0,
      metadata: { outputFields: ['visitId', 'eventType'] },
    },
    {
      name: 'Send Request',
      status: 'FAILED',
      timestamp: new Date(Date.now() - 93_000).toISOString(),
      durationMs: 3000,
      gapMs: 1,
      error: { message: 'Scheduling API temporarily unavailable', code: 'REMOTE_503' },
      request: { url: 'https://analytics.example.test/events', method: 'POST' },
      response: { statusCode: 503, body: { error: 'temporarily_unavailable' } },
    },
  ],
  request: {
    url: 'https://analytics.example.test/events',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: { visitId: 'visit-demo-2206', eventType: 'VISIT_COMPLETED' },
  },
  response: { statusCode: 503, headers: { 'content-type': 'application/json' }, body: { error: 'temporarily_unavailable' } },
  error: { message: 'Scheduling API temporarily unavailable', code: 'REMOTE_503', stack: 'Remote request returned HTTP 503' },
  vendorResponses: [
    {
      stage: 'primary',
      status: 'FAILED',
      timestamp: new Date(Date.now() - 93_000).toISOString(),
      provider: 'northstar-analytics',
      channel: 'HTTP',
      responseStatus: 503,
      messageId: 'vendor-demo-503',
      target: 'https://analytics.example.test/events',
      responseBody: { error: 'temporarily_unavailable' },
    },
  ],
};

const eventRecords = [
  {
    id: 'review-event-1',
    eventId: 'review-event-1',
    eventType: 'APPOINTMENT_CREATED',
    source: 'northstar-his',
    status: 'PROCESSED',
    receivedAt: now,
    createdAt: now,
    payload: { appointmentId: 'apt-demo-1042', department: 'Cardiology' },
    processedAt: now,
    deliveryCount: 1,
  },
];

const alertCenterLogs = [
  {
    id: 'review-alert-failure-1',
    tenantId: orgId,
    type: 'DELIVERY_FAILURE_REPORT',
    channel: 'EMAIL',
    status: 'FAILED',
    subject: 'Delivery failures detected',
    recipients: ['integration-ops@example.test'],
    totalFailures: 3,
    windowStart: now,
    windowEnd: now,
    errorMessage: 'The email provider rejected the report.',
    createdAt: now,
  },
];

const scheduledJob = {
  _id: 'review-job',
  id: 'review-job',
  orgId,
  name: 'Daily Integration Health Summary',
  type: 'SCRIPT_JOB',
  direction: 'SCRIPT_JOB',
  isActive: true,
  runtime: 'VM_SANDBOX',
  script: "const rows = await mysql.query('SELECT 1'); return rows;",
  schedule: { type: 'CRON', expression: '0 7 * * *', timezone: 'America/Chicago' },
  environmentVariables: [{ key: 'REPORT_RECIPIENT', secretKey: 'REPORT_RECIPIENT', isSecret: true }],
  dependencies: [],
  updatedAt: now,
};

const templates = [
  {
    id: 'review-template',
    name: 'Appointment Confirmation',
    description: 'A concise appointment confirmation message.',
    category: 'Messaging',
    eventType: 'APPOINTMENT_CONFIRMED',
    targetUrl: 'https://api.example.test/events/appointments',
    httpMethod: 'POST',
    channel: 'EMAIL',
    isActive: true,
    metadata: { vendor: 'Northstar Messaging' },
    updatedAt: now,
  },
];

const lookups = [
  {
    id: 'review-lookup',
    name: 'Department Code Map',
    keyField: 'sourceCode',
    valueField: 'departmentName',
    rowCount: 42,
    isActive: true,
    updatedAt: now,
  },
];
const roleDefinitions = [
  {
    role: 'SUPER_ADMIN',
    name: 'Platform Administrator',
    description: 'Full access across the platform',
    scope: 'global',
    isCustom: false,
    features: {
      dashboard: ['read', 'export'],
      integrations: ['read', 'write', 'delete', 'execute'],
      logs: ['read', 'export', 'delete'],
      events: ['read', 'write', 'delete'],
      settings: ['read', 'write', 'configure'],
      users: ['read', 'write', 'delete'],
      audit_logs: ['read', 'export'],
      api_keys: ['read', 'write', 'delete'],
    },
  },
  {
    role: 'ADMIN',
    name: 'Administrator',
    description: 'Manage platform operations',
    scope: 'global',
    isCustom: false,
    features: {
      dashboard: ['read', 'export'],
      integrations: ['read', 'write', 'delete', 'execute'],
      logs: ['read', 'export'],
      events: ['read', 'write'],
      users: ['read', 'write'],
      audit_logs: ['read', 'export'],
      api_keys: ['read', 'write', 'delete'],
    },
  },
  {
    role: 'ORG_ADMIN',
    name: 'Organization Admin',
    description: 'Manage one organization',
    scope: 'organization',
    isCustom: false,
    features: {
      dashboard: ['read', 'export'],
      integrations: ['read', 'write', 'delete', 'execute'],
      logs: ['read', 'export'],
      events: ['read', 'write'],
      settings: ['read'],
      users: ['read', 'write'],
      api_keys: ['read', 'write', 'delete'],
    },
  },
];
const systemLogs = [
  {
    timestamp: now,
    level: 'error',
    message: '[POLL #1248] Delivery worker received a temporary 502 from the scheduling service',
    meta: { pollId: '1248', integration: outbound[0].name, statusCode: 502 },
    category: 'api_error',
    source: 'server',
    stream: 'app',
    errorCategory: 'http_5xx',
  },
  {
    timestamp: new Date(Date.now() - 90_000).toISOString(),
    level: 'warn',
    message: '[POLL #1248] Retrying appointment delivery after provider timeout',
    meta: { pollId: '1248', integration: outbound[0].name, attempt: 2 },
    category: 'business_logic',
    source: 'server',
    stream: 'app',
    errorCategory: 'other',
  },
  {
    timestamp: new Date(Date.now() - 180_000).toISOString(),
    level: 'info',
    message: '[POLL #1247] Scheduler poll completed; 18 events processed',
    meta: { pollId: '1247', eventsProcessed: 18, retriesProcessed: 0 },
    category: 'business_logic',
    source: 'server',
    stream: 'app',
  },
  {
    timestamp: new Date(Date.now() - 240_000).toISOString(),
    level: 'info',
    message: 'POST /api/v1/events returned 202',
    meta: { method: 'POST', path: '/api/v1/events', statusCode: 202, remoteAddress: '192.0.2.24' },
    source: 'server',
    stream: 'access',
  },
];
const sampleActivity = {
  _id: 'review-activity-1',
  timestamp: now,
  event: 'integration.updated',
  category: 'administration',
  userId: 'review-admin',
  userEmail: 'review.admin@example.test',
  userRole: 'SUPER_ADMIN',
  orgId,
  page: '/integrations/review-outbound',
  feature: 'integrations',
  action: 'updated',
  target: { id: outbound[0].id, name: outbound[0].name },
  changes: { before: { isActive: false }, after: { isActive: true } },
  duration: 184,
  ipAddress: '192.0.2.24',
  userAgent: 'Review fixture browser',
  success: true,
  errorMessage: null,
  metadata: { source: 'local-review-fixture' },
  sessionId: 'review-session-1',
  date: now.slice(0, 10),
  hour: new Date(now).getHours(),
};
const scheduledIntegration = {
  id: 'review-scheduled-1',
  __KEEP___KEEP_integrationConfig__Id__: outbound[0].id,
  __KEEP_integrationName__: outbound[0].name,
  integrationConfigId: outbound[0].id,
  integrationName: outbound[0].name,
  tenantId: orgId,
  orgId,
  originalEventId: 'review-event-1',
  eventType: 'APPOINTMENT_CREATED',
  scheduledFor: new Date(Date.now() + 3_600_000).toISOString(),
  status: 'PENDING',
  payload: { appointmentId: 'apt-demo-1042' },
  targetUrl: outbound[0].targetUrl,
  httpMethod: 'POST',
  attemptCount: 0,
  createdAt: now,
};
const failedScheduledIntegration = {
  ...scheduledIntegration,
  id: 'review-scheduled-failed',
  originalEventId: 'review-event-failed-1',
  eventType: 'VISIT_COMPLETED',
  scheduledFor: new Date(Date.now() - 1_800_000).toISOString(),
  status: 'FAILED',
  attemptCount: 3,
  errorMessage: 'The scheduling endpoint returned a temporary failure.',
};

const asArrayPage = (rows) => ({ data: rows, pagination: { page: 1, limit: 20, total: rows.length, pages: 1 } });
const emptyStats = { total: 2, success: 1, failed: 1, queued: 0, successRate: 50, averageResponseTime: 1592 };

function respond(pathname, searchParams) {
  if (pathname === '/auth/portal/launch')
    return {
      accessToken: 'local-review-portal-access-token',
      refreshToken: 'local-review-portal-refresh-token',
      expiresIn: '1h',
      profile: {
        id: 'review-profile',
        orgId,
        role: 'VIEWER',
        allowedIntegrationIds: [],
        allowedTags: [],
        allowedViews: ['dashboard', 'logs'],
      },
    };
  if (pathname === '/auth/login')
    return {
      accessToken: 'local-review-fixture-token',
      user: { id: 'review-admin', email: 'review.admin@example.test', role: 'SUPER_ADMIN', orgId },
    };
  if (pathname === '/auth/me')
    return {
      accessToken: 'local-review-fixture-token',
      user: { id: 'review-admin', email: 'review.admin@example.test', role: 'SUPER_ADMIN', orgId },
    };
  if (pathname === '/tenant') return tenant;
  if (pathname === '/dashboard')
    return {
      totalDeliveries24h: 1284,
      successRate24h: 99.1,
      failedCount24h: 3,
      avgResponseTimeMs24h: 284,
      integrationHealth: outbound.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.isActive ? 'GREEN' : 'YELLOW',
        failureCount24h: item.isActive ? 0 : 3,
      })),
      recentFailures: logs.filter((item) => item.status === 'FAILED'),
    };
  if (pathname === '/outbound-integrations') return outbound;
  if (pathname === '/outbound-integrations/event-types')
    return { eventTypes: ['APPOINTMENT_CREATED', 'VISIT_COMPLETED'] };
  if (pathname === '/outbound-integrations/review-outbound') return outbound[0];
  if (pathname === '/integration-history/review-outbound/revisions')
    return {
      integration: { id: 'review-outbound', name: outbound[0].name, direction: 'OUTBOUND' },
      revisions: [
        { revision: 3, source: 'UPDATED', restoredFrom: null, changedBy: { id: 'review-admin', email: 'review.admin@example.test' }, changedFields: ['targetUrl', 'timeoutMs'], createdAt: now },
        { revision: 2, source: 'UPDATED', restoredFrom: null, changedBy: { id: 'review-admin', email: 'review.admin@example.test' }, changedFields: ['retryCount'], createdAt: new Date(Date.now() - 86_400_000).toISOString() },
        { revision: 1, source: 'CREATED', restoredFrom: null, changedBy: null, changedFields: [], createdAt: new Date(Date.now() - 172_800_000).toISOString() },
      ],
    };
  if (pathname === '/integration-history/review-outbound/revisions/2/diff')
    return {
      from: 2,
      to: 'current',
      changes: [{ path: 'retryCount', kind: 'changed', before: 2, after: 3 }],
      fromSnapshot: {},
      toSnapshot: {},
    };
  if (pathname === '/outbound-integrations/follow-up-preset') return { preset: null };
  if (pathname === '/outbound-integrations/review-outbound/test-follow-up')
    return {
      outcome: 'RESULT',
      durationMs: 12,
      result: { status: 'DELIVERED', done: true },
      httpCalls: [{ method: 'GET', url: 'https://status.example.test/messages/1042', statusCode: 200, durationMs: 9 }],
    };
  if (pathname === '/stages/runners')
    return {
      runners: [
        {
          type: 'script',
          label: 'Script',
          description: 'Run a script step.',
          hooks: ['before_send', 'after_response', 'after_delivery', 'on_failure'],
          configSchema: { fields: [] },
        },
      ],
    };
  if (pathname === '/stages/templates') return { templates: [] };
  if (pathname === '/stages/runtime') return { ready: true, mode: 'worker', isolated: true, problems: [] };
  if (pathname === '/inbound-integrations') return [inbound];
  if (pathname === '/inbound-integrations/review-inbound') return inbound;
  if (pathname === '/logs') return asArrayPage(logs);
  if (pathname === '/logs/stats/summary') return { ...emptyStats, byStatus: { SUCCESS: 1, FAILED: 1 } };
  if (pathname === '/logs/stats/delivery-follow-up') return { total: 0, pending: 0, completed: 0, failed: 0 };
  if (pathname === '/logs/review-log-1' || pathname === '/logs/review-log-2')
    return logs.find((row) => row.id === pathname.split('/').pop());
  if (pathname === '/events') return { events: eventRecords, total: 1, pages: 1, page: 1 };
  if (pathname === '/events/stats')
    return {
      total: 1,
      delivered: 1,
      skipped: 0,
      failed: 0,
      stuck: 0,
      processed: 1,
      bySource: [{ source: 'northstar-his', count: 1 }],
    };
  if (pathname === '/events/checkpoints') return [{ source: 'northstar-his', lastSequence: 234, updatedAt: now }];
  if (pathname === '/events/gaps') return { gaps: [], total: 0 };
  if (pathname === '/events/review-event-1') return eventRecords[0];
  if (pathname === '/field-schemas/event-types')
    return {
      eventTypes: [
        {
          eventType: 'APPOINTMENT_CREATED',
          orgId: null,
          label: 'Appointment Created',
          category: 'Scheduling',
          description: 'An appointment was created.',
          implementationClass: 'AppointmentCreatedEvent',
          fields: [
            {
              name: 'appointmentId',
              path: 'appointmentId',
              type: 'string',
              required: true,
              description: 'Unique appointment identifier',
            },
            { name: 'start', path: 'start', type: 'datetime', required: true, description: 'Scheduled start time' },
          ],
          samplePayload: { appointmentId: 'appt-review-1042', start: '2026-11-23T15:30:00.000Z' },
          createdAt: now,
          updatedAt: now,
        },
        {
          eventType: 'VISIT_COMPLETED',
          orgId: null,
          label: 'Visit Completed',
          category: 'Visits',
          description: 'A visit was completed.',
          implementationClass: 'VisitCompletedEvent',
          fields: [
            {
              name: 'visitId',
              path: 'visitId',
              type: 'string',
              required: true,
              description: 'Unique visit identifier',
            },
          ],
          samplePayload: { visitId: 'visit-review-501', status: 'completed' },
          createdAt: now,
          updatedAt: now,
        },
      ],
      count: 2,
    };
  if (pathname === '/field-schemas')
    return {
      eventType: searchParams.get('eventType'),
      fields: [
        { name: 'appointmentId', type: 'string', required: true },
        { name: 'start', type: 'datetime' },
      ],
    };
  if (pathname === '/scheduled-jobs') return [scheduledJob];
  if (pathname === '/scheduled-jobs/review-job') return scheduledJob;
  if (pathname === '/scheduled-jobs/review-job/logs')
    return [
      { id: 'review-run-1', status: 'SUCCESS', startedAt: now, durationMs: 1240, message: 'Report sent successfully.' },
    ];
  if (pathname === '/scheduled-integrations/stats')
    return { stats: { total: 8, pending: 3, overdue: 1, sent: 4, failed: 1, cancelled: 0 } };
  if (pathname === '/scheduled-integrations')
    return { scheduledIntegrations: [scheduledIntegration, failedScheduledIntegration] };
  if (pathname === '/alert-center') {
    const status = searchParams.get('status');
    const channel = searchParams.get('channel');
    const type = searchParams.get('type');
    const search = (searchParams.get('search') || '').toLowerCase();
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const limit = Number(searchParams.get('limit')) || 100;
    const filtered = alertCenterLogs.filter((log) => {
      if (status && log.status !== status) return false;
      if (channel && log.channel !== channel) return false;
      if (type && log.type !== type) return false;
      if (startDate && new Date(log.createdAt) < new Date(startDate)) return false;
      if (endDate && new Date(log.createdAt) > new Date(endDate)) return false;
      if (
        search &&
        ![log.subject, log.type, log.channel, log.errorMessage, ...(log.recipients || [])]
          .join(' ')
          .toLowerCase()
          .includes(search)
      )
        return false;
      return true;
    });
    return { logs: filtered.slice(0, limit) };
  }
  if (pathname === '/alert-center/status')
    return {
      enabled: true,
      intervalMinutes: 5,
      lookbackMinutes: 15,
      minFailures: 3,
      maxItems: 50,
      lastRunAt: now,
      nextRunAt: now,
      lastRunLog: null,
    };
  if (pathname.startsWith('/alert-center/stats')) return { total: 8, sent: 7, failed: 1, skipped: 0 };
  if (pathname === '/templates/catalog')
    return {
      templates: [
        {
          id: 'appointment-webhook',
          name: 'Appointment webhook',
          description: 'Send appointment events to an HTTP endpoint.',
          category: 'Scheduling',
          direction: 'OUTBOUND',
          inputs: [
            { key: 'targetUrl', label: 'Target URL', type: 'url', required: true },
            { key: 'eventType', label: 'Event type', type: 'eventType', required: true },
          ],
        },
        {
          id: 'crm-event-receiver',
          name: 'CRM event receiver',
          description: 'Receive signed events from a CRM service.',
          category: 'CRM',
          direction: 'INBOUND',
          inputs: [{ key: 'signingSecret', label: 'Signing secret', type: 'secret', required: true }],
        },
      ],
    };
  if (pathname === '/templates') return templates;
  if (pathname === '/templates/review-template') return templates[0];
  if (pathname === '/lookups')
    return {
      success: true,
      data: [
        {
          id: 'review-lookup-row',
          orgId,
          orgUnitRid: null,
          type: 'department',
          source: { id: 'CARD', label: 'Cardiology source code' },
          target: { id: 'CARDIO', label: 'Cardiology' },
          isActive: true,
          version: 1,
          usageCount: 28,
          lastUsedAt: now,
          createdAt: now,
          updatedAt: now,
        },
      ],
      count: 42,
    };
  if (pathname === '/lookups/stats')
    return {
      success: true,
      data: {
        totalMappings: 42,
        activeParent: 42,
        activeEntity: 0,
        typesCount: 1,
        mostUsedTypes: [{ type: 'department', count: 28 }],
        recentActivity: [],
      },
    };
  if (pathname === '/lookups/types') return { success: true, data: ['department'] };
  if (pathname === '/lookups/review-lookup')
    return {
      success: true,
      data: {
        ...lookups[0],
        orgId,
        orgUnitRid: null,
        type: 'department',
        source: { id: 'CARD', label: 'Cardiology source code' },
        target: { id: 'CARDIO', label: 'Cardiology' },
        isActive: true,
        version: 1,
        usageCount: 28,
        lastUsedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    };
  if (pathname === '/providers')
    return {
      items: [
        {
          id: 'review-provider',
          orgId,
          name: 'Northstar Scheduling',
          slug: 'northstar-scheduling',
          description: 'Scheduling integration provider',
          isActive: true,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
  if (pathname === '/sender-profiles') return { items: [] };
  if (pathname === '/alert-channels')
    return {
      channels: [
        {
          id: 'review-alert-channel',
          type: 'EMAIL',
          name: 'Platform operations',
          enabled: true,
          events: ['DELIVERY_FAILED', 'INTEGRATION_DISABLED'],
          config: { recipients: 'ops@example.test' },
          lastResult: { ok: true, at: new Date(Date.now() - 1_800_000).toISOString(), alertType: 'DELIVERY_FAILED' },
        },
      ],
    };
  if (pathname === '/alert-channels/plugins') return { plugins: [] };
  if (pathname === '/api-keys')
    return {
      data: [
        {
          id: 'review-api-key-1',
          name: 'Nightly report job',
          prefix: 'ig_live_demo',
          role: 'SUPER_ADMIN',
          orgId,
          createdBy: 'review-admin',
          createdAt: now,
          lastUsedAt: new Date(Date.now() - 3_600_000).toISOString(),
          revokedAt: null,
        },
      ],
    };
  if (pathname === '/config/ui')
    return {
      httpMethods: ['POST', 'PUT', 'PATCH', 'GET', 'DELETE'].map((value) => ({ value, label: value })),
      authTypes: ['NONE', 'API_KEY', 'BASIC', 'BEARER', 'OAUTH2', 'CUSTOM', 'CUSTOM_HEADERS'].map((value) => ({
        value,
        label: value,
      })),
      scopeTypes: [
        { value: 'ENTITY_ONLY', label: 'Entity only' },
        { value: 'INCLUDE_CHILDREN', label: 'Include children' },
      ],
      deliveryStatuses: [],
      transformationModes: [
        { value: 'NONE', label: 'None' },
        { value: 'SCRIPT', label: 'Script' },
      ],
      validationRules: {
        timeout: { min: 500, max: 60000, default: 5000, step: 500, label: 'Timeout', description: 'Request timeout' },
        retry: { min: 0, max: 10, default: 3, step: 1, label: 'Retries', description: 'Retry attempts' },
      },
      pagination: { defaultPageSize: 20, pageSizeOptions: [10, 20, 50] },
    };
  if (pathname.startsWith('/config/ui/')) return { override: null };
  if (pathname === '/config/ui/entity') return {};
  if (pathname === '/event-sources/33')
    return {
      type: 'http_push',
      isActive: true,
      config: { pollIntervalMs: 1000, batchSize: 10, maxAttempts: 5, staleAfterMs: 300000 },
      updatedAt: now,
    };
  if (pathname === '/event-sources/33/columns') return { columns: ['id', 'eventType', 'payload', 'createdAt'] };
  if (pathname === '/admin/ui-config') return { config: {} };
  if (pathname === '/admin/system-config') return { config: {} };
  if (pathname === '/admin/mysql-pool')
    return { maxPoolSize: 20, minPoolSize: 2, idleTimeoutMs: 30000, connectionTimeoutMs: 10000 };
  if (pathname === '/admin/storage-stats')
    return {
      db: {
        collections: 18,
        dataSize: 12_400_000,
        storageSize: 18_000_000,
        indexSize: 5_600_000,
        objects: 48200,
        avgObjSize: 257,
      },
      collections: [
        {
          name: 'delivery_logs',
          label: 'Delivery logs',
          count: 18240,
          dataSize: 4_800_000,
          storageSize: 6_200_000,
          indexSize: 1_600_000,
          totalSize: 7_800_000,
          avgObjSize: 263,
          percentOfTotal: 43.3,
        },
        {
          name: 'integrations',
          label: 'Integrations',
          count: 680,
          dataSize: 2_100_000,
          storageSize: 3_400_000,
          indexSize: 850_000,
          totalSize: 4_250_000,
          avgObjSize: 3088,
          percentOfTotal: 23.6,
        },
        {
          name: 'event_queue',
          label: 'Event queue',
          count: 9200,
          dataSize: 1_700_000,
          storageSize: 2_600_000,
          indexSize: 720_000,
          totalSize: 3_320_000,
          avgObjSize: 184,
          percentOfTotal: 18.1,
        },
      ],
      isOrgView: false,
      generatedAt: now,
    };
  if (pathname === '/admin/roles') return { roles: roleDefinitions };
  if (pathname === '/admin/orgs/summary')
    return {
      orgs: [
        { orgId, name: tenant.tenantName, code: tenant.tenantCode, isActive: true, userCount: 12, integrationCount: 6 },
      ],
    };
  if (pathname === '/admin/orgs')
    return { orgs: [{ orgId, name: tenant.tenantName, code: tenant.tenantCode, isActive: true, createdAt: now }] };
  if (pathname === '/admin/users')
    return {
      users: [
        {
          id: 'review-user',
          name: 'Alex Morgan',
          email: 'alex.morgan@example.test',
          role: 'ORG_ADMIN',
          orgId,
          isActive: true,
          lastLoginAt: now,
        },
      ],
      total: 1,
      page: 1,
      limit: 20,
    };
  if (pathname === '/admin/rate-limits')
    return {
      items: [{ id: 'review-limit', orgId, name: 'Default API policy', limit: 120, windowSeconds: 60, updatedAt: now }],
      total: 1,
    };
  if (pathname === '/admin/audit/logs')
    return {
      logs: [
        {
          _id: 'review-audit-1',
          timestamp: now,
          action: 'integration.updated',
          resourceType: 'integration',
          resourceId: outbound[0].id,
          userEmail: 'review.admin@example.test',
          userRole: 'SUPER_ADMIN',
          orgId,
          success: true,
          metadata: { name: outbound[0].name },
        },
      ],
      pagination: { page: 1, limit: 50, total: 1, totalPages: 1 },
    };
  if (pathname === '/admin/audit/stats')
    return {
      totalLogs: 1,
      failedActions: 0,
      successRate: '100.00',
      actionsByType: [{ action: 'integration.updated', count: 1 }],
      topUsers: [{ userId: 'review-admin', userEmail: 'review.admin@example.test', count: 1 }],
    };
  if (pathname === '/admin/audit/action-types') return { actionTypes: ['integration.updated', 'user.login'] };
  if (pathname === '/admin/audit/resource-types') return { resourceTypes: ['integration', 'user'] };
  if (pathname === '/admin/audit/activities')
    return { activities: [sampleActivity], pagination: { page: 1, limit: 50, total: 1, totalPages: 1 } };
  if (pathname === '/admin/audit/activities/stats')
    return {
      totalActivities: 1248,
      uniqueUsers: 18,
      eventsByType: [
        { event: 'integration.updated', count: 286 },
        { event: 'user.login', count: 212 },
      ],
      activitiesByCategory: [
        { category: 'administration', count: 402 },
        { category: 'authentication', count: 212 },
      ],
      topPages: [{ page: '/integrations', count: 321 }],
      topFeatures: [{ feature: 'integrations', count: 468 }],
      hourlyActivity: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour >= 8 && hour <= 17 ? 72 : 18 })),
    };
  if (pathname === '/admin/audit/activity-events') return { events: ['user.login', 'page.view'] };
  if (pathname === '/admin/audit/activity-categories') return { categories: ['authentication', 'navigation'] };
  if (pathname.startsWith('/admin/audit'))
    return { logs: [], pagination: { page: 1, limit: 50, total: 0, totalPages: 0 } };
  if (pathname === '/system-logs') {
    const source = searchParams.get('source') || 'app';
    const level = searchParams.get('level');
    const search = (searchParams.get('search') || '').toLowerCase();
    const pollId = searchParams.get('pollId');
    const errorCategory = searchParams.get('errorCategory');
    const allLogs = systemLogs.filter((log) => source === 'all' || log.stream === source);
    const filtered = allLogs.filter(
      (log) =>
        (!level || log.level === level) &&
        (!search || `${log.message} ${JSON.stringify(log.meta)}`.toLowerCase().includes(search)) &&
        (!pollId || log.meta.pollId === pollId) &&
        (!errorCategory || log.errorCategory === errorCategory)
    );
    const count = (key) => allLogs.filter((log) => log.level === key).length;
    return {
      logs: filtered,
      displayed: filtered.length,
      totalInPeriod: allLogs.length,
      limit: Number(searchParams.get('limit')) || 200,
      filters: { source, level, search, pollId, errorCategory },
      stats: {
        total: allLogs.length,
        error: count('error'),
        warn: count('warn'),
        info: count('info'),
        debug: count('debug'),
        byStream: {
          app: systemLogs.filter((log) => log.stream === 'app').length,
          access: systemLogs.filter((log) => log.stream === 'access').length,
        },
        errorCategories: { http_5xx: 1, other: 1 },
      },
      pollStats: { total: 2, withErrors: 1, withWarnings: 0, healthy: 1 },
    };
  }
  if (pathname === '/system-status') {
    const selectedOrgId = Number(searchParams.get('orgId')) || orgId;
    const isGlobal = !searchParams.has('orgId');
    const summary = {
      deliveries24h: 1284,
      successRate24h: 99.4,
      failed24h: 3,
      pendingCount: 6,
      retryingCount: 2,
      p95ResponseTimeMs: 620,
    };
    const organizationRows = [
      {
        orgId,
        name: tenant.tenantName,
        code: tenant.tenantCode,
        status: 'healthy',
        alertCount: { total: 0, critical: 0, warning: 0, info: 0 },
        summary,
        eventSources: {
          configured: true,
          sourceType: 'mysql',
          state: 'connected',
          adapterStatus: 'connected',
          summary: { rowsFetched: 1842 },
        },
      },
      {
        orgId: 42,
        name: 'Harborview Medical Group',
        code: 'HMG-042',
        status: 'warning',
        alertCount: { total: 1, critical: 0, warning: 1, info: 0 },
        summary: { ...summary, failed24h: 8, successRate24h: 98.1 },
        eventSources: {
          configured: true,
          sourceType: 'webhook',
          state: 'connected',
          adapterStatus: 'connected',
          summary: { eventsReceived: 742 },
        },
      },
      {
        orgId: 57,
        name: 'Cedar Valley Clinics',
        code: 'CVC-057',
        status: 'critical',
        alertCount: { total: 2, critical: 1, warning: 1, info: 0 },
        summary: { ...summary, failed24h: 34, successRate24h: 94.8 },
        eventSources: {
          configured: false,
          sourceType: null,
          state: 'not_configured',
          adapterStatus: null,
          summary: {},
        },
      },
    ];
    return {
      timestamp: now,
      scope: isGlobal ? 'global' : 'org',
      orgId: isGlobal ? null : selectedOrgId,
      overall: {
        status: 'warning',
        alertCount: { total: isGlobal ? 3 : 0, critical: isGlobal ? 1 : 0, warning: isGlobal ? 2 : 0, info: 0 },
        summary,
      },
      globalSummary: {
        organizationCount: organizationRows.length,
        organizationStatusCounts: { healthy: 1, warning: 1, critical: 1 },
        eventSourceConfiguredCount: 2,
        eventSourceNotConfiguredCount: 1,
      },
      organizations: organizationRows,
      process: {
        appVersion: '2.4.1',
        pid: 2481,
        nodeVersion: 'v20.19.2',
        platform: 'linux',
        arch: 'x64',
        environment: 'review',
        startedAt: new Date(Date.now() - 86_400_000).toISOString(),
        uptime: { uptime: 86400, formatted: '1 day' },
        memory: {
          stats: {
            nodeHeapUsedMB: 184,
            nodeHeapLimitMB: 512,
            nodeHeapUsagePercent: 36,
            processRssMB: 326,
            hostUsagePercent: 42,
          },
          report: {},
        },
        host: { hostname: 'review-gateway-01', loadAverage: [0.24, 0.31, 0.28], totalMemoryBytes: 8_589_934_592, freeMemoryBytes: 4_294_967_296 },
        mysql: { available: true, status: 'connected' },
      },
      processLifecycle: {
        current: {
          status: 'running', pid: 2481, startedAt: now, updatedAt: now, stoppedAt: null,
          reason: null, allowNaturalExit: false, naturalExitExpected: false, error: null,
        },
        abruptRestart: {
          detected: false, detectedAt: null, previousPid: null, previousStatus: null,
          previousStartedAt: null, previousUpdatedAt: null, previousReason: null,
        },
      },
      workers: {
        summary: { total: 3, healthy: 3, stale: 0, stopped: 0, disabled: 0 },
        items: [
          { workerName: 'delivery-worker', displayName: 'Delivery worker', status: 'healthy', lastHeartbeat: now, lastSuccessAt: now, lastErrorMessage: null, meta: { concurrency: 8, queue: 'deliveries' } },
          { workerName: 'scheduled-job-worker', displayName: 'Scheduled job worker', status: 'healthy', lastHeartbeat: now, lastSuccessAt: now, lastErrorMessage: null, meta: { concurrency: 4, jobs: 12 } },
          { workerName: 'retry-worker', displayName: 'Retry worker', status: 'healthy', lastHeartbeat: now, lastSuccessAt: now, lastErrorMessage: null, meta: { concurrency: 4, retries: 2 } },
        ],
      },
      traffic: {
        deliveries: { last5m: 24, last15m: 81, last60m: 302, last24h: 1284 },
        inboundEvents: { last60m: 226, last24h: 901 },
        directionMixLast60m: { outbound: 302, inbound: 226 },
      },
      backlogs: {
        pendingDeliveries: { immediate: 4, scheduled: 2 },
        dlq: { pending: 1 },
        scheduledIntegrations: { due: 3, running: 1 },
      },
      scheduledJobs: {
        summary: { total: 12, active: 10, inactive: 2, cron: 8, interval: 4 },
        worker: { running: true, loadedTasks: 10 },
        recentExecutions: [
          { integrationId: 'review-job-1', integrationName: 'Daily appointment sync', status: 'success', startedAt: now, completedAt: now, durationMs: 428, recordsFetched: 184, correlationId: 'review-correlation-1' },
          { integrationId: 'review-job-2', integrationName: 'Provider directory refresh', status: 'failed', startedAt: now, completedAt: now, durationMs: 1104, recordsFetched: 0, correlationId: 'review-correlation-2' },
        ],
      },
      senderProfiles: {
        summary: { total: 5, active: 4, inactive: 1, defaultCount: 2, organizationCount: 3, providers: { smtp: 3, ses: 2 } },
        defaultProfile: { id: 'review-sender-1', orgId: selectedOrgId, key: 'primary', name: 'Northstar Notifications', fromEmail: 'notifications@example.test', aliases: ['appointments@example.test'], provider: 'smtp', isDefault: true, isActive: true, createdAt: now, updatedAt: now },
        items: [
          { id: 'review-sender-1', orgId: selectedOrgId, key: 'primary', name: 'Northstar Notifications', fromEmail: 'notifications@example.test', aliases: ['appointments@example.test', 'reminders@example.test'], provider: 'smtp', isDefault: true, isActive: true, createdAt: now, updatedAt: now },
          { id: 'review-sender-2', orgId: selectedOrgId, key: 'billing', name: 'Billing Notices', fromEmail: 'billing@example.test', aliases: [], provider: 'ses', isDefault: false, isActive: true, createdAt: now, updatedAt: now },
        ],
      },
      eventSources: {
        manager: { adapterCount: 2, refreshIntervalMs: 30000, lastSyncStartedAt: now, lastSyncFinishedAt: now, lastSyncErrorAt: null, lastSyncErrorMessage: null },
        configuration: { configured: !isGlobal, sourceType: isGlobal ? null : 'mysql', configOrigin: isGlobal ? null : 'organization', state: isGlobal ? 'unknown' : 'running', error: null },
        summary: { connected: 2 },
        orgAdapters: isGlobal ? [] : [
          { orgId: selectedOrgId, sourceType: 'mysql', name: 'Appointments poller', connected: true, topic: 'appointments', table: 'appointment_events', lastMessageAt: now, lastSuccessAt: now, lastRowsFetched: 18, lastCheckpoint: 39218, reconnectAttempt: 0, connectionProbe: { ok: true, responseTimeMs: 18 } },
        ],
      },
      logs: {
        directory: '/var/log/integration-gateway',
        app: { status: 'healthy', found: true, fileName: 'gateway.log', modifiedAt: now, ageSeconds: 8, sizeBytes: 3_285_010 },
        access: { status: 'healthy', found: true, fileName: 'access.log', modifiedAt: now, ageSeconds: 12, sizeBytes: 1_284_440 },
      },
      alerts: isGlobal
        ? [
            { type: 'organization', severity: 'critical', message: 'Cedar Valley Clinics has no event source configured.' },
            { type: 'delivery', severity: 'warning', message: 'Elevated delivery failures at Harborview Medical Group.' },
          ]
        : [],
      checks: { api: { status: 'healthy', durationMs: 18 }, database: { status: 'healthy', durationMs: 24 } },
    };
  }
  if (pathname === '/analytics/overview')
    return {
      summary: { total: 1284, successful: 1271, failed: 3, skipped: 10, retrying: 0, pending: 0, successRate: 99.0 },
      performance: { avgResponseTime: 284, p95ResponseTime: 620, totalRequests: 1284 },
      eventTypes: {
        APPOINTMENT_CREATED: { total: 842, successful: 838, failed: 2 },
        VISIT_COMPLETED: { total: 442, successful: 433, failed: 1 },
      },
      integrationPerformance: outbound.map((item, index) => ({
        id: item.id,
        name: item.name,
        total: index ? 442 : 842,
        successful: index ? 433 : 838,
        failed: 1,
        skipped: 4,
        successRate: index ? 98.0 : 99.5,
        avgResponseTime: index ? 310 : 184,
      })),
    };
  if (pathname === '/analytics/timeseries')
    return {
      data: [
        { timestamp: new Date(Date.now() - 3_600_000).toISOString(), total: 72, successful: 70, failed: 1, skipped: 1 },
        { timestamp: now, total: 84, successful: 82, failed: 1, skipped: 1 },
      ],
    };
  if (pathname === '/analytics/performance')
    return {
      metrics: { avgResponseTime: 284, p50: 180, p95: 620, p99: 920 },
      distribution: {
        buckets: [
          { label: '0-250 ms', count: 821 },
          { label: '250-500 ms', count: 390 },
          { label: '500+ ms', count: 73 },
        ],
      },
      data: [{ name: 'Scheduling', averageResponseTime: 184, p95: 420 }],
    };
  if (pathname === '/analytics/errors')
    return {
      summary: {
        errorCategories: { REMOTE_5XX: 1, TIMEOUT: 2 },
        topErrors: [{ category: 'REMOTE_5XX', count: 1, message: 'Remote service temporarily unavailable' }],
      },
      topErrors: [{ category: 'REMOTE_5XX', count: 1, message: 'Remote service temporarily unavailable' }],
      integrationBreakdown: [{ name: outbound[1].name, failed: 1 }],
    };
  if (pathname === '/dlq/stats')
    return { success: true, data: { total: 1, pending: 1, retrying: 0, resolved: 0, abandoned: 0 } };
  if (pathname === '/dlq') {
    const status = searchParams.get('status');
    const direction = searchParams.get('direction');
    const errorCategory = searchParams.get('errorCategory');
    const matches = (!status || reviewDlqEntry.status === status)
      && (!direction || reviewDlqEntry.direction === direction)
      && (!errorCategory || reviewDlqEntry.error.category === errorCategory);
    return {
      success: true,
      data: matches ? [reviewDlqEntry] : [],
      pagination: { total: matches ? 1 : 0, limit: Number(searchParams.get('limit')) || 20, offset: 0, hasMore: false },
    };
  }
  if (pathname === '/dlq/review-dlq-1') return { success: true, data: reviewDlqEntry };
  if (pathname === '/execution-logs/review-trace-1/timeline') return { success: true, data: reviewTrace };
  if (pathname.startsWith('/dlq/')) return { success: true, data: [] };
  if (pathname.startsWith('/versions/integration/') && pathname.endsWith('/versions'))
    return {
      versions: [
        {
          id: outbound[0].id,
          name: outbound[0].name,
          version: '1.0.0',
          isActive: true,
          isDefault: true,
          compatibilityMode: 'BACKWARD_COMPATIBLE',
          createdAt: now,
          updatedAt: now,
        },
      ],
      summary: { integrationName: outbound[0].name, totalVersions: 1, activeVersions: 1 },
      pagination: { limit: 50, hasMore: false },
    };
  if (pathname.startsWith('/versions/integration/') && pathname.endsWith('/compatibility'))
    return {
      versions: [],
      compatibleVersions: [],
      incompatibleVersions: [],
      summary: { totalVersions: 1, activeVersions: 1, defaultVersion: '1.0.0' },
    };
  if (pathname.startsWith('/versions/'))
    return { versions: [], items: [], currentVersion: null, integrationName: 'Appointment Created to Scheduling' };
  if (pathname.startsWith('/admin/'))
    return { items: [], users: [], orgs: [], roles: [], total: 0, page: 1, limit: 20 };
  if (pathname.startsWith('/lookups/')) return { items: [], data: [], rows: [], columns: [], total: 0 };
  return {};
}

const api = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  const pathname = url.pathname.replace(/^\/api\/v1/, '');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': '*',
    });
    return res.end();
  }
  const body = JSON.stringify(respond(pathname, url.searchParams));
  res.writeHead(200, {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
});

const apiPort = Number(process.env.REVIEW_API_PORT || 3546);
const appPort = Number(process.env.REVIEW_APP_PORT || 5177);
api.listen(apiPort, '127.0.0.1');
process.env.VITE_API_BASE_URL = `http://127.0.0.1:${apiPort}/api/v1`;
process.env.VITE_API_BASE_URL_val = '';
const vite = await createServer({ server: { host: '127.0.0.1', port: appPort, strictPort: true } });
await vite.listen();
console.log(`Sanitized UI review app: http://127.0.0.1:${appPort}/integration-gateway/dashboard?orgId=33`);
console.log(`Synthetic fixture API: http://127.0.0.1:${apiPort}/api/v1`);

const close = async () => {
  await vite.close();
  api.close();
  process.exit(0);
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
