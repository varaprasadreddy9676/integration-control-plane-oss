import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Space,
  Badge,
  Grid,
  Select,
  Modal,
  Dropdown,
  Avatar,
  Tooltip,
  Spin,
} from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../components/common/Icon';
import { useLocation, Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '../components/common/ErrorBoundary';
import { getOrgSwitchDestination, shouldConfirmOrgSwitch, useNavigateWithParams } from '../utils/navigation';
import { shortTenantName } from '../utils/tenant-display';
import { useTenant } from './tenant-context';
import { useThemeMode } from './theme-provider';
import { useAuth } from './auth-context';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePageViewTracking } from '../hooks/useActivityTracker';
import { PortalScopeBadge } from '../components/portal/PortalScopeBadge';
import { TenantLoadingState } from '../components/common/TenantLoadingState';
import { TenantErrorState } from '../components/common/TenantErrorState';
import { ToastHost } from '../components/common/ToastHost';
import { OrgContextGuard } from '../components/OrgContextGuard';
import { cssVar, useDesignTokens, spacingToNumber } from '../design-system/utils';
import { listAdminOrgSummaries, getLogStatsSummary } from '../services/api';
import { isFeatureEnabled } from '../utils/featureFlags';
import { CommandPalette } from '../components/layout/CommandPalette';
import { AppSidebar } from '../components/layout/AppSidebar';
import { getActiveNavigationKey } from './navigation-state';
import { AppShell } from '@astryxdesign/core/AppShell';
import { MobileNav } from '@astryxdesign/core/MobileNav';
import { SideNavRenderContext } from '@astryxdesign/core/SideNav';
import { TopNav } from '@astryxdesign/core/TopNav';
import '../design-system/theme/responsive-dashboard.css';
import { Button } from '../components/common/LegacyButton';
import { Typography } from '../components/common/LegacyTypography';

// ── Lazy-loaded route chunks ────────────────────────────────────────────────
// Each import() becomes a separate bundle chunk loaded only when first visited.
//
// If a chunk request hangs or fails (most commonly because a new deploy removed the
// old chunk file this tab's manifest still points to), Suspense would otherwise show
// its fallback spinner forever with no way to recover short of a manual refresh. Race
// the import against a timeout and force one reload to pick up the current manifest.
const CHUNK_RELOAD_KEY = 'igw_chunk_reload_at';
const CHUNK_RELOAD_COOLDOWN_MS = 10_000;
const CHUNK_LOAD_TIMEOUT_MS = 20_000;

const n = <K extends string>(mod: Promise<Record<K, React.ComponentType>>, key: K) => {
  const withTimeout = Promise.race([
    mod,
    new Promise<Record<K, React.ComponentType>>((_, reject) =>
      setTimeout(() => reject(new Error(`Chunk load timed out: ${key}`)), CHUNK_LOAD_TIMEOUT_MS)
    ),
  ]);

  return withTimeout
    .then((m) => ({ default: m[key] }))
    .catch((error) => {
      const lastReload = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || '0');
      const now = Date.now();
      if (now - lastReload > CHUNK_RELOAD_COOLDOWN_MS) {
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
        window.location.reload();
        // Never resolves — the reload takes over before React would try to render this.
        return new Promise<{ default: React.ComponentType }>(() => {});
      }
      throw error;
    });
};

