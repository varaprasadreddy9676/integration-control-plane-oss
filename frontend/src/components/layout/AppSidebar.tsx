import { Typography, Badge, Button, Tooltip } from 'antd';
import {
  DeploymentUnitOutlined,
  MenuOutlined,
  SearchOutlined,
  ClockCircleOutlined,
  HistoryOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';
import { useDesignTokens } from '../../design-system/utils';
import { cssVar } from '../../design-system/utils/cssVar';
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { SidebarActiveIndicator, useActiveRowRect } from './SidebarActiveIndicator';

interface AppSidebarProps {
  collapsed: boolean;
  isMobile: boolean;
  navGroups: Array<{
    label: string;
    items: Array<{
      key: string;
      icon: React.ReactNode;
      label: string;
    }>;
  }>;
  activeKey: string;
  onNavigate: (path: string) => void;
  onToggle: () => void;
  tenantName?: string;
  tenantCode?: string;
  isSuperAdmin?: boolean;
  isAdmin?: boolean;
  failedCount?: number;
  onOpenSearch?: () => void;
}

interface NavItemRowProps {
  itemKey: string;
  icon: React.ReactNode;
  label: string;
  activeKey: string;
  isCollapsedDesktop: boolean;
  spacing: Record<string, string>;
  token: { colorError: string };
  failedCount?: number;
  onMenuClick: (key: string) => void;
  showBadge?: boolean;
  /** Row in the main nav: its highlight is the shared sliding indicator. */
  primary?: boolean;
}

interface NavItem {
  key: string;
  icon: React.ReactNode;
  label: string;
  group: string;
  groupLabel: string;
}

interface RecentItem {
  key: string;
  label: string;
  timestamp: number;
}

// Defined outside parent — prevents remount on every render
function NavItemRow({
  itemKey,
  icon,
  label,
  activeKey,
  isCollapsedDesktop,
  spacing,
  token,
  failedCount,
  onMenuClick,
  showBadge,
  primary = false,
}: NavItemRowProps) {
  const isActive = activeKey === itemKey;
  // Primary rows leave their highlight to SidebarActiveIndicator.
  const paintsHighlight = isActive && !primary;

  const inner = (
    <div
      onClick={() => onMenuClick(itemKey)}
      role="menuitem"
      tabIndex={0}
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onMenuClick(itemKey);
        }
      }}
      aria-current={isActive ? 'page' : undefined}
      data-nav-primary={primary || undefined}
      className="sidebar-nav-item"
      style={{
        padding: isCollapsedDesktop ? `${spacing[2]} 0` : `${spacing[2]} ${spacing[3]}`,
        borderRadius: isCollapsedDesktop ? 10 : 8,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: isCollapsedDesktop ? 'center' : 'flex-start',
        gap: spacing[3],
        position: 'relative',
        background: paintsHighlight ? 'var(--color-sidebar-active-bg)' : 'transparent',
        boxShadow: paintsHighlight ? '0 0 14px rgba(59, 130, 246, 0.2)' : 'none',
        // Consistent left-border active indicator in both modes
        borderLeft: paintsHighlight ? `3px solid var(--color-sidebar-accent)` : '3px solid transparent',
        borderRight: isCollapsedDesktop ? '3px solid transparent' : undefined,
        marginBottom: 3,
        transition: 'background-color 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        outline: 'none',
        minHeight: 34,
        width: '100%',
      }}
    >
      <span
        style={{
          fontSize: 16,
          color: isActive ? 'var(--color-sidebar-accent)' : 'var(--color-sidebar-item)',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          transition: 'color 0.15s',
          // Center icon in collapsed mode accounting for left border
          marginLeft: isCollapsedDesktop ? 0 : undefined,
        }}
      >
        {icon}
      </span>

      {!isCollapsedDesktop && (
        <>
          <Typography.Text
            style={{
              fontWeight: isActive ? 600 : 500,
              fontSize: 13.5,
              color: isActive ? 'var(--color-sidebar-active-text)' : 'var(--color-sidebar-item)',
              flex: 1,
              transition: 'color 0.15s',
              lineHeight: 1,
            }}
            ellipsis
          >
            {label}
          </Typography.Text>

          {showBadge && !!failedCount && failedCount > 0 ? (
            <Badge
              count={failedCount}
              size="small"
              style={{ background: token.colorError, fontSize: 10 }}
              aria-label={`${failedCount} failed deliveries`}
            />
          ) : null}
        </>
      )}
    </div>
  );

  return isCollapsedDesktop ? (
    <Tooltip title={label} placement="right">
      {inner}
    </Tooltip>
  ) : (
    inner
  );
}

