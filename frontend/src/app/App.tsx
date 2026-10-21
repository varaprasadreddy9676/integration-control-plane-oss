import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Layout,
  Typography,
  Space,
  Badge,
  Grid,
  Drawer,
  Select,
  Modal,
  Dropdown,
  Avatar,
  Tooltip,
  Spin,
} from 'antd';
import {
  RadarChartOutlined,
  ApiOutlined,
  HistoryOutlined,
  SettingOutlined,
  DeploymentUnitOutlined,
  ThunderboltOutlined,
  MoonOutlined,
  SunOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  ClockCircleOutlined,
  BellOutlined,
  DatabaseOutlined,
  BookOutlined,
  MenuOutlined,
  TeamOutlined,
  ApartmentOutlined,
  LineChartOutlined,
  WarningOutlined,
  BlockOutlined,
  CalendarOutlined,
  LogoutOutlined,
  SafetyOutlined,
  CodeOutlined,
  CloudServerOutlined,
  AuditOutlined,
  BarChartOutlined,
  IdcardOutlined,
  PieChartOutlined,
  SearchOutlined,
  KeyOutlined,
} from '@ant-design/icons';
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
import '../design-system/theme/responsive-dashboard.css';

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

const LandingPage = lazy(() => n(import('../features/landing/LandingPage'), 'LandingPage'));
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
  <div data-route-loading style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '40vh' }}>
    <Spin size="large" />
  </div>
);

