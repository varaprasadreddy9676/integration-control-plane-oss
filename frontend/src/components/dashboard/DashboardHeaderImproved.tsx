import { Button, Dropdown, Tooltip, Typography, Space, Badge } from 'antd';
import { ArrowRightOutlined, DownloadOutlined, ReloadOutlined, LoadingOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { useDesignTokens } from '../../design-system/utils';

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
  const { spacing } = useDesignTokens();

  return (
    <header
      className="dashboard-header"
      style={{
        marginBottom: spacing[6],
      padding: `${spacing[4]} 0`
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: spacing[4],
          marginBottom: spacing[3]
        }}
      >
        {/* Title Section */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: spacing[3],
              marginBottom: spacing[2]
            }}
          >
            <Typography.Title
              level={3}
              style={{
                margin: 0,
                fontSize: 24,
                fontWeight: 600
              }}
            >
              {title}
            </Typography.Title>
            <Button
              type="link"
              size="small"
              onClick={onManage}
              style={{
                padding: 0,
                height: 'auto',
                fontSize: 14
              }}
            >
              {manageLabel}
            </Button>
          </div>
          <Typography.Text
            type="secondary"
            style={{
              fontSize: 14,
              display: 'block'
            }}
          >
            {subtitle}
          </Typography.Text>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: spacing[2],
            flexShrink: 0
          }}
        >
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
                    <Typography.Text
                      type="secondary"
                      style={{ fontSize: 12 }}
                    >
                      {refreshCountdown !== null
                        ? `Refreshing in ${refreshCountdown}s`
                        : 'Auto-refresh on'
                      }
                    </Typography.Text>
                  }
                  style={{
                    fontSize: 12,
                  }}
                />
              </Tooltip>
            )}
          </Space>
        </div>
      </div>

      {/* Action Buttons */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          gap: spacing[2]
        }}
      >
        <Space size="small">
          {/* View Logs Button */}
          <Button
            type="default"
            icon={<ArrowRightOutlined />}
            onClick={onViewLogs}
            style={{
              fontWeight: 500,
            }}
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
              icon={refreshing ? <LoadingOutlined spin /> : <ReloadOutlined />}
              onClick={onRefresh}
              loading={refreshing}
              disabled={refreshing}
              aria-label="Refresh dashboard data"
              style={{
                height: 32
              }}
            />
          </Tooltip>

          {/* Export Button */}
          <Dropdown
            menu={{ items: exportMenuItems }}
            trigger={['click']}
            placement="bottomRight"
          >
            <Button
              icon={isExporting ? <LoadingOutlined spin /> : <DownloadOutlined />}
              loading={isExporting}
              aria-label="Export dashboard data"
              style={{
                height: 32
              }}
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
  const { spacing } = useDesignTokens();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: spacing[4],
      }}
    >
      <Typography.Title
        level={4}
        style={{
          margin: 0,
          fontSize: 18,
          fontWeight: 600,
        }}
      >
        {title}
      </Typography.Title>

      {onRefresh && (
        <Tooltip title="Refresh dashboard" placement="top">
          <Button
            type="text"
            icon={refreshing ? <LoadingOutlined spin /> : <ReloadOutlined />}
            onClick={onRefresh}
            loading={refreshing}
            aria-label="Refresh dashboard"
          />
        </Tooltip>
      )}
    </div>
  );
};