function useLocalStorage<T>(key: string, initialValue: T) {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T | ((val: T) => T)) => {
      setStoredValue((prev) => {
        const valueToStore = value instanceof Function ? value(prev) : value;
        try {
          window.localStorage.setItem(key, JSON.stringify(valueToStore));
        } catch {
          // silent
        }
        return valueToStore;
      });
    },
    [key]
  );

  return [storedValue, setValue] as const;
}

function getInitials(name?: string): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export const AppSidebar = ({
  collapsed,
  isMobile,
  navGroups,
  activeKey,
  onNavigate,
  onToggle,
  tenantName,
  tenantCode,
  isSuperAdmin,
  isAdmin,
  failedCount,
  onOpenSearch,
}: AppSidebarProps) => {
  const { spacing, token } = useDesignTokens();

  const [collapsedGroups, setCollapsedGroups] = useLocalStorage<Record<string, boolean>>(
    'sidebar-collapsed-groups',
    {}
  );
  const [recentItems, setRecentItems] = useLocalStorage<RecentItem[]>('sidebar-recent-items', []);

  const allNavItems: NavItem[] = useMemo(
    () =>
      navGroups.flatMap((group) =>
        group.items.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: item.label,
          group: group.label.toLowerCase().replace(/\s+/g, '-'),
          groupLabel: group.label,
        }))
      ),
    [navGroups]
  );

  useEffect(() => {
    if (activeKey && activeKey !== '/dashboard') {
      const currentItem = allNavItems.find((item) => item.key === activeKey);
      if (currentItem) {
        setRecentItems((prev) => {
          const filtered = prev.filter((item) => item.key !== activeKey);
          return [{ key: currentItem.key, label: currentItem.label, timestamp: Date.now() }, ...filtered].slice(0, 5);
        });
      }
    }
  }, [activeKey, allNavItems, setRecentItems]);

  const toggleGroup = useCallback(
    (groupLabel: string) => {
      setCollapsedGroups((prev) => ({ ...prev, [groupLabel]: !prev[groupLabel] }));
    },
    [setCollapsedGroups]
  );

  const handleMenuClick = useCallback(
    (path: string) => {
      onNavigate(path);
      if (isMobile) onToggle();
    },
    [onNavigate, isMobile, onToggle]
  );

  const isCollapsedDesktop = collapsed && !isMobile;

  const navRef = useRef<HTMLDivElement>(null);
  const activeRowRect = useActiveRowRect(navRef);

  const navItemProps = {
    activeKey,
    isCollapsedDesktop,
    spacing,
    token,
    failedCount,
    onMenuClick: handleMenuClick,
  };

  return (
    <>
      <style>{`
        .sidebar-nav-item:hover {
          background: var(--color-sidebar-hover) !important;
        }
        .sidebar-nav-item[aria-current="page"]:hover {
          background: var(--color-sidebar-active-bg) !important;
        }
        .sidebar-nav-item[data-nav-primary][aria-current="page"]:hover {
          background: transparent !important;
        }
        .sidebar-nav-item:focus-visible {
          box-shadow: inset 0 0 0 2px var(--color-sidebar-accent);
        }
        .sidebar-group-header:hover {
          background: var(--color-sidebar-hover) !important;
        }
        .sidebar-search-trigger:hover {
          border-color: var(--color-sidebar-accent) !important;
          background: var(--color-sidebar-hover) !important;
        }
        .sidebar-search-trigger:focus {
          outline: none;
        }
        .sidebar-collapse-btn {
          opacity: 0;
          transition: opacity 0.15s;
        }
        .app-sidebar:hover .sidebar-collapse-btn {
          opacity: 1;
        }
        .sidebar-collapse-btn:focus-visible {
          opacity: 1;
        }
      `}</style>

      <nav
        className="app-sidebar"
        aria-label="Main navigation"
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--color-sidebar-bg)',
        }}
      >
        {/* ── Brand header ── */}
        <div
          style={{
            padding: isCollapsedDesktop ? `${spacing[4]} ${spacing[2]}` : `0 ${spacing[3]} 0 ${spacing[4]}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsedDesktop ? 'center' : 'space-between',
            borderBottom: `1px solid ${cssVar.border.subtle}`,
            minHeight: 56,
            position: 'relative',
          }}
        >
          {isCollapsedDesktop ? (
            /* Collapsed: logo is the expand button */
            <Tooltip title="Expand sidebar" placement="right">
              <div
                onClick={onToggle}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && onToggle()}
                aria-label="Expand sidebar"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 8,
                  display: 'grid',
                  placeItems: 'center',
                  background: cssVar.primary[500],
                  color: cssVar.text.inverse,
                  cursor: 'pointer',
                  flexShrink: 0,
                }}
              >
                <DeploymentUnitOutlined style={{ fontSize: 18 }} />
              </div>
            </Tooltip>
          ) : (
            <>
              {/* Logo + name — clicking anywhere collapses on desktop */}
              <div
                onClick={!isMobile ? onToggle : undefined}
                role={!isMobile ? 'button' : undefined}
                tabIndex={!isMobile ? 0 : undefined}
                onKeyDown={!isMobile ? (e) => e.key === 'Enter' && onToggle() : undefined}
                aria-label={!isMobile ? 'Collapse sidebar' : undefined}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: spacing[3],
                  minWidth: 0,
                  cursor: !isMobile ? 'pointer' : 'default',
                  flex: 1,
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    display: 'grid',
                    placeItems: 'center',
                    background: cssVar.primary[500],
                    color: cssVar.text.inverse,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  <DeploymentUnitOutlined style={{ fontSize: 16 }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Typography.Text
                      strong
                      style={{ color: 'var(--color-sidebar-active-text)', fontWeight: 700, fontSize: 14 }}
                    >
                      Integration
                    </Typography.Text>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 700,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                        color: 'var(--color-sidebar-accent)',
                        background: 'rgba(99,102,241,0.15)',
                        border: '1px solid rgba(99,102,241,0.35)',
                        borderRadius: 4,
                        padding: '1px 4px',
                        lineHeight: 1.6,
                      }}
                    >
                      BETA
                    </span>
                  </div>
                  <Typography.Text style={{ color: 'var(--color-sidebar-item)', fontSize: 11, opacity: 0.7 }}>
                    Gateway
                  </Typography.Text>
                </div>
              </div>

              {/* Mobile close button */}
              {isMobile && (
                <Button
                  type="text"
                  icon={<MenuOutlined />}
                  onClick={onToggle}
                  aria-label="Close sidebar"
                  style={{ color: 'var(--color-sidebar-item)', height: 32, width: 32, flexShrink: 0 }}
                />
              )}
            </>
          )}
        </div>

        {/* ── Scrollable nav ── */}
        <div
          ref={navRef}
          role="navigation"
          aria-label="Primary navigation"
          style={{
            position: 'relative',
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: isCollapsedDesktop ? `${spacing[2]} 0` : `${spacing[3]} ${spacing[3]}`,
          }}
        >
          <SidebarActiveIndicator rect={activeRowRect} rounded={isCollapsedDesktop ? 10 : 8} />
          {!isCollapsedDesktop && (
            <>
              {/* ⌘K search trigger */}
              <div style={{ marginBottom: spacing[3] }}>
                <div
                  onClick={onOpenSearch}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && onOpenSearch?.()}
                  aria-label="Search pages (⌘K)"
                  className="sidebar-search-trigger"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    borderRadius: 7,
                    border: `1px solid ${cssVar.border.subtle}`,
                    background: 'var(--color-sidebar-hover)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <SearchOutlined style={{ fontSize: 13, color: 'var(--color-sidebar-item)', opacity: 0.6 }} />
                  <Typography.Text style={{ flex: 1, fontSize: 13, color: 'var(--color-sidebar-item)', opacity: 0.5 }}>
                    Search…
                  </Typography.Text>
                  <kbd
                    style={{
                      fontSize: 10,
                      color: 'var(--color-sidebar-item)',
                      opacity: 0.5,
                      background: cssVar.border.subtle,
                      border: `1px solid ${cssVar.border.subtle}`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontFamily: 'monospace',
                    }}
                  >
                    ⌘K
                  </kbd>
                </div>
              </div>

              {/* Recent items */}
              {recentItems.length > 0 && (
                <div style={{ marginBottom: spacing[3] }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: spacing[2],
                      marginBottom: spacing[1],
                      padding: `0 ${spacing[2]}`,
                    }}
                  >
                    <HistoryOutlined style={{ fontSize: 11, color: 'var(--color-sidebar-item)' }} />
                    <Typography.Text
                      style={{
                        color: 'var(--color-sidebar-item)',
                        fontSize: 10,
                        fontWeight: 600,
                        letterSpacing: '0.07em',
                        textTransform: 'uppercase',
                      }}
                    >
                      Recent
                    </Typography.Text>
                  </div>
                  {recentItems.slice(0, 3).map((item) => (
                    <NavItemRow
                      key={item.key}
                      itemKey={item.key}
                      icon={<ClockCircleOutlined style={{ fontSize: 13 }} />}
                      label={item.label}
                      {...navItemProps}
                    />
                  ))}
                  <div
                    style={{
                      height: 1,
                      background: cssVar.border.subtle,
                      margin: `${spacing[3]} 0`,
                    }}
                  />
                </div>
              )}
            </>
          )}

          {/* Nav groups */}
          {navGroups.map((group, groupIndex) => {
            const isGroupCollapsed = !!collapsedGroups[group.label];
            const isLast = groupIndex === navGroups.length - 1;

            return (
              <div key={group.label}>
                {/* Group divider in collapsed mode (between groups, not after last) */}
                {isCollapsedDesktop && groupIndex > 0 && (
                  <div
                    style={{
                      height: 1,
                      background: cssVar.border.subtle,
                      margin: `${spacing[2]} ${spacing[3]}`,
                      opacity: 0.6,
                    }}
                  />
                )}

                <div style={{ marginBottom: isCollapsedDesktop ? 0 : spacing[1] }}>
                  {/* Group header — expanded desktop & mobile only */}
                  {!isCollapsedDesktop && (
                    <div
                      className="sidebar-group-header"
                      onClick={() => toggleGroup(group.label)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && toggleGroup(group.label)}
                      aria-expanded={!isGroupCollapsed}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: spacing[2],
                        padding: `${spacing[2]} ${spacing[2]}`,
                        cursor: 'pointer',
                        borderRadius: 6,
                        marginBottom: 2,
                        userSelect: 'none',
                        transition: 'background 0.15s',
                      }}
                    >
                      <Typography.Text
                        style={{
                          color: 'var(--color-sidebar-item)',
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: '0.08em',
                          textTransform: 'uppercase',
                          flex: 1,
                          opacity: 0.6,
                        }}
                      >
                        {group.label}
                      </Typography.Text>
                      <CaretDownOutlined
                        style={{
                          fontSize: 9,
                          color: 'var(--color-sidebar-item)',
                          opacity: 0.4,
                          transform: isGroupCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
                          transition: 'transform 0.2s',
                        }}
                      />
                    </div>
                  )}

                  {/* Items */}
                  {!isGroupCollapsed &&
                    group.items.map((item) => (
                      <NavItemRow
                        key={item.key}
                        itemKey={item.key}
                        icon={item.icon}
                        label={item.label}
                        showBadge={item.key === '/logs'}
                        primary
                        {...navItemProps}
                      />
                    ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Footer ── */}
        <div
          style={{
            borderTop: `1px solid ${cssVar.border.subtle}`,
            padding: isCollapsedDesktop ? `${spacing[3]} ${spacing[2]}` : `${spacing[3]} ${spacing[4]}`,
          }}
        >
          {!isCollapsedDesktop ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: spacing[3] }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(99,102,241,0.2)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
                aria-hidden="true"
              >
                <Typography.Text
                  style={{ color: 'var(--color-sidebar-accent)', fontSize: 11, fontWeight: 700, lineHeight: 1 }}
                >
                  {getInitials(tenantName || (isSuperAdmin ? 'SA' : isAdmin ? 'AD' : undefined))}
                </Typography.Text>
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <Typography.Text
                  strong
                  ellipsis
                  style={{ fontSize: 13, color: 'var(--color-sidebar-active-text)', display: 'block', lineHeight: 1.4 }}
                >
                  {tenantName ?? (isSuperAdmin ? 'Global Admin' : isAdmin ? 'Admin' : 'Tenant')}
                </Typography.Text>
                {tenantCode && (
                  <Typography.Text
                    ellipsis
                    style={{ fontSize: 11, color: 'var(--color-sidebar-item)', opacity: 0.5, lineHeight: 1.2 }}
                  >
                    {tenantCode}
                  </Typography.Text>
                )}
              </div>

              <Badge status={tenantName ? 'success' : 'default'} aria-label={tenantName ? 'Connected' : 'No org'} />
            </div>
          ) : (
            <Tooltip title={tenantName ?? (isSuperAdmin ? 'Global Admin' : 'Tenant')} placement="right">
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: 'rgba(99,102,241,0.2)',
                  border: '1px solid rgba(99,102,241,0.3)',
                  display: 'grid',
                  placeItems: 'center',
                  margin: '0 auto',
                  cursor: 'default',
                }}
              >
                <Typography.Text style={{ color: 'var(--color-sidebar-accent)', fontSize: 11, fontWeight: 700 }}>
                  {getInitials(tenantName || (isSuperAdmin ? 'SA' : isAdmin ? 'AD' : undefined))}
                </Typography.Text>
              </div>
            </Tooltip>
          )}
        </div>
      </nav>
    </>
  );
};
