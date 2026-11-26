import { Dropdown, Tooltip, Space, Badge } from '@/components/common/LegacyAntdControls';
import { Icon as GatewayIcon } from '../common/Icon';
import type { MenuProps } from '@/components/common/LegacyAntdControls';
import { Button } from '../common/LegacyButton';
import { Typography } from '../common/LegacyTypography';

interface DashboardHeaderProps {
  title: string;
  subtitle: string;
  manageLabel: string;
  onManage: () => void;
  onViewLogs: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  refreshSeconds: number;
  refreshCountdown: number | null;
  exportMenuItems: MenuProps['items'];
  isExporting: boolean;
  lastRefreshTime?: Date;
}

/**
 * Dashboard Header Component
 *
 * Accessibility:
 * - Proper semantic HTML (header, h1)
 * - ARIA labels for all interactive elements
 * - Keyboard-accessible actions
 * - Loading states with proper feedback
 *
 * UX:
 * - Clear visual hierarchy
 * - Action grouping with logical spacing
 * - Feedback for async operations
 * - Contextual helper text
 */
export const DashboardHeader = ({
  title,
  subtitle,
  manageLabel,
  onManage,
  onViewLogs,
  onRefresh,
  refreshing,
  refreshSeconds,
  refreshCountdown,
  exportMenuItems,
  isExporting,
  lastRefreshTime,
}: DashboardHeaderProps) => {
  return (
    <header className="dashboard-header dashboard-header--spacious">
      <div className="dashboard-header-main">
        {/* Title Section */}
        <div className="console-flex-min-width-0">
          <div className="dashboard-header-title-row">
            <Typography.Title level={3} className="dashboard-header-title">
              {title}
            </Typography.Title>
            <Button type="link" size="small" onClick={onManage} className="dashboard-header-manage">
              {manageLabel}
            </Button>
          </div>
          <Typography.Text type="secondary" className="console-type-control console-display-block">
            {subtitle}
          </Typography.Text>
        </div>

        {/* Actions */}
        <div className="dashboard-header-refresh">
          <Space size="small">
            {/* Auto-refresh indicator */}
            {refreshSeconds > 0 && (
              <Tooltip
                title={`Auto-refresh enabled (every ${refreshSeconds}s). Last refresh: ${lastRefreshTime ? new Date(lastRefreshTime).toLocaleTimeString() : 'Never'}`}
                placement="bottomRight"
              >
                <Badge
                  status="processing"
                  text={
                    <Typography.Text type="secondary" className="console-type-caption">
                      {refreshCountdown !== null ? `Refreshing in ${refreshCountdown}s` : 'Auto-refresh on'}
                    </Typography.Text>
                  }
                  className="console-type-caption"
                />
              </Tooltip>
            )}
          </Space>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="dashboard-header-actions">
        <Space size="small">
          {/* View Logs Button */}
          <Button
            type="default"
            icon={<GatewayIcon name="ArrowRightOutlined" />}
            onClick={onViewLogs}
            className="console-font-weight-medium"
          >
            View Logs
          </Button>

          {/* Refresh Button */}
          <Tooltip
            title={
              refreshing
                ? 'Refreshing...'
                : `Refresh now${refreshSeconds > 0 && refreshCountdown !== null ? ` (next auto refresh in ${refreshCountdown}s)` : ''}`
            }
            placement="top"
          >
            <Button
              icon={refreshing ? <GatewayIcon name="LoadingOutlined" spin /> : <GatewayIcon name="ReloadOutlined" />}
              onClick={onRefresh}
              loading={refreshing}
              disabled={refreshing}
              aria-label="Refresh dashboard data"
              className="dashboard-header-icon-action"
            />
          </Tooltip>

          {/* Export Button */}
          <Dropdown menu={{ items: exportMenuItems }} trigger={['click']} placement="bottomRight">
            <Button
              icon={isExporting ? <GatewayIcon name="LoadingOutlined" spin /> : <GatewayIcon name="DownloadOutlined" />}
              loading={isExporting}
              aria-label="Export dashboard data"
              className="dashboard-header-icon-action"
            />
          </Dropdown>
        </Space>
      </div>
    </header>
  );
};

/**
 * Dashboard Header Component (Compact variant)
 *
 * For use in embedded or constrained layouts
 */
export const DashboardHeaderCompact = ({
  title,
  refreshing,
  onRefresh,
}: {
  title: string;
  refreshing?: boolean;
  onRefresh?: () => void;
}) => {
  return (
    <div className="dashboard-header-compact">
      <Typography.Title level={4} className="console-margin-0 console-type-title console-font-weight-semibold">
        {title}
      </Typography.Title>

      {onRefresh && (
        <Tooltip title="Refresh dashboard" placement="top">
          <Button
            type="text"
            icon={refreshing ? <GatewayIcon name="LoadingOutlined" spin /> : <GatewayIcon name="ReloadOutlined" />}
            onClick={onRefresh}
            loading={refreshing}
            aria-label="Refresh dashboard"
          />
        </Tooltip>
      )}
    </div>
  );
};
