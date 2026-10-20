import { Button, Dropdown, Tooltip, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { ArrowRightOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { RefreshCountdown } from '../../../components/common/RefreshCountdown';

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
          <Typography.Title level={3} className="dashboard-title">
            {title}
          </Typography.Title>
          <Button type="link" size="small" className="dashboard-manage-link" onClick={onManage}>
            {manageLabel}
            <span style={{ fontSize: 11 }}>→</span>
          </Button>
        </div>
        {subtitle && (
          <Typography.Text type="secondary" className="dashboard-subtitle">
            {subtitle}
          </Typography.Text>
        )}
      </div>
      <div className="dashboard-actions">
        {refreshSeconds > 0 ? (
          <div className="dashboard-auto-refresh-pill">
            <span className="live-pulse-dot" style={{ background: '#10B981' }} />
            <RefreshCountdown
              intervalMs={refreshSeconds * 1000}
              lastRefreshAt={lastRefreshedAt ?? undefined}
              fontSize={12}
            />
          </div>
        ) : (
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Auto-refresh off
          </Typography.Text>
        )}
        <Button
          icon={<ArrowRightOutlined style={{ fontSize: 12 }} />}
          onClick={onViewLogs}
          aria-label="View delivery logs"
          style={{
            height: 34,
            fontWeight: 600,
            fontSize: 12.5,
            borderRadius: 8,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderColor: '#CBD5E1',
            boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
          }}
        >
          View Logs
        </Button>
        <Tooltip title={refreshSeconds > 0 ? `Refresh now (auto-refreshes every ${refreshSeconds}s)` : 'Refresh now'}>
          <Button
            icon={<ReloadOutlined style={{ fontSize: 13 }} />}
            onClick={onRefresh}
            loading={refreshing}
            aria-label="Refresh dashboard data"
            style={{
              height: 34,
              width: 34,
              borderRadius: 8,
              borderColor: '#E2E8F0',
              display: 'grid',
              placeItems: 'center',
            }}
          />
        </Tooltip>
        <Dropdown menu={{ items: exportMenuItems }} trigger={['click']} placement="bottomRight">
          <Button
            icon={<DownloadOutlined style={{ fontSize: 13 }} />}
            loading={isExporting}
            aria-label="Export dashboard data"
            aria-haspopup="true"
            style={{
              height: 34,
              width: 34,
              borderRadius: 8,
              borderColor: '#E2E8F0',
              display: 'grid',
              placeItems: 'center',
            }}
          />
        </Dropdown>
      </div>
    </header>
  );
};
