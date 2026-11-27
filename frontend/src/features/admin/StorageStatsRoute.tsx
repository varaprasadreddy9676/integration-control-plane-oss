import { useState } from 'react';
import { Card, Col, Progress, Row, Space, Statistic, Switch, Tooltip } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { Icon as GatewayIcon } from '../../components/common/Icon';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../app/auth-context';
import { PageHeader } from '../../components/common/PageHeader';
import { PageTemplate } from '../../components/common/PageTemplate';
import { RefreshCountdown, SecondsAgo } from '../../components/common/RefreshCountdown';
import { BarChart } from '../../components/charts/BarChart';
import { PieChart } from '../../components/charts/PieChart';
import { getAdminStorageStats, type CollectionStat } from '../../services/api';
import { ModernTable } from '../../components/common/ModernTable';
import { StatePanel } from '../../components/common/StatePanel';
import { InlineHint } from '../../components/common/InlineHint';
import { Button as AstryxButton } from '@astryxdesign/core/Button';
import { cssVar } from '../../design-system/utils';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

export const StorageStatsRoute = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'SUPER_ADMIN' || user?.role === 'ADMIN' || user?.role === 'ORG_ADMIN';
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [manualRefreshPending, setManualRefreshPending] = useState(false);

  const { data, isLoading, error, dataUpdatedAt, refetch } = useQuery({
    queryKey: ['adminStorageStats'],
    queryFn: getAdminStorageStats,
    staleTime: 20_000,
    refetchInterval: autoRefresh ? 30_000 : false,
    enabled: isAdmin,
  });

  const handleManualRefresh = async () => {
    setManualRefreshPending(true);
    try {
      await refetch();
    } finally {
      setManualRefreshPending(false);
    }
  };

  if (!isAdmin) {
    return (
      <PageTemplate title="Storage & Usage">
        <StatePanel
          title="Admin access required"
          description="Your account does not have access to storage and usage."
          size="compact"
        />
      </PageTemplate>
    );
  }

  const db = data?.db;
  const collections = data?.collections ?? [];
  const isOrgView = data?.isOrgView ?? false;

  if (error && !data) {
    return (
      <PageTemplate header={<PageHeader title="Storage & Usage" />}>
        <StatePanel
          title="Unable to load storage statistics"
          description="Check your connection and try again."
          footnote={(error as Error).message}
          tone="critical"
          size="compact"
          actions={
            <AstryxButton
              label="Retry"
              variant="secondary"
              icon={<GatewayIcon name="ReloadOutlined" />}
              onClick={handleManualRefresh}
              isLoading={manualRefreshPending}
            />
          }
        />
      </PageTemplate>
    );
  }

  const compressionRatio = db && db.storageSize > 0 ? (db.dataSize / db.storageSize).toFixed(1) : '—';

  // Bar chart: top 10 by storageSize (converted to MB)
  const barData = collections.slice(0, 10).map((c) => ({
    label: c.label,
    storageMB: +(c.storageSize / 1024 ** 2).toFixed(2),
  }));

  // Pie chart: top 7 + Other
  const pieTop7 = collections.slice(0, 7);
  const otherSum = collections.slice(7).reduce((s, c) => s + c.storageSize, 0);
  const pieData = [
    ...pieTop7.map((c) => ({ name: c.label, value: c.storageSize })),
    ...(otherSum > 0 ? [{ name: 'Other', value: otherSum }] : []),
  ];

  const columns = [
    {
      title: 'Collection',
      key: 'collection',
      render: (_: unknown, row: CollectionStat) => (
        <Space direction="vertical" size={0}>
          <Space size={4}>
            <Text weight="semibold">{row.label}</Text>
            {row.percentOfTotal > 50 && <Text color="secondary">Dominant</Text>}
          </Space>
          <Text color="secondary" className="console-type-caption">
            {row.name}
          </Text>
        </Space>
      ),
    },
    {
      title: 'Documents',
      dataIndex: 'count',
      key: 'count',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.count - b.count,
      render: (v: number) => v.toLocaleString(),
    },
    {
      title: <Tooltip title="Raw size before compression">Data Size</Tooltip>,
      dataIndex: 'dataSize',
      key: 'dataSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.dataSize - b.dataSize,
      render: (v: number, row: CollectionStat) =>
        row.count === 0 && row.storageSize === 0 ? <Text color="secondary">—</Text> : formatBytes(v),
    },
    {
      title: <Tooltip title="Actual disk usage">Stored on Disk</Tooltip>,
      dataIndex: 'storageSize',
      key: 'storageSize',
      align: 'right' as const,
      defaultSortOrder: 'descend' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.storageSize - b.storageSize,
      render: (v: number, row: CollectionStat) =>
        row.count === 0 && row.storageSize === 0 ? <Text color="secondary">empty</Text> : formatBytes(v),
    },
    {
      title: 'Index Size',
      dataIndex: 'indexSize',
      key: 'indexSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.indexSize - b.indexSize,
      render: (v: number) => (v === 0 ? <Text color="secondary">—</Text> : formatBytes(v)),
    },
    {
      title: '% of Total',
      dataIndex: 'percentOfTotal',
      key: 'percentOfTotal',
      sorter: (a: CollectionStat, b: CollectionStat) => a.percentOfTotal - b.percentOfTotal,
      render: (v: number, record: CollectionStat) =>
        v === 0 ? (
          <Text color="secondary">—</Text>
        ) : (
          <Progress
            aria-label={`${record.name} storage used`}
            percent={v}
            size="small"
            strokeColor={cssVar.border.default}
            trailColor={cssVar.border.subtle}
          />
        ),
      width: 160,
    },
    {
      title: 'Avg Doc',
      dataIndex: 'avgObjSize',
      key: 'avgObjSize',
      align: 'right' as const,
      sorter: (a: CollectionStat, b: CollectionStat) => a.avgObjSize - b.avgObjSize,
      render: (v: number) => (v === 0 ? <Text color="secondary">—</Text> : formatBytes(v)),
    },
  ];

  return (
    <PageTemplate
      header={
        <PageHeader
          title="Storage & Usage"
          description={dataUpdatedAt ? <SecondsAgo since={dataUpdatedAt} /> : undefined}
          actions={
            <Space wrap>
              <Space size={8}>
                {autoRefresh ? (
                  <RefreshCountdown intervalMs={30_000} lastRefreshAt={dataUpdatedAt} fontSize={13} />
                ) : (
                  <Text color="secondary" className="console-type-body">
                    Auto-refresh off
                  </Text>
                )}
                <Switch
                  aria-label="Enable automatic refresh"
                  size="small"
                  checked={autoRefresh}
                  onChange={setAutoRefresh}
                />
              </Space>
              <AstryxButton
                label={manualRefreshPending ? 'Refreshing…' : 'Refresh'}
                variant="secondary"
                icon={<GatewayIcon name="ReloadOutlined" />}
                onClick={handleManualRefresh}
                isLoading={manualRefreshPending}
              />
            </Space>
          }
        />
      }
    >
      <div className="storage-workspace">
        {isOrgView && (
          <Text type="supporting" color="secondary">
            Organization scope: document counts are specific to your organization; disk and index sizes are
            platform-wide.
          </Text>
        )}

        {error && data && (
          <InlineHint tone="warning">The latest refresh failed. Showing the most recently loaded values.</InlineHint>
        )}

        {/* Summary metrics */}
        <Row className="storage-metrics" gutter={[16, 12]}>
          <Col xs={12} md={6}>
            <Tooltip title="Actual disk space used (after MongoDB compression)">
              <Statistic title="Total storage" value={db ? formatBytes(db.storageSize) : '—'} loading={isLoading} />
            </Tooltip>
          </Col>
          <Col xs={12} md={6}>
            <Tooltip
              title={
                isOrgView ? 'Total records belonging to your organization' : 'Total records across all collections'
              }
            >
              <Statistic
                title={isOrgView ? 'Your documents' : 'Documents stored'}
                value={db ? db.objects.toLocaleString() : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Col>
          <Col xs={12} md={6}>
            <Tooltip title="Space used by query indexes">
              <Statistic title="Index size" value={db ? formatBytes(db.indexSize) : '—'} loading={isLoading} />
            </Tooltip>
          </Col>
          <Col xs={12} md={6}>
            <Tooltip title="Ratio of logical data size to on-disk storage">
              <Statistic
                title="Compression ratio"
                value={db && db.storageSize > 0 ? `${compressionRatio}×` : '—'}
                loading={isLoading}
              />
            </Tooltip>
          </Col>
        </Row>

        {/* Charts */}
        <Row className="storage-charts" gutter={[16, 16]}>
          <Col xs={24} md={14}>
            <Card className="storage-chart-panel" title="Top collections by disk usage" loading={isLoading}>
              {barData.length > 0 ? (
                <BarChart
                  data={barData}
                  bars={[{ dataKey: 'storageMB', name: 'Storage (MB)' }]}
                  xAxisKey="label"
                  layout="vertical"
                  height={320}
                  showLegend={false}
                  yAxisWidth={130}
                  tooltipFormatter={(value: number) => [`${value} MB`, 'Storage']}
                />
              ) : (
                !isLoading && <StatePanel size="compact" glyph="searching" title="No collection data" />
              )}
            </Card>
          </Col>
          <Col xs={24} md={10}>
            <Card className="storage-chart-panel" title="Storage distribution" loading={isLoading}>
              {pieData.length > 0 ? (
                <PieChart data={pieData} innerRadius={60} height={320} />
              ) : (
                !isLoading && <StatePanel size="compact" glyph="searching" title="No storage data" />
              )}
            </Card>
          </Col>
        </Row>

        {/* Collections Table */}
        <Card className="storage-collections-panel" title="Collections" loading={isLoading}>
          <ModernTable
            dataSource={collections}
            columns={columns}
            rowKey="name"
            size="small"
            pagination={{ pageSize: 20, showSizeChanger: false }}
          />
        </Card>
      </div>
    </PageTemplate>
  );
};
