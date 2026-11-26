import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  App,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Timeline,
  Divider,
  Grid,
  Dropdown,
  Modal,
  Skeleton,
  Tooltip,
  Drawer,
} from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { RetainedTabs, type RetainedTabItem } from '../../../components/common/RetainedTabs';
import { ModernTable } from '../../../components/common/ModernTable';
import { getStatusLabel, StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { StatPillRow } from '../../../components/common/StatPillRow';
import { DeliveryFollowUpPanel, FollowUpTag } from '../components/DeliveryFollowUpPanel';
import { buildStageTabItems, StageSummaryTags } from '../../stages/components/DeliveryStageTabs';
import { DeliveryFlow } from '../../stages/components/DeliveryFlow';
import { isLiveStatus } from '../utils/liveRun';
import { LiveRunNotice } from '../../../components/common/LiveRunNotice';
import { getDeliveryStages, type StageRun, type StageState } from '../../../services/stages-api';
import { DeliveryFollowUpSummary } from '../components/DeliveryFollowUpSummary';
import { FollowUpChecks } from '../components/FollowUpChecks';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';
import { StatePanel } from '../../../components/common/StatePanel';
import { SearchInput } from '../../../components/common/ListControls';
import {
  getLogs,
  getIntegrations,
  exportLogsToCsv,
  exportLogsToJson,
  exportSelectedLogs,
  getLogById,
  retryLog,
  bulkRetryLogs,
  bulkDeleteLogs,
  getEventTypes,
  getUIConfig,
  getUIConfigOverride,
  getLogStatsSummary,
  getDeliveryFollowUpStats,
  type PaginatedResponse,
  getIntegrationCredentials,
  getInboundIntegrationCredentials,
} from '../../../services/api';
import type { DeliveryLog } from '../../../mocks/types';
import { formatDateTime, formatDateTimeWithSeconds } from '../../../utils/format';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { getCallerInfo } from '../../../utils/caller';
import { CallerCard } from '../components/CallerCard';
import { createExportProgress } from '../../../utils/export-progress';
import { useDesignTokens, withAlpha, spacingToNumber, cssVar } from '../../../design-system/utils';
import { generateCurlCommand } from '../../../utils/curl';
import { usePermissions } from '../../../hooks/usePermissions';
import activityTracker, { ACTIVITY_EVENTS } from '../../../services/activity-tracker';
import { DeliveryTraceTimeline } from '../components/DeliveryTraceTimeline';
import { SourceEventPanel, hasSourceEvent } from '../components/SourceEventPanel';
import { usePaginatedTable } from '../../../hooks/usePaginatedTable';
import { useAuth } from '../../../app/auth-context';
import { useTenant } from '../../../app/tenant-context';
import { Hl7LogPanel, isHl7LogLike } from '../components/Hl7LogPanel';
import { LogCodeViewer } from '../components/LogCodeViewer';
import dayjs, { type Dayjs } from 'dayjs';
import { Button } from '../../../components/common/LegacyButton';
import { Text } from '@astryxdesign/core/Text';

const { RangePicker } = DatePicker;

// Helper to get today's date range as ISO start/end
const getTodayDateRange = (): [string, string] => {
  const start = dayjs().startOf('day').toISOString();
  const end = dayjs().endOf('day').toISOString();
  return [start, end];
};

/** Last N days inclusive of today, as ISO start/end. */
const getRangeForLastDays = (days: number): [string, string] => [
  dayjs()
    .subtract(days - 1, 'day')
    .startOf('day')
    .toISOString(),
  dayjs().endOf('day').toISOString(),
];

const formatForCodeBlock = (value: unknown): string => {
  if (value === null || value === undefined) return 'No response body';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (err) {
    return String(value);
  }
};

const maskSecret = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value) return null;
  if (value.length <= 4) return '****';
  return `${value.slice(0, 2)}${'*'.repeat(Math.max(4, value.length - 4))}${value.slice(-2)}`;
};

/** A script job that has not finished: its output is still being written and the drawer follows it. */
const isLiveScriptRun = (log: Partial<DeliveryLog> | null | undefined): boolean =>
  isScriptJobLogLike(log) && isLiveStatus(log?.status);

const LIVE_OUTPUT_POLL_MS = 3000;

const DAY_OF_WEEK_OPTIONS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SCHEDULED_TRIGGER_TYPES = new Set(['SCHEDULE', 'SCHEDULED']);

const isScriptJobLogLike = (log: Partial<DeliveryLog> | null | undefined): boolean => {
  if (!log) return false;
  const config = (log as any).__KEEP_integrationConfig__ || {};
  return (
    String(log.direction || '').toUpperCase() === 'SCRIPT_JOB' ||
    String(log.httpMethod || '').toUpperCase() === 'SCRIPT_JOB' ||
    String(config.direction || '').toUpperCase() === 'SCRIPT_JOB' ||
    String(config.jobType || '').toUpperCase() === 'SCRIPT_JOB' ||
    (String(config.runtime || '').toUpperCase() === 'NODE_PROCESS' && Boolean(config.script))
  );
};

const getScriptLogs = (log: any): Array<{ level: string; message: string; ts: string }> => {
  const direct = log?.metadata?.scriptLogs;
  if (Array.isArray(direct) && direct.length > 0) return direct;

  const fromSteps = Array.isArray(log?.steps)
    ? log.steps.flatMap((step: any) => (Array.isArray(step?.metadata?.scriptLogs) ? step.metadata.scriptLogs : []))
    : [];
  return fromSteps;
};

const deriveDateRangeFromDays = (value: string | null): [string, string] | null => {
  const parsedDays = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsedDays) || parsedDays <= 0) return null;
  const end = dayjs().endOf('day');
  const start =
    parsedDays <= 1
      ? dayjs().startOf('day')
      : dayjs()
          .subtract(parsedDays - 1, 'day')
          .startOf('day');
  return [start.toISOString(), end.toISOString()];
};

