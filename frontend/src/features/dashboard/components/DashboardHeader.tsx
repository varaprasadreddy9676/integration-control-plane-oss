import { Dropdown, Tooltip } from '@/components/common/LegacyAntdControls';
import type { MenuProps } from '@/components/common/LegacyAntdControls';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';
import { cssVar } from '../../../design-system/utils';
import { Button } from '../../../components/common/LegacyButton';

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  manageLabel: string;
  onManage: () => void;
  onViewLogs: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshSeconds: number;
  /** Timestamp (ms) of the most recent completed fetch, for the countdown. */
  lastRefreshedAt: number | null;
  exportMenuItems: MenuProps['items'];
  isExporting: boolean;
}

export const DashboardHeader = ({
  title,
  subtitle,
  manageLabel,
  onManage,
  onViewLogs,
  onRefresh,
  refreshing,
  refreshSeconds,
  lastRefreshedAt,
  exportMenuItems,
  isExporting,
}: DashboardHeaderProps) => {
  return (
    <header className="dashboard-header">
      <div className="dashboard-title-wrap">
        <div className="dashboard-title-row">
          <Heading level={1} className="dashboard-title">
            {title}
          </Heading>
          <Button type="link" size="small" className="dashboard-manage-link" onClick={onManage}>
            {manageLabel}
            <span className="console-type-caption">→</span>
          </Button>
        </div>
        {subtitle && (
          <Text type="supporting" color="secondary" className="dashboard-subtitle">
            {subtitle}
          </Text>
        )}
      </div>
      <div className="dashboard-actions">
        {refreshSeconds > 0 ? (
          <div className="dashboard-auto-refresh-pill">
            <span className="live-pulse-dot" style={{ background: cssVar.success.text }} />
            <RefreshCountdown
              intervalMs={refreshSeconds * 1000}
              lastRefreshAt={lastRefreshedAt ?? undefined}
              fontSize={12}
            />
          </div>
        ) : (
          <Text type="supporting" color="secondary">
            Auto-refresh off
          </Text>
        )}
        <Button
          icon={<GatewayIcon size="xsm" name="ArrowRightOutlined" />}
          onClick={onViewLogs}
          aria-label="View delivery logs"
          style={{
            height: 34,
            fontWeight: 600,
            fontSize: 'var(--console-type-caption)',
            borderRadius: 4,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 'var(--spacing-2)',
            borderColor: cssVar.border.default,
            boxShadow: 'none',
          }}
        >
          View Logs
        </Button>
        <div className="dashboard-icon-actions">
          <Tooltip title={refreshSeconds > 0 ? `Refresh now (auto-refreshes every ${refreshSeconds}s)` : 'Refresh now'}>
            <Button
              icon={<GatewayIcon size="xsm" name="ReloadOutlined" />}
              onClick={onRefresh}
              loading={refreshing}
              aria-label="Refresh dashboard data"
              style={{
                height: 34,
                width: 34,
                borderRadius: 4,
                borderColor: cssVar.border.default,
                display: 'grid',
                placeItems: 'center',
              }}
            />
          </Tooltip>
          <Dropdown menu={{ items: exportMenuItems }} trigger={['click']} placement="bottomRight">
            <Button
              icon={<GatewayIcon size="xsm" name="DownloadOutlined" />}
              loading={isExporting}
              aria-label="Export dashboard data"
              aria-haspopup="true"
              style={{
                height: 34,
                width: 34,
                borderRadius: 4,
                borderColor: cssVar.border.default,
                display: 'grid',
                placeItems: 'center',
              }}
            />
          </Dropdown>
        </div>
      </div>
    </header>
  );
};
