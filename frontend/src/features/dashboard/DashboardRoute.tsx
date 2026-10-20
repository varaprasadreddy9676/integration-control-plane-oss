import { useState, useMemo, useEffect, useCallback } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Space, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  WarningOutlined,
  FieldTimeOutlined,
  MinusCircleOutlined,
  FileImageOutlined,
  FilePdfOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import {
  getDashboardSummary,
  getAnalyticsOverview,
  getAnalyticsTimeseries,
  getAnalyticsErrors,
  getAnalyticsPerformance,
  getEventAuditStats,
  getUIConfig,
  getUIConfigOverride,
  sendDashboardEmail,
  getAllIntegrations,
  getAllScheduledJobs,
  getLogs,
  getScheduledJobLogs,
} from '../../services/api';
import { formatDateTimeWithSeconds, formatNumber } from '../../utils/format';
import { useDesignTokens, cssVar } from '../../design-system/utils';
import { useNavigateWithParams } from '../../utils/navigation';
import { useTenant } from '../../app/tenant-context';
import { useDashboardExport } from './hooks/useDashboardExport';
import {
  DashboardDetailsTabs,
  DashboardDeliveriesTab,
  DashboardErrorsTab,
  DashboardHeader,
  GettingStartedCard,
  DashboardKpiSection,
  DashboardLatencyTab,
  DashboardLogsTab,
  DashboardOverviewTab,
  DashboardToolbar,
  DashboardOutboundTab,
  DashboardInboundTab,
  DashboardScheduledTab,
} from './components';

type DashboardScope = 'ALL' | 'OUTBOUND' | 'INBOUND' | 'SCHEDULED';
type DashboardDetailsTab =
  | 'overview'
  | 'errors'
  | 'latency'
  | 'deliveries'
  | 'logs'
  | 'outbound'
  | 'inbound'
  | 'scheduled';

const TAB_SCOPE_OVERRIDES: Partial<Record<DashboardDetailsTab, DashboardScope>> = {
  outbound: 'OUTBOUND',
  inbound: 'INBOUND',
  scheduled: 'SCHEDULED',
};

const EMPTY_ANALYTICS_OVERVIEW = {
  summary: { total: 0, successful: 0, failed: 0, skipped: 0, retrying: 0, successRate: 0 },
  performance: { avgResponseTime: 0, p95ResponseTime: 0, totalRequests: 0 },
  eventTypes: {},
  integrationPerformance: [],
};

const EMPTY_TIMESERIES = { data: [] };
const EMPTY_ERRORS = {
  summary: { errorCategories: {}, topErrors: [] },
  topErrors: [],
  integrationBreakdown: [],
};
const EMPTY_PERFORMANCE = {
  metrics: {},
  distribution: { buckets: [] },
};
const EMPTY_EVENT_AUDIT = {
  totalReceived: 0,
  delivered: 0,
  skipped: 0,
  failed: 0,
  stuck: 0,
};