// Typing a date by hand is the slowest, most error-prone way to answer the
// questions people actually bring to this screen ("did it break today?",
// "what happened this week?"). One click covers almost all of them.
const DATE_RANGE_PRESETS = [
  {
    label: 'Today',
    value: () => [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: 'Yesterday',
    value: () => [dayjs().subtract(1, 'day').startOf('day'), dayjs().subtract(1, 'day').endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: 'Last 7 days',
    value: () => [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: 'Last 30 days',
    value: () => [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
  {
    label: 'This month',
    value: () => [dayjs().startOf('month'), dayjs().endOf('day')] as [Dayjs, Dayjs],
  },
];

const normalizeHourFilter = (value: string | null): string | undefined => {
  if (value == null || value === '') return undefined;
  const hour = Number.parseInt(String(value), 10);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return undefined;
  return String(hour);
};

const normalizeDayOfWeekFilter = (value: string | null): string | undefined => {
  if (value == null || value === '') return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const numeric = Number.parseInt(raw, 10);
    if (numeric >= 0 && numeric <= 6) return DAY_OF_WEEK_OPTIONS[numeric];
    if (numeric >= 1 && numeric <= 7) return DAY_OF_WEEK_OPTIONS[(numeric + 6) % 7];
    return undefined;
  }
  const upper = raw.toUpperCase();
  return DAY_OF_WEEK_OPTIONS.find((day) => day.toUpperCase() === upper) || undefined;
};

const deriveFlowFilterFromParams = (direction: string | null, triggerType: string | null): string | undefined => {
  const normalizedDirection = direction ? String(direction).toUpperCase() : '';
  const normalizedTriggerType = triggerType ? String(triggerType).toUpperCase() : '';
  if (normalizedDirection === 'SCHEDULED' || SCHEDULED_TRIGGER_TYPES.has(normalizedTriggerType)) {
    return 'SCHEDULED';
  }
  if (['INBOUND', 'OUTBOUND', 'COMMUNICATION'].includes(normalizedDirection)) {
    return normalizedDirection;
  }
  return undefined;
};

interface ExecutionSpan {
  name: string;
  kind: string;
  status: 'ok' | 'error';
  duration?: number;
  startedAt?: number;
  method?: string;
  url?: string;
  statusCode?: number;
  authType?: string;
  attempt?: number;
  error?: string;
  message?: string;
  requestBody?: string;
  responseBody?: string;
  children?: ExecutionSpan[];
}

const TraceSpanRow = ({
  span,
  depth,
  totalDuration,
}: {
  span: ExecutionSpan;
  depth: number;
  totalDuration: number;
}) => {
  const [open, setOpen] = useState(false);
  const isError = span.status === 'error';
  const pct = Math.max(2, ((span.duration || 0) / (totalDuration || 1)) * 100);
  const hasDetail = span.requestBody || span.responseBody || span.error || span.message;
  return (
    <div className="logs-trace-span" style={{ paddingLeft: depth * 16 }}>
      <div className="logs-trace-span-row" data-interactive={hasDetail} onClick={() => hasDetail && setOpen((v) => !v)}>
        <span className="logs-trace-duration">{span.duration != null ? `${span.duration}ms` : ''}</span>
        {isError && <span aria-label="Span failed" className="logs-trace-error-dot" />}
        <Text type="code">{span.kind}</Text>
        <span className="logs-trace-name" data-error={isError}>
          {span.name}
          {span.method ? ` ${span.method}` : ''}
          {span.url ? <span className="logs-trace-url"> {span.url}</span> : null}
          {span.message ? <span className="console-text-secondary"> — {span.message}</span> : null}
          {span.statusCode != null ? (
            <Text
              type="code"
              className={span.statusCode >= 400 ? 'console-margin-left-2 console-text-error' : 'console-margin-left-2'}
            >
              {span.statusCode}
            </Text>
          ) : null}
          {span.authType ? <span className="logs-trace-metadata">[{span.authType}]</span> : null}
          {span.attempt != null ? <span className="logs-trace-metadata">attempt {span.attempt}</span> : null}
        </span>
        <div className="logs-trace-progress" data-kind={span.kind} data-error={isError}>
          <div className="logs-trace-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      {open && hasDetail && (
        <div className="logs-trace-span-details" data-kind={span.kind} data-error={isError}>
          {span.error && <div className="logs-trace-error-message">{span.error}</div>}
          {span.requestBody && (
            <div className="console-margin-bottom-1">
              <div className="logs-trace-section-label">Request</div>
              <pre className="logs-trace-code-preview">
                {typeof span.requestBody === 'string' ? span.requestBody : JSON.stringify(span.requestBody, null, 2)}
              </pre>
            </div>
          )}
          {span.responseBody && (
            <div>
              <div className="logs-trace-section-label">Response</div>
              <pre className="logs-trace-code-preview">
                {typeof span.responseBody === 'string' ? span.responseBody : JSON.stringify(span.responseBody, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
      {span.children?.map((ch, i) => (
        <TraceSpanRow key={i} span={ch} depth={depth + 1} totalDuration={totalDuration} />
      ))}
    </div>
  );
};

const TraceWaterfall = ({ spans }: { spans: ExecutionSpan[] }) => {
  const { spacing } = useDesignTokens();
  const totalDuration = spans.reduce((s, sp) => s + (sp.duration || 0), 0) || 1;
  return (
    <div className="console-padding-y-2">
      <div className="logs-trace-summary">
        <span>{spans.length} spans</span>
        <span>·</span>
        <span>total {spans.reduce((s, sp) => s + (sp.duration || 0), 0)}ms</span>
      </div>
      {spans.map((sp, i) => (
        <TraceSpanRow key={i} span={sp} depth={0} totalDuration={totalDuration} />
      ))}
    </div>
  );
};

export const LogsRoute = () => {
  const { spacing, token } = useDesignTokens();
  const { isSuperAdmin } = usePermissions();
  // cURL previews mask credentials by default — they get pasted into tickets.
  // Admins can reveal them to get a command that actually runs; deliberately
  // per-visit state, so it never persists into someone's next session.
  const [revealCredentials, setRevealCredentials] = useState(false);
  // The log only carries masked credentials; revealing fetches the real ones
  // from the audited, super-admin-only credentials endpoint.
  const [revealedConfig, setRevealedConfig] = useState<any>(null);

  // Revealing a credential is a deliberate exception to the default masking,
  // and the resulting command carries a working secret. Record who did it and
  // when. Flushed immediately rather than left in the batch queue — an audit
  // event that a closed tab can discard is not an audit event.
  const toggleRevealCredentials = async () => {
    if (revealCredentials) {
      setRevealCredentials(false);
      setRevealedConfig(null);
      return;
    }
    const integrationId = detailRecord?.integrationConfigId;
    if (!integrationId) return;
    try {
      const config =
        detailRecord?.direction === 'INBOUND'
          ? await getInboundIntegrationCredentials(String(integrationId))
          : await getIntegrationCredentials(String(integrationId));
      setRevealedConfig(config);
      setRevealCredentials(true);
      activityTracker.track({
        event: ACTIVITY_EVENTS.CREDENTIAL_REVEALED,
        metadata: {
          surface: 'delivery-log-curl',
          integrationId,
          integrationName: detailRecord?.integrationName ?? null,
          logId: detailRecord?.id ?? null,
          orgId,
        },
      });
      void activityTracker.flush();
    } catch (error) {
      msgApi.error(error instanceof Error ? error.message : 'Could not load the credentials');
    }
  };
  const colors = cssVar.legacy;
  const { user } = useAuth();
  const { orgId } = useTenant();
  const isPortalSession = !!(user as any)?.isPortalSession;
  const { message: msgApi, modal } = App.useApp();
  const screens = Grid.useBreakpoint();
  const isNarrow = !screens.md;
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const [statusFilter, setStatusFilter] = useState<string | undefined>(() => searchParams.get('status') || undefined);
  const [integrationFilter, setIntegrationFilter] = useState<string | undefined>(
    () => searchParams.get('integrationId') || undefined
  );
  const [providerFilter, setProviderFilter] = useState<string | undefined>(
    () => searchParams.get('provider') || undefined
  );
  const [eventTypeFilter, setEventTypeFilter] = useState<string | undefined>(
    () => searchParams.get('eventType') || undefined
  );
  const [flowFilter, setFlowFilter] = useState<string | undefined>(() =>
    deriveFlowFilterFromParams(searchParams.get('direction'), searchParams.get('triggerType'))
  );
  const [errorCategoryFilter, setErrorCategoryFilter] = useState<string | undefined>(
    () => searchParams.get('errorCategory') || undefined
  );
  const [clientIpFilter, setClientIpFilter] = useState<string | undefined>(
    () => searchParams.get('clientIp') || undefined
  );
  const [hourFilter, setHourFilter] = useState<string | undefined>(() => normalizeHourFilter(searchParams.get('hour')));
  const [dayOfWeekFilter, setDayOfWeekFilter] = useState<string | undefined>(() =>
    normalizeDayOfWeekFilter(searchParams.get('dayOfWeek'))
  );
  const [dateRange, setDateRange] = useState<[string, string] | null>(() => {
    if (searchParams.get('dateRange') === 'all') return null;
    const s = searchParams.get('startDate');
    const e = searchParams.get('endDate');
    if (s && e) return [s, e];
    const derived = deriveDateRangeFromDays(searchParams.get('days'));
    if (derived) return derived;
    return getTodayDateRange();
  });
  const [search, setSearch] = useState('');
  const [expandedLogDetails, setExpandedLogDetails] = useState<Record<string, DeliveryLog>>({});
  // What each delivery's pipeline stages did (runs with their requests), fetched with the details.
  const [stageDetails, setStageDetails] = useState<Record<string, { states: StageState[]; runs: StageRun[] }>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [retryingLogs, setRetryingLogs] = useState<Record<string, boolean>>({});
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [exportLoading, setExportLoading] = useState(false);
  const [showMoreFilters, setShowMoreFilters] = useState(
    () =>
      searchParams.has('eventType') ||
      searchParams.has('errorCategory') ||
      searchParams.has('clientIp') ||
      searchParams.has('hour') ||
      searchParams.has('dayOfWeek')
  );
  const [manualRefreshPending, setManualRefreshPending] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  // Ref to read current searchParams in sync effect without subscribing to changes
  const searchParamsRef = useRef(searchParams);
  searchParamsRef.current = searchParams;

  const setDateRangeWithUrl = useCallback((nextRange: [string, string] | null) => {
    // dateRange is the single source of truth. The state-to-URL effect below
    // performs the URL update after React commits this value, avoiding a race
    // where an effect with the previous range could overwrite a direct update.
    setDateRange(nextRange);
  }, []);

  // Every filter above is seeded from the URL exactly once, at mount. That is
  // fine when you arrive from elsewhere, and silently broken when you are
  // already here: the failed-deliveries badge navigates to
  // /logs?status=FAILED&dateRange=all, the URL changes, and nothing on screen
  // moves. Navigations that mean to drive the filters carry an `applyFilters`
  // marker in router state — it changes only on a real navigation, so adopting
  // it here cannot loop against the state→URL sync effect below.
  const appliedFiltersAt = (location.state as { applyFilters?: number } | null)?.applyFilters;
  useEffect(() => {
    if (!appliedFiltersAt) return;
    const params = searchParamsRef.current;

    setStatusFilter(params.get('status') || undefined);
    setIntegrationFilter(params.get('integrationId') || undefined);
    setProviderFilter(params.get('provider') || undefined);
    setEventTypeFilter(params.get('eventType') || undefined);
    setFlowFilter(deriveFlowFilterFromParams(params.get('direction'), params.get('triggerType')));
    setErrorCategoryFilter(params.get('errorCategory') || undefined);
    setClientIpFilter(params.get('clientIp') || undefined);
    setHourFilter(normalizeHourFilter(params.get('hour')));
    setDayOfWeekFilter(normalizeDayOfWeekFilter(params.get('dayOfWeek')));

    if (params.get('dateRange') === 'all') {
      setDateRange(null);
    } else {
      const start = params.get('startDate');
      const end = params.get('endDate');
      const derived = deriveDateRangeFromDays(params.get('days'));
      if (start && end) setDateRange([start, end]);
      else if (derived) setDateRange(derived);
    }
  }, [appliedFiltersAt]);

  // Sync state → URL only (one-way). Uses ref to read current URL params
  // without subscribing to changes, breaking the circular dependency that
  // caused filter resets during auto-refresh.
  useEffect(() => {
    const current = searchParamsRef.current;
    const nextParams = new URLSearchParams(current);

    const syncParam = (key: string, value?: string | null) => {
      if (value == null || value === '') {
        nextParams.delete(key);
        return;
      }
      nextParams.set(key, value);
    };

    syncParam('status', statusFilter);
    syncParam('integrationId', integrationFilter);
    syncParam('provider', providerFilter);
    syncParam('eventType', eventTypeFilter);
    syncParam('errorCategory', errorCategoryFilter);
    syncParam('clientIp', clientIpFilter);
    syncParam('hour', hourFilter);
    syncParam('dayOfWeek', dayOfWeekFilter);

    if (flowFilter === 'SCHEDULED') {
      nextParams.delete('direction');
      nextParams.set('triggerType', 'SCHEDULED');
    } else if (flowFilter) {
      nextParams.set('direction', flowFilter);
      nextParams.delete('triggerType');
    } else {
      nextParams.delete('direction');
      nextParams.delete('triggerType');
    }

    nextParams.delete('days');
    if (dateRange?.[0] && dateRange?.[1]) {
      nextParams.delete('dateRange');
      nextParams.set('startDate', dateRange[0]);
      nextParams.set('endDate', dateRange[1]);
    } else if (dateRange === null) {
      nextParams.delete('startDate');
      nextParams.delete('endDate');
      nextParams.set('dateRange', 'all');
    }

    if (nextParams.toString() !== current.toString()) {
      setSearchParams(nextParams, { replace: true });
    }
  }, [
    setSearchParams,
    statusFilter,
    integrationFilter,
    providerFilter,
    eventTypeFilter,
    flowFilter,
    errorCategoryFilter,
    clientIpFilter,
    hourFilter,
    dayOfWeekFilter,
    dateRange,
  ]);

  // Clear selection when filters change to prevent data corruption
  useEffect(() => {
    setSelectedRowKeys([]);
  }, [
    statusFilter,
    integrationFilter,
    providerFilter,
    eventTypeFilter,
    flowFilter,
    errorCategoryFilter,
    clientIpFilter,
    hourFilter,
    dayOfWeekFilter,
    search,
    dateRange,
  ]);

  // Pagination with auto-reset on filter changes
  const { currentPage, pageSize, getPaginationConfig } = usePaginatedTable({
    defaultPageSize: 15,
    pageSizeOptions: ['10', '15', '25', '50', '100'],
    resetDeps: [
      orgId,
      statusFilter,
      integrationFilter,
      providerFilter,
      eventTypeFilter,
      flowFilter,
      errorCategoryFilter,
      clientIpFilter,
      hourFilter,
      dayOfWeekFilter,
      search,
      dateRange,
    ],
    syncWithUrl: true, // Enable URL params for bookmarkable pages
  });

  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });
  const { data: uiOverride } = useQuery({
    queryKey: ['uiConfigOverride'],
    queryFn: getUIConfigOverride,
    staleTime: 5 * 60 * 1000,
  });

  const refreshSeconds = Number(
    uiOverride?.dashboard?.autoRefreshSeconds ?? uiConfig?.dashboard?.autoRefreshSeconds ?? 30
  );
  // A background refetch that lands while the date panel is open re-renders the
  // filter row and discards a half-picked range, so hold refreshes until the
  // picker closes.
  const refreshInterval = refreshSeconds > 0 && !datePickerOpen ? refreshSeconds * 1000 : false;
  const logsQueryStaleTime = refreshInterval || 30_000;

  const resolvedDirection =
    flowFilter === 'INBOUND'
      ? 'INBOUND'
      : flowFilter === 'OUTBOUND'
        ? 'OUTBOUND'
        : flowFilter === 'COMMUNICATION'
          ? 'COMMUNICATION'
          : undefined;
  const resolvedTriggerType = flowFilter === 'SCHEDULED' ? 'SCHEDULED' : undefined;
  const timezoneOffset = hourFilter || dayOfWeekFilter ? String(new Date().getTimezoneOffset()) : undefined;

  const resolvedDateRange = useMemo(() => {
    if (!dateRange?.[0] || !dateRange?.[1]) return null;
    return [dayjs(dateRange[0]).startOf('day').toISOString(), dayjs(dateRange[1]).endOf('day').toISOString()] as [
      string,
      string,
    ];
  }, [dateRange]);

  const {
    data: logsResponse,
    refetch: refetchLogs,
    isFetching: logsFetching,
    dataUpdatedAt: logsUpdatedAt,
  } = useQuery<PaginatedResponse<DeliveryLog>>({
    queryKey: [
      'logs',
      orgId,
      statusFilter,
      integrationFilter,
      providerFilter,
      eventTypeFilter,
      flowFilter,
      errorCategoryFilter,
      clientIpFilter,
      hourFilter,
      dayOfWeekFilter,
      search,
      resolvedDateRange,
      currentPage,
      pageSize,
    ],
    queryFn: () =>
      getLogs({
        status: statusFilter === 'PENDING_OR_RETRYING' ? undefined : statusFilter, // Don't send special filter to backend
        integrationId: integrationFilter,
        provider: providerFilter,
        eventType: eventTypeFilter,
        direction: resolvedDirection,
        triggerType: resolvedTriggerType,
        errorCategory: errorCategoryFilter,
        clientIp: clientIpFilter,
        hour: hourFilter,
        dayOfWeek: dayOfWeekFilter,
        timezoneOffset,
        search,
        dateRange: resolvedDateRange,
        page: currentPage,
        limit: pageSize,
        groupBy: 'message',
      }),
    refetchInterval: refreshInterval,
    staleTime: logsQueryStaleTime,
  });

  const logs = logsResponse?.data || [];
  const pagination = logsResponse?.pagination;
  const isInitialLogsLoading = logsFetching && !logsResponse;

  const { data: stats } = useQuery({
    queryKey: [
      'logs-stats-summary',
      orgId,
      integrationFilter,
      providerFilter,
      eventTypeFilter,
      flowFilter,
      errorCategoryFilter,
      clientIpFilter,
      hourFilter,
      dayOfWeekFilter,
      search,
      resolvedDateRange,
    ],
    queryFn: () =>
      getLogStatsSummary({
        integrationId: integrationFilter,
        provider: providerFilter,
        eventType: eventTypeFilter,
        direction: resolvedDirection,
        triggerType: resolvedTriggerType,
        errorCategory: errorCategoryFilter,
        clientIp: clientIpFilter,
        hour: hourFilter,
        dayOfWeek: dayOfWeekFilter,
        timezoneOffset,
        search,
        dateRange: resolvedDateRange,
        groupBy: 'message',
      }),
    refetchInterval: refreshInterval,
    staleTime: logsQueryStaleTime,
  });

  // Results of the follow-up script of the selected integration (nothing shown until there are some).
  const { data: followUpStats } = useQuery({
    enabled: Boolean(integrationFilter),
    queryKey: ['logs-follow-up-stats', orgId, integrationFilter, resolvedDateRange],
    queryFn: () =>
      getDeliveryFollowUpStats({
        integrationId: integrationFilter,
        dateRange: resolvedDateRange,
      }),
    refetchInterval: refreshInterval,
    staleTime: logsQueryStaleTime,
  });

  const { data: integrations = [] } = useQuery({
    queryKey: ['integrations', orgId],
    queryFn: () => getIntegrations(),
    staleTime: 5 * 60 * 1000, // integration list changes infrequently — don't re-fetch on every focus
  });
  const providerOptions = useMemo(() => {
    const options = new Map<string, string>();

    integrations.forEach((integration) => {
      const provider = String(integration.provider || '').trim();
      if (!provider) return;
      const key = provider.toLocaleLowerCase();
      if (!options.has(key)) options.set(key, provider);
    });

    // Keep a deep-linked value selectable even when the integration catalogue
    // is temporarily incomplete or the provider was removed after the link
    // was created. The server remains the source of truth for matching.
    const selectedProvider = String(providerFilter || '').trim();
    if (selectedProvider) {
      const key = selectedProvider.toLocaleLowerCase();
      if (!options.has(key)) options.set(key, selectedProvider);
    }

    return Array.from(options.values())
      .sort((left, right) => left.localeCompare(right))
      .map((provider) => ({ value: provider, label: provider }));
  }, [integrations, providerFilter]);
  const { data: eventTypes = [] } = useQuery<string[]>({
    queryKey: ['event-types', orgId],
    queryFn: getEventTypes,
    staleTime: 5 * 60 * 1000, // event types are static — re-fetch at most every 5 minutes
  });
  const latestRefreshAt = logsUpdatedAt || 0;

  const showCallsFromIp = (ip: string) => {
    setClientIpFilter(ip);
    setShowMoreFilters(true);
    setDetailRecord(null);
  };

  const clearExportFilter = (key: string) => {
    switch (key) {
      case 'status':
        setStatusFilter(undefined);
        break;
      case 'flow':
        setFlowFilter(undefined);
        break;
      case 'integration':
        setIntegrationFilter(undefined);
        break;
      case 'provider':
        setProviderFilter(undefined);
        break;
      case 'eventType':
        setEventTypeFilter(undefined);
        break;
      case 'errorCategory':
        setErrorCategoryFilter(undefined);
        break;
      case 'clientIp':
        setClientIpFilter(undefined);
        break;
      case 'hour':
        setHourFilter(undefined);
        break;
      case 'dayOfWeek':
        setDayOfWeekFilter(undefined);
        break;
      case 'date':
        setDateRangeWithUrl(null);
        break;
      case 'search':
        setSearch('');
        break;
      default:
        break;
    }
  };

  const exportFilterChips = useMemo(() => {
    const chips: Array<{ key: string; label: string; onClear?: () => void }> = [];
    if (statusFilter) {
      const label =
        statusFilter === 'FAILED'
          ? 'Failed (including abandoned)'
          : statusFilter === 'QUEUED'
            ? 'Pending (queued)'
            : getStatusLabel(statusFilter);
      chips.push({
        key: 'status',
        label: `Status: ${label}`,
        onClear: () => clearExportFilter('status'),
      });
    }
    if (flowFilter) {
      const flowLabel =
        flowFilter === 'SCHEDULED'
          ? 'Scheduled'
          : flowFilter === 'INBOUND'
            ? 'Inbound'
            : flowFilter === 'COMMUNICATION'
              ? 'Communication'
              : 'Outbound';
      chips.push({
        key: 'flow',
        label: `Flow: ${flowLabel}`,
        onClear: () => clearExportFilter('flow'),
      });
    }
    if (integrationFilter) {
      const __KEEP_integrationName__ =
        integrations.find((wh) => wh.id === integrationFilter)?.name || integrationFilter;
      chips.push({
        key: 'integration',
        label: `Integration: ${__KEEP_integrationName__}`,
        onClear: () => clearExportFilter('integration'),
      });
    }
    if (providerFilter) {
      chips.push({
        key: 'provider',
        label: `Provider: ${providerFilter}`,
        onClear: () => clearExportFilter('provider'),
      });
    }
    if (eventTypeFilter) {
      chips.push({
        key: 'eventType',
        label: `Event: ${eventTypeFilter}`,
        onClear: () => clearExportFilter('eventType'),
      });
    }
    if (errorCategoryFilter) {
      chips.push({
        key: 'errorCategory',
        label: `Error: ${errorCategoryFilter}`,
        onClear: () => clearExportFilter('errorCategory'),
      });
    }
    if (clientIpFilter) {
      chips.push({
        key: 'clientIp',
        label: `IP: ${clientIpFilter}`,
        onClear: () => clearExportFilter('clientIp'),
      });
    }
    if (hourFilter) {
      chips.push({
        key: 'hour',
        label: `Hour: ${hourFilter.padStart(2, '0')}:00`,
        onClear: () => clearExportFilter('hour'),
      });
    }
    if (dayOfWeekFilter) {
      chips.push({
        key: 'dayOfWeek',
        label: `Day: ${dayOfWeekFilter}`,
        onClear: () => clearExportFilter('dayOfWeek'),
      });
    }
    if (dateRange?.[0] && dateRange?.[1]) {
      const startLabel = dayjs(dateRange[0]).format('YYYY-MM-DD');
      const endLabel = dayjs(dateRange[1]).format('YYYY-MM-DD');
      chips.push({
        key: 'date',
        label: `Date: ${startLabel} → ${endLabel}`,
        onClear: () => clearExportFilter('date'),
      });
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      const display = trimmedSearch.length > 28 ? `${trimmedSearch.slice(0, 28)}…` : trimmedSearch;
      chips.push({
        key: 'search',
        label: `Search: ${display}`,
        onClear: () => clearExportFilter('search'),
      });
    }
    return chips;
  }, [
    statusFilter,
    flowFilter,
    integrationFilter,
    providerFilter,
    eventTypeFilter,
    errorCategoryFilter,
    clientIpFilter,
    hourFilter,
    dayOfWeekFilter,
    dateRange,
    search,
    integrations,
  ]);

  const filtered = useMemo(() => {
    // Handle "Pending" filter - show both PENDING and RETRYING
    // (backend counts both as "pending" in stats)
    if (statusFilter === 'PENDING_OR_RETRYING') {
      return logs.filter((log) => log.status === 'PENDING' || log.status === 'RETRYING');
    }
    return logs;
  }, [logs, statusFilter]);

  // Feeds the empty state: naming the filters that produced "nothing" is what
  // turns a dead end into something the reader can act on.
  const activeFilterSummary = useMemo(
    () => exportFilterChips.map((chip) => chip.label).join(' · '),
    [exportFilterChips]
  );
  const visibleFilterChips = useMemo(() => {
    const isDefaultTodayRange = Boolean(
      dateRange?.[0] &&
        dateRange?.[1] &&
        dayjs(dateRange[0]).isSame(dayjs(), 'day') &&
        dayjs(dateRange[1]).isSame(dayjs(), 'day')
    );
    if (!isDefaultTodayRange) return exportFilterChips;
    return exportFilterChips.filter((chip) => chip.key !== 'date');
  }, [dateRange, exportFilterChips]);
  const isNarrowedToSingleDay = useMemo(
    () => Boolean(dateRange?.[0] && dateRange?.[1] && dayjs(dateRange[0]).isSame(dayjs(dateRange[1]), 'day')),
    [dateRange]
  );

  const exportCount = pagination?.total ?? filtered.length;
  const exportLabel =
    exportFilterChips.length > 0
      ? `Export filtered (${exportCount.toLocaleString()})`
      : `Export (${exportCount.toLocaleString()})`;

  const handleExportCsv = async () => {
    const { onProgress, finish } = createExportProgress(msgApi, 'Export CSV');
    try {
      await exportLogsToCsv(
        {
          status: statusFilter,
          integrationId: integrationFilter,
          provider: providerFilter,
          eventType: eventTypeFilter,
          direction: resolvedDirection,
          triggerType: resolvedTriggerType,
          errorCategory: errorCategoryFilter,
          clientIp: clientIpFilter,
          hour: hourFilter,
          dayOfWeek: dayOfWeekFilter,
          timezoneOffset,
          search: search || undefined,
          dateRange: resolvedDateRange || undefined,
        },
        { onProgress }
      );
      finish('Export complete');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      finish(errorMessage, true);
    }
  };

  // One inspect surface. Expanding in place pushed the table off screen and
  // made comparing two deliveries a collapse-scroll-expand loop; the drawer
  // keeps the list in view so you can walk down a failure run.
  const [detailRecord, setDetailRecord] = useState<DeliveryLog | null>(null);
  // Revealed credentials belong to one integration: hide them when another log opens.
  useEffect(() => {
    setRevealCredentials(false);
    setRevealedConfig(null);
  }, [detailRecord?.id]);

  // A running script job shows its output as it appears: follow it until it finishes.
  const followedLog = detailRecord ? expandedLogDetails[detailRecord.id] || detailRecord : null;
  const followingLiveRun = isLiveScriptRun(followedLog);
  useEffect(() => {
    if (!detailRecord || !followingLiveRun) return undefined;
    const id = detailRecord.id;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      try {
        const latest = await getLogById(id);
        if (cancelled || !latest) return;
        setExpandedLogDetails((prev) => ({ ...prev, [id]: latest }));
        if (!isLiveScriptRun(latest)) {
          setDetailRecord((prev) => (prev && prev.id === id ? { ...prev, status: latest.status } : prev));
          void refetchLogs();
        }
      } catch {
        // A missed poll is harmless: the next one catches up.
      }
    }, LIVE_OUTPUT_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [detailRecord?.id, followingLiveRun]);

  const openDeliveryDetail = async (record: DeliveryLog) => {
    setDetailRecord(record);
    if (!expandedLogDetails[record.id]) {
      await handleRowExpand(true, record);
    }
  };

  // Triage is rarely one delivery — it is walking a run of them. Stepping
  // through the loaded page from inside the drawer beats closing, finding your
  // place, and opening the next one.
  const detailIndex = detailRecord ? filtered.findIndex((row) => row.id === detailRecord.id) : -1;

  // j/k and the arrow keys walk the run without reaching for the mouse. Ignored
  // while typing, so the search box and the date field keep their own keys.
  useEffect(() => {
    if (!detailRecord) return;
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && (el.closest('input, textarea, [contenteditable="true"]') || el.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        stepDetail(1);
      } else if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        stepDetail(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const stepDetail = (offset: number) => {
    if (detailIndex < 0) return;
    const next = filtered[detailIndex + offset];
    if (next) void openDeliveryDetail(next);
  };

  const handleRowExpand = async (expanded: boolean, record: DeliveryLog) => {
    if (expanded && !expandedLogDetails[record.id]) {
      setLoadingDetails((prev) => ({ ...prev, [record.id]: true }));
      try {
        const [fullLog, stages] = await Promise.all([
          getLogById(record.id),
          // Stage runs are extra detail: a failure here must not hide the log.
          getDeliveryStages(record.id).catch(() => null),
        ]);
        if (fullLog) {
          setExpandedLogDetails((prev) => ({ ...prev, [record.id]: fullLog }));
        }
        if (stages) {
          setStageDetails((prev) => ({ ...prev, [record.id]: stages }));
        }
      } catch (error) {
        msgApi.error('Failed to load log details');
      } finally {
        setLoadingDetails((prev) => ({ ...prev, [record.id]: false }));
      }
    }
  };

  const handleRetry = async (record: DeliveryLog, options: { force?: boolean } = {}) => {
    const forceRetry = Boolean(options.force);
    setRetryingLogs((prev) => ({ ...prev, [record.id]: true }));
    try {
      await retryLog(record.id, {
        force: forceRetry,
        reason: forceRetry ? 'Force retry from UI' : 'Manual retry from UI',
      });
      msgApi.success(
        forceRetry
          ? 'Force retry initiated. Circuit breaker bypassed for this replay.'
          : 'Delivery retry initiated. The integration will be retried shortly.'
      );
      // Refetch logs after a short delay to show the updated status
      setTimeout(() => {
        refetchLogs();
      }, 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to retry delivery';
      msgApi.error(errorMessage);
    } finally {
      setRetryingLogs((prev) => ({ ...prev, [record.id]: false }));
    }
  };

  const handleReplayWithPayload = async (
    record: DeliveryLog,
    options: { payload: unknown; reason: string; force: boolean }
  ) => {
    setRetryingLogs((prev) => ({ ...prev, [record.id]: true }));
    try {
      await retryLog(record.id, options);
      msgApi.success(
        options.force ? 'Force replay initiated with edited payload.' : 'Replay initiated with edited payload.'
      );
      setTimeout(() => {
        refetchLogs();
      }, 1000);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to replay delivery';
      msgApi.error(errorMessage);
      throw error;
    } finally {
      setRetryingLogs((prev) => ({ ...prev, [record.id]: false }));
    }
  };

  const confirmForceRetry = (record: DeliveryLog) => {
    modal.confirm({
      title: 'Force retry delivery?',
      content:
        'This will bypass the circuit breaker and attempt delivery immediately. Use only if the target endpoint is healthy.',
      okText: 'Force retry',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        await handleRetry(record, { force: true });
      },
    });
  };

  // Bulk retry handler
  const handleBulkRetry = () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select logs to retry.');
      return;
    }

    modal.confirm({
      title: 'Bulk Retry Logs',
      content: `Retry ${selectedRowKeys.length} selected delivery log(s)? Only FAILED logs will be retried.`,
      okText: 'Retry',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await bulkRetryLogs(selectedRowKeys.map((k) => String(k)));
          if (result.retriedCount > 0) {
            msgApi.success(`Queued ${result.retriedCount} log(s) for retry`);
          }
          if (result.retriedCount < selectedRowKeys.length) {
            msgApi.info(`${selectedRowKeys.length - result.retriedCount} log(s) were skipped (not in FAILED status)`);
          }
          setSelectedRowKeys([]);
          setTimeout(() => {
            refetchLogs();
          }, 1000);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to retry logs';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  const handleBulkForceRetry = () => {
    if (selectedRowKeys.length === 0) {
      msgApi.warning('Please select logs to force retry.');
      return;
    }

    modal.confirm({
      title: 'Force retry logs?',
      content: `Force retry ${selectedRowKeys.length} selected delivery log(s)? This bypasses the circuit breaker and sends immediately. Only FAILED logs will be retried.`,
      okText: 'Force retry',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        const logIds = selectedRowKeys.map((k) => String(k));
        const nextRetrying = logIds.reduce<Record<string, boolean>>((acc, id) => {
          acc[id] = true;
          return acc;
        }, {});
        setRetryingLogs((prev) => ({ ...prev, ...nextRetrying }));

        try {
          const results = await Promise.allSettled(
            logIds.map((id) => retryLog(id, { force: true, reason: 'Force retry from UI' }))
          );
          const successCount = results.filter((result) => result.status === 'fulfilled').length;
          const failureCount = results.length - successCount;
          if (successCount > 0) {
            msgApi.success(`Force retried ${successCount} log(s)`);
          }
          if (failureCount > 0) {
            msgApi.warning(`${failureCount} log(s) were skipped or failed (not in FAILED status or error occurred)`);
          }
          setSelectedRowKeys([]);
          setTimeout(() => {
            refetchLogs();
          }, 1000);
        } finally {
          const resetRetrying = logIds.reduce<Record<string, boolean>>((acc, id) => {
            acc[id] = false;
            return acc;
          }, {});
          setRetryingLogs((prev) => ({ ...prev, ...resetRetrying }));
        }
      },
    });
  };

  // Bulk delete handler
  const handleBulkDelete = () => {
    modal.confirm({
      title: 'Delete Selected Logs',
      content: `Permanently delete ${selectedRowKeys.length} delivery log(s)? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          const result = await bulkDeleteLogs(selectedRowKeys.map((k) => String(k)));
          msgApi.success(`Deleted ${result.deletedCount} log(s)`);
          setSelectedRowKeys([]);
          refetchLogs();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Failed to delete logs';
          msgApi.error(errorMessage);
        }
      },
    });
  };

  // Export handler with format and scope (ALL SERVER-SIDE)
  const handleExport = async (exportType: 'all' | 'selected' | 'filtered', format: 'csv' | 'json') => {
    if (exportLoading) return;

    const filters = {
      status: statusFilter,
      integrationId: integrationFilter,
      provider: providerFilter,
      eventType: eventTypeFilter,
      direction: resolvedDirection,
      triggerType: resolvedTriggerType,
      errorCategory: errorCategoryFilter,
      clientIp: clientIpFilter,
      hour: hourFilter,
      dayOfWeek: dayOfWeekFilter,
      timezoneOffset,
      search: search || undefined,
      dateRange: dateRange || undefined,
    };

    // Calculate count before export
    let count = 0;
    if (exportType === 'selected') {
      if (selectedRowKeys.length === 0) {
        msgApi.warning('Please select logs to export');
        return;
      }
      count = selectedRowKeys.length;
    } else {
      count = exportType === 'all' ? logs.length : filtered.length;
    }

    // Warn for large exports (>10,000 records)
    if (count > 10000) {
      modal.confirm({
        title: 'Large Export Warning',
        content: `You're about to export ${count.toLocaleString()} logs. This may take several minutes and could result in a very large file. Continue?`,
        okText: 'Yes, Export',
        cancelText: 'Cancel',
        onOk: async () => {
          await performExport(exportType, format, filters, count);
        },
      });
      return;
    }

    // Proceed with export for smaller datasets
    await performExport(exportType, format, filters, count);
  };

  const performExport = async (
    exportType: 'all' | 'selected' | 'filtered',
    format: 'csv' | 'json',
    filters: any,
    count: number
  ) => {
    const { onProgress, finish } = createExportProgress(msgApi, `Export ${format.toUpperCase()}`);
    try {
      setExportLoading(true);

      if (exportType === 'selected') {
        // Server-side export for selected logs
        await exportSelectedLogs(selectedRowKeys as string[], format, {
          onProgress,
        });
        finish(`Exported ${count} log(s)`);
      } else {
        // For all/filtered, use backend export
        if (format === 'csv') {
          await exportLogsToCsv(exportType === 'all' ? {} : filters, {
            onProgress,
          });
        } else {
          await exportLogsToJson(exportType === 'all' ? {} : filters, {
            onProgress,
          });
        }
        finish(`Exported ${count} log(s)`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to export logs';
      finish(errorMessage, true);
    } finally {
      setExportLoading(false);
    }
  };

  // Row selection config
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

  const copyToClipboard = async (text: string) => {
    const copied = await copyTextToClipboard(text);
    if (copied) {
      msgApi.success('Copied to clipboard');
    } else {
      msgApi.error('Failed to copy');
    }
  };

  // Quick status filter handler
  const handleQuickStatusFilter = (status: string) => {
    setStatusFilter(statusFilter === status ? undefined : status);
  };

  const handleManualRefresh = async () => {
    setManualRefreshPending(true);
    try {
      await refetchLogs();
    } finally {
      setManualRefreshPending(false);
    }
  };

  // Shared by the details drawer. This was inline in expandedRowRender; the
  // drawer reuses it verbatim so the two can never drift apart in what they
  // can show (cURL, response, HL7, provider, script logs, replay).
  const renderDeliveryDetail = (record: DeliveryLog) => {
    const fullLog = expandedLogDetails[record.id] || record;
    const isLoading = loadingDetails[record.id];
    const integrationConfig = fullLog.__KEEP_integrationConfig__;
    const isScriptJobLog = isScriptJobLogLike(fullLog);
    const scriptLogs = getScriptLogs(fullLog);
    const hasScriptLogs = Array.isArray(scriptLogs) && scriptLogs.length > 0;
    const isLiveRun = isLiveScriptRun(fullLog);
    // A running job gets its output tab straight away, even before the first line, so it is there to watch.
    const showScriptTab = hasScriptLogs || isLiveRun;
    // A skipped delivery never sent a request: no HTTP status, no
    // cURL — what the operator needs is the event that was skipped.
    const isSkippedLog = fullLog.status === 'SKIPPED';
    const showSourceEvent = hasSourceEvent(fullLog);
    const stageTabs = buildStageTabItems(stageDetails[record.id]);
    const stateColor = isSkippedLog ? colors.warning : colors.error;
    // Script jobs have no real HTTP request to reconstruct — there's no
    // targetUrl/payload, so generateCurlCommand would just produce a
    // meaningless `curl -X POST "" -d '{}'`. Show the script's actual
    // console output instead (see 'script-logs' tab below).
    const curlConfig = revealCredentials && revealedConfig ? revealedConfig : fullLog.__KEEP_integrationConfig__;
    const curlCommand =
      !isScriptJobLog && !isSkippedLog && curlConfig
        ? generateCurlCommand(curlConfig, fullLog.requestPayload, fullLog.requestHeaders, {
            direction: fullLog.direction,
            request: (fullLog as any).request,
            orgId: (fullLog as any).orgId,
            inboundRequestHeaders: (fullLog as any).inboundRequestHeaders,
            revealCredentials,
          })
        : null;
    const isInboundLog = fullLog.direction === 'INBOUND';
    const outboundCurlCommand = (() => {
      if (!isInboundLog || !fullLog.requestHeaders || !fullLog.targetUrl) return null;
      // Merge stored outbound headers with resolved customHeaders.
      // requestHeaders only stores Authorization + Content-Type; custom headers
      // (x-partner-id, x-partner-name etc.) need to be re-resolved from inboundRequestHeaders.
      const mergedHeaders: Record<string, unknown> = {
        ...(fullLog.requestHeaders as Record<string, unknown>),
      };
      const customHdrs = (fullLog.__KEEP_integrationConfig__ as any)?.customHeaders || {};
      const callerHdrs = ((fullLog as any).inboundRequestHeaders || {}) as Record<string, unknown>;
      const lowerCaller: Record<string, string> = {};
      Object.entries(callerHdrs).forEach(([k, v]) => {
        lowerCaller[k.toLowerCase()] = String(v);
      });
      const storedLower = new Set(Object.keys(mergedHeaders).map((k) => k.toLowerCase()));
      Object.entries(customHdrs).forEach(([name, value]) => {
        // Newer logs store the value actually sent upstream; keep it over a placeholder.
        if (storedLower.has(name.toLowerCase())) return;
        const resolved = String(value).replace(
          /\{\{(\w+)\}\}/g,
          (_, k: string) => lowerCaller[k.toLowerCase()] ?? `<${k}>`
        );
        mergedHeaders[name] = resolved;
      });
      return generateCurlCommand(
        {
          targetUrl: (revealCredentials && revealedConfig?.targetUrl) || fullLog.targetUrl,
          httpMethod: fullLog.httpMethod || 'POST',
        } as any,
        (fullLog.requestPayload || {}) as Record<string, unknown>,
        mergedHeaders,
        { revealCredentials }
      );
    })();
    const callerInfo = isInboundLog
      ? getCallerInfo((fullLog as any).inboundRequestHeaders, (fullLog as any).clientIp)
      : null;
    const isCommunicationLog = fullLog.httpMethod === 'COMMUNICATION' || fullLog.direction === 'COMMUNICATION';
    const actionIndex = typeof fullLog.actionIndex === 'number' ? fullLog.actionIndex : 0;
    const actionConfig =
      integrationConfig?.actions?.[actionIndex] ||
      integrationConfig?.actions?.find((a: any) => a?.kind === 'COMMUNICATION') ||
      null;
    const communicationConfig = actionConfig?.communicationConfig || null;
    const smtpConfig = communicationConfig?.smtp || null;
    // For ROUTED_EMAIL the sender profile is resolved at delivery time and stored in metadata
    const senderRoutingMeta = (fullLog as any).metadata?.senderRouting || null;
    const resolvedSenderProfile = senderRoutingMeta?.senderProfile || null;
    const payloadForProvider = (fullLog.requestPayload || {}) as Record<string, any>;
    const requestBodyForProvider = (fullLog.request?.body || {}) as Record<string, any>;
    const providerDetails = {
      channel: fullLog.requestHeaders?.channel || fullLog.request?.headers?.channel || null,
      provider: fullLog.requestHeaders?.provider || fullLog.request?.headers?.provider || null,
      target: fullLog.targetUrl || fullLog.request?.url || null,
      method: fullLog.httpMethod || fullLog.request?.method || null,
      smtp: smtpConfig
        ? {
            host: smtpConfig.host || null,
            port: smtpConfig.port || null,
            username: smtpConfig.username || null,
            password: maskSecret(smtpConfig.password),
            fromEmail: smtpConfig.fromEmail || null,
          }
        : resolvedSenderProfile
          ? {
              // ROUTED_EMAIL: show resolved sender profile info
              profile: resolvedSenderProfile.name || resolvedSenderProfile.key || null,
              fromEmail: resolvedSenderProfile.fromEmail || null,
              provider: resolvedSenderProfile.provider || null,
              routingDecision: senderRoutingMeta.routingDecision || null,
            }
          : null,
      message: {
        to: payloadForProvider.to || requestBodyForProvider.to || null,
        // from: prefer actual payload value, fall back to resolved sender profile
        from:
          payloadForProvider.from ||
          requestBodyForProvider.from ||
          resolvedSenderProfile?.fromEmail ||
          smtpConfig?.fromEmail ||
          null,
        subject: payloadForProvider.subject || requestBodyForProvider.subject || null,
      },
    };
    const hasResponseBody =
      fullLog.responseBody !== null && fullLog.responseBody !== undefined && fullLog.responseBody !== '';
    // With no body to show, say why instead of printing "No response body": the reason is the error, and for a script job its output.
    const formattedResponseBody = hasResponseBody
      ? formatForCodeBlock(fullLog.responseBody)
      : [
          isScriptJobLog ? 'This job did not return a result.' : 'No response body was recorded.',
          fullLog.errorMessage ? `Reason: ${fullLog.errorMessage}` : '',
          hasScriptLogs ? "The job's step-by-step output, with the cause, is in the Script Output tab." : '',
        ]
          .filter(Boolean)
          .join('\n\n');
    const isHl7Log = isHl7LogLike({
      httpMethod: fullLog.httpMethod,
      metadata: (fullLog as any).metadata,
      requestPayload: fullLog.requestPayload,
      responseBody: fullLog.responseBody,
    });

    return (
      <div className="console-padding-0">
        {isLoading ? (
          <StatePanel glyph="connecting" tone="busy" title="Loading delivery details" size="compact" />
        ) : (
          <Card
            variant="outlined"
            className="logs-detail-card"
            styles={{
              body: {
                padding: spacing[2],
                display: 'flex',
                flexDirection: 'column',
                gap: spacing[2],
              },
            }}
          >
            {/* Why it failed, first. The payload and cURL below are
                            reference material — the operator opened this row to
                            find out what went wrong, and previously had to scroll
                            past hundreds of lines of body to reach it. */}
            {fullLog.errorMessage && (
              <div className={`logs-error-summary${isSkippedLog ? ' logs-error-summary--warning' : ''}`}>
                <div className="console-flex-baseline-wrap">
                  <Text
                    weight="semibold"
                    size="lg"
                    className={isSkippedLog ? 'console-text-warning' : 'console-text-error'}
                  >
                    {isSkippedLog
                      ? 'Delivery skipped'
                      : fullLog.status === 'ABANDONED'
                        ? 'Delivery abandoned'
                        : 'Delivery failed'}
                    {!isSkippedLog && fullLog.responseStatus ? ` · HTTP ${fullLog.responseStatus}` : ''}
                  </Text>
                  {fullLog.status === 'ABANDONED' && (
                    <Text type="supporting" size="sm" color="secondary">
                      retries exhausted — no further attempts will be made
                    </Text>
                  )}
                </div>

                <Text
                  as="div"
                  type="code"
                  className={`${isSkippedLog ? 'console-text-warning' : 'console-text-error'} console-code-wrap`}
                >
                  {fullLog.errorMessage}
                </Text>

                <div className="logs-error-metadata">
                  {fullLog.targetUrl && (
                    <span className="console-font-mono">
                      {fullLog.httpMethod || 'POST'} {fullLog.targetUrl}
                    </span>
                  )}
                  {typeof fullLog.responseTimeMs === 'number' && <span>{fullLog.responseTimeMs} ms</span>}
                  {(() => {
                    // attemptCount is what the Attempts column shows and
                    // what the engine counts against maxRetries;
                    // retryAttempts only holds the stored retry records,
                    // which read as "1 attempt" on an abandoned delivery.
                    const attempts =
                      typeof (fullLog as any).attemptCount === 'number'
                        ? (fullLog as any).attemptCount
                        : Array.isArray(fullLog.retryAttempts)
                          ? fullLog.retryAttempts.length
                          : null;
                    if (!attempts) return null;
                    return (
                      <span>
                        {attempts} attempt{attempts === 1 ? '' : 's'}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}

            <DeliveryFollowUpPanel followUp={fullLog.followUp} />

            {isLiveRun && <LiveRunNotice startedAt={fullLog.createdAt} lines={scriptLogs.length} />}

            {(curlCommand ||
              isCommunicationLog ||
              isHl7Log ||
              showScriptTab ||
              showSourceEvent ||
              fullLog.followUp ||
              (fullLog as any).traceId ||
              stageTabs.length > 0) && (
              <RetainedTabs
                key={String(fullLog.id)}
                ariaLabel="Delivery details"
                idPrefix={`delivery-${String(fullLog.id)}`}
                initialKey={
                  isSkippedLog && showSourceEvent
                    ? 'source-event'
                    : isHl7Log
                      ? 'hl7'
                      : isCommunicationLog
                        ? 'provider'
                        : showScriptTab
                          ? 'script-logs'
                          : curlCommand
                            ? 'curl'
                            : fullLog.followUp
                              ? 'follow-up'
                              : stageTabs.length > 0
                                ? stageTabs[0].key
                                : 'source-event'
                }
                items={
                  [
                    // The event that triggered this delivery, so the
                    // operator needn't hunt for it in Event Audit.
                    ...(showSourceEvent
                      ? [
                          {
                            key: 'source-event',
                            label: 'Source event',
                            children: (
                              <SourceEventPanel
                                messageId={fullLog.messageId as string}
                                fallbackPayload={fullLog.originalPayload}
                              />
                            ),
                          },
                        ]
                      : []),
                    ...(showScriptTab
                      ? [
                          {
                            key: 'script-logs',
                            label: isLiveRun ? 'Script Output · live' : 'Script Output',
                            children: (
                              <div className="console-position-relative">
                                <Button
                                  size="small"
                                  icon={<GatewayIcon name="CopyOutlined" />}
                                  aria-label="Copy script output"
                                  onClick={() =>
                                    copyToClipboard(
                                      scriptLogs
                                        .map(
                                          (l: any) =>
                                            `[${new Date(l.ts).toLocaleTimeString()}] ${String(l.level).toUpperCase()} ${l.message}`
                                        )
                                        .join('\n')
                                    )
                                  }
                                  className="console-overlay-copy-action-left"
                                />
                                <div
                                  ref={(el) => {
                                    // Follow the newest line while the job runs.
                                    if (el && isLiveRun) el.scrollTop = el.scrollHeight;
                                  }}
                                  className="console-script-output"
                                >
                                  {scriptLogs.length === 0 && (
                                    <span className="console-text-muted">Waiting for the first line of output…</span>
                                  )}
                                  {scriptLogs.map((entry: any, i: number) => (
                                    <div key={i} className="console-script-output__line">
                                      <span className="console-script-output__time">
                                        {new Date(entry.ts).toLocaleTimeString()}
                                      </span>
                                      <span
                                        className="console-script-output__level"
                                        data-level={String(entry.level).toLowerCase()}
                                      >
                                        {String(entry.level).toUpperCase()}
                                      </span>
                                      <span className="console-script-output__message">{entry.message}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ),
                          },
                        ]
                      : []),
                    ...(isHl7Log
                      ? [
                          {
                            key: 'hl7',
                            label: 'HL7',
                            children: (
                              <Hl7LogPanel
                                compact
                                httpMethod={fullLog.httpMethod}
                                metadata={(fullLog as any).metadata}
                                status={fullLog.status}
                                errorMessage={fullLog.errorMessage}
                                responseStatus={fullLog.responseStatus}
                                responseTimeMs={fullLog.responseTimeMs}
                                targetUrl={fullLog.targetUrl}
                                createdAt={fullLog.createdAt}
                                originalPayload={(fullLog as any).originalPayload}
                                requestPayload={fullLog.requestPayload}
                                responseBody={fullLog.responseBody}
                                canReplay={['FAILED', 'ABANDONED'].includes(fullLog.status)}
                                onReplayPayload={(options) => handleReplayWithPayload(fullLog, options)}
                              />
                            ),
                          },
                        ]
                      : []),
                    ...(isCommunicationLog
                      ? [
                          {
                            key: 'provider',
                            label: 'Provider',
                            children: (
                              <div className="console-position-relative">
                                <Button
                                  size="small"
                                  icon={<GatewayIcon name="CopyOutlined" />}
                                  aria-label="Copy provider details"
                                  onClick={() => copyToClipboard(formatForCodeBlock(providerDetails))}
                                  className="console-overlay-copy-action-left"
                                />
                                <pre tabIndex={0} className="clamped-code-block console-code-preview">
                                  {formatForCodeBlock(providerDetails)}
                                </pre>
                              </div>
                            ),
                          },
                        ]
                      : isScriptJobLog || isSkippedLog
                        ? []
                        : [
                            {
                              key: 'curl',
                              label: outboundCurlCommand ? 'Inbound cURL' : 'cURL',
                              children: (
                                <div className="console-position-relative logs-code-viewer-host">
                                  {outboundCurlCommand && (
                                    <div className="console-code-preview__caption">Caller → Gateway</div>
                                  )}
                                  <div
                                    className={
                                      outboundCurlCommand
                                        ? 'logs-code-copy-actions logs-code-copy-actions--offset console-flex-gap-1'
                                        : 'logs-code-copy-actions console-flex-gap-1'
                                    }
                                  >
                                    <Button
                                      size="small"
                                      icon={<GatewayIcon name="CopyOutlined" />}
                                      aria-label="Copy inbound cURL"
                                      disabled={!curlCommand}
                                      onClick={() => copyToClipboard(curlCommand || '')}
                                    />
                                    {isSuperAdmin() && (
                                      <Tooltip
                                        title={
                                          revealCredentials
                                            ? 'Hide credentials'
                                            : 'Show real credentials so the command runs as-is. Do not paste the result into a ticket.'
                                        }
                                      >
                                        <Button
                                          size="small"
                                          icon={
                                            revealCredentials ? (
                                              <GatewayIcon name="EyeInvisibleOutlined" />
                                            ) : (
                                              <GatewayIcon name="EyeOutlined" />
                                            )
                                          }
                                          aria-label={
                                            revealCredentials ? 'Hide credentials in cURL' : 'Show credentials in cURL'
                                          }
                                          aria-pressed={revealCredentials}
                                          danger={revealCredentials}
                                          onClick={toggleRevealCredentials}
                                        />
                                      </Tooltip>
                                    )}
                                  </div>
                                  <LogCodeViewer value={curlCommand} language="shell" label="cURL command" />
                                </div>
                              ),
                            },
                            ...(outboundCurlCommand
                              ? [
                                  {
                                    key: 'outbound-curl',
                                    label: 'Outbound cURL',
                                    children: (
                                      <div className="console-position-relative logs-code-viewer-host">
                                        <div className="console-margin-bottom-2 console-text-secondary console-type-caption">
                                          Gateway → External API
                                        </div>
                                        <Button
                                          size="small"
                                          icon={<GatewayIcon name="CopyOutlined" />}
                                          aria-label="Copy outbound cURL"
                                          onClick={() => copyToClipboard(outboundCurlCommand)}
                                          className="logs-code-copy-actions logs-code-copy-actions--offset"
                                        />
                                        <LogCodeViewer
                                          value={outboundCurlCommand}
                                          language="shell"
                                          label="Outbound cURL command"
                                        />
                                      </div>
                                    ),
                                  },
                                ]
                              : []),
                          ]),
                    ...(callerInfo
                      ? [
                          {
                            key: 'caller',
                            label: 'Caller',
                            children: <CallerCard info={callerInfo} onFilterIp={showCallsFromIp} />,
                          },
                        ]
                      : []),
                    ...((fullLog as any).executionTrace?.length
                      ? [
                          {
                            key: 'trace',
                            label: 'Trace',
                            children: <TraceWaterfall spans={(fullLog as any).executionTrace as ExecutionSpan[]} />,
                          },
                        ]
                      : []),
                    {
                      key: 'response',
                      label: 'Response',
                      children: (
                        <div className="console-position-relative logs-code-viewer-host">
                          <Button
                            size="small"
                            icon={<GatewayIcon name="CopyOutlined" />}
                            aria-label="Copy response body"
                            disabled={!formattedResponseBody}
                            onClick={() => copyToClipboard(formattedResponseBody)}
                            className="logs-code-copy-actions"
                          />
                          <LogCodeViewer value={formattedResponseBody} language="json" label="Response body" />
                        </div>
                      ),
                    },
                    // The gateway records an execution trace per
                    // delivery and never showed it. Only offered when
                    // the record actually carries a traceId. Inbound calls that
                    // have the Trace tab already see these same stages there, with
                    // bodies and retries, so the Timeline would only repeat it.
                    // One tab per pipeline stage that ran, titled with the stage's own name.
                    ...(stageTabs.length > 0 && fullLog.integrationConfigId && !isInboundLog && !isScriptJobLog
                      ? [
                          {
                            key: 'diagram',
                            label: 'Diagram',
                            children: (
                              <DeliveryFlow
                                integrationId={String(fullLog.integrationConfigId)}
                                logId={String(fullLog.id)}
                              />
                            ),
                          },
                        ]
                      : []),
                    ...stageTabs,
                    // What the integration's follow-up script asked the provider after the send, and what came back.
                    ...(fullLog.followUp
                      ? [
                          {
                            key: 'follow-up',
                            label: 'Follow-up',
                            children: <FollowUpChecks followUp={fullLog.followUp} />,
                          },
                        ]
                      : []),
                    ...((fullLog as any).traceId && !(isInboundLog && (fullLog as any).executionTrace?.length)
                      ? [
                          {
                            key: 'timeline',
                            label: 'Timeline',
                            children: (
                              <DeliveryTraceTimeline
                                traceId={(fullLog as any).traceId}
                                stageRuns={stageDetails[record.id]?.runs}
                              />
                            ),
                          },
                        ]
                      : []),
                  ] as RetainedTabItem[]
                }
              />
            )}

            {fullLog.retryAttempts &&
              fullLog.retryAttempts.length > 0 &&
              (() => {
                // Only the most recent attempt is persisted for some
                // records, so retryAttempts.length can read "(1 attempt)"
                // while that single entry is labeled "Attempt #3" —
                // confirmed live and confusing, since it reads as if only
                // one retry ever happened. Use the highest attemptNumber
                // seen, not the array length, so the header and the
                // per-attempt label always agree.
                const totalAttempts = Math.max(
                  fullLog.retryAttempts.length,
                  ...fullLog.retryAttempts.map((attempt) => attempt.attemptNumber || 0)
                );
                const onlyLastAttemptShown = totalAttempts > fullLog.retryAttempts.length;
                return (
                  <>
                    <Divider className="console-margin-y-2" />
                    <Text weight="semibold">
                      {onlyLastAttemptShown
                        ? `Retry History (last of ${totalAttempts} attempts)`
                        : `Retry History (${totalAttempts} ${totalAttempts === 1 ? 'attempt' : 'attempts'})`}
                    </Text>
                    <Timeline
                      className="console-margin-top-2"
                      items={fullLog.retryAttempts.map((attempt) => ({
                        color:
                          attempt.status === 'SUCCESS'
                            ? colors.success[600]
                            : attempt.status === 'FAILED'
                              ? colors.error[600]
                              : colors.warning[600],
                        dot:
                          attempt.status === 'SUCCESS' ? (
                            <GatewayIcon size="xsm" name="CheckCircleOutlined" />
                          ) : attempt.status === 'FAILED' ? (
                            <GatewayIcon size="xsm" name="CloseCircleOutlined" />
                          ) : (
                            <GatewayIcon size="xsm" name="ClockCircleOutlined" />
                          ),
                        children: (
                          <div>
                            <div className="console-margin-bottom-1">
                              <Space size={spacingToNumber(spacing[2])}>
                                <StatusBadge status={attempt.status} size="small" />
                                <Text type="code">Attempt #{attempt.attemptNumber}</Text>
                                <Text type="supporting" size="sm" color="secondary">
                                  {formatDateTime(attempt.attemptedAt)}
                                </Text>
                                {attempt.responseStatus && (
                                  <Text
                                    type="code"
                                    style={{
                                      color: attempt.responseStatus >= 400 ? cssVar.error.text : undefined,
                                    }}
                                  >
                                    HTTP {attempt.responseStatus}
                                  </Text>
                                )}
                                {attempt.responseTimeMs && (
                                  <Text type="supporting" size="sm" color="secondary">
                                    {attempt.responseTimeMs}ms
                                  </Text>
                                )}
                              </Space>
                            </div>
                            {attempt.retryReason && (
                              <Text
                                type="supporting"
                                size="sm"
                                color="secondary"
                                className="console-caption-block console-margin-bottom-1 console-text-secondary"
                              >
                                Reason: {attempt.retryReason}
                              </Text>
                            )}
                            {attempt.errorMessage &&
                              (attempt.errorMessage === fullLog.errorMessage ? (
                                // Already shown verbatim in the "Error Details" box above —
                                // repeating it here just doubles the same text on screen.
                                <Text
                                  type="supporting"
                                  size="sm"
                                  color="secondary"
                                  className="console-display-block console-margin-top-2 console-font-style-italic"
                                >
                                  Same error as shown in Error Details above.
                                </Text>
                              ) : (
                                <pre className="logs-attempt-error-code">{attempt.errorMessage}</pre>
                              ))}
                            {attempt.responseBody && (
                              <pre className="logs-attempt-response-code">
                                {formatForCodeBlock(attempt.responseBody)}
                              </pre>
                            )}
                          </div>
                        ),
                      }))}
                    />
                  </>
                );
              })()}
          </Card>
        )}
      </div>
    );
  };

  return (
    <PageTemplate
      title="Delivery logs"
      description={
        <>
          {pagination?.total && pagination.total > filtered.length
            ? `Showing ${filtered.length} of ${pagination.total}`
            : `${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
          {stats?.total != null &&
            ` · Last updated ${formatDateTimeWithSeconds(stats.refreshedAt ?? new Date().toISOString())}`}
        </>
      }
      actions={
        <Dropdown
          disabled={exportLoading}
          menu={{
            items: [
              {
                key: 'export-header',
                type: 'group',
                label: 'Export Format',
              },
              {
                key: 'csv-all',
                label: 'All logs (CSV)',
                icon: <GatewayIcon name="DownloadOutlined" />,
                onClick: () => handleExport('all', 'csv'),
                disabled: exportLoading,
              },
              {
                key: 'json-all',
                label: 'All logs (JSON)',
                icon: <GatewayIcon name="DownloadOutlined" />,
                onClick: () => handleExport('all', 'json'),
                disabled: exportLoading,
              },
              { type: 'divider' },
              {
                key: 'csv-filtered',
                label: 'Filtered results (CSV)',
                icon: <GatewayIcon name="DownloadOutlined" />,
                onClick: () => handleExport('filtered', 'csv'),
                disabled: exportLoading,
              },
              {
                key: 'json-filtered',
                label: 'Filtered results (JSON)',
                icon: <GatewayIcon name="DownloadOutlined" />,
                onClick: () => handleExport('filtered', 'json'),
                disabled: exportLoading,
              },
            ],
          }}
        >
          <Button icon={<GatewayIcon name="DownloadOutlined" />} disabled={exportLoading} size="small">
            {exportLabel}
          </Button>
        </Dropdown>
      }
    >
      {(isInitialLogsLoading || stats) && (
        <div className="logs-summary-strip">
          {isInitialLogsLoading ? (
            <StatePanel glyph="connecting" tone="busy" title="Loading delivery logs" size="compact" />
          ) : stats ? (
            <>
              <StatPillRow
                activeFilter={statusFilter}
                onFilterChange={setStatusFilter}
                items={[
                  {
                    title: 'Total',
                    value: stats.total,
                    icon: <GatewayIcon name="DatabaseOutlined" />,
                    tone: cssVar.text.secondary,
                    filterValue: null,
                  },
                  {
                    title: 'Delivered',
                    value: stats.success,
                    icon: <GatewayIcon name="CheckCircleOutlined" />,
                    tone: cssVar.text.secondary,
                    filterValue: 'SUCCESS',
                  },
                  {
                    title: 'Failed',
                    value: stats.failed,
                    icon: <GatewayIcon name="CloseCircleOutlined" />,
                    tone: stats.failed > 0 ? cssVar.error.text : cssVar.text.secondary,
                    filterValue: 'FAILED',
                  },
                  {
                    title: 'Skipped',
                    value: stats.skipped,
                    icon: <GatewayIcon name="MinusCircleOutlined" />,
                    tone: cssVar.text.secondary,
                    filterValue: 'SKIPPED',
                  },
                  {
                    title: 'Pending',
                    value: stats.pending,
                    icon: <GatewayIcon name="ClockCircleOutlined" />,
                    tone: stats.pending > 0 ? cssVar.warning.text : cssVar.text.secondary,
                    filterValue: 'PENDING_OR_RETRYING',
                  },
                ]}
              />
              {integrationFilter && <DeliveryFollowUpSummary stats={followUpStats} />}
            </>
          ) : null}
        </div>
      )}
      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <>
          <div role="status" aria-live="polite" aria-atomic="true" className="console-visually-hidden">
            {selectedRowKeys.length} log
            {selectedRowKeys.length !== 1 ? 's' : ''} selected. Bulk actions available.
          </div>
          <div className="logs-selection-strip">
            <div className="logs-selection-content">
              <div>
                <Text weight="semibold" className="console-margin-right-2 console-text-primary">
                  {selectedRowKeys.length} selected
                </Text>
                <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                  Clear selection
                </Button>
              </div>
              <Space size={spacingToNumber(spacing[2])} wrap>
                {!isPortalSession && (
                  <Button size="small" icon={<GatewayIcon name="RedoOutlined" />} onClick={handleBulkRetry}>
                    Retry
                  </Button>
                )}
                {!isPortalSession && (
                  <Button size="small" danger icon={<GatewayIcon name="RedoOutlined" />} onClick={handleBulkForceRetry}>
                    Force retry
                  </Button>
                )}
                <Dropdown
                  trigger={['click']}
                  disabled={exportLoading}
                  menu={{
                    items: [
                      {
                        key: 'csv-selected',
                        label: 'Export selected (CSV)',
                        icon: <GatewayIcon name="DownloadOutlined" />,
                        onClick: () => handleExport('selected', 'csv'),
                        disabled: exportLoading,
                      },
                      {
                        key: 'json-selected',
                        label: 'Export selected (JSON)',
                        icon: <GatewayIcon name="DownloadOutlined" />,
                        onClick: () => handleExport('selected', 'json'),
                        disabled: exportLoading,
                      },
                    ],
                  }}
                >
                  <Button size="small" icon={<GatewayIcon name="DownloadOutlined" />} disabled={exportLoading}>
                    Export
                  </Button>
                </Dropdown>
                {!isPortalSession && (
                  <Button size="small" danger icon={<GatewayIcon name="DeleteOutlined" />} onClick={handleBulkDelete}>
                    Delete
                  </Button>
                )}
              </Space>
            </div>
          </div>
        </>
      )}
      {/* Always visible so users can apply the first filter. */}
      <div className="console-filter-toolbar">
        <Text type="label" size="sm" color="secondary">
          Filters
        </Text>
        <Select
          placeholder="Status"
          className="console-filter-field-narrow"
          allowClear
          size="small"
          value={statusFilter === 'PENDING_OR_RETRYING' ? undefined : statusFilter}
          onChange={(value) => setStatusFilter(value)}
          options={['PENDING', 'QUEUED', 'SUCCESS', 'FAILED', 'RETRYING', 'SKIPPED', 'ABANDONED'].map((status) => ({
            value: status,
            // FAILED intentionally spans abandoned deliveries server-side; the
            // label says so rather than letting the result look wrong.
            label:
              status === 'FAILED'
                ? 'Failed (including abandoned)'
                : status === 'QUEUED'
                  ? 'Pending (queued)'
                  : getStatusLabel(status),
          }))}
        />
        <RangePicker
          className="logs-date-range"
          size="small"
          format="YYYY-MM-DD"
          allowClear
          presets={DATE_RANGE_PRESETS}
          value={dateRange ? [dayjs(dateRange[0]), dayjs(dateRange[1])] : null}
          // Auto-refresh is paused while this picker is open. Re-rendering the
          // row underneath someone who is mid-selection is how a half-entered
          // range gets thrown away.
          onOpenChange={setDatePickerOpen}
          onChange={(dates) => {
            if (dates?.[0] && dates?.[1]) {
              setDateRangeWithUrl([dates[0].startOf('day').toISOString(), dates[1].endOf('day').toISOString()]);
            } else if (dates === null) {
              // Only reset when user explicitly clears (null), not during intermediate selection ([Dayjs, null])
              setDateRangeWithUrl(null);
            }
          }}
        />
        <Select
          placeholder="Integration"
          className="console-filter-field"
          allowClear
          size="small"
          value={integrationFilter}
          onChange={(value) => setIntegrationFilter(value)}
          options={integrations.map((wh) => ({ value: wh.id, label: wh.name }))}
        />
        <Select
          aria-label="Provider filter"
          placeholder="Provider"
          className="logs-provider-filter"
          allowClear
          showSearch
          optionFilterProp="label"
          size="small"
          value={providerFilter}
          onChange={(value) => setProviderFilter(value)}
          options={providerOptions}
        />
        <Select
          placeholder="Flow"
          className="console-filter-field-narrow"
          allowClear
          size="small"
          value={flowFilter}
          onChange={(value) => setFlowFilter(value)}
          options={[
            { value: 'OUTBOUND', label: 'Outbound' },
            { value: 'INBOUND', label: 'Inbound' },
            { value: 'SCHEDULED', label: 'Scheduled' },
            { value: 'COMMUNICATION', label: 'Communication' },
          ]}
        />
        <SearchInput
          value={search}
          onChange={setSearch}
          isNarrow={isNarrow}
          label="Search delivery logs"
          placeholder="Search message, target URL, or error"
          width={220}
        />
        <Button
          type="text"
          size="small"
          onClick={() => setShowMoreFilters((prev) => !prev)}
          className="console-text-secondary"
        >
          {showMoreFilters ? 'Less filters' : 'More filters'}
        </Button>
        <div className={`logs-refresh-controls${isNarrow ? ' logs-refresh-controls--narrow' : ''}`}>
          <RefreshCountdown intervalMs={refreshInterval} lastRefreshAt={latestRefreshAt} />
          <Button
            type="default"
            icon={<GatewayIcon name="ReloadOutlined" spin={manualRefreshPending} />}
            loading={false}
            onClick={handleManualRefresh}
            size="small"
          >
            {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      {showMoreFilters && (
        <div className="console-filter-toolbar">
          <Text type="label" size="sm" color="secondary">
            More filters
          </Text>
          <Select
            placeholder="Event Type"
            className="console-filter-field"
            allowClear
            size="small"
            value={eventTypeFilter}
            onChange={(value) => setEventTypeFilter(value)}
            options={eventTypes.map((type) => ({ value: type, label: type }))}
          />
          <Input
            placeholder="Error category"
            className="console-filter-field"
            allowClear
            size="small"
            value={errorCategoryFilter}
            onChange={(event) => setErrorCategoryFilter(event.target.value || undefined)}
          />
          <Input
            placeholder="Client IP"
            className="console-filter-field-narrow"
            allowClear
            size="small"
            value={clientIpFilter}
            onChange={(event) => setClientIpFilter(event.target.value.trim() || undefined)}
          />
          <Select
            placeholder="Day of week"
            className="console-filter-field-narrow"
            allowClear
            size="small"
            value={dayOfWeekFilter}
            onChange={(value) => setDayOfWeekFilter(value)}
            options={DAY_OF_WEEK_OPTIONS.map((day) => ({
              value: day,
              label: day,
            }))}
          />
          <Select
            placeholder="Hour"
            className="logs-hour-filter"
            allowClear
            size="small"
            value={hourFilter}
            onChange={(value) => setHourFilter(value)}
            options={Array.from({ length: 24 }, (_, hour) => ({
              value: String(hour),
              label: `${String(hour).padStart(2, '0')}:00`,
            }))}
          />
        </div>
      )}
      {visibleFilterChips.length > 0 && (
        <div className="logs-active-filters">
          <Text type="label" size="sm" color="secondary">
            Active filters
          </Text>
          <Space wrap size={spacingToNumber(spacing[1])}>
            {visibleFilterChips.map((chip) => (
              <Button
                key={chip.key}
                type="text"
                size="small"
                onClick={chip.onClear}
                title={`Clear filter: ${chip.label}`}
                aria-label={`Clear filter: ${chip.label}`}
              >
                {chip.label} <GatewayIcon name="CloseOutlined" aria-hidden="true" />
              </Button>
            ))}
            <Button
              type="text"
              size="small"
              onClick={() => {
                clearExportFilter('status');
                clearExportFilter('flow');
                clearExportFilter('integration');
                clearExportFilter('provider');
                clearExportFilter('eventType');
                clearExportFilter('errorCategory');
                clearExportFilter('hour');
                clearExportFilter('dayOfWeek');
                clearExportFilter('date');
                clearExportFilter('search');
              }}
              title="Clear all filters"
              aria-label="Clear all filters"
            >
              Clear all
            </Button>
          </Space>
        </div>
      )}
      <div className="logs-table-wrapper">
        <div className="logs-table-surface">
          {!isInitialLogsLoading && filtered.length === 0 ? (
            <div className="logs-empty-surface">
              <StatePanel
                title={isNarrowedToSingleDay ? 'No deliveries on this date' : 'No matching deliveries'}
                actions={
                  <>
                    <Button type="primary" onClick={() => setDateRangeWithUrl(getRangeForLastDays(7))}>
                      Search last 7 days
                    </Button>
                    <Button onClick={() => setDateRangeWithUrl(getRangeForLastDays(30))}>Last 30 days</Button>
                    <Button
                      onClick={() => {
                        setStatusFilter(undefined);
                        setIntegrationFilter(undefined);
                        setEventTypeFilter(undefined);
                        setFlowFilter(undefined);
                        setErrorCategoryFilter(undefined);
                        setHourFilter(undefined);
                        setDayOfWeekFilter(undefined);
                        setSearch('');
                        setDateRangeWithUrl(getTodayDateRange());
                      }}
                    >
                      Clear filters
                    </Button>
                  </>
                }
              />
            </div>
          ) : (
            <ModernTable<DeliveryLog>
              dataSource={filtered}
              rowKey="id"
              rowSelection={rowSelection}
              size="small"
              enableResize={true}
              stickyHeader={true}
              loading={isInitialLogsLoading}
              pagination={{
                ...getPaginationConfig(pagination?.total || 0),
                showTotal: (total, range) => `${range[0]}-${range[1]} of ${total.toLocaleString()} delivery logs`,
                showQuickJumper: pagination && pagination.totalPages > 10,
              }}
              onRow={(record) => ({
                onClick: (event) => {
                  // Leave the checkbox, links and action buttons alone.
                  const target = event.target as HTMLElement;
                  if (target.closest('button, a, input, .ant-checkbox-wrapper, .ant-dropdown-trigger')) return;
                  void openDeliveryDetail(record);
                },
                style: { cursor: 'pointer' },
              })}
              columns={[
                {
                  title: 'Time',
                  dataIndex: 'createdAt',
                  key: 'createdAt',
                  width: 160,
                  sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                  defaultSortOrder: 'descend',
                  render: (date: string) => (
                    <Text type="supporting" size="base" color="secondary">
                      {formatDateTimeWithSeconds(date)}
                    </Text>
                  ),
                },
                {
                  title: 'Integration',
                  dataIndex: 'integrationName',
                  key: 'integrationName',
                  width: 180,
                  ellipsis: true,
                  sorter: (a, b) => (a.integrationName || '').localeCompare(b.integrationName || ''),
                  render: (name: string | null, record: DeliveryLog) => {
                    const resolved =
                      name || integrations.find((i: any) => i.id === record.integrationConfigId)?.name || null;
                    return resolved ? (
                      <Text size="base" weight="semibold" maxLines={1} hasTruncateTooltip>
                        {resolved}
                      </Text>
                    ) : (
                      <Text size="base" color="secondary">
                        Unknown Integration
                      </Text>
                    );
                  },
                },
                {
                  title: 'Flow',
                  dataIndex: 'direction',
                  key: 'direction',
                  width: 96,
                  // Direction is repetitive in filtered logs, so keep it on
                  // wider screens and preserve room for status and diagnostics.
                  responsive: ['xxl'],
                  render: (_: string, record: DeliveryLog) => {
                    const direction = record.direction || 'OUTBOUND';
                    const trigger = record.triggerType || 'EVENT';
                    const label = direction === 'SCHEDULED' || trigger === 'SCHEDULE' ? 'SCHEDULED' : direction;

                    return (
                      <MetaTag variant="flow" size="small">
                        {label}
                      </MetaTag>
                    );
                  },
                },
                {
                  title: 'Event',
                  dataIndex: 'eventType',
                  key: 'eventType',
                  width: 145,
                  ellipsis: true,
                  sorter: (a, b) => (a.eventType || '').localeCompare(b.eventType || ''),
                  render: (event: string | null) =>
                    event ? (
                      <MetaTag variant="event" size="small">
                        {event}
                      </MetaTag>
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  key: 'status',
                  width: 124,
                  sorter: (a, b) => a.status.localeCompare(b.status),
                  filters: [
                    { text: 'Delivered', value: 'SUCCESS' },
                    { text: 'Failed', value: 'FAILED' },
                    { text: 'Retrying', value: 'RETRYING' },
                    { text: 'Pending', value: 'PENDING' },
                    { text: 'Pending (queued)', value: 'QUEUED' },
                    { text: 'Skipped', value: 'SKIPPED' },
                    { text: 'Abandoned', value: 'ABANDONED' },
                  ],
                  onFilter: (value, record) => record.status === value,
                  render: (status: string, record: any) => (
                    // ABANDONED under a "Failed" filter looks like a contradiction.
                    // It is not: the backend treats FAILED as {$in: [FAILED, ABANDONED]}
                    // and the summary counts both, because abandoned *is* failed —
                    // failed with its retries used up. Say so on hover.
                    <Tooltip
                      title={
                        status === 'ABANDONED'
                          ? 'Failed, and its retries are exhausted — no further attempts will be made. Counted under Failed.'
                          : status === 'FAILED'
                            ? 'Failed without a retry being scheduled.'
                            : undefined
                      }
                    >
                      <div onClick={() => handleQuickStatusFilter(status)} className="console-cursor-pointer">
                        <StatusBadge status={status as any} size="default" />
                        <FollowUpTag followUp={record?.followUp} />
                        <StageSummaryTags summary={record?.stageSummary} />
                      </div>
                    </Tooltip>
                  ),
                },
                {
                  title: 'Category',
                  dataIndex: 'errorCategory',
                  key: 'errorCategory',
                  width: 160,
                  responsive: ['xxl'],
                  ellipsis: true,
                  render: (category?: string | null) =>
                    category ? (
                      <MetaTag variant="category" size="small">
                        {category}
                      </MetaTag>
                    ) : (
                      <Text type="supporting" color="secondary">
                        —
                      </Text>
                    ),
                },
                {
                  title: 'HTTP Status',
                  dataIndex: 'responseStatus',
                  key: 'responseStatus',
                  align: 'right',
                  width: 78,
                  sorter: (a, b) => (a.responseStatus || 0) - (b.responseStatus || 0),
                  render: (status: number | null) => (
                    <code className={status != null && status >= 400 ? 'console-text-error' : undefined}>
                      {status ?? '—'}
                    </code>
                  ),
                },
                {
                  title: 'Latency',
                  dataIndex: 'responseTimeMs',
                  key: 'responseTimeMs',
                  align: 'right',
                  width: 88,
                  sorter: (a, b) => a.responseTimeMs - b.responseTimeMs,
                  render: (val: number) => {
                    return <Text type="code">{val} ms</Text>;
                  },
                },
                {
                  title: 'Attempts',
                  dataIndex: 'attemptCount',
                  key: 'attemptCount',
                  align: 'right',
                  width: 76,
                  sorter: (a, b) => a.attemptCount - b.attemptCount,
                  resizable: false,
                  render: (val: number, record) => (
                    <Space size={spacingToNumber(spacing[1])} className="console-flex-end-full">
                      <GatewayIcon name="HistoryOutlined" className="console-text-secondary" />
                      <Text size="base" weight="semibold" color="secondary">
                        {val}
                      </Text>
                      {record.status === 'RETRYING' && (
                        <GatewayIcon name="ReloadOutlined" spin className="console-text-warning" />
                      )}
                    </Space>
                  ),
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  width: 112,
                  align: 'center',
                  resizable: false,
                  // Keep actions in normal table flow: a fixed clone can cover
                  // status and delivery diagnostics in the compact console shell.
                  render: (_: unknown, record: DeliveryLog) => {
                    const isScriptJob = isScriptJobLogLike(record);
                    // ABANDONED is failed with its automatic retries used up, so it
                    // is the status most likely to need a human retry — yet it was
                    // excluded here, which is why this column read "—" on every row
                    // of a Failed-filtered view. The replay endpoint accepts both
                    // (routes/logs.js: replayableStatuses), and the replay tab in the
                    // expanded row already offered both.
                    const canRetry = ['FAILED', 'ABANDONED'].includes(record.status) && !isScriptJob;
                    const isRetrying = retryingLogs[record.id];

                    if (!canRetry || isPortalSession) {
                      if (isScriptJob && ['FAILED', 'ABANDONED'].includes(record.status)) {
                        return (
                          <Text type="supporting" color="secondary">
                            Script job
                          </Text>
                        );
                      }
                      return (
                        <Text type="supporting" color="secondary">
                          —
                        </Text>
                      );
                    }

                    return (
                      <Space size={spacingToNumber(spacing[1])}>
                        <Button
                          type="text"
                          size="small"
                          icon={<GatewayIcon name="RedoOutlined" spin={isRetrying} />}
                          disabled={!canRetry || isRetrying}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetry(record);
                          }}
                          className={canRetry ? 'console-text-link logs-retry-action' : 'console-text-secondary'}
                        >
                          Retry
                        </Button>
                        <Dropdown
                          trigger={['click']}
                          placement="bottomRight"
                          menu={{
                            items: [
                              {
                                key: 'force-retry',
                                label: 'Force retry',
                                danger: true,
                                disabled: isRetrying,
                              },
                            ],
                            onClick: ({ key }) => {
                              if (key === 'force-retry') confirmForceRetry(record);
                            },
                          }}
                        >
                          <Button
                            type="text"
                            size="small"
                            icon={<GatewayIcon name="MoreOutlined" aria-hidden="true" />}
                            aria-label={`More actions for ${record.integrationName || 'delivery'}`}
                            title="More actions"
                            onClick={(event) => event.stopPropagation()}
                          />
                        </Dropdown>
                      </Space>
                    );
                  },
                },
              ]}
            />
          )}
        </div>
      </div>

      <Drawer
        title={
          detailRecord ? (
            <div className="logs-drawer-title">
              <StatusBadge status={detailRecord.status as any} size="default" />
              <span className="logs-drawer-title-name">{detailRecord.integrationName || 'Delivery'}</span>
              <Text type="supporting" size="sm" color="secondary" textWrap="nowrap">
                {formatDateTimeWithSeconds(detailRecord.createdAt)}
              </Text>
            </div>
          ) : (
            'Delivery'
          )
        }
        placement="right"
        width={screens.xxl ? 920 : screens.lg ? 720 : '100%'}
        mask={false}
        open={Boolean(detailRecord)}
        onClose={() => setDetailRecord(null)}
        destroyOnClose
        styles={{ body: { padding: spacing[3] } }}
        extra={
          detailRecord ? (
            <Space size={spacingToNumber(spacing[1])}>
              {detailIndex >= 0 && (
                <>
                  <Text type="supporting" size="sm" color="secondary" textWrap="nowrap">
                    {detailIndex + 1} of {filtered.length}
                  </Text>
                  <Tooltip title="Previous delivery (k)">
                    <Button
                      size="small"
                      icon={<GatewayIcon name="LeftOutlined" />}
                      aria-label="Previous delivery"
                      disabled={detailIndex <= 0}
                      onClick={() => stepDetail(-1)}
                    />
                  </Tooltip>
                  <Tooltip title="Next delivery (j)">
                    <Button
                      size="small"
                      icon={<GatewayIcon name="RightOutlined" />}
                      aria-label="Next delivery"
                      disabled={detailIndex >= filtered.length - 1}
                      onClick={() => stepDetail(1)}
                    />
                  </Tooltip>
                </>
              )}
              {['FAILED', 'ABANDONED'].includes(detailRecord.status) &&
                !isScriptJobLogLike(detailRecord) &&
                !isPortalSession && (
                  <Button
                    size="small"
                    type="primary"
                    icon={<GatewayIcon name="ReloadOutlined" />}
                    loading={retryingLogs[detailRecord.id]}
                    onClick={() => handleRetry(detailRecord)}
                  >
                    Retry
                  </Button>
                )}
            </Space>
          ) : null
        }
      >
        {detailRecord && renderDeliveryDetail(detailRecord)}
      </Drawer>
    </PageTemplate>
  );
};
