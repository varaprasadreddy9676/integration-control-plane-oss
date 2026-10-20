import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Select,
  Space,
  Tag,
  Typography,
  Timeline,
  Divider,
  Tabs,
  Grid,
  Dropdown,
  Modal,
  Skeleton,
  Tooltip,
  Drawer,
} from 'antd';
import {
  DownloadOutlined,
  RedoOutlined,
  HistoryOutlined,
  ReloadOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
  DatabaseOutlined,
  DeleteOutlined,
  CopyOutlined,
  LeftOutlined,
  RightOutlined,
  EyeOutlined,
  EyeInvisibleOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../../components/common/PageHeader';
import { ModernTable } from '../../../components/common/ModernTable';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { MetaTag } from '../../../components/common/MetaTag';
import { StatPillRow } from '../../../components/common/StatPillRow';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';
import { StatePanel } from '../../../components/common/StatePanel';
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
  type PaginatedResponse,
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
import dayjs, { type Dayjs } from 'dayjs';

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
  { label: 'Today', value: () => [dayjs().startOf('day'), dayjs().endOf('day')] as [Dayjs, Dayjs] },
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

const SPAN_KIND_COLOR: Record<string, string> = {
  AUTH: 'var(--color-text-secondary)',
  POLICY: 'var(--color-info-text)',
  TRANSFORM: 'var(--color-text-secondary)',
  HTTP: 'var(--color-text-secondary)',
  LOG: 'var(--color-text-secondary)',
};

const TraceSpanRow = ({
  span,
  depth,
  totalDuration,
}: {
  span: ExecutionSpan;
  depth: number;
  totalDuration: number;
}) => {
  const { token } = useDesignTokens();
  const [open, setOpen] = useState(false);
  const kindColor = SPAN_KIND_COLOR[span.kind] || 'var(--color-info-text)';
  const isError = span.status === 'error';
  const barColor = kindColor;
  const pct = Math.max(2, ((span.duration || 0) / (totalDuration || 1)) * 100);
  const hasDetail = span.requestBody || span.responseBody || span.error || span.message;
  return (
    <div style={{ marginBottom: 6, paddingLeft: depth * 16 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: hasDetail ? 'pointer' : 'default' }}
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        <span
          style={{
            minWidth: 76,
            fontSize: 11,
            color: token.colorTextSecondary,
            fontFamily: 'monospace',
            textAlign: 'right',
          }}
        >
          {span.duration != null ? `${span.duration}ms` : ''}
        </span>
        {isError && (
          <span
            aria-label="Span failed"
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--color-error-text)',
              flexShrink: 0,
            }}
          />
        )}
        <Tag
          color={barColor}
          style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', minWidth: 64, textAlign: 'center' }}
        >
          {span.kind}
        </Tag>
        <span style={{ flex: 1, fontSize: 12, color: isError ? 'var(--color-error-text)' : token.colorText }}>
          {span.name}
          {span.method ? ` ${span.method}` : ''}
          {span.url ? (
            <span style={{ color: token.colorTextSecondary, fontFamily: 'monospace', fontSize: 11 }}> {span.url}</span>
          ) : null}
          {span.message ? <span style={{ color: token.colorTextSecondary }}> — {span.message}</span> : null}
          {span.statusCode != null ? (
            <Tag style={{ marginLeft: 6, fontSize: 10 }} color={span.statusCode < 400 ? 'green' : 'red'}>
              {span.statusCode}
            </Tag>
          ) : null}
          {span.authType ? (
            <span style={{ marginLeft: 6, fontSize: 10, color: token.colorTextSecondary }}>[{span.authType}]</span>
          ) : null}
          {span.attempt != null ? (
            <span style={{ marginLeft: 6, fontSize: 10, color: token.colorTextSecondary }}>attempt {span.attempt}</span>
          ) : null}
        </span>
        <div
          style={{
            width: 120,
            height: 8,
            background: withAlpha(barColor, 0.15),
            borderRadius: 4,
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 4 }} />
        </div>
      </div>
      {open && hasDetail && (
        <div
          style={{
            marginTop: 4,
            marginLeft: 84,
            paddingLeft: 8,
            borderLeft: `2px solid ${isError ? 'var(--color-error-text)' : barColor}`,
          }}
        >
          {span.error && (
            <div style={{ fontSize: 11, color: 'var(--color-error-text)', marginBottom: 4 }}>{span.error}</div>
          )}
          {span.requestBody && (
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 10, color: token.colorTextSecondary, marginBottom: 2 }}>Request</div>
              <pre
                style={{
                  fontSize: 10,
                  margin: 0,
                  background: token.colorFillQuaternary,
                  padding: '4px 8px',
                  borderRadius: 4,
                  maxHeight: 120,
                  overflow: 'auto',
                  color: token.colorText,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {typeof span.requestBody === 'string' ? span.requestBody : JSON.stringify(span.requestBody, null, 2)}
              </pre>
            </div>
          )}
          {span.responseBody && (
            <div>
              <div style={{ fontSize: 10, color: token.colorTextSecondary, marginBottom: 2 }}>Response</div>
              <pre
                style={{
                  fontSize: 10,
                  margin: 0,
                  background: token.colorFillQuaternary,
                  padding: '4px 8px',
                  borderRadius: 4,
                  maxHeight: 120,
                  overflow: 'auto',
                  color: token.colorText,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
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
  const { token, spacing } = useDesignTokens();
  const totalDuration = spans.reduce((s, sp) => s + (sp.duration || 0), 0) || 1;
  return (
    <div style={{ padding: `${spacing[2]} 0` }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: spacing[2], fontSize: 11, color: token.colorTextSecondary }}>
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
  const { spacing, token, borderRadius, shadows } = useDesignTokens();
  const { isAdmin } = usePermissions();
  // cURL previews mask credentials by default — they get pasted into tickets.
  // Admins can reveal them to get a command that actually runs; deliberately
  // per-visit state, so it never persists into someone's next session.
  const [revealCredentials, setRevealCredentials] = useState(false);

  // Revealing a credential is a deliberate exception to the default masking,
  // and the resulting command carries a working secret. Record who did it and
  // when. Flushed immediately rather than left in the batch queue — an audit
  // event that a closed tab can discard is not an audit event.
  const toggleRevealCredentials = () => {
    setRevealCredentials((wasRevealed) => {
      const nowRevealed = !wasRevealed;
      if (nowRevealed) {
        activityTracker.track({
          event: ACTIVITY_EVENTS.CREDENTIAL_REVEALED,
          metadata: {
            surface: 'delivery-log-curl',
            integrationId: detailRecord?.integrationConfigId ?? null,
            integrationName: detailRecord?.integrationName ?? null,
            logId: detailRecord?.id ?? null,
            orgId,
          },
        });
        void activityTracker.flush();
      }
      return nowRevealed;
    });
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
      chips.push({ key: 'status', label: `Status: ${statusFilter}`, onClear: () => clearExportFilter('status') });
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
      chips.push({ key: 'flow', label: `Flow: ${flowLabel}`, onClear: () => clearExportFilter('flow') });
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
      chips.push({ key: 'dayOfWeek', label: `Day: ${dayOfWeekFilter}`, onClear: () => clearExportFilter('dayOfWeek') });
    }
    if (dateRange?.[0] && dateRange?.[1]) {
      const startLabel = dayjs(dateRange[0]).format('YYYY-MM-DD');
      const endLabel = dayjs(dateRange[1]).format('YYYY-MM-DD');
      chips.push({ key: 'date', label: `Date: ${startLabel} → ${endLabel}`, onClear: () => clearExportFilter('date') });
    }
    const trimmedSearch = search.trim();
    if (trimmedSearch) {
      const display = trimmedSearch.length > 28 ? `${trimmedSearch.slice(0, 28)}…` : trimmedSearch;
      chips.push({ key: 'search', label: `Search: ${display}`, onClear: () => clearExportFilter('search') });
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

  const tagTone = (base: string) => ({
    borderRadius: borderRadius.full,
    borderColor: withAlpha(base, 0.25),
    background: withAlpha(base, 0.1),
    color: base,
    fontWeight: 700,
    paddingInline: spacing[2],
    paddingBlock: spacing['0.5'],
    fontSize: token.fontSizeSM,
  });
  const mutedSurface = withAlpha(token.colorTextBase, 0.04);
  const errorSurface = withAlpha(colors.error[500], 0.1);
  const panelStyle = {
    borderRadius: token.borderRadiusLG,
    border: `1px solid ${token.colorBorderSecondary}`,
    background: token.colorBgContainer,
    boxShadow: shadows.xl,
  } as const;
  const tableFullBleedStyle = isNarrow
    ? {}
    : {
        marginLeft: 0,
        marginRight: `-${spacing[4]}`,
        paddingRight: spacing[1],
      };

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
        const fullLog = await getLogById(record.id);
        if (fullLog) {
          setExpandedLogDetails((prev) => ({ ...prev, [record.id]: fullLog }));
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
        await exportSelectedLogs(selectedRowKeys as string[], format, { onProgress });
        finish(`Exported ${count} log(s)`);
      } else {
        // For all/filtered, use backend export
        if (format === 'csv') {
          await exportLogsToCsv(exportType === 'all' ? {} : filters, { onProgress });
        } else {
          await exportLogsToJson(exportType === 'all' ? {} : filters, { onProgress });
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
    // A skipped delivery never sent a request: no HTTP status, no
    // cURL — what the operator needs is the event that was skipped.
    const isSkippedLog = fullLog.status === 'SKIPPED';
    const showSourceEvent = hasSourceEvent(fullLog);
    const stateColor = isSkippedLog ? colors.warning : colors.error;
    // Script jobs have no real HTTP request to reconstruct — there's no
    // targetUrl/payload, so generateCurlCommand would just produce a
    // meaningless `curl -X POST "" -d '{}'`. Show the script's actual
    // console output instead (see 'script-logs' tab below).
    const curlCommand =
      !isScriptJobLog && !isSkippedLog && fullLog.__KEEP_integrationConfig__
        ? generateCurlCommand(fullLog.__KEEP_integrationConfig__, fullLog.requestPayload, fullLog.requestHeaders, {
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
        { targetUrl: fullLog.targetUrl, httpMethod: fullLog.httpMethod || 'POST' } as any,
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
    const formattedResponseBody = formatForCodeBlock(fullLog.responseBody);
    const isHl7Log = isHl7LogLike({
      httpMethod: fullLog.httpMethod,
      metadata: (fullLog as any).metadata,
      requestPayload: fullLog.requestPayload,
      responseBody: fullLog.responseBody,
    });

    return (
      <div style={{ padding: 0, background: 'transparent' }}>
        {isLoading ? (
          <div style={{ padding: spacing[3] }}>
            <Skeleton active paragraph={{ rows: 4 }} />
            <Skeleton active paragraph={{ rows: 6 }} />
          </div>
        ) : (
          <Card
            variant="outlined"
            style={{ ...panelStyle, boxShadow: 'none', margin: 0 }}
            styles={{
              body: { padding: spacing[2], display: 'flex', flexDirection: 'column', gap: spacing[2] },
            }}
          >
            {/* Why it failed, first. The payload and cURL below are
                            reference material — the operator opened this row to
                            find out what went wrong, and previously had to scroll
                            past hundreds of lines of body to reach it. */}
            {fullLog.errorMessage && (
              <div
                style={{
                  border: `1px solid ${withAlpha(stateColor[500], 0.35)}`,
                  background: isSkippedLog ? withAlpha(colors.warning[500], 0.1) : errorSurface,
                  borderRadius: token.borderRadiusLG,
                  padding: spacing[3],
                  display: 'flex',
                  flexDirection: 'column',
                  gap: spacing[2],
                }}
              >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: spacing[2], flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ fontSize: 15, color: stateColor[800] }}>
                    {isSkippedLog
                      ? 'Delivery skipped'
                      : fullLog.status === 'ABANDONED'
                        ? 'Delivery abandoned'
                        : 'Delivery failed'}
                    {!isSkippedLog && fullLog.responseStatus ? ` · HTTP ${fullLog.responseStatus}` : ''}
                  </Typography.Text>
                  {fullLog.status === 'ABANDONED' && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      retries exhausted — no further attempts will be made
                    </Typography.Text>
                  )}
                </div>

                <Typography.Text
                  style={{
                    fontSize: 13,
                    color: stateColor[800],
                    fontFamily: 'ui-monospace, monospace',
                    whiteSpace: 'pre-wrap',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {fullLog.errorMessage}
                </Typography.Text>

                <div
                  style={{
                    display: 'flex',
                    gap: spacing[4],
                    flexWrap: 'wrap',
                    fontSize: 12,
                    color: cssVar.text.secondary,
                  }}
                >
                  {fullLog.targetUrl && (
                    <span style={{ fontFamily: 'ui-monospace, monospace' }}>
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

            {(curlCommand || isCommunicationLog || isHl7Log || hasScriptLogs || showSourceEvent) && (
              <Tabs
                size="small"
                defaultActiveKey={
                  isSkippedLog && showSourceEvent
                    ? 'source-event'
                    : isHl7Log
                      ? 'hl7'
                      : isCommunicationLog
                        ? 'provider'
                        : hasScriptLogs
                          ? 'script-logs'
                          : curlCommand
                            ? 'curl'
                            : 'source-event'
                }
                items={[
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
                  ...(hasScriptLogs
                    ? [
                        {
                          key: 'script-logs',
                          label: 'Script Output',
                          children: (
                            <div style={{ position: 'relative' }}>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
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
                                style={{
                                  position: 'absolute',
                                  top: spacing[2],
                                  left: spacing[2],
                                  zIndex: 1,
                                }}
                              />
                              <div
                                style={{
                                  background: 'var(--color-code-bg)',
                                  borderRadius: token.borderRadiusLG,
                                  padding: spacing[3],
                                  paddingTop: 40,
                                  fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                  fontSize: token.fontSizeSM,
                                  maxHeight: 280,
                                  overflow: 'auto',
                                }}
                              >
                                {scriptLogs.map((entry: any, i: number) => (
                                  <div
                                    key={i}
                                    style={{
                                      display: 'flex',
                                      gap: spacing[2],
                                      padding: '3px 0',
                                      borderBottom:
                                        i < scriptLogs.length - 1 ? '1px solid rgba(255,255,255,0.06)' : 'none',
                                    }}
                                  >
                                    <span style={{ color: 'var(--color-text-muted)', flexShrink: 0, fontSize: 11 }}>
                                      {new Date(entry.ts).toLocaleTimeString()}
                                    </span>
                                    <span
                                      style={{
                                        color:
                                          entry.level === 'error'
                                            ? 'var(--color-error-text)'
                                            : entry.level === 'warn'
                                              ? 'var(--color-warning-text)'
                                              : 'var(--color-text-secondary)',
                                        fontWeight: 600,
                                        flexShrink: 0,
                                      }}
                                    >
                                      {String(entry.level).toUpperCase()}
                                    </span>
                                    <span style={{ color: 'var(--color-text-primary)', wordBreak: 'break-word' }}>
                                      {entry.message}
                                    </span>
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
                            <div style={{ position: 'relative' }}>
                              <Button
                                size="small"
                                icon={<CopyOutlined />}
                                aria-label="Copy provider details"
                                onClick={() => copyToClipboard(formatForCodeBlock(providerDetails))}
                                style={{
                                  position: 'absolute',
                                  top: spacing[2],
                                  left: spacing[2],
                                  zIndex: 1,
                                }}
                              />
                              <pre
                                className="clamped-code-block"
                                tabIndex={0}
                                style={{
                                  background: withAlpha(cssVar.bg.overlay, 0.96),
                                  color: cssVar.text.primary,
                                  padding: spacing[3],
                                  borderRadius: token.borderRadiusLG,
                                  overflow: 'auto',
                                  maxHeight: 280,
                                  border: `1px solid ${cssVar.border.default}`,
                                  fontSize: token.fontSizeSM,
                                  whiteSpace: 'pre-wrap',
                                  overflowWrap: 'anywhere',
                                  wordBreak: 'break-word',
                                  outline: 'none',
                                }}
                              >
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
                              <div style={{ position: 'relative' }}>
                                {outboundCurlCommand && (
                                  <div
                                    style={{
                                      marginBottom: spacing[2],
                                      fontSize: token.fontSizeSM,
                                      color: cssVar.text.secondary,
                                    }}
                                  >
                                    Caller → Gateway
                                  </div>
                                )}
                                <div
                                  style={{
                                    position: 'absolute',
                                    top: outboundCurlCommand ? 28 : spacing[2],
                                    left: spacing[2],
                                    zIndex: 1,
                                    display: 'flex',
                                    gap: spacing[1],
                                  }}
                                >
                                  <Button
                                    size="small"
                                    icon={<CopyOutlined />}
                                    aria-label="Copy inbound cURL"
                                    onClick={() => copyToClipboard(curlCommand || '')}
                                  />
                                  {isAdmin() && (
                                    <Tooltip
                                      title={
                                        revealCredentials
                                          ? 'Hide credentials'
                                          : 'Show real credentials so the command runs as-is. Do not paste the result into a ticket.'
                                      }
                                    >
                                      <Button
                                        size="small"
                                        icon={revealCredentials ? <EyeInvisibleOutlined /> : <EyeOutlined />}
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
                                <pre
                                  className="clamped-code-block"
                                  ref={(el) => {
                                    if (el) {
                                      el.onkeydown = (e) => {
                                        if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                                          e.preventDefault();
                                          const selection = window.getSelection();
                                          const range = document.createRange();
                                          range.selectNodeContents(el);
                                          selection?.removeAllRanges();
                                          selection?.addRange(range);
                                        }
                                      };
                                    }
                                  }}
                                  tabIndex={0}
                                  style={{
                                    background: withAlpha(cssVar.bg.overlay, 0.96),
                                    color: cssVar.text.primary,
                                    padding: spacing[3],
                                    borderRadius: token.borderRadiusLG,
                                    overflow: 'auto',
                                    maxHeight: 280,
                                    border: `1px solid ${cssVar.border.default}`,
                                    fontSize: token.fontSizeSM,
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                    wordBreak: 'break-word',
                                    outline: 'none',
                                  }}
                                >
                                  {curlCommand}
                                </pre>
                              </div>
                            ),
                          },
                          ...(outboundCurlCommand
                            ? [
                                {
                                  key: 'outbound-curl',
                                  label: 'Outbound cURL',
                                  children: (
                                    <div style={{ position: 'relative' }}>
                                      <div
                                        style={{
                                          marginBottom: spacing[2],
                                          fontSize: token.fontSizeSM,
                                          color: cssVar.text.secondary,
                                        }}
                                      >
                                        Gateway → External API
                                      </div>
                                      <Button
                                        size="small"
                                        icon={<CopyOutlined />}
                                        aria-label="Copy outbound cURL"
                                        onClick={() => copyToClipboard(outboundCurlCommand)}
                                        style={{
                                          position: 'absolute',
                                          top: 28,
                                          left: spacing[2],
                                          zIndex: 1,
                                        }}
                                      />
                                      <pre
                                        className="clamped-code-block"
                                        ref={(el) => {
                                          if (el) {
                                            el.onkeydown = (e) => {
                                              if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                                                e.preventDefault();
                                                const selection = window.getSelection();
                                                const range = document.createRange();
                                                range.selectNodeContents(el);
                                                selection?.removeAllRanges();
                                                selection?.addRange(range);
                                              }
                                            };
                                          }
                                        }}
                                        tabIndex={0}
                                        style={{
                                          background: withAlpha(cssVar.bg.overlay, 0.96),
                                          color: cssVar.text.primary,
                                          padding: spacing[3],
                                          borderRadius: token.borderRadiusLG,
                                          overflow: 'auto',
                                          maxHeight: 280,
                                          border: `1px solid ${cssVar.border.default}`,
                                          fontSize: token.fontSizeSM,
                                          whiteSpace: 'pre-wrap',
                                          overflowWrap: 'anywhere',
                                          wordBreak: 'break-word',
                                          outline: 'none',
                                        }}
                                      >
                                        {outboundCurlCommand}
                                      </pre>
                                    </div>
                                  ),
                                },
                              ]
                            : []),
                        ]),
                  ...(callerInfo
                    ? [{ key: 'caller', label: 'Caller', children: <CallerCard info={callerInfo} onFilterIp={showCallsFromIp} /> }]
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
                      <div style={{ position: 'relative' }}>
                        <Button
                          size="small"
                          icon={<CopyOutlined />}
                          aria-label="Copy response body"
                          onClick={() => copyToClipboard(formattedResponseBody)}
                          style={{
                            position: 'absolute',
                            top: spacing[2],
                            left: spacing[2],
                            zIndex: 1,
                          }}
                        />
                        <pre
                          className="clamped-code-block"
                          ref={(el) => {
                            if (el) {
                              el.onkeydown = (e) => {
                                if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
                                  e.preventDefault();
                                  const selection = window.getSelection();
                                  const range = document.createRange();
                                  range.selectNodeContents(el);
                                  selection?.removeAllRanges();
                                  selection?.addRange(range);
                                }
                              };
                            }
                          }}
                          tabIndex={0}
                          style={{
                            background: mutedSurface,
                            color: token.colorText,
                            padding: spacing[3],
                            borderRadius: token.borderRadiusLG,
                            overflow: 'auto',
                            maxHeight: 280,
                            fontSize: token.fontSizeSM,
                            whiteSpace: 'pre-wrap',
                            overflowWrap: 'anywhere',
                            wordBreak: 'break-word',
                            outline: 'none',
                          }}
                        >
                          {formattedResponseBody}
                        </pre>
                      </div>
                    ),
                  },
                  // The gateway records an execution trace per
                  // delivery and never showed it. Only offered when
                  // the record actually carries a traceId. Inbound calls that
                  // have the Trace tab already see these same stages there, with
                  // bodies and retries, so the Timeline would only repeat it.
                  ...((fullLog as any).traceId && !(isInboundLog && (fullLog as any).executionTrace?.length)
                    ? [
                        {
                          key: 'timeline',
                          label: 'Timeline',
                          children: <DeliveryTraceTimeline traceId={(fullLog as any).traceId} />,
                        },
                      ]
                    : []),
                ]}
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
                    <Divider style={{ margin: `${spacing[2]} 0` }} />
                    <Typography.Text strong>
                      {onlyLastAttemptShown
                        ? `Retry History (last of ${totalAttempts} attempts)`
                        : `Retry History (${totalAttempts} ${totalAttempts === 1 ? 'attempt' : 'attempts'})`}
                    </Typography.Text>
                    <Timeline
                      style={{ marginTop: spacing[2] }}
                      items={fullLog.retryAttempts.map((attempt) => ({
                        color:
                          attempt.status === 'SUCCESS'
                            ? colors.success[600]
                            : attempt.status === 'FAILED'
                              ? colors.error[600]
                              : colors.warning[600],
                        dot:
                          attempt.status === 'SUCCESS' ? (
                            <CheckCircleOutlined style={{ fontSize: 14 }} />
                          ) : attempt.status === 'FAILED' ? (
                            <CloseCircleOutlined style={{ fontSize: 14 }} />
                          ) : (
                            <ClockCircleOutlined style={{ fontSize: 14 }} />
                          ),
                        children: (
                          <div>
                            <div style={{ marginBottom: spacing[1] }}>
                              <Space size={spacingToNumber(spacing[2])}>
                                <Tag
                                  style={tagTone(
                                    attempt.status === 'SUCCESS'
                                      ? colors.success[600]
                                      : attempt.status === 'FAILED'
                                        ? colors.error[600]
                                        : colors.warning[600]
                                  )}
                                >
                                  Attempt #{attempt.attemptNumber}
                                </Tag>
                                <Typography.Text
                                  type="secondary"
                                  style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}
                                >
                                  {formatDateTime(attempt.attemptedAt)}
                                </Typography.Text>
                                {attempt.responseStatus && (
                                  <Tag
                                    style={tagTone(
                                      attempt.responseStatus >= 200 && attempt.responseStatus < 300
                                        ? colors.success[600]
                                        : colors.error[600]
                                    )}
                                  >
                                    HTTP {attempt.responseStatus}
                                  </Tag>
                                )}
                                {attempt.responseTimeMs && (
                                  <Typography.Text
                                    type="secondary"
                                    style={{ fontSize: token.fontSizeSM, color: cssVar.text.secondary }}
                                  >
                                    {attempt.responseTimeMs}ms
                                  </Typography.Text>
                                )}
                              </Space>
                            </div>
                            {attempt.retryReason && (
                              <Typography.Text
                                type="secondary"
                                style={{
                                  fontSize: token.fontSizeSM,
                                  display: 'block',
                                  marginBottom: spacing[1],
                                  color: cssVar.text.secondary,
                                }}
                              >
                                Reason: {attempt.retryReason}
                              </Typography.Text>
                            )}
                            {attempt.errorMessage &&
                              (attempt.errorMessage === fullLog.errorMessage ? (
                                // Already shown verbatim in the "Error Details" box above —
                                // repeating it here just doubles the same text on screen.
                                <Typography.Text
                                  type="secondary"
                                  style={{
                                    fontSize: token.fontSizeSM,
                                    display: 'block',
                                    marginTop: spacing[2],
                                    fontStyle: 'italic',
                                  }}
                                >
                                  Same error as shown in Error Details above.
                                </Typography.Text>
                              ) : (
                                <pre
                                  style={{
                                    background: errorSurface,
                                    color: colors.error[700],
                                    padding: spacing[2],
                                    borderRadius: token.borderRadiusSM,
                                    fontSize: token.fontSizeSM,
                                    marginTop: spacing[2],
                                    marginBottom: spacing[2],
                                  }}
                                >
                                  {attempt.errorMessage}
                                </pre>
                              ))}
                            {attempt.responseBody && (
                              <pre
                                style={{
                                  background: mutedSurface,
                                  color: token.colorText,
                                  padding: spacing[2],
                                  borderRadius: token.borderRadiusSM,
                                  fontSize: token.fontSizeSM,
                                  maxHeight: 150,
                                  overflow: 'auto',
                                  marginTop: spacing[2],
                                }}
                              >
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
    <div>
      <PageHeader
        title="Delivery logs"
        statusChips={
          [
            {
              // "15 records" next to "Failed: 22" read as a contradiction. 15 is
              // this page; 22 is the filtered total.
              label:
                pagination?.total && pagination.total > filtered.length
                  ? `Showing ${filtered.length} of ${pagination.total}`
                  : `${filtered.length} record${filtered.length === 1 ? '' : 's'}`,
            },
            stats?.total != null
              ? { label: `Last updated: ${formatDateTimeWithSeconds(stats?.refreshedAt ?? new Date().toISOString())}` }
              : undefined,
          ].filter(Boolean) as Array<{ label: string; color?: string }>
        }
        compact
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
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('all', 'csv'),
                  disabled: exportLoading,
                },
                {
                  key: 'json-all',
                  label: 'All logs (JSON)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('all', 'json'),
                  disabled: exportLoading,
                },
                { type: 'divider' },
                {
                  key: 'csv-filtered',
                  label: 'Filtered results (CSV)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('filtered', 'csv'),
                  disabled: exportLoading,
                },
                {
                  key: 'json-filtered',
                  label: 'Filtered results (JSON)',
                  icon: <DownloadOutlined />,
                  onClick: () => handleExport('filtered', 'json'),
                  disabled: exportLoading,
                },
              ],
            }}
          >
            <Button icon={<DownloadOutlined />} disabled={exportLoading} size="small">
              {exportLabel}
            </Button>
          </Dropdown>
        }
      />
      {(isInitialLogsLoading || stats) && (
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            marginBottom: spacing[2],
          }}
        >
          {isInitialLogsLoading ? (
            <div
              role="status"
              aria-live="polite"
              aria-busy="true"
              style={{ display: 'flex', flexWrap: 'wrap', gap: spacing[2], alignItems: 'center' }}
            >
              <Typography.Text type="secondary" style={{ fontSize: 12, marginRight: spacing[2] }}>
                Loading delivery logs...
              </Typography.Text>
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton.Input key={i} active size="small" style={{ width: 100, borderRadius: borderRadius.full }} />
              ))}
            </div>
          ) : stats ? (
            <StatPillRow
              activeFilter={statusFilter}
              onFilterChange={setStatusFilter}
              items={[
                {
                  title: 'Total',
                  value: stats.total,
                  icon: <DatabaseOutlined />,
                  tone: cssVar.text.secondary,
                  filterValue: null,
                },
                {
                  title: 'Success',
                  value: stats.success,
                  icon: <CheckCircleOutlined />,
                  tone: cssVar.text.secondary,
                  filterValue: 'SUCCESS',
                },
                {
                  title: 'Failed',
                  value: stats.failed,
                  icon: <CloseCircleOutlined />,
                  tone: stats.failed > 0 ? cssVar.error.text : cssVar.text.secondary,
                  filterValue: 'FAILED',
                },
                {
                  title: 'Skipped',
                  value: stats.skipped,
                  icon: <MinusCircleOutlined />,
                  tone: cssVar.text.secondary,
                  filterValue: 'SKIPPED',
                },
                {
                  title: 'Pending',
                  value: stats.pending,
                  icon: <ClockCircleOutlined />,
                  tone: stats.pending > 0 ? cssVar.warning.text : cssVar.text.secondary,
                  filterValue: 'PENDING_OR_RETRYING',
                },
              ]}
            />
          ) : null}
        </div>
      )}
      {/* Bulk Action Bar */}
      {selectedRowKeys.length > 0 && (
        <>
          <div
            role="status"
            aria-live="polite"
            aria-atomic="true"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              overflow: 'hidden',
              clip: 'rect(0, 0, 0, 0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {selectedRowKeys.length} log{selectedRowKeys.length !== 1 ? 's' : ''} selected. Bulk actions available.
          </div>
          <div
            style={{
              padding: `${spacing[2]} ${spacing[3]}`,
              borderBottom: `1px solid ${colors.primary[300]}`,
              background: withAlpha(colors.primary[50], 0.6),
              marginBottom: spacing[2],
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: spacing[2],
              }}
            >
              <div>
                <Typography.Text strong style={{ marginRight: spacing[2], color: colors.primary[700] }}>
                  {selectedRowKeys.length} selected
                </Typography.Text>
                <Button size="small" type="text" onClick={() => setSelectedRowKeys([])}>
                  Clear selection
                </Button>
              </div>
              <Space size={spacingToNumber(spacing[2])} wrap>
                {!isPortalSession && (
                  <Button size="small" icon={<RedoOutlined />} onClick={handleBulkRetry}>
                    Retry
                  </Button>
                )}
                {!isPortalSession && (
                  <Button size="small" danger icon={<RedoOutlined />} onClick={handleBulkForceRetry}>
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
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('selected', 'csv'),
                        disabled: exportLoading,
                      },
                      {
                        key: 'json-selected',
                        label: 'Export selected (JSON)',
                        icon: <DownloadOutlined />,
                        onClick: () => handleExport('selected', 'json'),
                        disabled: exportLoading,
                      },
                    ],
                  }}
                >
                  <Button size="small" icon={<DownloadOutlined />} disabled={exportLoading}>
                    Export
                  </Button>
                </Dropdown>
                {!isPortalSession && (
                  <Button size="small" danger icon={<DeleteOutlined />} onClick={handleBulkDelete}>
                    Delete
                  </Button>
                )}
              </Space>
            </div>
          </div>
        </>
      )}
      <div
        style={{
          padding: `${spacing[2]} ${spacing[3]}`,
          borderBottom: `1px solid ${token.colorBorder}`,
          background: token.colorBgContainer,
          marginBottom: spacing[2],
          // Always visible. This container holds the only controls for status,
          // date, integration, flow and search — gating it on an existing
          // non-date filter made it impossible to create the first one.
          display: 'flex',
          flexWrap: 'wrap',
          gap: spacing[2],
          alignItems: 'center',
        }}
      >
        <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
          Filters
        </Typography.Text>
        <Select
          placeholder="Status"
          style={{ minWidth: 160, flex: '1 1 170px' }}
          allowClear
          size="small"
          value={statusFilter === 'PENDING_OR_RETRYING' ? undefined : statusFilter}
          onChange={(value) => setStatusFilter(value)}
          options={['PENDING', 'QUEUED', 'SUCCESS', 'FAILED', 'RETRYING', 'SKIPPED', 'ABANDONED'].map((status) => ({
            value: status,
            // FAILED intentionally spans abandoned deliveries server-side; the
            // label says so rather than letting the result look wrong.
            label: status === 'FAILED' ? 'FAILED (incl. abandoned)' : status,
          }))}
        />
        <RangePicker
          style={{ flex: '1 1 240px', minWidth: 220 }}
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
          style={{ minWidth: 200, flex: '1 1 220px' }}
          allowClear
          size="small"
          value={integrationFilter}
          onChange={(value) => setIntegrationFilter(value)}
          options={integrations.map((wh) => ({ value: wh.id, label: wh.name }))}
        />
        <Select
          aria-label="Provider filter"
          placeholder="Provider"
          style={{ minWidth: 180, flex: '1 1 190px' }}
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
          style={{ minWidth: 160, flex: '1 1 170px' }}
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
        <Input
          placeholder="Search message, target URL, or error"
          allowClear
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ minWidth: 200, flex: '1 1 220px' }}
          prefix={<SearchOutlined style={{ color: cssVar.text.muted }} />}
        />
        <Button
          type="text"
          size="small"
          onClick={() => setShowMoreFilters((prev) => !prev)}
          style={{ color: cssVar.text.secondary }}
        >
          {showMoreFilters ? 'Less filters' : 'More filters'}
        </Button>
        <div style={{ marginLeft: isNarrow ? 0 : 'auto', display: 'flex', alignItems: 'center', gap: spacing[2] }}>
          <RefreshCountdown intervalMs={refreshInterval} lastRefreshAt={latestRefreshAt} />
          <Button
            type="default"
            icon={<ReloadOutlined spin={manualRefreshPending} />}
            loading={false}
            onClick={handleManualRefresh}
            size="small"
          >
            {manualRefreshPending ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </div>
      {showMoreFilters && (
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            marginBottom: spacing[2],
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            alignItems: 'center',
          }}
        >
          <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
            More filters
          </Typography.Text>
          <Select
            placeholder="Event Type"
            style={{ minWidth: 200, flex: '1 1 220px' }}
            allowClear
            size="small"
            value={eventTypeFilter}
            onChange={(value) => setEventTypeFilter(value)}
            options={eventTypes.map((type) => ({ value: type, label: type }))}
          />
          <Input
            placeholder="Error category"
            style={{ minWidth: 200, flex: '1 1 220px' }}
            allowClear
            size="small"
            value={errorCategoryFilter}
            onChange={(event) => setErrorCategoryFilter(event.target.value || undefined)}
          />
          <Input
            placeholder="Client IP"
            style={{ minWidth: 160, flex: '1 1 170px' }}
            allowClear
            size="small"
            value={clientIpFilter}
            onChange={(event) => setClientIpFilter(event.target.value.trim() || undefined)}
          />
          <Select
            placeholder="Day of week"
            style={{ minWidth: 160, flex: '1 1 170px' }}
            allowClear
            size="small"
            value={dayOfWeekFilter}
            onChange={(value) => setDayOfWeekFilter(value)}
            options={DAY_OF_WEEK_OPTIONS.map((day) => ({ value: day, label: day }))}
          />
          <Select
            placeholder="Hour"
            style={{ minWidth: 140, flex: '1 1 150px' }}
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
        <div
          style={{
            padding: `${spacing[2]} ${spacing[3]}`,
            borderBottom: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            marginBottom: spacing[2],
            display: 'flex',
            flexWrap: 'wrap',
            gap: spacing[2],
            alignItems: 'center',
          }}
        >
          <Typography.Text type="secondary" style={{ fontWeight: 600, fontSize: 12 }}>
            Active filters
          </Typography.Text>
          <Space wrap size={spacingToNumber(spacing[1])}>
            {visibleFilterChips.length > 0 ? (
              <>
                {visibleFilterChips.map((chip) => (
                  <Tag
                    key={chip.key}
                    onClick={chip.onClear}
                    role={chip.onClear ? 'button' : undefined}
                    tabIndex={chip.onClear ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (!chip.onClear) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        chip.onClear();
                      }
                    }}
                    title="Click to clear"
                    style={{
                      borderRadius: borderRadius.full,
                      fontSize: 12,
                      padding: `${spacing['0.5']} ${spacing[2]}`,
                      borderColor: withAlpha(colors.info[400], 0.25),
                      background: withAlpha(colors.info[100], 0.5),
                      color: colors.info[700],
                      fontWeight: 600,
                      margin: 0,
                      cursor: 'pointer',
                    }}
                  >
                    {chip.label}
                  </Tag>
                ))}
                <Tag
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
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
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
                    }
                  }}
                  title="Clear all filters"
                  style={{
                    borderRadius: borderRadius.full,
                    fontSize: 12,
                    padding: `${spacing['0.5']} ${spacing[2]}`,
                    borderColor: withAlpha(cssVar.border.default, 0.8),
                    background: cssVar.bg.elevated,
                    color: cssVar.text.secondary,
                    fontWeight: 600,
                    margin: 0,
                    cursor: 'pointer',
                  }}
                >
                  Clear all
                </Tag>
              </>
            ) : (
              <Tag
                style={{
                  borderRadius: borderRadius.full,
                  fontSize: 12,
                  padding: `${spacing['0.5']} ${spacing[2]}`,
                  borderColor: withAlpha(cssVar.border.default, 0.8),
                  background: cssVar.bg.elevated,
                  color: cssVar.text.secondary,
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                All logs
              </Tag>
            )}
          </Space>
        </div>
      )}
      <div className="logs-table-wrapper" style={tableFullBleedStyle}>
        <div
          style={{
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 8,
            background: token.colorBgContainer,
            padding: spacing[2],
          }}
        >
          {!isInitialLogsLoading && filtered.length === 0 ? (
            <div
              style={{
                background: token.colorBgContainer,
                borderRadius: token.borderRadiusLG,
              }}
            >
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
                  width: 180,
                  sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
                  defaultSortOrder: 'descend',
                  render: (date: string) => (
                    <Typography.Text style={{ fontSize: 13, color: cssVar.text.secondary }}>
                      {formatDateTimeWithSeconds(date)}
                    </Typography.Text>
                  ),
                },
                {
                  title: 'Integration',
                  dataIndex: 'integrationName',
                  key: 'integrationName',
                  width: 210,
                  ellipsis: true,
                  sorter: (a, b) => (a.integrationName || '').localeCompare(b.integrationName || ''),
                  render: (name: string | null, record: DeliveryLog) => {
                    const resolved =
                      name || integrations.find((i: any) => i.id === record.integrationConfigId)?.name || null;
                    return resolved ? (
                      <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: cssVar.text.primary }} ellipsis>
                        {resolved}
                      </Typography.Text>
                    ) : (
                      <Typography.Text style={{ fontSize: 13, color: cssVar.text.muted, fontStyle: 'italic' }}>
                        Unknown Integration
                      </Typography.Text>
                    );
                  },
                },
                {
                  title: 'Flow',
                  dataIndex: 'direction',
                  key: 'direction',
                  width: 110,
                  // The row is ~1240px of columns against a ~1270px viewport, so
                  // something has to give — and it should not be HTTP status,
                  // latency or attempts, which are what triage actually scans.
                  // Direction is the most repetitive column (usually all one
                  // value under a given filter), so it yields first and returns
                  // on wide screens.
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
                  width: 180,
                  ellipsis: true,
                  sorter: (a, b) => (a.eventType || '').localeCompare(b.eventType || ''),
                  render: (event: string | null) =>
                    event ? (
                      <MetaTag variant="event" size="small">
                        {event}
                      </MetaTag>
                    ) : (
                      <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>—</Typography.Text>
                    ),
                },
                {
                  title: 'Status',
                  dataIndex: 'status',
                  key: 'status',
                  width: 130,
                  sorter: (a, b) => a.status.localeCompare(b.status),
                  filters: [
                    { text: 'Success', value: 'SUCCESS' },
                    { text: 'Failed', value: 'FAILED' },
                    { text: 'Retrying', value: 'RETRYING' },
                    { text: 'Pending', value: 'PENDING' },
                    { text: 'Queued', value: 'QUEUED' },
                    { text: 'Skipped', value: 'SKIPPED' },
                    { text: 'Abandoned', value: 'ABANDONED' },
                  ],
                  onFilter: (value, record) => record.status === value,
                  render: (status: string) => (
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
                      <div onClick={() => handleQuickStatusFilter(status)} style={{ cursor: 'pointer' }}>
                        <StatusBadge status={status as any} size="default" />
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
                      <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>—</Typography.Text>
                    ),
                },
                {
                  title: 'HTTP Status',
                  dataIndex: 'responseStatus',
                  key: 'responseStatus',
                  align: 'right',
                  width: 88,
                  sorter: (a, b) => (a.responseStatus || 0) - (b.responseStatus || 0),
                  render: (status: number | null) => (
                    <Tag
                      style={{
                        borderRadius: borderRadius.full,
                        fontSize: 12,
                        padding: `${spacing['1']} ${spacing[2]}`,
                        borderColor: withAlpha(
                          !status
                            ? colors.warning[400]
                            : status >= 200 && status < 300
                              ? colors.success[400]
                              : colors.error[400],
                          0.3
                        ),
                        background: withAlpha(
                          !status
                            ? colors.warning[100]
                            : status >= 200 && status < 300
                              ? colors.success[100]
                              : colors.error[100],
                          0.6
                        ),
                        color: !status
                          ? colors.warning[700]
                          : status >= 200 && status < 300
                            ? colors.success[700]
                            : colors.error[700],
                        fontWeight: 700,
                        margin: 0,
                        fontFamily: 'ui-monospace, monospace',
                      }}
                    >
                      {status ?? '—'}
                    </Tag>
                  ),
                },
                {
                  title: 'Latency',
                  dataIndex: 'responseTimeMs',
                  key: 'responseTimeMs',
                  align: 'right',
                  width: 100,
                  sorter: (a, b) => a.responseTimeMs - b.responseTimeMs,
                  render: (val: number) => {
                    const tone = cssVar.text.primary;
                    return (
                      <Typography.Text style={{ fontSize: 13, color: tone, fontFamily: 'ui-monospace, monospace' }}>
                        {val} ms
                      </Typography.Text>
                    );
                  },
                },
                {
                  title: 'Attempts',
                  dataIndex: 'attemptCount',
                  key: 'attemptCount',
                  align: 'right',
                  width: 88,
                  sorter: (a, b) => a.attemptCount - b.attemptCount,
                  resizable: false,
                  render: (val: number, record) => (
                    <Space size={spacingToNumber(spacing[1])} style={{ justifyContent: 'flex-end', width: '100%' }}>
                      <HistoryOutlined style={{ color: cssVar.text.secondary }} />
                      <Typography.Text style={{ fontSize: 13, fontWeight: 600, color: cssVar.text.secondary }}>
                        {val}
                      </Typography.Text>
                      {record.status === 'RETRYING' && <ReloadOutlined spin style={{ color: colors.warning[600] }} />}
                    </Space>
                  ),
                },
                {
                  title: 'Actions',
                  key: 'actions',
                  width: 130,
                  align: 'center',
                  resizable: false,
                  // Retry is the single most common action an operator takes from
                  // this table during an incident; with 10 columns it scrolled off
                  // to the right past the visible viewport at typical widths.
                  fixed: 'right',
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
                          <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>
                            Script job
                          </Typography.Text>
                        );
                      }
                      return <Typography.Text style={{ color: cssVar.text.muted, fontSize: 12 }}>—</Typography.Text>;
                    }

                    return (
                      <Space size={spacingToNumber(spacing[1])}>
                        <Button
                          type="text"
                          size="small"
                          icon={<RedoOutlined spin={isRetrying} />}
                          disabled={!canRetry || isRetrying}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRetry(record);
                          }}
                          style={{
                            color: canRetry ? colors.primary[600] : cssVar.text.muted,
                            fontWeight: 500,
                          }}
                        >
                          Retry
                        </Button>
                        <Button
                          type="text"
                          size="small"
                          danger
                          disabled={!canRetry || isRetrying}
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmForceRetry(record);
                          }}
                          style={{
                            fontWeight: 500,
                          }}
                        >
                          Force
                        </Button>
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
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], minWidth: 0 }}>
              <StatusBadge status={detailRecord.status as any} size="default" />
              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {detailRecord.integrationName || 'Delivery'}
              </span>
              <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                {formatDateTimeWithSeconds(detailRecord.createdAt)}
              </Typography.Text>
            </div>
          ) : (
            'Delivery'
          )
        }
        placement="right"
        width={screens.xxl ? 920 : screens.lg ? 720 : '100%'}
        open={Boolean(detailRecord)}
        onClose={() => setDetailRecord(null)}
        destroyOnClose
        styles={{ body: { padding: spacing[3] } }}
        extra={
          detailRecord ? (
            <Space size={spacingToNumber(spacing[1])}>
              {detailIndex >= 0 && (
                <>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                    {detailIndex + 1} of {filtered.length}
                  </Typography.Text>
                  <Tooltip title="Previous delivery (k)">
                    <Button
                      size="small"
                      icon={<LeftOutlined />}
                      aria-label="Previous delivery"
                      disabled={detailIndex <= 0}
                      onClick={() => stepDetail(-1)}
                    />
                  </Tooltip>
                  <Tooltip title="Next delivery (j)">
                    <Button
                      size="small"
                      icon={<RightOutlined />}
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
                    icon={<ReloadOutlined />}
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
    </div>
  );
};
