import { Badge, Tooltip } from "@/components/common/LegacyAntdControls";
import { Icon as GatewayIcon } from '../common/Icon';
import { SideNav, SideNavHeading, SideNavItem, SideNavSection } from '@astryxdesign/core/SideNav';
import { useEffect, useMemo, useState } from 'react';
import { Button as AstryxButton } from '@astryxdesign/core/Button';

interface AppSidebarProps {
  collapsed: boolean;
  isMobile: boolean;
  navGroups: Array<{
    label: string;
    items: Array<{ key: string; icon: React.ReactNode; label: string }>;
  }>;
  activeKey: string;
  onNavigate: (path: string) => void;
  onToggle: () => void;
  failedCount?: number;
}

const COLLAPSED_GROUPS_KEY = 'sidebar-collapsed-groups';

const isRouteInGroup = (activeKey: string, items: AppSidebarProps['navGroups'][number]['items']) =>
  items.some((item) => activeKey === item.key || activeKey.startsWith(`${item.key}/`));

const readCollapsedGroups = (): Record<string, boolean> => {
  try {
    const stored = window.localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = stored ? JSON.parse(stored) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { Administration: true };
    }
    return {
      Administration: true,
      ...Object.fromEntries(
        Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean')
      ),
    };
  } catch {
    return { Administration: true };
  }
};

export const AppSidebar = ({
  collapsed,
  isMobile,
  navGroups,
  activeKey,
  onNavigate,
  onToggle,
  failedCount,
}: AppSidebarProps) => {
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    const initial = readCollapsedGroups();
    const activeGroup = navGroups.find((group) => isRouteInGroup(activeKey, group.items));
    if (activeGroup) initial[activeGroup.label] = false;
    return initial;
  });
  const isCollapsed = collapsed && !isMobile;
  const collapseConfig = useMemo(
    () => ({ isCollapsed, onCollapsedChange: onToggle, hasButton: false }),
    [isCollapsed, onToggle]
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(collapsedGroups));
    } catch {
      // Navigation remains usable when browser storage is unavailable.
    }
  }, [collapsedGroups]);

  useEffect(() => {
    const activeGroup = navGroups.find((group) => isRouteInGroup(activeKey, group.items));
    if (activeGroup) {
      setCollapsedGroups((previous) =>
        previous[activeGroup.label] ? { ...previous, [activeGroup.label]: false } : previous
      );
    }
  }, [activeKey, navGroups]);
  return (
    <SideNav
      className={`app-sidebar${isCollapsed ? ' app-sidebar--collapsed' : ''}`}
      collapsible={isMobile ? false : collapseConfig}
      header={
        <SideNavHeading
          icon={<GatewayIcon name="DeploymentUnitOutlined" />}
          superheading="MEDICS"
          heading="Integration Gateway"
          headerEndContent={
            !isMobile && !isCollapsed ? (
              <Tooltip title="Collapse sidebar" placement="right">
                <AstryxButton
                  label="Collapse sidebar"
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  className="app-sidebar__collapse-button"
                  icon={<GatewayIcon name="PanelLeftClose" aria-hidden="true" />}
                  aria-label="Collapse sidebar"
                  onClick={onToggle}
                />
              </Tooltip>
            ) : undefined
          }
        />
      }
      topContent={
        isCollapsed ? (
          <div className="app-sidebar__collapse-row">
            <Tooltip title="Expand sidebar" placement="right">
              <AstryxButton
                label="Expand sidebar"
                variant="ghost"
                size="sm"
                isIconOnly
                className="app-sidebar__collapse-button"
                icon={<GatewayIcon name="PanelLeftOpen" aria-hidden="true" />}
                aria-label="Expand sidebar"
                onClick={onToggle}
              />
            </Tooltip>
          </div>
        ) : undefined
      }
      data-testid="app-sidebar"
    >
      {navGroups.map((group) => {
        const isGroupCollapsed = !isMobile && Boolean(collapsedGroups[group.label]);
        return (
          <SideNavSection
            key={group.label}
            title={group.label}
            endContent={
              !isCollapsed && !isMobile ? (
                <AstryxButton
                  label={`${isGroupCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                  variant="ghost"
                  size="sm"
                  isIconOnly
                  className="app-sidebar__group-toggle"
                  icon={<GatewayIcon name="CaretDownOutlined" rotate={isGroupCollapsed ? -90 : 0} aria-hidden="true" />}
                  aria-label={`${isGroupCollapsed ? 'Expand' : 'Collapse'} ${group.label}`}
                  aria-expanded={!isGroupCollapsed}
                  onClick={() =>
                    setCollapsedGroups((previous) => ({ ...previous, [group.label]: !previous[group.label] }))
                  }
                />
              ) : undefined
            }
          >
            {!isGroupCollapsed &&
              group.items.map((item) => (
                <SideNavItem
                  key={item.key}
                  label={item.label}
                  icon={item.icon}
                  isSelected={activeKey === item.key}
                  onClick={() => onNavigate(item.key)}
                  endContent={
                    item.key === '/logs' && failedCount ? <Badge count={failedCount} size="small" /> : undefined
                  }
                />
              ))}
          </SideNavSection>
        );
      })}
    </SideNav>
  );
};
