import { Button, Space, Typography, Avatar, Badge, Dropdown, Tooltip } from 'antd';
import {
  MenuOutlined,
  WarningOutlined,
  ThunderboltOutlined,
  SunOutlined,
  MoonOutlined,
  LogoutOutlined,
  SettingOutlined,
  IdcardOutlined,
  UserOutlined,
} from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useDesignTokens, spacingToNumber } from '../../design-system/utils';
import { cssVar } from '../../design-system/utils/cssVar';
import { withAlpha } from '../../design-system/utils';
import { shortTenantName } from '../../utils/tenant-display';
import { PortalScopeBadge } from '../portal/PortalScopeBadge';

interface AppHeaderProps {
  collapsed: boolean;
  isMobile: boolean;
  isEmbedded: boolean;
  isSystemStatusStandaloneRoute: boolean;
  tenant?: {
    tenantName?: string;
    tenantCode?: string;
    region?: string;
  };
  user?: {
    email?: string;
    role?: string;
    orgId?: number;
    isImpersonating?: boolean;
  };
  failedCount?: number;
  activeKey?: string;
  navGroups: Array<{
    label: string;
    items: Array<{
      key: string;
      icon: React.ReactNode;
      label: string;
    }>;
  }>;
  onToggleSidebar: () => void;
  onNavigate: (path: string) => void;
  onToggleTheme: () => void;
  onLogout: () => void;
  onCreateIntegration: () => void;
  onViewFailedDeliveries: () => void;
  orgId?: number;
  adminOrgs?: Array<{
    orgId: number;
    name?: string;
  }>;
  onSwitchOrg?: (orgId: number) => void;
  onClearOrg?: () => void;
  themeMode: 'light' | 'dark';
  isPortalSession?: boolean;
  isImpersonating?: boolean;
}

/**
 * Application Header Component
 *
 * Accessibility:
 * - Proper semantic HTML with header role
 * - Keyboard-accessible buttons and dropdowns
 * - ARIA labels for all interactive elements
 * - Skip navigation link (for keyboard users)
 *
 * UX:
 * - Responsive design (mobile/desktop)
 * - Clear visual hierarchy
 * - Loading states for async actions
 * - Contextual actions based on user role
 */