export const DashboardRoute = () => {
  const navigate = useNavigateWithParams();
  const { orgId } = useTenant();
  const { themeColors, spacing } = useDesignTokens();
  const [days, setDays] = useState(1); // Default to "Today"
  const [direction, setDirection] = useState<DashboardScope>('ALL');
  const [providerSelection, setProviderSelection] = useState<{ orgId: number; value?: string }>({ orgId });
  const providerFilter = providerSelection.orgId === orgId ? providerSelection.value : undefined;
  const [integrationSelection, setIntegrationSelection] = useState<{ orgId: number; value?: string }>({ orgId });
  const integrationId = integrationSelection.orgId === orgId ? integrationSelection.value : undefined;
  const setIntegrationId = useCallback(
    (value: string | undefined) => setIntegrationSelection({ orgId, value }),
    [orgId]
  );
  const [detailsTab, setDetailsTab] = useState<DashboardDetailsTab>('overview');
  const { exportDashboard, isExporting } = useDashboardExport();

  // Drill-downs from this dashboard carry their filters in the query string.
  // The logs route seeds its filters from the URL only at mount, so a
  // navigation also has to say "these are meant to be applied" — otherwise
  // landing on an already-open logs screen changes the address bar and nothing
  // else. See the applyFilters effect in LogsRoute.
  const navigateWithFilters = useCallback(
    (path: string) => {
      const [pathname, queryString = ''] = path.split('?');
      const params = new URLSearchParams(queryString);
      if (providerFilter && !params.has('provider')) params.set('provider', providerFilter);
      const query = params.toString();
      navigate(`${pathname}${query ? `?${query}` : ''}`, { state: { applyFilters: Date.now() } });
    },
    [navigate, providerFilter]
  );

  // Email modal state
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [emailRecipients, setEmailRecipients] = useState('');
  const [includePdf, setIncludePdf] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [performanceChartMetric, setPerformanceChartMetric] = useState<'percent' | 'count'>('percent');
  const [performanceChartLayout, setPerformanceChartLayout] = useState<'horizontal' | 'vertical'>('horizontal');
  const [hiddenLegends, setHiddenLegends] = useState<Set<string>>(new Set());

  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig', orgId],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });
  const { data: uiOverride } = useQuery({
    queryKey: ['uiConfigOverride', orgId],
    queryFn: getUIConfigOverride,
    staleTime: 5 * 60 * 1000,
  });

  const { data: integrationOptions } = useQuery({
    queryKey: ['dashboard-integrations', orgId],
    queryFn: async () => {
      const [integrations, scheduledJobs] = await Promise.all([getAllIntegrations(), getAllScheduledJobs()]);

      const outboundInboundOptions = (integrations || []).map((integration: any) => ({
        label: `${integration.direction ? `${integration.direction.toLowerCase()}: ` : ''}${integration.name || integration.type || integration.id || 'Integration'}`,
        name: integration.name || integration.type || integration.id || 'Integration',
        value: String(
          integration.id ||
            integration._id ||
            integration.__KEEP___KEEP_integrationConfig__Id__ ||
            integration.type ||
            ''
        ),
        direction: integration.direction || 'OUTBOUND',
        provider: typeof integration.provider === 'string' ? integration.provider.trim() : undefined,
      }));

      const scheduledOptions = (scheduledJobs || []).map((job: any) => ({
        label: `scheduled: ${job.name || job.type || job._id}`,
        name: job.name || job.type || job._id || 'Scheduled Job',
        value: String(job._id || job.id),
        direction: 'SCHEDULED',
      }));

      // The outbound list also returns inbound and scheduled configs; keep each id once.
      const seen = new Set<string>();
      return [...outboundInboundOptions, ...scheduledOptions].filter((opt) => {
        if (!opt.value || seen.has(opt.value)) return false;
        seen.add(opt.value);
        return true;
      });
    },
    staleTime: 5 * 60 * 1000,
  });

  const providerOptions = useMemo(() => {
    const providers = new Map<string, string>();
    (integrationOptions || []).forEach((option: any) => {
      const value = typeof option?.provider === 'string' ? option.provider.trim() : '';
      if (value && !providers.has(value.toLowerCase())) providers.set(value.toLowerCase(), value);
    });
    return Array.from(providers.values())
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ label: value, value }));
  }, [integrationOptions]);

  const filteredIntegrationOptions = useMemo(() => {
    if (!providerFilter) return integrationOptions || [];
    return (integrationOptions || []).filter((option: any) => option.provider === providerFilter);
  }, [integrationOptions, providerFilter]);

  const setProviderFilter = useCallback(
    (value: string | undefined) => {
      setProviderSelection({ orgId, value });
      // An integration belongs to one provider. Clear an old integration selection
      // when the provider changes so the dashboard never shows an accidental
      // intersection of two unrelated filters.
      setIntegrationSelection({ orgId, value: undefined });
    },
    [orgId]
  );

  const integrationDirectionMap = useMemo(() => {
    const map = new Map<string, string>();
    (filteredIntegrationOptions || []).forEach((option: any) => {
      if (option?.value) {
        map.set(String(option.value), option.direction || 'OUTBOUND');
      }
    });
    return map;
  }, [filteredIntegrationOptions]);

  const integrationNameMap = useMemo(() => {
    const map = new Map<string, string>();
    (filteredIntegrationOptions || []).forEach((option: any) => {
      if (option?.value && option?.name) {
        map.set(String(option.value), option.name);
      }
    });
    return map;
  }, [filteredIntegrationOptions]);

  const resolvedScope = useMemo(() => {
    if (direction === 'ALL' && integrationId) {
      return (integrationDirectionMap.get(String(integrationId)) || 'ALL') as typeof direction;
    }
    return direction;
  }, [direction, integrationId, integrationDirectionMap]);

  const configuredScopeCounts = useMemo(() => {
    const counts: Record<Exclude<DashboardScope, 'ALL'>, number> = {
      OUTBOUND: 0,
      INBOUND: 0,
      SCHEDULED: 0,
    };

    (filteredIntegrationOptions || []).forEach((option: any) => {
      const optionDirection = option?.direction as Exclude<DashboardScope, 'ALL'> | undefined;
      if (optionDirection && optionDirection in counts) {
        counts[optionDirection] += 1;
      }
    });

    return counts;
  }, [filteredIntegrationOptions]);

  const effectiveScope = useMemo<DashboardScope>(() => {
    return TAB_SCOPE_OVERRIDES[detailsTab] || resolvedScope;
  }, [detailsTab, resolvedScope]);

  const hasConfiguredEntitiesInScope = useMemo(() => {
    if (effectiveScope === 'ALL') return !providerFilter || filteredIntegrationOptions.length > 0;
    if (integrationId) {
      return integrationDirectionMap.get(String(integrationId)) === effectiveScope;
    }
    return configuredScopeCounts[effectiveScope] > 0;
  }, [configuredScopeCounts, effectiveScope, filteredIntegrationOptions.length, integrationDirectionMap, integrationId, providerFilter]);

  const refreshSeconds = Number(
    uiOverride?.dashboard?.autoRefreshSeconds ?? uiConfig?.dashboard?.autoRefreshSeconds ?? 30
  );
  const refreshInterval = refreshSeconds > 0 ? refreshSeconds * 1000 : false;

  // Send email function
  const handleSendEmail = async () => {
    if (!emailRecipients.trim()) {
      message.error('Please enter at least one email address');
      return;
    }

    // Parse email addresses (comma or newline separated)
    const recipients = emailRecipients
      .split(/[,\n]/)
      .map((email) => email.trim())
      .filter((email) => email.length > 0);

    if (recipients.length === 0) {
      message.error('Please enter valid email addresses');
      return;
    }

    setSendingEmail(true);
    try {
      const result = await sendDashboardEmail({
        recipients,
        days,
        includePdf,
      });

      message.success(`Dashboard sent successfully to ${recipients.length} recipient(s)`);
      setEmailModalVisible(false);
      setEmailRecipients('');
      setIncludePdf(false);
    } catch (error) {
      message.error('Failed to send email. Please try again.');
      console.error('Send email error:', error);
    } finally {
      setSendingEmail(false);
    }
  };

  // Export menu items
  const exportMenuItems: MenuProps['items'] = [
    {
      key: 'send-email',
      label: 'Send via Email',
      icon: <MailOutlined />,
      onClick: () => setEmailModalVisible(true),
    },
    { type: 'divider' },
    {
      key: 'export-png',
      label: 'Export as PNG',
      icon: <FileImageOutlined />,
      onClick: () => exportDashboard('png'),
    },
    {
      key: 'export-pdf',
      label: 'Export as PDF',
      icon: <FilePdfOutlined />,
      onClick: () => exportDashboard('pdf'),
    },
  ];

  // Fetch dashboard summary (24h stats)
  const {
    data: summary,
    dataUpdatedAt: summaryUpdatedAt,
    refetch: refetchSummary,
  } = useQuery({
    queryKey: ['dashboard-summary', orgId],
    queryFn: getDashboardSummary,
    refetchInterval: refreshInterval,
  });

  const analyticsDirection = effectiveScope === 'ALL' || effectiveScope === 'SCHEDULED' ? undefined : effectiveScope;
  const analyticsTriggerType = effectiveScope === 'SCHEDULED' ? 'SCHEDULED' : undefined;
  const needsHourlyTimeseries = detailsTab === 'overview' || detailsTab === 'inbound';
  const needsErrorAnalytics =
    detailsTab === 'errors' || detailsTab === 'outbound' || detailsTab === 'inbound' || detailsTab === 'scheduled';
  const needsPerformanceAnalytics =
    detailsTab === 'latency' || detailsTab === 'outbound' || detailsTab === 'inbound' || detailsTab === 'scheduled';
  const needsEventAuditStats =
    detailsTab === 'deliveries' && effectiveScope !== 'SCHEDULED' && hasConfiguredEntitiesInScope;
  const needsRecentLogs = detailsTab === 'logs';
  const dashboardQueryStaleTime = refreshInterval || 30_000;

  // Dashboard UI uses calendar-day ranges (local time), but the analytics backend defaults
  // to "last N days" as a rolling window. Passing start/end removes confusion like
  // "Today shows failures" due to late-night runs from the prior calendar day.
  const analyticsDateRange = useMemo(() => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - Math.max(0, days - 1));
    return { startDate: start.toISOString(), endDate: end.toISOString() };
  }, [days]);

  const appendDashboardFilterParams = useCallback(
    (params: URLSearchParams) => {
      if (integrationId) params.set('integrationId', integrationId);
      if (analyticsDirection) params.set('direction', analyticsDirection);
      if (analyticsTriggerType) params.set('triggerType', analyticsTriggerType);
      if (providerFilter) params.set('provider', providerFilter);
    },
    [analyticsDirection, analyticsTriggerType, integrationId, providerFilter]
  );

  // Fetch analytics overview
  const {
    data: analytics,
    isLoading: analyticsLoading,
    dataUpdatedAt: analyticsUpdatedAt,
    refetch: refetchAnalytics,
  } = useQuery({
    queryKey: [
      'analytics-overview',
      orgId,
      days,
      analyticsDirection,
      analyticsTriggerType,
      integrationId,
      providerFilter,
      analyticsDateRange.startDate,
      analyticsDateRange.endDate,
    ],
    queryFn: () =>
      getAnalyticsOverview(days, analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange, providerFilter),
    enabled: hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  const {
    data: timeseriesDaily,
    dataUpdatedAt: timeseriesDailyUpdatedAt,
    refetch: refetchTimeseriesDaily,
  } = useQuery({
    queryKey: [
      'analytics-timeseries',
      orgId,
      'day',
      days,
      analyticsDirection,
      analyticsTriggerType,
      integrationId,
      providerFilter,
      analyticsDateRange.startDate,
      analyticsDateRange.endDate,
    ],
    queryFn: () =>
      getAnalyticsTimeseries(days, 'day', analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange, providerFilter),
    enabled: hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  const {
    data: timeseriesHourly,
    dataUpdatedAt: timeseriesHourlyUpdatedAt,
    refetch: refetchTimeseriesHourly,
  } = useQuery({
    queryKey: [
      'analytics-timeseries',
      orgId,
      'hour',
      days,
      analyticsDirection,
      analyticsTriggerType,
      integrationId,
      providerFilter,
      analyticsDateRange.startDate,
      analyticsDateRange.endDate,
    ],
    queryFn: () =>
      getAnalyticsTimeseries(days, 'hour', analyticsDirection, analyticsTriggerType, integrationId, analyticsDateRange, providerFilter),
    enabled: needsHourlyTimeseries && hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  // Fetch error analysis
  const {
    data: errorAnalytics,
    isLoading: errorsLoading,
    dataUpdatedAt: errorUpdatedAt,
    refetch: refetchErrors,
  } = useQuery({
    queryKey: [
      'analytics-errors',
      orgId,
      days,
      analyticsDirection,
      analyticsTriggerType,
      integrationId,
      providerFilter,
      analyticsDateRange.startDate,
      analyticsDateRange.endDate,
    ],
    queryFn: () =>
      getAnalyticsErrors(days, integrationId, analyticsDirection, analyticsTriggerType, analyticsDateRange, providerFilter),
    enabled: needsErrorAnalytics && hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  const {
    data: performanceAnalytics,
    isLoading: performanceLoading,
    dataUpdatedAt: performanceUpdatedAt,
    refetch: refetchPerformance,
  } = useQuery({
    queryKey: [
      'analytics-performance',
      orgId,
      days,
      analyticsDirection,
      analyticsTriggerType,
      integrationId,
      providerFilter,
      analyticsDateRange.startDate,
      analyticsDateRange.endDate,
    ],
    queryFn: () =>
      getAnalyticsPerformance(days, integrationId, analyticsDirection, analyticsTriggerType, analyticsDateRange, providerFilter),
    enabled: needsPerformanceAnalytics && hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  const hoursBack = days * 24;
  const {
    data: eventAuditStats,
    isLoading: eventAuditLoading,
    dataUpdatedAt: eventAuditUpdatedAt,
    refetch: refetchEventAuditStats,
  } = useQuery({
    queryKey: ['event-audit-stats', orgId, hoursBack],
    queryFn: () => getEventAuditStats({ hoursBack }),
    enabled: needsEventAuditStats,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  // Conditional queries for Scheduled tab
  const { data: scheduledJobs } = useQuery({
    queryKey: ['dashboard-scheduled-jobs', orgId],
    queryFn: () => getAllScheduledJobs(),
    enabled: detailsTab === 'scheduled' && hasConfiguredEntitiesInScope,
    staleTime: 5 * 60 * 1000,
  });

  const scheduledLogsDateRange = useMemo(() => {
    const now = new Date();
    const startDate = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return [startDate.toISOString(), now.toISOString()] as [string, string];
  }, [days]);

  const logsDateRange = useMemo(() => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    return [start.toISOString(), end.toISOString()] as [string, string];
  }, [days]);

  const scheduledJobIds = useMemo(() => {
    const jobs = scheduledJobs || [];
    if (!jobs.length) return [];
    if (integrationId) {
      return jobs
        .filter((job: any) => String(job.id || job._id) === String(integrationId))
        .map((job: any) => String(job.id || job._id));
    }
    return jobs.map((job: any) => String(job.id || job._id)).filter(Boolean);
  }, [scheduledJobs, integrationId]);

  const {
    data: scheduledLogsResponse,
    dataUpdatedAt: scheduledLogsUpdatedAt,
    refetch: refetchScheduledLogs,
  } = useQuery({
    queryKey: [
      'dashboard-scheduled-job-logs',
      orgId,
      scheduledJobIds,
      scheduledLogsDateRange[0],
      scheduledLogsDateRange[1],
    ],
    queryFn: async () => {
      const logsByJob = await Promise.all(scheduledJobIds.map((jobId) => getScheduledJobLogs(jobId, { limit: 100 })));
      const startMs = new Date(scheduledLogsDateRange[0]).getTime();
      const endMs = new Date(scheduledLogsDateRange[1]).getTime();
      return logsByJob
        .flat()
        .filter((log: any) => {
          const startedAt = new Date(log.startedAt || log.createdAt || 0).getTime();
          return Number.isFinite(startedAt) && startedAt >= startMs && startedAt <= endMs;
        })
        .sort(
          (a: any, b: any) =>
            new Date(b.startedAt || b.createdAt).getTime() - new Date(a.startedAt || a.createdAt).getTime()
        )
        .slice(0, 200);
    },
    enabled: detailsTab === 'scheduled' && scheduledJobIds.length > 0,
    refetchInterval: refreshInterval,
  });

  const scheduledJobLogs = useMemo(() => scheduledLogsResponse || [], [scheduledLogsResponse]);

  const {
    data: recentLogsResponse,
    isLoading: recentLogsLoading,
    dataUpdatedAt: recentLogsUpdatedAt,
    refetch: refetchRecentLogs,
  } = useQuery({
    queryKey: ['dashboard-recent-logs', orgId, days, analyticsDirection, analyticsTriggerType, integrationId, providerFilter],
    queryFn: () =>
      getLogs({
        status: 'FAILED',
        integrationId,
        direction: analyticsDirection,
        triggerType: analyticsTriggerType,
        provider: providerFilter,
        dateRange: logsDateRange,
        limit: 50,
      }),
    enabled: needsRecentLogs && hasConfiguredEntitiesInScope,
    refetchInterval: refreshInterval,
    staleTime: dashboardQueryStaleTime,
  });

  const lastRefreshedAt = useMemo(() => {
    const timestamps = [
      summaryUpdatedAt,
      analyticsUpdatedAt,
      timeseriesDailyUpdatedAt,
      timeseriesHourlyUpdatedAt,
      errorUpdatedAt,
      performanceUpdatedAt,
      eventAuditUpdatedAt,
      scheduledLogsUpdatedAt,
      recentLogsUpdatedAt,
    ].filter(Boolean) as number[];
    if (timestamps.length === 0) return null;
    return Math.max(...timestamps);
  }, [
    summaryUpdatedAt,
    analyticsUpdatedAt,
    timeseriesDailyUpdatedAt,
    timeseriesHourlyUpdatedAt,
    errorUpdatedAt,
    performanceUpdatedAt,
    eventAuditUpdatedAt,
    scheduledLogsUpdatedAt,
    recentLogsUpdatedAt,
  ]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchSummary(),
        ...(hasConfiguredEntitiesInScope ? [refetchAnalytics(), refetchTimeseriesDaily()] : []),
        ...(needsHourlyTimeseries && hasConfiguredEntitiesInScope ? [refetchTimeseriesHourly()] : []),
        ...(needsErrorAnalytics && hasConfiguredEntitiesInScope ? [refetchErrors()] : []),
        ...(needsPerformanceAnalytics && hasConfiguredEntitiesInScope ? [refetchPerformance()] : []),
        ...(needsEventAuditStats ? [refetchEventAuditStats()] : []),
        ...(needsRecentLogs && hasConfiguredEntitiesInScope ? [refetchRecentLogs()] : []),
        ...(detailsTab === 'scheduled' && hasConfiguredEntitiesInScope && scheduledJobIds.length > 0
          ? [refetchScheduledLogs()]
          : []),
      ]);
      message.success('Dashboard refreshed');
    } catch (err) {
      message.error('Refresh failed. Please try again.');
    } finally {
      setRefreshing(false);
    }
  };

  const timeLabel = days === 1 ? 'Today' : `${days}d`;
  // Tiles need the compact form ("7d"); sentences need the spoken form.
  const rangePhrase = days === 1 ? 'today' : `the last ${days} days`;
  const analyticsData = hasConfiguredEntitiesInScope ? analytics || EMPTY_ANALYTICS_OVERVIEW : EMPTY_ANALYTICS_OVERVIEW;
  const timeseriesDailyData = hasConfiguredEntitiesInScope ? timeseriesDaily || EMPTY_TIMESERIES : EMPTY_TIMESERIES;
  const timeseriesHourlyData = hasConfiguredEntitiesInScope ? timeseriesHourly || EMPTY_TIMESERIES : EMPTY_TIMESERIES;
  const errorAnalyticsData = hasConfiguredEntitiesInScope ? errorAnalytics || EMPTY_ERRORS : EMPTY_ERRORS;
  const performanceAnalyticsData = hasConfiguredEntitiesInScope
    ? performanceAnalytics || EMPTY_PERFORMANCE
    : EMPTY_PERFORMANCE;
  const eventAuditStatsData = hasConfiguredEntitiesInScope ? eventAuditStats || EMPTY_EVENT_AUDIT : EMPTY_EVENT_AUDIT;
  const recentLogsData = hasConfiguredEntitiesInScope ? recentLogsResponse?.data || [] : [];
  const scheduledJobLogsData = hasConfiguredEntitiesInScope ? scheduledJobLogs : [];
  const analyticsLoadingState = hasConfiguredEntitiesInScope ? analyticsLoading : false;
  const errorsLoadingState = hasConfiguredEntitiesInScope ? errorsLoading : false;
  const performanceLoadingState = hasConfiguredEntitiesInScope ? performanceLoading : false;
  const eventAuditLoadingState = hasConfiguredEntitiesInScope ? eventAuditLoading : false;
  const recentLogsLoadingState = hasConfiguredEntitiesInScope ? recentLogsLoading : false;
  const hasSummaryData = (analyticsData.summary?.total ?? 0) > 0;
  const noConfiguredScopeHint =
    effectiveScope === 'SCHEDULED'
      ? 'No scheduled jobs configured'
      : effectiveScope === 'INBOUND'
        ? 'No inbound integrations configured'
        : effectiveScope === 'OUTBOUND'
          ? 'No outbound integrations configured'
          : 'No data for this range';
  const noDataHint = hasConfiguredEntitiesInScope ? 'No data for this range' : noConfiguredScopeHint;

  // Five tiles reading "—" is the single most common first impression of this
  // screen, and on its own it does not say whether the window is empty or the
  // platform is idle. Say which, and offer the wider window in one click.
  const showEmptyRangeNotice = hasConfiguredEntitiesInScope && !analyticsLoadingState && !hasSummaryData && days <= 7;

  const normalizedErrorAnalytics = useMemo(() => {
    const summary = errorAnalyticsData?.summary || {};
    return {
      ...errorAnalyticsData,
      summary: {
        ...summary,
        errorCategories: summary.errorCategories || {},
        topErrors: summary.topErrors || errorAnalyticsData?.topErrors || [],
      },
      topErrors: errorAnalyticsData?.topErrors || summary.topErrors || [],
      integrationBreakdown: errorAnalyticsData?.integrationBreakdown || [],
    };
  }, [errorAnalyticsData]);

  // Calculate trends from timeseries data
  const trends = useMemo(() => {
    const series = timeseriesDailyData?.data || [];
    if (series.length < 2) return null;

    // Split data into two halves for comparison
    const midpoint = Math.floor(series.length / 2);
    const firstHalf = series.slice(0, midpoint);
    const secondHalf = series.slice(midpoint);

    const calcAvg = (data: any[], field: string) => {
      const sum = data.reduce((acc, point) => acc + (point[field] || 0), 0);
      return data.length > 0 ? sum / data.length : 0;
    };

    const firstTotal = calcAvg(firstHalf, 'total');
    const secondTotal = calcAvg(secondHalf, 'total');
    const firstSuccessful = calcAvg(firstHalf, 'successful');
    const secondSuccessful = calcAvg(secondHalf, 'successful');
    const firstFailed = calcAvg(firstHalf, 'failed');
    const secondFailed = calcAvg(secondHalf, 'failed');
    const firstSkipped = calcAvg(firstHalf, 'skipped');
    const secondSkipped = calcAvg(secondHalf, 'skipped');
    const firstSuccessRate = firstTotal > 0 ? (firstSuccessful / firstTotal) * 100 : 0;
    const secondSuccessRate = secondTotal > 0 ? (secondSuccessful / secondTotal) * 100 : 0;

    const calcChange = (prev: number, current: number) => {
      if (prev === 0 && current === 0) return 0;
      if (prev === 0) return 100;
      return ((current - prev) / prev) * 100;
    };

    return {
      totalChange: calcChange(firstTotal, secondTotal),
      successRateChange: secondSuccessRate - firstSuccessRate, // Absolute change for percentage
      failedChange: calcChange(firstFailed, secondFailed),
      skippedChange: calcChange(firstSkipped, secondSkipped),
    };
  }, [timeseriesDailyData]);

  const metrics = [
    {
      label: 'Deliveries',
      value: hasSummaryData ? formatNumber(analyticsData?.summary?.total || 0) : '—',
      delta: hasSummaryData
        ? [
            `${analyticsData?.summary?.successful || 0} successful`,
            `${analyticsData?.summary?.failed || 0} failed`,
            `${analyticsData?.summary?.skipped || 0} skipped`,
            // Only surface pending/retrying when non-zero — otherwise every "0 pending, 0
            // retrying" would clutter the common fully-resolved case. When present, this is
            // what makes the breakdown actually sum to the total shown above (e.g. a QUEUED
            // delivery in progress counts toward total but not successful/failed/skipped).
            ...(analyticsData?.summary?.pending ? [`${analyticsData.summary.pending} pending`] : []),
            ...(analyticsData?.summary?.retrying ? [`${analyticsData.summary.retrying} retrying`] : []),
          ].join(', ')
        : noDataHint,
      icon: <ThunderboltOutlined />,
      tone: themeColors.text.primary,
      trend: trends?.totalChange,
      trendLabel: trends
        ? `${trends.totalChange > 0 ? '+' : ''}${trends.totalChange.toFixed(1)}% vs previous period`
        : undefined,
      onClick: () => {
        const params = new URLSearchParams({ days: days.toString() });
        appendDashboardFilterParams(params);
        navigate(`/logs?${params.toString()}`);
      },
    },
    {
      label: 'Success rate',
      value: hasSummaryData ? `${(analyticsData?.summary?.successRate || 0).toFixed(1)}%` : '—',
      delta: hasSummaryData
        ? `${analyticsData.summary.successful} / ${analyticsData.summary.total} deliveries`
        : noDataHint,
      icon: <CheckCircleOutlined />,
      tone: themeColors.text.primary,
      trend: trends?.successRateChange,
      trendLabel: trends
        ? `${trends.successRateChange > 0 ? '+' : ''}${trends.successRateChange.toFixed(1)}% vs previous period`
        : undefined,
      onClick: () => {
        const params = new URLSearchParams({ status: 'SUCCESS', days: days.toString() });
        appendDashboardFilterParams(params);
        navigate(`/logs?${params.toString()}`);
      },
    },
    {
      label: 'Skipped',
      value: hasSummaryData ? formatNumber(analyticsData?.summary?.skipped || 0) : '—',
      delta: hasSummaryData ? 'Condition-based or policy-based skips' : noDataHint,
      icon: <MinusCircleOutlined />,
      tone: themeColors.text.primary,
      trend: trends?.skippedChange,
      trendLabel: trends
        ? `${trends.skippedChange > 0 ? '+' : ''}${trends.skippedChange.toFixed(1)}% vs previous period`
        : undefined,
      onClick: () => {
        const params = new URLSearchParams({ status: 'SKIPPED', days: days.toString() });
        appendDashboardFilterParams(params);
        navigate(`/logs?${params.toString()}`);
      },
    },
    {
      label: 'Avg latency',
      value: hasSummaryData ? `${analyticsData?.performance?.avgResponseTime || 0} ms` : '—',
      delta: hasSummaryData ? `P95: ${analyticsData?.performance?.p95ResponseTime || 0} ms` : noDataHint,
      icon: <FieldTimeOutlined />,
      tone: themeColors.text.primary,
      trend: undefined, // We'll calculate this later if needed
      trendLabel: undefined,
      onClick: () => setDetailsTab('latency'),
    },
    {
      label: 'Failed deliveries',
      value: hasSummaryData ? formatNumber(analyticsData?.summary?.failed || 0) : '—',
      delta: hasSummaryData
        ? analyticsData?.summary?.retrying
          ? `${analyticsData.summary.retrying} retrying`
          : 'View error details below'
        : noDataHint,
      icon: <WarningOutlined />,
      tone: hasSummaryData && analyticsData.summary.failed > 0 ? themeColors.error.text : themeColors.text.primary,
      // Drives the tile's red treatment. A Failed card with zero failures stays
      // neutral, so red keeps meaning something.
      critical: Boolean(hasSummaryData && analyticsData.summary.failed > 0),
      trend: trends?.failedChange,
      trendLabel: trends
        ? `${trends.failedChange > 0 ? '+' : ''}${trends.failedChange.toFixed(1)}% vs previous period`
        : undefined,
      onClick: () => {
        const params = new URLSearchParams({ status: 'FAILED', days: days.toString() });
        appendDashboardFilterParams(params);
        navigate(`/logs?${params.toString()}`);
      },
    },
  ];

  // Prepare chart data
  const deliveryTrendData = useMemo(() => {
    const series = timeseriesDailyData?.data || [];
    if (!Array.isArray(series) || series.length === 0) return [];

    const data = series.map((point: any) => {
      const total = Number(point.total || 0);
      const successful = Number(point.successful || 0);
      const failed = Number(point.failed || 0);
      const skipped = Number(point.skipped || 0);
      const successRate = total > 0 ? (successful / total) * 100 : 0;

      return {
        date: new Date(point.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        Successful: successful,
        Failed: failed,
        Skipped: skipped,
        'Success Rate': Number(successRate.toFixed(1)),
        Total: total,
      };
    });

    return data;
  }, [timeseriesDailyData]);

  // Funnel chart data for event flow
  const funnelData = useMemo(() => {
    const totalReceived = Number(eventAuditStatsData?.totalReceived || 0);
    const delivered = Number(eventAuditStatsData?.delivered || 0);
    const skipped = Number(eventAuditStatsData?.skipped || 0);
    const processed = delivered + skipped;

    if (totalReceived === 0) return [];

    return [
      { name: 'Received', value: totalReceived },
      { name: 'Processed', value: processed },
      { name: 'Delivered', value: delivered },
    ].filter((entry) => entry.value > 0);
  }, [eventAuditStatsData]);

  const integrationPerformance = useMemo(() => {
    return (analyticsData?.integrationPerformance || []).map((integration: any) => {
      const integrationKey = String(
        integration.__KEEP___KEEP_integrationConfig__Id__ || integration.integrationConfigId || integration.id || ''
      );
      const resolvedName =
        integration.__KEEP_integrationName__ ||
        integration.integrationName ||
        (integrationKey ? integrationNameMap.get(integrationKey) : undefined) ||
        integrationKey ||
        'Unknown';

      return {
        ...integration,
        __KEEP_integrationName__: resolvedName,
        integrationName: integration.integrationName || resolvedName,
      };
    });
  }, [analyticsData, integrationNameMap]);

  const successFailureByIntegrationData = useMemo(() => {
    if (!integrationPerformance?.length) return [];
    return integrationPerformance
      .map((integration: any) => {
        const displayName =
          integration.__KEEP_integrationName__ ||
          integration.integrationName ||
          integration.__KEEP___KEEP_integrationConfig__Id__ ||
          'Unknown';
        const successful = integration.successful || 0;
        const failed = integration.failed || 0;
        const skipped = integration.skipped || 0;
        const total = integration.total || successful + failed + skipped;
        const successRate = total > 0 ? (successful / total) * 100 : 0;
        const failureRate = total > 0 ? (failed / total) * 100 : 0;
        const skippedRate = total > 0 ? (skipped / total) * 100 : 0;
        return {
          name: displayName,
          nameShort: displayName,
          successRate: Number(successRate.toFixed(1)),
          failureRate: Number(failureRate.toFixed(1)),
          skippedRate: Number(skippedRate.toFixed(1)),
          successCount: successful,
          failedCount: failed,
          skippedCount: skipped,
          total,
          skipped,
          integrationId: integration.__KEEP___KEEP_integrationConfig__Id__,
        };
      })
      .map((integration: any) => ({
        ...integration,
      }));
  }, [integrationPerformance]);

  const performanceChartData = useMemo(() => {
    return [...successFailureByIntegrationData].sort((a: any, b: any) => {
      if (performanceChartMetric === 'count') {
        if ((b.failedCount || 0) !== (a.failedCount || 0)) {
          return (b.failedCount || 0) - (a.failedCount || 0);
        }
        return (b.total || 0) - (a.total || 0);
      }
      if (b.failureRate !== a.failureRate) {
        return b.failureRate - a.failureRate;
      }
      return (b.total || 0) - (a.total || 0);
    });
  }, [performanceChartMetric, successFailureByIntegrationData]);

  const hourlyPatternData = useMemo(() => {
    const series = timeseriesHourlyData?.data || [];
    if (!Array.isArray(series) || series.length === 0) return [];

    const buckets = new Map<number, { successful: number; failed: number; skipped: number; total: number }>();
    series.forEach((point: any) => {
      const timestamp = point.timestamp ? new Date(point.timestamp) : null;
      if (!timestamp || Number.isNaN(timestamp.getTime())) return;
      const hour = timestamp.getHours();
      const current = buckets.get(hour) || { successful: 0, failed: 0, skipped: 0, total: 0 };
      buckets.set(hour, {
        successful: current.successful + Number(point.successful || 0),
        failed: current.failed + Number(point.failed || 0),
        skipped: current.skipped + Number(point.skipped || 0),
        total: current.total + Number(point.total || 0),
      });
    });

    return Array.from({ length: 24 }).map((_, hour) => {
      const data = buckets.get(hour) || { successful: 0, failed: 0, skipped: 0, total: 0 };
      const successRate = data.total > 0 ? (data.successful / data.total) * 100 : 0;
      return {
        hour: `${hour}:00`,
        Successful: data.successful,
        Failed: data.failed,
        Skipped: data.skipped,
        'Success Rate': Number(successRate.toFixed(1)),
        Total: data.total,
      };
    });
  }, [timeseriesHourlyData]);

  const latencyDistributionData = useMemo(() => {
    const buckets = performanceAnalyticsData?.distribution?.buckets || [];
    return buckets.map((bucket: any) => ({
      bucket: bucket.label,
      Count: bucket.count || 0,
    }));
  }, [performanceAnalyticsData]);

  const latencySummary = useMemo(() => {
    const metrics = performanceAnalyticsData?.metrics;
    if (!metrics) return null;
    return {
      avg: metrics.avgResponseTime || 0,
      p95: metrics.p95ResponseTime || 0,
      min: metrics.minResponseTime || 0,
      max: metrics.maxResponseTime || 0,
    };
  }, [performanceAnalyticsData]);

  const overviewMetrics = metrics;
  const detailsTabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'errors', label: 'Errors' },
    { key: 'latency', label: 'Latency' },
    { key: 'deliveries', label: 'Deliveries' },
    { key: 'logs', label: 'Logs' },
    { key: 'outbound', label: 'Outbound' },
    { key: 'inbound', label: 'Inbound' },
    { key: 'scheduled', label: 'Scheduled' },
  ];

  const scopeMeta = useMemo(() => {
    if (effectiveScope === 'INBOUND') {
      return {
        label: 'Inbound Integration',
        manageLabel: 'Manage Inbound',
        managePath: '/integrations?tab=inbound',
        createPath: '/inbound-integrations/new',
        performanceSubtitle: 'Per-inbound integration delivery quality and latency',
        eventTypeTitle: 'Event Type Distribution',
        eventTypeSubtitle: 'Top inbound event types over the selected window',
      };
    }
    if (effectiveScope === 'SCHEDULED') {
      return {
        label: 'Scheduled Job',
        manageLabel: 'Manage Scheduled Jobs',
        managePath: '/scheduled-jobs',
        createPath: '/scheduled-jobs/new',
        performanceSubtitle: 'Per-job run quality and latency',
        eventTypeTitle: 'Job Type Distribution',
        eventTypeSubtitle: 'Top scheduled job types over the selected window',
      };
    }
    if (effectiveScope === 'OUTBOUND') {
      return {
        label: 'Event Rule',
        manageLabel: 'Manage Integrations',
        managePath: '/integrations',
        createPath: '/integrations/new',
        performanceSubtitle: 'Per-rule delivery quality and latency',
        eventTypeTitle: 'Event Type Distribution',
        eventTypeSubtitle: 'Top outbound event types over the selected window',
      };
    }
    return {
      label: 'Integration',
      manageLabel: 'Manage Integrations',
      managePath: '/integrations',
      createPath: '/integrations/new',
      performanceSubtitle: 'Per-integration delivery quality and latency',
      eventTypeTitle: 'Event Type Distribution',
      eventTypeSubtitle: 'Top events over the selected window',
    };
  }, [effectiveScope]);

  // Count what is configured in the current view. The summary's health list
  // only covers integrations with recent activity, so it read "0 rules" for
  // orgs whose integrations were simply quiet.
  const integrationCount =
    effectiveScope === 'ALL' ? filteredIntegrationOptions.length : configuredScopeCounts[effectiveScope] || 0;
  const statusText = `${integrationCount} ${integrationCount === 1 ? 'integration' : 'integrations'} · Updated ${lastRefreshedAt ? formatDateTimeWithSeconds(new Date(lastRefreshedAt).toISOString()) : 'pending'}`;

  const errorCategoryData = useMemo(() => {
    const categories = normalizedErrorAnalytics.summary.errorCategories || {};
    return Object.entries(categories)
      .map(([name, value]) => ({ name, value: Number(value || 0) }))
      .filter((entry) => entry.value > 0);
  }, [normalizedErrorAnalytics]);

  const recentLogs = recentLogsData;

  const getIntegrationPath = (record: any) => {
    const id = record?.__KEEP___KEEP_integrationConfig__Id__ || record?.integrationConfigId || record?.id;
    if (!id) return scopeMeta.managePath;
    const mappedDirection = integrationDirectionMap.get(String(id));
    const recordDirection =
      record?.triggerType === 'SCHEDULED' ? 'SCHEDULED' : record?.direction || mappedDirection || effectiveScope;

    if (recordDirection === 'SCHEDULED') return `/scheduled-jobs/${id}`;
    if (recordDirection === 'INBOUND') return `/inbound-integrations/${id}`;
    return `/integrations/${id}`;
  };

  const handleChartClick = (data: any, context?: { chartType?: string }) => {
    const payload = data?.payload || data;
    // Build filter params based on clicked data
    const params = new URLSearchParams();

    appendDashboardFilterParams(params);

    // Handle different chart types
    if (context?.chartType === 'hourly' && payload?.hour) {
      // Extract hour from format like "14:00"
      const hour = parseInt(payload.hour.split(':')[0]);
      params.set('hour', String(hour));
    }

    if (context?.chartType === 'heatmap' && payload?.x && payload?.y) {
      // Heatmap: x = hour, y = day of week
      params.set('hour', String(payload.x).replace(/h$/i, ''));
      params.set('dayOfWeek', String(payload.y));
    }

    const clickedStatus = resolveDrilldownStatus(data);
    if (clickedStatus) {
      params.set('status', clickedStatus);
    }

    // Pass the dashboard's date range so logs cover the same period as the chart.
    // Without this, LogsRoute defaults to today-only and misses failures from earlier days.
    if (analyticsDateRange.startDate) params.set('startDate', analyticsDateRange.startDate);
    if (analyticsDateRange.endDate) params.set('endDate', analyticsDateRange.endDate);

    navigate(`/logs?${params.toString()}`);
  };

  const handleLegendClick = (dataKey: string) => {
    setHiddenLegends((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(dataKey)) {
        newSet.delete(dataKey);
      } else {
        newSet.add(dataKey);
      }
      return newSet;
    });
  };

  const resolveDrilldownStatus = (data: any): 'SUCCESS' | 'FAILED' | 'SKIPPED' | undefined => {
    const seriesKey = String(
      data?.__clickedDataKey || data?.__clickedSeriesName || data?.dataKey || data?.name || ''
    ).toLowerCase();

    if (seriesKey.includes('fail')) return 'FAILED';
    if (seriesKey.includes('success')) return 'SUCCESS';
    if (seriesKey.includes('skip')) return 'SKIPPED';

    const payload = data?.payload || data;
    if (payload?.failed > 0 || payload?.Failed > 0) return 'FAILED';
    if (payload?.successful > 0 || payload?.Successful > 0) return 'SUCCESS';
    if (payload?.skipped > 0 || payload?.Skipped > 0) return 'SKIPPED';
    return undefined;
  };

  // A brand-new org has nothing to chart; show the setup steps instead.
  if (integrationOptions && integrationOptions.length === 0) {
    return (
      <div className="dashboard-shell" data-dashboard-container>
        <DashboardHeader
          title="Dashboard"
          subtitle="Real-time monitoring of event delivery performance and system health."
          manageLabel={scopeMeta.manageLabel}
          onManage={() => navigate(scopeMeta.managePath)}
          onViewLogs={() => navigateWithFilters('/logs')}
          onRefresh={handleManualRefresh}
          refreshing={refreshing}
          refreshSeconds={refreshSeconds}
          lastRefreshedAt={lastRefreshedAt}
          exportMenuItems={exportMenuItems}
          isExporting={isExporting}
        />
        <GettingStartedCard orgId={orgId} onNavigate={navigate} />
      </div>
    );
  }

  return (
    <div className="dashboard-shell" data-dashboard-container>
      <DashboardHeader
        title="Dashboard"
        subtitle="Real-time monitoring of event delivery performance and system health."
        manageLabel={scopeMeta.manageLabel}
        onManage={() => navigate(scopeMeta.managePath)}
        onViewLogs={() => navigateWithFilters('/logs')}
        onRefresh={handleManualRefresh}
        refreshing={refreshing}
        refreshSeconds={refreshSeconds}
        lastRefreshedAt={lastRefreshedAt}
        exportMenuItems={exportMenuItems}
        isExporting={isExporting}
      />

      <DashboardToolbar
        days={days}
        setDays={setDays}
        direction={direction}
        setDirection={setDirection}
        provider={providerFilter}
        setProvider={setProviderFilter}
        providerOptions={providerOptions}
        integrationId={integrationId}
        setIntegrationId={setIntegrationId}
        integrationOptions={filteredIntegrationOptions}
        statusText={statusText}
      />

      {showEmptyRangeNotice && (
        <Alert
          type="info"
          showIcon
          // Neutral surface with a small blue icon, rather than AntD's full blue
          // info styling: this is a statement of fact, and it was carrying the
          // same visual weight as the primary action beside it.
          style={{
            marginTop: 12,
            background: cssVar.bg.surface,
            border: `1px solid ${cssVar.border.default}`,
          }}
          message="No deliveries in this period"
          action={
            <Space>
              <Button size="small" onClick={() => setDays(7)}>
                Last 7 days
              </Button>
              <Button size="small" onClick={() => setDays(30)}>
                Last 30 days
              </Button>
            </Space>
          }
        />
      )}

      <DashboardKpiSection metrics={overviewMetrics} loading={analyticsLoadingState} rangePhrase={rangePhrase} />

      <DashboardDetailsTabs
        activeKey={detailsTab}
        onChange={(key) => setDetailsTab(key as typeof detailsTab)}
        items={detailsTabs}
      />

      {detailsTab === 'overview' && (
        <DashboardOverviewTab
          days={days}
          deliveryTrendData={deliveryTrendData}
          hourlyPatternData={hourlyPatternData}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          analyticsLoading={analyticsLoadingState}
          noDataHint={noDataHint}
          onTrendChartClick={(data) => handleChartClick(data, { chartType: 'trend' })}
          onHourlyChartClick={(data) => handleChartClick(data, { chartType: 'hourly' })}
        />
      )}

      {detailsTab === 'errors' && (
        <DashboardErrorsTab
          errorsLoading={errorsLoadingState}
          errorCategoryData={errorCategoryData}
          topErrors={normalizedErrorAnalytics.summary.topErrors || []}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          onViewAllFailures={() => {
            const params = new URLSearchParams({ status: 'FAILED', days: days.toString() });
            appendDashboardFilterParams(params);
            navigate(`/logs?${params.toString()}`);
          }}
          onErrorCategoryClick={(data) => {
            const params = new URLSearchParams({ status: 'FAILED', days: days.toString() });
            appendDashboardFilterParams(params);
            if (data?.name) params.set('errorCategory', data.name);
            navigate(`/logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'latency' && (
        <DashboardLatencyTab
          performanceLoading={performanceLoadingState}
          latencyDistributionData={latencyDistributionData}
          latencySummary={latencySummary}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'deliveries' && (
        <DashboardDeliveriesTab
          analyticsLoading={analyticsLoadingState}
          integrationPerformance={integrationPerformance}
          performanceTitle={`${scopeMeta.label} Performance (${days === 1 ? 'Today' : `${days} days`})`}
          performanceSubtitle={scopeMeta.performanceSubtitle}
          performanceEntityLabel={scopeMeta.label}
          manageLabel={scopeMeta.manageLabel}
          onManageAll={() => navigate(scopeMeta.managePath)}
          onCreateNew={() => navigate(scopeMeta.createPath)}
          onViewEventAudit={() => navigate('/events')}
          onNavigate={navigateWithFilters}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          timeLabel={timeLabel}
          performanceChartData={performanceChartData}
          performanceChartMetric={performanceChartMetric}
          setPerformanceChartMetric={setPerformanceChartMetric}
          performanceChartLayout={performanceChartLayout}
          setPerformanceChartLayout={setPerformanceChartLayout}
          showEventAudit={effectiveScope !== 'SCHEDULED'}
          eventAuditLoading={eventAuditLoadingState}
          eventAuditStats={eventAuditStatsData || null}
          funnelData={funnelData}
          errorBreakdown={normalizedErrorAnalytics.integrationBreakdown || []}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
          onPerformanceChartClick={(data) => {
            const params = new URLSearchParams({ days: days.toString() });
            appendDashboardFilterParams(params);
            if (data?.integrationId) {
              params.set('integrationId', data.integrationId);
            }
            const clickedStatus = resolveDrilldownStatus(data);
            if (clickedStatus) params.set('status', clickedStatus);
            navigate(`/logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'logs' && (
        <DashboardLogsTab
          logsLoading={recentLogsLoadingState}
          logs={recentLogs}
          noDataHint={noDataHint}
          onViewAll={() => {
            const params = new URLSearchParams({ status: 'FAILED', days: days.toString() });
            appendDashboardFilterParams(params);
            navigate(`/logs?${params.toString()}`);
          }}
        />
      )}

      {detailsTab === 'outbound' && (
        <DashboardOutboundTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoadingState}
          performanceLoading={performanceLoadingState}
          errorsLoading={errorsLoadingState}
          analytics={analyticsData}
          performanceAnalytics={performanceAnalyticsData}
          errorAnalytics={normalizedErrorAnalytics}
          timeseriesDaily={timeseriesDailyData}
          integrationPerformance={integrationPerformance}
          onNavigate={navigateWithFilters}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'inbound' && (
        <DashboardInboundTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoadingState}
          analytics={analyticsData}
          timeseriesHourly={timeseriesHourlyData}
          performanceAnalytics={performanceAnalyticsData}
          integrationPerformance={integrationPerformance}
          onNavigate={navigateWithFilters}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {detailsTab === 'scheduled' && (
        <DashboardScheduledTab
          days={days}
          timeLabel={timeLabel}
          analyticsLoading={analyticsLoadingState}
          errorsLoading={errorsLoadingState}
          analytics={analyticsData}
          timeseriesDaily={timeseriesDailyData}
          performanceAnalytics={performanceAnalyticsData}
          errorAnalytics={normalizedErrorAnalytics}
          integrationPerformance={integrationPerformance}
          scheduledJobs={hasConfiguredEntitiesInScope ? scheduledJobs || [] : []}
          scheduledJobLogs={scheduledJobLogsData}
          onNavigate={navigateWithFilters}
          getIntegrationPath={getIntegrationPath}
          noDataHint={noDataHint}
          hiddenLegends={hiddenLegends}
          onLegendClick={handleLegendClick}
        />
      )}

      {/* Email Modal */}
      <Modal
        title="Send Dashboard via Email"
        open={emailModalVisible}
        onOk={handleSendEmail}
        onCancel={() => {
          setEmailModalVisible(false);
          setEmailRecipients('');
          setIncludePdf(false);
        }}
        confirmLoading={sendingEmail}
        okText="Send Email"
        width={600}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Typography.Text strong>Recipient Email Addresses</Typography.Text>
            <Typography.Text type="secondary" style={{ display: 'block', marginBottom: spacing[2] }}>
              Enter one or more email addresses (comma or newline separated)
            </Typography.Text>
            <Input.TextArea
              placeholder="user1@example.com, user2@example.com"
              value={emailRecipients}
              onChange={(e) => setEmailRecipients(e.target.value)}
              rows={4}
              disabled={sendingEmail}
            />
          </div>
          <div>
            <Checkbox checked={includePdf} onChange={(e) => setIncludePdf(e.target.checked)} disabled={sendingEmail}>
              Include PDF attachment (may take longer to send)
            </Checkbox>
          </div>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              The email will include dashboard statistics for the current time range (
              {days === 1 ? 'Today' : `${days} days`}) and a link to view the full dashboard.
            </Typography.Text>
          </div>
        </Space>
      </Modal>
    </div>
  );
};