export const App = () => {
  const { token, spacing, zIndex: zIndexTokens } = useDesignTokens();
  const screens = Grid.useBreakpoint();
  const isTabletDown = !screens.lg;
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
  const isDetailOrConfigRoute = /^\/(integrations|inbound-integrations|scheduled-jobs)\/[^/]+$/.test(location.pathname);
  const showGlobalNewIntegrationAction =
    !isPortalSession && location.pathname !== '/integrations' && !isDetailOrConfigRoute;
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

  // Auto-collapse sidebar on tablet/mobile (but respect user preference on desktop).
  //
  // Grid.useBreakpoint() reports {} on the first render, before its media
  // queries are evaluated — so `!screens.lg` is true on every load, including
  // desktop. This effect therefore collapsed the sidebar immediately and the
  // persistence effect below wrote that back to localStorage, meaning an
  // expanded sidebar could never survive a reload and every desktop user saw
  // 29 unlabelled icons. Wait until the breakpoints actually resolve.
  useEffect(() => {
    if (screens.lg === undefined) return;
    if (isTabletDown) {
      setCollapsed(true);
    }
  }, [isTabletDown, screens.lg]);

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
          items: [{ key: '/dashboard', icon: <RadarChartOutlined />, label: 'Dashboard' }],
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
              { key: '/integrations', icon: <ApiOutlined />, label: 'All Integrations' },
              ...(isFeatureEnabled('integrationFlowBuilderEnabled')
                ? [{ key: '/flow-builder', icon: <BlockOutlined />, label: 'Flow Builder' }]
                : []),
              { key: '/scheduled', icon: <CalendarOutlined />, label: 'Delayed Deliveries' },
              { key: '/scheduled-jobs', icon: <ClockCircleOutlined />, label: 'Scheduled Jobs' },
            ],
          },

          // ── Reference data ────────────────────────────────────────────────
          {
            label: 'Resources',
            items: [
              { key: '/events/catalog', icon: <DeploymentUnitOutlined />, label: 'Event Catalog' },
              { key: '/templates', icon: <AppstoreOutlined />, label: 'Templates' },
              { key: '/lookups', icon: <DatabaseOutlined />, label: 'Lookup Tables' },
            ],
          }
        );
      } else {
        // Portal session — show integrations list only (read-only scope enforced by backend)
        groups.push({
          label: 'Integrations',
          items: [{ key: '/integrations', icon: <ApiOutlined />, label: 'All Integrations' }],
        });
      }

      const monitorItems = [
        ...(portalCanView('logs') ? [{ key: '/logs', icon: <HistoryOutlined />, label: 'Delivery Logs' }] : []),
        ...(!isPortalSession
          ? [
              { key: '/events', icon: <FileTextOutlined />, label: 'Event Audit' },
              { key: '/alert-center', icon: <BellOutlined />, label: 'Alert Center' },
              { key: '/dlq', icon: <WarningOutlined />, label: 'Dead Letter Queue' },
              { key: '/bulk', icon: <ThunderboltOutlined />, label: 'Bulk Operations' },
              { key: '/system-logs', icon: <CodeOutlined />, label: 'System Logs' },
            ]
          : []),
      ];

      if (monitorItems.length > 0) {
        groups.push({ label: 'Monitor', items: monitorItems });
      }

      // Settings — not shown in portal sessions
      if (!isPortalSession) {
        groups.push(
          {
            label: 'Settings',
            items: [
              { key: '/settings', icon: <SettingOutlined />, label: 'Organization' },
              { key: '/settings/event-source', icon: <CloudServerOutlined />, label: 'Event Source' },
              { key: '/settings/providers', icon: <AppstoreOutlined />, label: 'Providers' },
              { key: '/help', icon: <BookOutlined />, label: 'Documentation' },
            ],
          }
        );
      }
    }

    // ── Platform admin ──────────────────────────────────────────────────────
    if (isSuperAdmin || isAdmin) {
      groups.push({
        label: 'Administration',
        items: [
          { key: '/admin/orgs', icon: <ApartmentOutlined />, label: 'Org Directory' },
          { key: '/admin/users', icon: <TeamOutlined />, label: 'User Management' },
          { key: '/admin/roles', icon: <SafetyOutlined />, label: 'Role Management' },
          { key: '/admin/api-keys', icon: <KeyOutlined />, label: 'API Keys' },
          { key: '/admin/rate-limits', icon: <LineChartOutlined />, label: 'Rate Limits' },
          { key: '/admin/audit-logs', icon: <AuditOutlined />, label: 'Audit Logs' },
          { key: '/admin/user-activity', icon: <BarChartOutlined />, label: 'User Activity' },
          { key: '/admin/storage', icon: <PieChartOutlined />, label: 'Storage & Usage' },
          { key: '/admin/system-status', icon: <CloudServerOutlined />, label: 'System Status' },
          { key: '/admin/permissions', icon: <IdcardOutlined />, label: 'My Permissions' },
        ],
      });
    } else if (isOrgAdmin) {
      // ORG_ADMIN: can see their team's activity, storage stats, own permissions,
      // and manage their own API keys (api_keys:* is granted within their org)
      groups.push({
        label: 'Team',
        items: [
          { key: '/admin/api-keys', icon: <KeyOutlined />, label: 'API Keys' },
          { key: '/admin/user-activity', icon: <BarChartOutlined />, label: 'User Activity' },
          { key: '/admin/storage', icon: <PieChartOutlined />, label: 'Storage & Usage' },
          { key: '/admin/system-status', icon: <CloudServerOutlined />, label: 'System Status' },
          { key: '/admin/permissions', icon: <IdcardOutlined />, label: 'My Permissions' },
        ],
      });
    }

    return groups;
  }, [isSuperAdmin, isAdmin, isOrgAdmin, orgId, isPortalSession, portalAllowedViews]);

  const activeKey = useMemo(() => {
    const all = navGroups.flatMap((group) => group.items);
    // Sort by key length (longest first) to match more specific paths first
    // This ensures /scheduled-jobs matches before /scheduled
    const sorted = [...all].sort((a, b) => b.key.length - a.key.length);
    const match = sorted.find((item) => location.pathname.startsWith(item.key));
    return match?.key ?? '/dashboard';
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

  // User profile dropdown items
  const userMenuItems = [
    {
      key: 'user-info',
      label: (
        <div style={{ padding: '4px 0' }}>
          <Typography.Text strong style={{ display: 'block', fontSize: 13 }}>
            {user?.email}
          </Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {user?.role?.replace(/_/g, ' ')}
            {user?.orgId ? ` · Org ${user.orgId}` : ''}
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
            icon: <SettingOutlined />,
            label: 'Organization Settings',
            onClick: () => navigate('/settings'),
          },
          {
            key: 'permissions',
            icon: <IdcardOutlined />,
            label: 'My Permissions',
            onClick: () => navigate('/admin/permissions'),
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
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
      if (isMobile) setCollapsed(true);
    },
    onToggle: toggleSidebar,
    tenantName: tenant?.tenantName,
    tenantCode: tenant?.tenantCode,
    isSuperAdmin,
    isAdmin,
    failedCount,
    onOpenSearch: () => setCmdPaletteOpen(true),
  };

  const renderShell = () => (
    <div className="app-shell">
      {/* Skip-to-content — WCAG 2.4.1, visible on focus for keyboard users */}
      <a
        href="#main-content"
        style={{
          position: 'absolute',
          top: -999,
          left: -999,
          zIndex: 9999,
          padding: '8px 16px',
          background: '#6366f1',
          color: '#fff',
          borderRadius: 6,
          fontWeight: 600,
          fontSize: 14,
          textDecoration: 'none',
        }}
        onFocus={(e) => {
          e.currentTarget.style.top = '16px';
          e.currentTarget.style.left = '16px';
        }}
        onBlur={(e) => {
          e.currentTarget.style.top = '-999px';
          e.currentTarget.style.left = '-999px';
        }}
      >
        Skip to main content
      </a>
      <Layout style={{ minHeight: '100vh', background: 'transparent', position: 'relative', zIndex: 1 }}>
        <ToastHost />
        <CommandPalette
          open={cmdPaletteOpen}
          onClose={() => setCmdPaletteOpen(false)}
          navGroups={navGroups}
          failedCount={failedCount}
        />

        {/* Desktop Sidebar - Hidden in embedded mode */}
        {!isMobile && !isEmbedded && !isSystemStatusStandaloneRoute && (
          <Layout.Sider
            collapsed={collapsed}
            collapsedWidth={68}
            width={240}
            className="app-sider"
            style={{
              background: 'var(--color-sidebar-bg)',
              position: 'sticky',
              top: 0,
              height: '100vh',
              overflow: 'auto',
              borderRight: `1px solid ${cssVar.border.subtle}`,
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <AppSidebar {...sidebarProps} />
          </Layout.Sider>
        )}

        {/* Mobile Drawer - Hidden in embedded mode */}
        {isMobile && !isEmbedded && !isSystemStatusStandaloneRoute && (
          <Drawer
            placement="left"
            open={!collapsed}
            onClose={() => setCollapsed(true)}
            width={280}
            closable={false}
            bodyStyle={{
              padding: 0,
              background: 'var(--color-sidebar-bg)',
            }}
            styles={{
              body: {
                padding: 0,
              },
            }}
          >
            <AppSidebar {...sidebarProps} />
          </Drawer>
        )}
        <Layout style={{ background: 'transparent', minHeight: '100vh' }}>
          {!isEmbedded && !isSystemStatusStandaloneRoute && (
            <Layout.Header
              style={{
                background: mode === 'dark' ? 'rgba(11, 18, 32, 0.98)' : 'rgba(255, 255, 255, 0.98)',
                paddingInline: spacing[4],
                paddingBlock: isMobile ? spacing[2] : 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: isMobile ? 'wrap' : 'nowrap',
                rowGap: spacing[2],
                gap: spacing[4],
                borderBottom: `1px solid ${cssVar.border.subtle}`,
                position: 'sticky',
                top: 0,
                zIndex: zIndexTokens.stickyHeader,
                height: isMobile ? 'auto' : 64,
                minHeight: 64,
                backdropFilter: 'blur(12px)',
                boxShadow: 'var(--shadow-sm)',
              }}
            >
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
                {/* Hamburger Button — mobile only; desktop uses sidebar collapse toggle */}
                {isMobile && (
                  <Button
                    type="text"
                    onClick={toggleSidebar}
                    icon={<MenuOutlined />}
                    aria-label="Open navigation"
                    style={{
                      color: token.colorText,
                      height: 40,
                      width: 40,
                      flexShrink: 0,
                    }}
                  />
                )}

                {/* Tenant Info — redundant with the org switcher below on mobile for admins, so it's
                    hidden there to leave room; non-admin mobile users have no switcher, so it stays
                    as their only org context. */}
                {!(isMobile && (isSuperAdmin || isAdmin) && !isImpersonating) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: spacing[2], minWidth: 0 }}>
                    <Badge status={tenant ? 'success' : 'default'} style={{ flexShrink: 0 }} />
                    <div style={{ minWidth: 0 }}>
                      <Typography.Text
                        strong
                        style={{
                          fontSize: 14,
                          color: token.colorText,
                          display: 'block',
                          lineHeight: 1.4,
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={tenant?.tenantName ?? undefined}
                      >
                        {shortTenantName(tenant?.tenantName) ??
                          (isSuperAdmin || isAdmin ? 'Global Admin View' : 'Tenant')}
                      </Typography.Text>
                      <div style={{ display: 'flex', gap: spacing[2], alignItems: 'center' }}>
                        <Typography.Text
                          type="secondary"
                          style={{
                            fontSize: 12,
                            lineHeight: 1.2,
                          }}
                        >
                          {tenant?.tenantCode ?? (isSuperAdmin || isAdmin ? 'Select org from dropdown' : '')}
                        </Typography.Text>
                        {tenant && (
                          <Typography.Text
                            type="secondary"
                            style={{
                              fontSize: 12,
                              lineHeight: 1.2,
                            }}
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
                    onChange={(value) => {
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

                      if (Number(value) === orgId) {
                        return;
                      }

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
                    }}
                  />
                )}
              </div>

              {/* Right: Actions */}
              <Space size={spacingToNumber(spacing[2])}>
                {/* Command palette trigger */}
                <Tooltip title="Search pages (⌘K)">
                  <Button
                    type="text"
                    icon={<SearchOutlined />}
                    onClick={() => setCmdPaletteOpen(true)}
                    aria-label="Open command palette"
                    style={{ height: 40, width: 40, color: token.colorTextSecondary }}
                  />
                </Tooltip>

                {showGlobalNewIntegrationAction && (
                  <Button
                    type="primary"
                    onClick={() => navigate('/integrations/new')}
                    icon={<ThunderboltOutlined />}
                    style={{
                      fontWeight: 600,
                      height: 38,
                      borderRadius: 8,
                      background: 'linear-gradient(180deg, #2563EB 0%, #1D4ED8 100%)',
                      border: '1px solid #1D4ED8',
                      boxShadow: '0 1px 2px rgba(37, 99, 235, 0.25)',
                    }}
                  >
                    {!isMobile && 'New Integration'}
                  </Button>
                )}

                {/* Failed deliveries badge — only when there are failures */}
                {failedCount > 0 && (
                  <Tooltip title={`${failedCount} failed deliveries — click to view`}>
                    <Button
                      type="text"
                      icon={<WarningOutlined style={{ color: '#E11D48' }} />}
                      onClick={() =>
                        navigate('/logs?status=FAILED&dateRange=all', {
                          state: { applyFilters: Date.now() },
                        })
                      }
                      aria-label={`${failedCount} failed deliveries`}
                      style={{
                        color: '#E11D48',
                        background: 'rgba(254, 226, 226, 0.65)',
                        border: '1px solid #FECDD3',
                        height: 36,
                        paddingInline: 10,
                        borderRadius: 8,
                        fontWeight: 600,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono, monospace)' }}>{failedCount}</span>
                    </Button>
                  </Tooltip>
                )}

                {/* Theme toggle */}
                <Button
                  type="text"
                  onClick={toggleMode}
                  icon={mode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
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
                        fontSize: 12,
                        fontWeight: 600,
                        flexShrink: 0,
                      }}
                    >
                      {(user?.email?.[0] ?? 'U').toUpperCase()}
                    </Avatar>
                    {!isMobile && (
                      <Typography.Text
                        style={{
                          fontSize: 13,
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
            </Layout.Header>
          )}
          <Layout.Content
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
                <div style={{ marginBottom: spacing[4] }}>
                  <div
                    style={{
                      padding: `${spacing[3]} ${spacing[4]}`,
                      borderRadius: 10,
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
                      <Typography.Paragraph style={{ margin: 0 }}>
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
                      <Route
                        path="/inbound-integrations"
                        element={<Navigate to="/integrations?tab=inbound" replace />}
                      />
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
          </Layout.Content>
        </Layout>
      </Layout>
    </div>
  );

  // Public landing page — show before any auth checks
  if (isLandingRoute && !isAuthenticated) {
    return <LandingPage />;
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
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/" replace />;
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