export const AppHeader = ({
  collapsed,
  isMobile,
  isEmbedded,
  isSystemStatusStandaloneRoute,
  tenant,
  user,
  failedCount,
  onToggleSidebar,
  onToggleTheme,
  onLogout,
  onCreateIntegration,
  onViewFailedDeliveries,
  themeMode,
  isPortalSession,
  isImpersonating,
}: AppHeaderProps) => {
  const { spacing, token } = useDesignTokens();

  const userMenuItems: MenuProps['items'] = [
    ...(user && !isPortalSession
      ? [
          {
            key: 'profile',
            icon: <UserOutlined />,
            label: (
              <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 200 }}>
                <span>Profile</span>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{user?.role?.replace(/_/g, ' ')}</span>
              </span>
            ),
            onClick: () => {
              /* Navigate to profile */
            },
          },
          {
            key: 'settings',
            icon: <SettingOutlined />,
            label: 'Organization Settings',
            onClick: () => {
              /* Navigate to settings */
            },
          },
          {
            key: 'permissions',
            icon: <IdcardOutlined />,
            label: 'My Permissions',
            onClick: () => {
              /* Navigate to permissions */
            },
          },
          { type: 'divider' as const },
        ]
      : []),
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: 'Sign out',
      danger: true,
      onClick: onLogout,
    },
  ];

  return (
    <header
      className="app-header"
      style={{
        background: themeMode === 'dark' ? 'rgba(11, 18, 32, 0.98)' : 'rgba(255, 255, 255, 0.98)',
        paddingInline: spacing[4],
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: spacing[4],
        borderBottom: `1px solid ${cssVar.border.subtle}`,
        position: 'sticky',
        top: 0,
        zIndex: 1000,
        height: 64,
        backdropFilter: 'blur(12px)',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      {/* Skip Navigation Link (Accessibility) */}
      <a
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
        style={{
          position: 'absolute',
          left: '-9999px',
          width: 1,
          height: 1,
          overflow: 'hidden',
        }}
      >
        Skip to main content
      </a>

      {/* Left: Hamburger + Tenant Info */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: spacing[3],
          flex: 1,
          minWidth: 0,
        }}
      >
        {/* Hamburger Button */}
        {!isEmbedded && !isSystemStatusStandaloneRoute && (
          <Tooltip title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} placement="bottom">
            <Button
              type="text"
              onClick={onToggleSidebar}
              icon={<MenuOutlined />}
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!collapsed}
              aria-controls="app-sidebar"
              style={{
                color: token.colorText,
                height: 40,
                width: 40,
                flexShrink: 0,
              }}
            />
          </Tooltip>
        )}

        {/* Tenant Info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[2],
            minWidth: 0,
          }}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: tenant?.tenantName ? '#10B981' : '#94A3B8' }} />
            {tenant?.tenantName && (
              <span
                className="live-pulse-dot"
                style={{
                  position: 'absolute',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: 'rgba(16, 185, 129, 0.35)',
                }}
              />
            )}
          </div>
          <div
            style={{
              minWidth: 0,
              flex: 1,
            }}
          >
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
              aria-label={`Organization: ${tenant?.tenantName || 'None'}`}
              title={tenant?.tenantName ?? undefined}
            >
              {shortTenantName(tenant?.tenantName) ?? 'Tenant'}
            </Typography.Text>
            <div
              style={{
                display: 'flex',
                gap: spacing[2],
                alignItems: 'center',
              }}
            >
              <Typography.Text
                type="secondary"
                style={{
                  fontSize: 12,
                  lineHeight: 1.2,
                }}
              >
                {tenant?.tenantCode || 'No Code'}
              </Typography.Text>
              {tenant?.region && (
                <>
                  <Typography.Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      lineHeight: 1.2,
                    }}
                    aria-hidden="true"
                  >
                    •
                  </Typography.Text>
                  <Typography.Text
                    type="secondary"
                    style={{
                      fontSize: 12,
                      lineHeight: 1.2,
                    }}
                  >
                    {tenant.region}
                  </Typography.Text>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Portal Session Badge */}
        {isPortalSession && <PortalScopeBadge />}
      </div>

      {/* Right: Actions */}
      <Space size={spacingToNumber(spacing[2])} aria-label="Header actions">
        {!isPortalSession && (
          <Button
            type="primary"
            onClick={onCreateIntegration}
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

        {/* Failed deliveries badge */}
        {failedCount && failedCount > 0 && (
          <Tooltip title={`${failedCount} failed deliveries — click to view`} placement="bottom">
            <Button
              type="text"
              icon={<WarningOutlined style={{ color: '#E11D48' }} />}
              onClick={onViewFailedDeliveries}
              aria-label={`${failedCount} failed deliveries`}
              style={{
                // Was a light-mode pink pill regardless of theme. Uses the
                // semantic tokens so it reads correctly on the navy shell too.
                color: cssVar.error.text,
                background: withAlpha(cssVar.error.text, 0.12),
                border: `1px solid ${withAlpha(cssVar.error.text, 0.3)}`,
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
              <span style={{ fontSize: 12, fontWeight: 500 }}>failed</span>
            </Button>
          </Tooltip>
        )}

        {/* Theme toggle */}
        <Tooltip title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} placement="bottom">
          <Button
            type="text"
            onClick={onToggleTheme}
            icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            style={{
              color: token.colorTextSecondary,
              height: 40,
              width: 40,
            }}
          />
        </Tooltip>

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
            aria-haspopup="true"
          >
            <Avatar
              size={28}
              style={{
                background: token.colorPrimary,
                fontSize: 12,
                fontWeight: 600,
                flexShrink: 0,
              }}
              aria-hidden="true"
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
                }}
              >
                {user?.email?.split('@')[0]}
              </Typography.Text>
            )}
          </Button>
        </Dropdown>
      </Space>
    </header>
  );
};
// Helper function removed - using spacingToNumber from design-system/utils instead
