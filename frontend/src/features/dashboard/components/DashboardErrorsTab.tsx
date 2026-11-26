import { Card, List, Space } from '@/components/common/LegacyAntdControls';
import { Text } from '@astryxdesign/core/Text';
import { PieChart } from '../../../components/charts';
import { formatDateTime } from '../../../utils/format';
import { cssVar, spacingToNumber, useDesignTokens } from '../../../design-system/utils';
import {
  DashboardEmptyState,
  DashboardLoadingState,
  DashboardSectionTitle,
  DASHBOARD_PANEL_CLASS,
} from './DashboardPrimitives';
import { Button } from '../../../components/common/LegacyButton';

interface DashboardErrorsTabProps {
  errorsLoading: boolean;
  errorCategoryData: Array<{ name: string; value: number }>;
  topErrors: Array<{ message: string; count: number; lastSeen: string }>;
  noDataHint: string;
  onViewAllFailures: () => void;
  onErrorCategoryClick?: (data: any) => void;
  hiddenLegends: Set<string>;
  onLegendClick: (dataKey: string) => void;
}

export const DashboardErrorsTab = ({
  errorsLoading,
  errorCategoryData,
  topErrors,
  noDataHint,
  onViewAllFailures,
  onErrorCategoryClick,
  hiddenLegends,
  onLegendClick,
}: DashboardErrorsTabProps) => {
  const { themeColors, spacing, token } = useDesignTokens();

  return (
    <section className="dashboard-tab-grid">
      <Card
        className={DASHBOARD_PANEL_CLASS}
        variant="borderless"
        title={<DashboardSectionTitle title="Failure Categories" subtitle="Breakdown of error types" />}
        styles={{ body: { padding: spacing[4] } }}
      >
        {errorsLoading ? (
          <DashboardLoadingState title="Loading failure categories" />
        ) : errorCategoryData.length > 0 ? (
          <PieChart
            data={errorCategoryData}
            height={320}
            showLegend={true}
            innerRadius={70}
            outerRadius={110}
            label={true}
            paddingAngle={2}
            colors={[
              themeColors.error.text,
              themeColors.warning.text,
              themeColors.info.text,
              themeColors.primary.default,
              token.colorTextDisabled,
            ]}
            onSliceClick={onErrorCategoryClick}
            hiddenLegends={hiddenLegends}
            onLegendClick={onLegendClick}
          />
        ) : (
          <DashboardEmptyState message={noDataHint} />
        )}
      </Card>

      <Card
        className={DASHBOARD_PANEL_CLASS}
        variant="borderless"
        title={<DashboardSectionTitle title="Top Errors" subtitle="Most frequent delivery issues" />}
        extra={
          <Button type="text" size="small" onClick={onViewAllFailures}>
            View All Failures
          </Button>
        }
        styles={{ body: { padding: spacing[4], display: 'flex', flexDirection: 'column', gap: spacing[1] } }}
      >
        {errorsLoading ? (
          <DashboardLoadingState title="Loading recent failures" />
        ) : topErrors.length > 0 ? (
          <List
            dataSource={topErrors}
            renderItem={(error) => (
              <List.Item style={{ padding: `${spacing[3]} 0`, borderBlockEnd: `1px solid ${cssVar.border.default}` }}>
                <Space direction="vertical" size={spacingToNumber(spacing[1])} className="console-width-full">
                  <Space
                    style={{
                      width: '100%',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: spacing[3],
                    }}
                  >
                    <Text weight="semibold" className="ui-extracted-315b668bf0">
                      {error.message}
                    </Text>
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      {error.count} occurrences
                    </Text>
                  </Space>
                  <Text type="supporting" color="secondary">
                    Last seen {formatDateTime(error.lastSeen)}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <DashboardEmptyState message="No errors in the selected period" />
        )}
      </Card>
    </section>
  );
};
