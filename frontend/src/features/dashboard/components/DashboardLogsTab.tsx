import { Card, List, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { formatDateTime } from '../../../utils/format';
import { cssVar, spacingToNumber, useDesignTokens } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardSectionTitle,
  DASHBOARD_PANEL_CLASS,
} from './DashboardPrimitives';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge } from '../../../components/common/StatusBadge';

interface DashboardLogsTabProps {
  logsLoading: boolean;
  logs: Array<any>;
  noDataHint: string;
  onViewAll: () => void;
}

export const DashboardLogsTab = ({ logsLoading, logs, noDataHint, onViewAll }: DashboardLogsTabProps) => {
  const { spacing, token } = useDesignTokens();

  return (
    <section className={`${DASHBOARD_PANEL_CLASS} console-margin-top-4`}>
      <Card
        variant="borderless"
        title={<DashboardSectionTitle title="Recent Failures" subtitle="Most recent failed deliveries" />}
        extra={
          <Button type="text" size="small" onClick={onViewAll}>
            View Logs
          </Button>
        }
        styles={{ body: { padding: spacing[4] } }}
      >
        {logsLoading ? (
          <DashboardLoadingState title="Loading recent failures" />
        ) : logs.length > 0 ? (
          <List
            dataSource={logs}
            pagination={{
              pageSize: 10,
              showSizeChanger: true,
              pageSizeOptions: ['10', '25', '50'],
              showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} logs`,
              size: 'small',
            }}
            renderItem={(log: any) => (
              <List.Item style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                <Space direction="vertical" size={spacingToNumber(spacing[1])} className="console-width-full">
                  <Space
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: spacing[2],
                    }}
                  >
                    <div className="console-min-width-0">
                      <Text weight="semibold">
                        {log.__KEEP_integrationName__ ||
                          log.integrationName ||
                          log.__KEEP___KEEP_integrationConfig__Id__ ||
                          'Unknown integration'}
                      </Text>
                      <Text type="supporting" color="secondary" display="block">
                        {log.errorMessage || 'Failed delivery'}
                      </Text>
                    </div>
                    <StatusBadge status="FAILED" size="small" />
                  </Space>
                  <Text type="supporting" color="secondary">
                    {formatDateTime(log.createdAt)}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <DashboardEmptyState message={noDataHint} />
        )}
      </Card>
    </section>
  );
};