const DocsPage = lazy(() => n(import('../features/landing/DocsPage'), 'DocsPage'));
const LoginRoute = lazy(() => n(import('../features/auth/LoginRoute'), 'LoginRoute'));
const PortalLaunchRoute = lazy(() => n(import('../features/auth/PortalLaunchRoute'), 'PortalLaunchRoute'));
const DashboardRoute = lazy(() => n(import('../features/dashboard/DashboardRoute'), 'DashboardRoute'));
const UnifiedIntegrationsRoute = lazy(() =>
  n(import('../features/integrations/routes/UnifiedIntegrationsRoute'), 'UnifiedIntegrationsRoute')
);
const IntegrationDetailRoute = lazy(() =>
  n(import('../features/integrations/routes/IntegrationDetailRoute'), 'IntegrationDetailRoute')
);
const InboundIntegrationDetailRoute = lazy(() =>
  import('../features/inbound-integrations').then((m) => ({ default: m.InboundIntegrationDetailRoute }))
);
const DLQRoute = lazy(() => n(import('../features/integrations/routes/DLQRoute'), 'DLQRoute'));
const FlowBuilderListRoute = lazy(() =>
  n(import('../features/flowBuilder/routes/FlowBuilderListRoute'), 'FlowBuilderListRoute')
);
const FlowBuilderRoute = lazy(() => n(import('../features/flowBuilder/routes/FlowBuilderRoute'), 'FlowBuilderRoute'));
const LogsRoute = lazy(() => n(import('../features/logs/routes/LogsRoute'), 'LogsRoute'));
const LogDetailRoute = lazy(() => n(import('../features/logs/routes/LogDetailRoute'), 'LogDetailRoute'));
const SystemLogsRoute = lazy(() =>
  import('../features/system-logs/routes/SystemLogsRoute').then((m) => ({ default: m.default }))
);
const EventAuditRoute = lazy(() => n(import('../features/events/routes/EventAuditRoute'), 'EventAuditRoute'));
const EventCatalogRoute = lazy(() => n(import('../features/events/routes/EventCatalogRoute'), 'EventCatalogRoute'));
const AlertCenterRoute = lazy(() => n(import('../features/alert-center/routes/AlertCenterRoute'), 'AlertCenterRoute'));
const BulkOperationsRoute = lazy(() => n(import('../features/bulk/routes/BulkOperationsRoute'), 'BulkOperationsRoute'));
const ScheduledIntegrationsRoute = lazy(() =>
  n(import('../features/scheduled/routes/ScheduledIntegrationsRoute'), 'ScheduledIntegrationsRoute')
);
const ScheduledJobsRoute = lazy(() =>
  n(import('../features/scheduled-jobs/routes/ScheduledJobsRoute'), 'ScheduledJobsRoute')
);
const ScheduledJobDetailRoute = lazy(() =>
  n(import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute'), 'ScheduledJobDetailRoute')
);
const TemplatesRoute = lazy(() => n(import('../features/templates/routes/TemplatesRoute'), 'TemplatesRoute'));
const TemplateDetailRoute = lazy(() =>
  n(import('../features/templates/routes/TemplateDetailRoute'), 'TemplateDetailRoute')
);
const LookupsRoute = lazy(() => n(import('../features/lookups/routes/LookupsRoute'), 'LookupsRoute'));
const LookupDetailRoute = lazy(() => n(import('../features/lookups/routes/LookupDetailRoute'), 'LookupDetailRoute'));
const LookupStatsRoute = lazy(() => n(import('../features/lookups/routes/LookupStatsRoute'), 'LookupStatsRoute'));
const VersionsRoute = lazy(() => n(import('../features/versions/routes/VersionsRoute'), 'VersionsRoute'));
const SettingsRoute = lazy(() => n(import('../features/settings/SettingsRoute'), 'SettingsRoute'));
const EventSourceSettingsRoute = lazy(() =>
  n(import('../features/settings/EventSourceSettingsRoute'), 'EventSourceSettingsRoute')
);
const MysqlPoolSettingsRoute = lazy(() =>
  n(import('../features/settings/MysqlPoolSettingsRoute'), 'MysqlPoolSettingsRoute')
);
const SenderProfilesRoute = lazy(() => n(import('../features/settings/SenderProfilesRoute'), 'SenderProfilesRoute'));
const ProvidersRoute = lazy(() => n(import('../features/settings/ProvidersRoute'), 'ProvidersRoute'));
const UserManagementRoute = lazy(() => n(import('../features/settings/UserManagementRoute'), 'UserManagementRoute'));
const HelpRoute = lazy(() => n(import('../features/help/routes/HelpRoute'), 'HelpRoute'));
const LookupGuideRoute = lazy(() => n(import('../features/help/routes/LookupGuideRoute'), 'LookupGuideRoute'));
const OrgDirectoryRoute = lazy(() => n(import('../features/admin/OrgDirectoryRoute'), 'OrgDirectoryRoute'));
const UserActivityRoute = lazy(() => n(import('../features/admin/UserActivityRoute'), 'UserActivityRoute'));
const StorageStatsRoute = lazy(() => n(import('../features/admin/StorageStatsRoute'), 'StorageStatsRoute'));
const AuditLogsRoute = lazy(() => n(import('../features/admin/AuditLogsRoute'), 'AuditLogsRoute'));
const RoleManagementRoute = lazy(() => n(import('../features/admin/RoleManagementRoute'), 'RoleManagementRoute'));
const PermissionsDemoRoute = lazy(() => n(import('../features/admin/PermissionsDemoRoute'), 'PermissionsDemoRoute'));
const AdminRateLimitsRoute = lazy(() => n(import('../features/settings/AdminRateLimitsRoute'), 'AdminRateLimitsRoute'));
const ApiKeysRoute = lazy(() => n(import('../features/settings/ApiKeysRoute'), 'ApiKeysRoute'));
const SystemStatusRoute = lazy(() =>
  import('../features/system-status/routes/SystemStatusRoute').then((m) => ({ default: m.default }))
);

const RouteFallback = () => (
  // data-route-loading: page transitions wait for this to go (view-transition.ts).
  <div data-route-loading className="ui-extracted-d0b5df9733">
    <Spin size="large" />
  </div>
);

export const App = () => {
  const { token, spacing, zIndex: zIndexTokens } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const location = useLocation();
  const navigate = useNavigateWithParams();
  const { tenant, isLoading, error, orgId, retryTenant, setManualOrgId, clearOrgId } = useTenant();
  const { isAuthenticated, user, exitImpersonation, logout } = useAuth();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isAdmin = user?.role === 'ADMIN';
  const isOrgAdmin = user?.role === 'ORG_ADMIN';
  const isImpersonating = user?.impersonated;
  const isPortalSession = !!(user as any)?.isPortalSession;
  const portalAllowedViews: string[] = (() => {
    if (!isPortalSession) return [];
    try {
      const stored = localStorage.getItem('integration_gateway_user');
      return stored ? (JSON.parse(stored)?.allowedViews ?? []) : [];
    } catch {
      return [];
    }
  })();
  const { mode, toggleMode } = useThemeMode();
  const queryClient = useQueryClient();

  // -------- PORTAL EMBED LOGIC --------
  const searchParams = new URLSearchParams(location.search);
  const embeddedParam = searchParams.get('embedded') === 'true';
  const tokenParam = searchParams.get('token');
  const [isEmbedded] = useState(() => {
    // Check URL param or if loaded inside an actual iframe
    return embeddedParam || window.self !== window.top;
  });

  // If a magic link token is in the URL, decode it and hydrate the auth context
  // in-place — no page reload, no redirect (which would break Vite's base path).
  useEffect(() => {
    if (!tokenParam) return;
    // Only inject if this token is different from what's already stored
    const existingToken = localStorage.getItem('integration_gateway_token');
    if (existingToken === tokenParam) return;

    try {
      // Decode JWT payload (middle segment) — no signature verification needed here,
      // the backend will validate it on every API call.
      const base64Payload = tokenParam.split('.')[1];
      const payload = JSON.parse(atob(base64Payload)) as {
        sub: string;
        email: string;
        role: string;
        orgId?: number;
        isPortalSession?: boolean;
        profileId?: string;
        allowedIntegrationIds?: string[];
        allowedTags?: string[];
        allowedViews?: string[];
        tokenVersion?: number;
        type?: string;
      };

      // Write token + synthetic user into localStorage so auth-context picks them up
      localStorage.setItem('integration_gateway_token', tokenParam);
      localStorage.setItem(
        'integration_gateway_user',
        JSON.stringify({
          id: payload.sub,
          email: payload.email,
          role: payload.role,
          orgId: payload.orgId ?? null,
          isPortalSession: payload.isPortalSession ?? false,
          ...(payload.profileId
            ? {
                profileId: payload.profileId,
                allowedIntegrationIds: payload.allowedIntegrationIds ?? [],
                allowedTags: payload.allowedTags ?? [],
                allowedViews: payload.allowedViews ?? ['dashboard', 'logs'],
              }
            : {}),
        })
      );

      // Persist orgId so tenant-context resolves the right org
      if (payload.orgId) {
        localStorage.setItem('integration_gateway_org_id', String(payload.orgId));
      }

      // Fire the custom event so auth-context and tenant-context re-read localStorage
      window.dispatchEvent(new Event('auth-storage'));
    } catch (err) {
      console.warn('[Portal] Failed to decode magic link token', err);
    }
  }, [tokenParam, token]);

  // Remove the token from the browser URL immediately after bootstrap so it
  // does not appear in server logs, browser history, or get copied accidentally.
  useEffect(() => {
    if (!tokenParam) return;
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('token');
      window.history.replaceState({}, '', url.toString());
    } catch {
      // ignore — replaceState not critical
    }
  }, [tokenParam]);
  // ------------------------------------

  // Automatic page view and navigation tracking
  usePageViewTracking();

  // Initialize collapsed state from localStorage
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  // Persist collapsed state to localStorage
  useEffect(() => {
    localStorage.setItem('sidebar-collapsed', JSON.stringify(collapsed));
  }, [collapsed]);

  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Handle logout with complete cache clearing
  const handleLogout = () => {
    // Clear React Query cache
    queryClient.clear();

    // Clear all localStorage items (except theme preference)
    const themeMode = localStorage.getItem('theme-mode');
    localStorage.clear();
    if (themeMode) {
      localStorage.setItem('theme-mode', themeMode);
    }

    // Clear sessionStorage
    sessionStorage.clear();

    // Call auth logout (clears auth tokens and user state)
    logout();

    // Navigate to login page
    navigate('/login');
  };

  const navGroups = useMemo(() => {
    const groups = [];

    // Only show org-specific menus if user has an orgId selected
    // OR if user is not a super admin (regular users always have orgId)
    const showOrgMenus = orgId > 0 || !isSuperAdmin;

    if (showOrgMenus) {
      // For portal sessions, only show groups/items corresponding to allowedViews
      const portalCanView = (view: string) =>
        !isPortalSession || portalAllowedViews.length === 0 || portalAllowedViews.includes(view);

      if (portalCanView('dashboard')) {
        groups.push({
          label: 'Overview',
          items: [{ key: '/dashboard', icon: <GatewayIcon name="RadarChartOutlined" />, label: 'Dashboard' }],
        });
      }

      // Integrations — portal VIEWER sessions can browse (read-only in backend)
      // Full editors (non-portal) see all tools
      if (!isPortalSession) {
        groups.push(
          // ── What you build ────────────────────────────────────────────────
          {
            label: 'Integrations',
            items: [
              { key: '/integrations', icon: <GatewayIcon name="ApiOutlined" />, label: 'All Integrations' },
              ...(isFeatureEnabled('integrationFlowBuilderEnabled')
                ? [{ key: '/flow-builder', icon: <GatewayIcon name="BlockOutlined" />, label: 'Flow Builder' }]
                : []),
              { key: '/scheduled', icon: <GatewayIcon name="CalendarOutlined" />, label: 'Delayed Deliveries' },
              { key: '/scheduled-jobs', icon: <GatewayIcon name="ClockCircleOutlined" />, label: 'Scheduled Jobs' },
            ],
          },

          // ── Reference data ────────────────────────────────────────────────
          {
            label: 'Resources',
            items: [
              { key: '/events/catalog', icon: <GatewayIcon name="DeploymentUnitOutlined" />, label: 'Event Catalog' },
              { key: '/templates', icon: <GatewayIcon name="AppstoreOutlined" />, label: 'Templates' },
              { key: '/lookups', icon: <GatewayIcon name="DatabaseOutlined" />, label: 'Lookup Tables' },
            ],
          }
        );
      } else {
        // Portal session — show integrations list only (read-only scope enforced by backend)
        groups.push({
          label: 'Integrations',
          items: [{ key: '/integrations', icon: <GatewayIcon name="ApiOutlined" />, label: 'All Integrations' }],
        });
      }

      const monitorItems = [
        ...(portalCanView('logs')
          ? [{ key: '/logs', icon: <GatewayIcon name="HistoryOutlined" />, label: 'Delivery Logs' }]
          : []),
        ...(!isPortalSession
          ? [
              { key: '/events', icon: <GatewayIcon name="FileTextOutlined" />, label: 'Event Audit' },
              { key: '/alert-center', icon: <GatewayIcon name="BellOutlined" />, label: 'Alert Center' },
              { key: '/dlq', icon: <GatewayIcon name="WarningOutlined" />, label: 'Dead Letter Queue' },
              { key: '/bulk', icon: <GatewayIcon name="ThunderboltOutlined" />, label: 'Bulk Operations' },
              { key: '/system-logs', icon: <GatewayIcon name="CodeOutlined" />, label: 'System Logs' },
            ]
          : []),
      ];

      if (monitorItems.length > 0) {
        groups.push({ label: 'Monitor', items: monitorItems });
      }

      // Settings — not shown in portal sessions
      if (!isPortalSession) {
        groups.push({
          label: 'Settings',
          items: [
            { key: '/settings', icon: <GatewayIcon name="SettingOutlined" />, label: 'Organization' },
            { key: '/settings/event-source', icon: <GatewayIcon name="CloudServerOutlined" />, label: 'Event Source' },
            { key: '/settings/providers', icon: <GatewayIcon name="AppstoreOutlined" />, label: 'Providers' },
            { key: '/help', icon: <GatewayIcon name="BookOutlined" />, label: 'Documentation' },
          ],
        });
      }
    }

    // ── Platform admin ──────────────────────────────────────────────────────
    if (isSuperAdmin || isAdmin) {
      groups.push({
        label: 'Administration',
        items: [
          { key: '/admin/orgs', icon: <GatewayIcon name="ApartmentOutlined" />, label: 'Org Directory' },
          { key: '/admin/users', icon: <GatewayIcon name="TeamOutlined" />, label: 'User Management' },
          { key: '/admin/roles', icon: <GatewayIcon name="SafetyOutlined" />, label: 'Role Management' },
          { key: '/admin/api-keys', icon: <GatewayIcon name="KeyOutlined" />, label: 'API Keys' },
          { key: '/admin/rate-limits', icon: <GatewayIcon name="LineChartOutlined" />, label: 'Rate Limits' },
          { key: '/admin/audit-logs', icon: <GatewayIcon name="AuditOutlined" />, label: 'Audit Logs' },
          { key: '/admin/user-activity', icon: <GatewayIcon name="BarChartOutlined" />, label: 'User Activity' },
          { key: '/admin/storage', icon: <GatewayIcon name="PieChartOutlined" />, label: 'Storage & Usage' },
          { key: '/admin/system-status', icon: <GatewayIcon name="CloudServerOutlined" />, label: 'System Status' },
          { key: '/admin/permissions', icon: <GatewayIcon name="IdcardOutlined" />, label: 'My Permissions' },
        ],
      });
    } else if (isOrgAdmin) {
      // ORG_ADMIN: can see their team's activity, storage stats, own permissions,
      // and manage their own API keys (api_keys:* is granted within their org)
      groups.push({
        label: 'Team',
        items: [
          { key: '/admin/api-keys', icon: <GatewayIcon name="KeyOutlined" />, label: 'API Keys' },
          { key: '/admin/user-activity', icon: <GatewayIcon name="BarChartOutlined" />, label: 'User Activity' },
          { key: '/admin/storage', icon: <GatewayIcon name="PieChartOutlined" />, label: 'Storage & Usage' },
          { key: '/admin/system-status', icon: <GatewayIcon name="CloudServerOutlined" />, label: 'System Status' },
          { key: '/admin/permissions', icon: <GatewayIcon name="IdcardOutlined" />, label: 'My Permissions' },
        ],
      });
    }

    return groups;
  }, [isSuperAdmin, isAdmin, isOrgAdmin, orgId, isPortalSession, portalAllowedViews]);

  const activeKey = useMemo(() => {
    return getActiveNavigationKey(location.pathname, navGroups) ?? '';
  }, [location.pathname, navGroups]);

  const isLoginRoute = location.pathname.startsWith('/login');
  const isLandingRoute = location.pathname === '/';
  const isDocsRoute = location.pathname.startsWith('/docs');
  const isPortalLaunchRoute = location.pathname.startsWith('/portal/launch');
  const isSystemStatusStandaloneRoute = location.pathname.startsWith('/status/system');
  const isAdminRoute = location.pathname.startsWith('/admin');
  // Portal launch route should bypass tenant checks (orgId set after auth)
  const canSkipTenant = ((isSuperAdmin || isAdmin) && isAdminRoute) || isPortalLaunchRoute;

  // On initial login, redirect SUPER_ADMIN to admin dashboard
  useEffect(() => {
    if (isAuthenticated && isSuperAdmin && location.pathname === '/') {
      navigate('/admin/orgs');
    }
  }, [isAuthenticated, isSuperAdmin, location.pathname, navigate]);

  const { data: adminOrgs = [] } = useQuery({
    queryKey: ['adminOrgsSummary'],
    queryFn: listAdminOrgSummaries,
    enabled: isSuperAdmin || isAdmin,
    staleTime: 30 * 1000,
  });

  // Poll failed delivery count for the header badge — refreshes every 60s
  const { data: failedStats } = useQuery({
    queryKey: ['headerFailedStats', orgId],
    queryFn: () => getLogStatsSummary(),
    enabled: !!orgId && orgId > 0,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });
  const failedCount = failedStats?.failed ?? 0;

  const handleOrgChange = (value?: number) => {
    if (!value) {
      Modal.confirm({
        title: 'Clear org context?',
        content: 'You will return to the global admin view.',
        okText: 'Clear',
        okButtonProps: { danger: true },
        cancelText: 'Cancel',
        onOk: () => clearOrgId(),
      });
      return;
    }

    if (Number(value) === orgId) return;
    const orgSwitchDestination = getOrgSwitchDestination(location.pathname);
    if (!shouldConfirmOrgSwitch(orgId)) {
      setManualOrgId(Number(value), orgSwitchDestination || undefined);
      return;
    }

    Modal.confirm({
      title: 'Switch organization?',
      content: orgSwitchDestination
        ? `Switch context to Org ${value}? This record belongs to the current organization, so you will return to its list. Unsaved changes will be lost.`
        : `Switch context to Org ${value}? Unsaved changes may be lost.`,
      okText: 'Switch',
      cancelText: 'Cancel',
      onOk: () => setManualOrgId(Number(value), orgSwitchDestination || undefined),
    });
  };

  const createMenuItems = [
    {
      key: 'integration',
      icon: <GatewayIcon name="ApiOutlined" />,
      label: 'New integration',
      onClick: () => navigate('/integrations/new'),
    },
    {
      key: 'inbound',
      icon: <GatewayIcon name="CloudServerOutlined" />,
      label: 'New inbound integration',
      onClick: () => navigate('/inbound-integrations/new'),
    },
    {
      key: 'scheduled-job',
      icon: <GatewayIcon name="CalendarOutlined" />,
      label: 'New scheduled job',
      onClick: () => navigate('/scheduled-jobs/new'),
    },
    {
      key: 'template',
      icon: <GatewayIcon name="AppstoreOutlined" />,
      label: 'New template',
      onClick: () => navigate('/templates/new'),
    },
    {
      key: 'lookup',
      icon: <GatewayIcon name="DatabaseOutlined" />,
      label: 'New lookup mapping',
      onClick: () => navigate('/lookups/new'),
    },
    ...(isFeatureEnabled('integrationFlowBuilderEnabled')
      ? [
          {
            key: 'flow',
            icon: <GatewayIcon name="BlockOutlined" />,
            label: 'New flow',
            onClick: () => navigate('/flow-builder/new'),
          },
        ]
      : []),
  ];
  const mobileMoreMenuItems = [
    { key: 'user', label: user?.email ?? 'Account', disabled: true },
    ...(!isPortalSession ? [{ type: 'group' as const, label: 'Create', children: createMenuItems }] : []),
    { type: 'divider' as const },
    ...(failedCount > 0
      ? [
          {
            key: 'failed',
            icon: <GatewayIcon name="WarningOutlined" />,
            label: `${failedCount} failed deliveries`,
            onClick: () => navigate('/logs?status=FAILED&dateRange=all', { state: { applyFilters: Date.now() } }),
          },
        ]
      : []),
    ...(!isPortalSession
      ? [
          {
            key: 'settings',
            icon: <GatewayIcon name="SettingOutlined" />,
            label: 'Organization settings',
            onClick: () => navigate('/settings'),
          },
          {
            key: 'permissions',
            icon: <GatewayIcon name="IdcardOutlined" />,
            label: 'My permissions',
            onClick: () => navigate('/admin/permissions'),
          },
        ]
      : []),
    {
      key: 'theme',
      icon: mode === 'dark' ? <GatewayIcon name="SunOutlined" /> : <GatewayIcon name="MoonOutlined" />,
      label: mode === 'dark' ? 'Light mode' : 'Dark mode',
      onClick: toggleMode,
    },
    { type: 'divider' as const },
    {
      key: 'logout',
      icon: <GatewayIcon name="LogoutOutlined" />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout,
    },
  ];

  // User profile dropdown items
  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div className="ui-extracted-ea0765548d">
          <Typography.Text strong className="ui-extracted-991c3e85b7">
            {user?.email}
          </Typography.Text>
          <Typography.Text type="secondary" className="console-type-caption">
            {user?.role?.replace(/_/g, ' ')}
          </Typography.Text>
        </div>
      ),
      disabled: true,
    },
    { type: 'divider' as const },
    ...(!isPortalSession
      ? [
          {
            key: 'settings',
            icon: <GatewayIcon name="SettingOutlined" />,
            label: 'Organization Settings',
            onClick: () => navigate('/settings'),
          },
          {
            key: 'permissions',
            icon: <GatewayIcon name="IdcardOutlined" />,
            label: 'My Permissions',
            onClick: () => navigate('/admin/permissions'),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      key: 'logout',
      icon: <GatewayIcon name="LogoutOutlined" />,
      label: 'Sign out',
      danger: true,
      onClick: handleLogout,
    },
  ];

  useEffect(() => {
    if (!isAuthenticated && !isLoginRoute && !isLandingRoute && !isDocsRoute) {
      sessionStorage.setItem('auth_redirect', `${location.pathname}${location.search}`);
    }
  }, [isAuthenticated, isLoginRoute, location.pathname, location.search]);

  // Toggle sidebar (for hamburger button)
  const toggleSidebar = () => {
    setCollapsed(!collapsed);
  };

  const sidebarProps = {
    collapsed,
    isMobile,
    navGroups,
    activeKey,
    onNavigate: (path: string) => {
      navigate(path);
    },
    onToggle: toggleSidebar,
    failedCount,
  };

  const hasAppNavigation = !isEmbedded && !isSystemStatusStandaloneRoute;
  const renderShell = () => (
    <div className="app-shell">
      <ToastHost />
      <CommandPalette
        open={cmdPaletteOpen}
        onClose={() => setCmdPaletteOpen(false)}
        navGroups={navGroups}
        failedCount={failedCount}
      />

      <AppShell
        className="product-app-shell"
        variant="section"
        height="auto"
        contentPadding={0}
        mobileNav={{
          content: (
            <MobileNav header="Integration Gateway" label="Integration Gateway navigation">
              <SideNavRenderContext value="drawer-content">
                <AppSidebar {...sidebarProps} />
              </SideNavRenderContext>
            </MobileNav>
          ),
        }}
        sideNav={hasAppNavigation ? <AppSidebar {...sidebarProps} /> : undefined}
        topNav={
          hasAppNavigation ? (
            <TopNav
              className="product-top-nav"
              startContent={
                <div className="product-top-nav-content">
                  {/* Left: Hamburger + Tenant Info */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: spacing[3],
                      flex: isMobile ? '1 1 100%' : 1,
                      minWidth: 0,
                    }}
                  >
                    {/* Tenant Info — redundant with the org switcher below on mobile for admins, so it's
                    hidden there to leave room; non-admin mobile users have no switcher, so it stays
                    as their only org context. */}
                    {!((isSuperAdmin || isAdmin) && !isImpersonating) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], minWidth: 0 }}>
                        <Badge status={tenant ? 'success' : 'default'} className="ui-extracted-a9640d5e74" />
                        <div className="console-min-width-0">
                          <Typography.Text
                            strong
                            style={{
                              fontSize: 'var(--console-type-control)',
                              color: token.colorText,
                              display: 'block',
                              lineHeight: 1.4,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            ellipsis
                          >
                            {shortTenantName(tenant?.tenantName) ??
                              (isSuperAdmin || isAdmin ? 'Global Admin View' : 'Tenant')}
                          </Typography.Text>
                          <div className="console-flex-center-gap-2">
                            <Typography.Text
                              type="secondary"
                              className="ui-extracted-f83ef7a23d"
                            >
                              {tenant?.tenantCode ?? (isSuperAdmin || isAdmin ? 'Select org from dropdown' : '')}
                            </Typography.Text>
                            {tenant && (
                              <Typography.Text
                                type="secondary"
                                className="ui-extracted-f83ef7a23d"
                              >
                                • {tenant.region ?? 'Global'}
                              </Typography.Text>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {isPortalSession && <PortalScopeBadge />}

                    {(isSuperAdmin || isAdmin) && !isImpersonating && (
                      <Select
                        size="small"
                        placeholder="Switch org"
                        value={orgId && orgId > 0 ? orgId : undefined}
                        style={isMobile ? { flex: 1, minWidth: 0 } : { minWidth: 160 }}
                        allowClear
                        options={adminOrgs.map((org) => ({
                          label: org.name ? `${org.name} (Org ${org.orgId})` : `Org ${org.orgId}`,
                          value: org.orgId,
                        }))}
                        onChange={handleOrgChange}
                      />
                    )}
                  </div>

                  {/* Right: Actions */}
                  <Space size={spacingToNumber(spacing[2])}>
                    <Tooltip title="Search pages (⌘K)">
                      <Button
                        className="global-search-trigger"
                        type="default"
                        icon={<GatewayIcon name="SearchOutlined" />}
                        onClick={() => setCmdPaletteOpen(true)}
                        aria-label="Search pages"
                      >
                        <span>Search pages</span>
                        {!isMobile && <kbd>⌘K</kbd>}
                      </Button>
                    </Tooltip>

                    {!isPortalSession && (
                      <Dropdown trigger={['click']} menu={{ items: createMenuItems }}>
                        <Button type="primary" icon={<GatewayIcon name="PlusOutlined" />} aria-label="Create">
                          {!isMobile && 'Create'}
                        </Button>
                      </Dropdown>
                    )}

                    {/* Failed deliveries badge — only when there are failures */}
                    {failedCount > 0 && (
                      <Tooltip title={`${failedCount} failed deliveries — click to view`}>
                        <Button
                          type="text"
                          icon={<GatewayIcon name="WarningOutlined" className="ui-extracted-4308a8b95b" />}
                          onClick={() =>
                            navigate('/logs?status=FAILED&dateRange=all', {
                              state: { applyFilters: Date.now() },
                            })
                          }
                          aria-label={`${failedCount} failed deliveries`}
                          className="ui-extracted-6768a4d7c5"
                        >
                          <span
                            className="ui-extracted-9264b62352"
                          >
                            {failedCount}
                          </span>
                        </Button>
                      </Tooltip>
                    )}

                    {/* Theme toggle */}
                    <Button
                      type="text"
                      onClick={toggleMode}
                      icon={mode === 'dark' ? <GatewayIcon name="SunOutlined" /> : <GatewayIcon name="MoonOutlined" />}
                      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                      style={{ color: token.colorTextSecondary, height: 40, width: 40 }}
                    />

                    {/* User profile dropdown */}
                    <Dropdown menu={{ items: userMenuItems }} placement="bottomRight" trigger={['click']}>
                      <Button
                        type="text"
                        style={{
                          height: 40,
                          padding: `0 ${spacing[2]}`,
                          display: 'flex',
                          alignItems: 'center',
                          gap: spacing[2],
                        }}
                        aria-label="User menu"
                      >
                        <Avatar
                          size={28}
                          style={{
                            background: token.colorPrimary,
                            fontSize: 'var(--console-type-caption)',
                            fontWeight: 600,
                            flexShrink: 0,
                          }}
                        >
                          {(user?.email?.[0] ?? 'U').toUpperCase()}
                        </Avatar>
                        {!isMobile && (
                          <Typography.Text
                            style={{
                              fontSize: 'var(--console-type-body)',
                              color: token.colorText,
                              maxWidth: 120,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {user?.email?.split('@')[0]}
                          </Typography.Text>
                        )}
                      </Button>
                    </Dropdown>
                  </Space>
                </div>
              }
              endContent={
                isMobile ? (
                  <Space className="mobile-top-actions" size={4}>
                    {(isSuperAdmin || isAdmin) && !isImpersonating ? (
                      <Select
                        className="mobile-org-switcher"
                        size="small"
                        aria-label="Switch organization"
                        placeholder="Select org"
                        value={orgId > 0 ? orgId : undefined}
                        allowClear
                        options={adminOrgs.map((org) => ({
                          label: org.name ? `${org.name} (Org ${org.orgId})` : `Org ${org.orgId}`,
                          value: org.orgId,
                        }))}
                        onChange={handleOrgChange}
                      />
                    ) : tenant?.tenantName ? (
                      <Typography.Text className="mobile-tenant-name" ellipsis>
                        {shortTenantName(tenant.tenantName)}
                      </Typography.Text>
                    ) : null}
                    <Tooltip title="Search pages">
                      <Button
                        type="text"
                        icon={<GatewayIcon name="SearchOutlined" />}
                        aria-label="Search pages"
                        onClick={() => setCmdPaletteOpen(true)}
                      />
                    </Tooltip>
                    <Dropdown menu={{ items: mobileMoreMenuItems }} trigger={['click']} placement="bottomRight">
                      <Button type="text" icon={<GatewayIcon name="EllipsisOutlined" />} aria-label="More actions" />
                    </Dropdown>
                  </Space>
                ) : undefined
              }
            />
          ) : undefined
        }
      >
        <div
          id="main-content"
          tabIndex={-1}
          style={{
            padding: isEmbedded ? 0 : isMobile ? spacing[4] : spacing[5],
            minHeight: isEmbedded ? '100vh' : 'calc(100vh - 64px)',
            background: isEmbedded ? 'transparent' : cssVar.bg.base,
            outline: 'none',
          }}
        >
          <div className="content-shell">
            {isImpersonating && (
              <div className="console-margin-bottom-4">
                <div
                  style={{
                    padding: `${spacing[3]} ${spacing[4]}`,
                    borderRadius: 8,
                    border: `1px solid ${cssVar.warning.border}`,
                    background: cssVar.warning.bg,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: spacing[4],
                  }}
                >
                  <div>
                    <Typography.Text strong>Impersonation active</Typography.Text>
                    <Typography.Paragraph className="console-margin-none">
                      You are acting as org {user?.orgId ?? 'unknown'} ({user?.role}).
                    </Typography.Paragraph>
                  </div>
                  <Button onClick={exitImpersonation}>Exit impersonation</Button>
                </div>
              </div>
            )}
            <div className="content-stack">
              <ErrorBoundary>
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<DashboardRoute />} />
                    <Route path="/integrations" element={<UnifiedIntegrationsRoute />} />
                    <Route path="/integrations/:id" element={<IntegrationDetailRoute />} />
                    <Route path="/inbound-integrations" element={<Navigate to="/integrations?tab=inbound" replace />} />
                    <Route path="/inbound-integrations/:id" element={<InboundIntegrationDetailRoute />} />
                    {isFeatureEnabled('integrationFlowBuilderEnabled') && (
                      <>
                        <Route path="/flow-builder" element={<FlowBuilderListRoute />} />
                        <Route path="/flow-builder/new" element={<FlowBuilderRoute />} />
                        <Route path="/flow-builder/:integrationId" element={<FlowBuilderRoute />} />
                      </>
                    )}
                    <Route path="/events" element={<EventAuditRoute />} />
                    <Route path="/events/catalog" element={<EventCatalogRoute />} />
                    <Route path="/lookups" element={<LookupsRoute />} />
                    <Route path="/lookups/stats" element={<LookupStatsRoute />} />
                    <Route path="/lookups/:id" element={<LookupDetailRoute />} />
                    <Route path="/logs" element={<LogsRoute />} />
                    <Route path="/logs/:id" element={<LogDetailRoute />} />
                    <Route path="/dlq" element={<DLQRoute />} />
                    <Route path="/scheduled" element={<ScheduledIntegrationsRoute />} />
                    <Route path="/scheduled-jobs" element={<ScheduledJobsRoute />} />
                    <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
                    <Route path="/alert-center" element={<AlertCenterRoute />} />
                    <Route path="/system-logs" element={<SystemLogsRoute />} />
                    <Route path="/templates" element={<TemplatesRoute />} />
                    <Route path="/templates/new" element={<TemplateDetailRoute />} />
                    <Route path="/templates/:id" element={<TemplateDetailRoute />} />
                    <Route path="/bulk" element={<BulkOperationsRoute />} />
                    <Route path="/versions/:__KEEP_integrationName__" element={<VersionsRoute />} />
                    <Route path="/settings" element={<SettingsRoute />} />
                    <Route path="/settings/event-source" element={<EventSourceSettingsRoute />} />
                    <Route path="/settings/mysql-pool" element={<MysqlPoolSettingsRoute />} />
                    <Route path="/settings/sender-profiles" element={<SenderProfilesRoute />} />
                    <Route path="/settings/providers" element={<ProvidersRoute />} />
                    <Route path="/admin/users" element={<UserManagementRoute />} />
                    <Route path="/admin/orgs" element={<OrgDirectoryRoute />} />
                    <Route path="/admin/roles" element={<RoleManagementRoute />} />
                    <Route path="/admin/api-keys" element={<ApiKeysRoute />} />
                    <Route path="/admin/permissions" element={<PermissionsDemoRoute />} />
                    <Route path="/admin/rate-limits" element={<AdminRateLimitsRoute />} />
                    <Route path="/admin/audit-logs" element={<AuditLogsRoute />} />
                    <Route path="/admin/user-activity" element={<UserActivityRoute />} />
                    <Route path="/admin/storage" element={<StorageStatsRoute />} />
                    <Route path="/admin/system-status" element={<SystemStatusRoute mode="admin" />} />
                    <Route path="/status/system" element={<SystemStatusRoute mode="standalone" />} />
                    <Route path="/help" element={<HelpRoute />} />
                    <Route path="/help/lookup-guide" element={<LookupGuideRoute />} />
                    <Route path="*" element={<Navigate to="/dashboard" replace />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </div>
          </div>
        </div>
      </AppShell>
    </div>
  );

  // The console opens directly to sign-in; public docs remain separately reachable.
  if (isLandingRoute && !isAuthenticated) {
    return <LoginRoute />;
  }

  // Public docs — no auth required
  if (isDocsRoute) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/docs/:slug" element={<DocsPage />} />
        </Routes>
      </ErrorBoundary>
    );
  }

  // Portal launch — public exchange route, no auth required
  if (isPortalLaunchRoute) {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/portal/launch" element={<PortalLaunchRoute />} />
        </Routes>
      </ErrorBoundary>
    );
  }

  if (isLoginRoute) {
    return isAuthenticated ? <Navigate to="/dashboard" replace /> : <LoginRoute />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return (
    <OrgContextGuard>
      {canSkipTenant ? (
        renderShell()
      ) : error ? (
        <TenantErrorState
          error={error}
          orgId={orgId}
          userOrgId={user?.orgId}
          canBrowseOrgs={isSuperAdmin || isAdmin}
          onRetry={retryTenant}
          onOpenOrgDirectory={() => clearOrgId('/admin/orgs')}
          onGoToOwnOrg={() => user?.orgId && setManualOrgId(user.orgId, '/dashboard')}
          onSignOut={handleLogout}
        />
      ) : isLoading || !tenant ? (
        <TenantLoadingState
          variant="loading"
          title="Preparing your workspace"
          description="Loading tenant context"
          onRetry={retryTenant}
        />
      ) : (
        renderShell()
      )}
    </OrgContextGuard>
  );
};
