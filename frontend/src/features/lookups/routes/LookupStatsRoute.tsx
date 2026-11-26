import { Grid } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { useQuery } from '@tanstack/react-query';
import { useNavigateWithParams } from '../../../utils/navigation';
import { getLookupStats } from '../../../services/api';
import { formatDateTime } from '../../../utils/format';
import { useTenant } from '../../../app/tenant-context';
import { BarChart } from '../../../components/charts/BarChart';
import { ModernTable } from '../../../components/common/ModernTable';
import { PageTemplate } from '../../../components/common/PageTemplate';
import { MetaTag } from '../../../components/common/MetaTag';
import { StatePanel } from '../../../components/common/StatePanel';
import { Button } from '../../../components/common/LegacyButton';

export const LookupStatsRoute = () => {
  const screens = Grid.useBreakpoint();
  const { orgId } = useTenant();
  const navigate = useNavigateWithParams();
  const {
    data: stats,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['lookup-stats', orgId],
    queryFn: getLookupStats,
    enabled: orgId > 0,
    staleTime: 60_000,
  });

  const mostUsedTypesData = (stats?.mostUsedTypes || []).map((item) => ({
    name: item.type,
    value: item.count,
  }));
  const hasRecords = (stats?.totalMappings || 0) > 0;

  return (
    <PageTemplate
        as="main"
        className="lookup-stats-workspace"
        contentClassName="lookup-stats-template-content"
        title="Lookup statistics"
        description="Usage and recent activity for this organization’s mapping tables."
        breadcrumb={[{ label: 'Lookups', path: '/lookups' }, { label: 'Statistics' }]}
        compact
    >

      {isError ? (
        <StatePanel
          glyph="disrupted"
          tone="critical"
          title="Lookup statistics could not be loaded"
          description={error instanceof Error ? error.message : 'The request failed. Try again.'}
          actions={<Button onClick={() => refetch()}>Retry</Button>}
        />
      ) : (
        <>
          <div className="lookup-stat-summary" aria-label="Lookup summary">
            {[
              { label: 'Total mappings', value: stats?.totalMappings ?? 0 },
              { label: 'Active at parent', value: stats?.activeParent ?? 0 },
              { label: 'Active at entity', value: stats?.activeEntity ?? 0 },
              { label: 'Mapping types', value: stats?.typesCount ?? 0 },
            ].map((item) => (
              <div className="lookup-stat-item" key={item.label}>
                <span>{item.label}</span>
                <strong>{isLoading ? '—' : item.value.toLocaleString()}</strong>
              </div>
            ))}
          </div>

          {!isLoading && !hasRecords ? (
            <StatePanel
              glyph="searching"
              title="No lookup activity yet"
              description="Statistics will appear after mappings are created and used."
              actions={<Button onClick={() => navigate('/lookups')}>View lookup tables</Button>}
            />
          ) : (
            <>
              <div className="lookup-stats-overview">
                <section className="lookup-stats-section">
                  <div className="lookup-stats-section-heading">
                    <div>
                      <Text weight="semibold">Most used mapping types</Text>
                      <Text type="supporting" color="secondary">Volume by type</Text>
                    </div>
                  </div>
                  {mostUsedTypesData.length ? (
                    <BarChart
                      data={mostUsedTypesData}
                      xAxisKey="name"
                      bars={[{ dataKey: 'value', name: 'Mappings', color: 'var(--color-sidebar-accent)' }]}
                      height={screens.md ? 260 : 220}
                      showLegend={false}
                    />
                  ) : (
                    <StatePanel size="compact" title="No type usage to chart" />
                  )}
                </section>

                <section className="lookup-stats-section">
                  <div className="lookup-stats-section-heading">
                    <div>
                      <Text weight="semibold">Type breakdown</Text>
                      <Text type="supporting" color="secondary">Mappings by category</Text>
                    </div>
                    <Text type="supporting" color="secondary">{mostUsedTypesData.length} types</Text>
                  </div>
                  <ModernTable
                    dataSource={stats?.mostUsedTypes || []}
                    loading={isLoading}
                    pagination={false}
                    size="small"
                    rowKey="type"
                    columns={[
                      {
                        title: 'Type',
                        dataIndex: 'type',
                        key: 'type',
                        render: (type: string) => (
                          <MetaTag variant="event" size="small">
                            {type}
                          </MetaTag>
                        ),
                      },
                      {
                        title: 'Mappings',
                        dataIndex: 'count',
                        key: 'count',
                        align: 'right' as const,
                        render: (count: number) => count.toLocaleString(),
                      },
                      {
                        title: 'Last used',
                        dataIndex: 'lastUsedAt',
                        key: 'lastUsedAt',
                        render: (date: string | null) => (date ? formatDateTime(date) : 'Never'),
                      },
                    ]}
                    scroll={{ x: 500, y: 260 }}
                  />
                </section>
              </div>

              <section className="lookup-stats-section lookup-stats-recent">
                <div className="lookup-stats-section-heading">
                  <div>
                    <Text weight="semibold">Recently used mappings</Text>
                    <Text type="supporting" color="secondary">Most recent lookup activity</Text>
                  </div>
                </div>
                <ModernTable
                  dataSource={stats?.recentlyUsed || []}
                  loading={isLoading}
                  rowKey={(record: any) => `${record.type}:${record.sourceId}:${record.targetId}`}
                  pagination={{ pageSize: 10, showTotal: (total) => `${total} mappings` }}
                  size="small"
                  columns={[
                    {
                      title: 'Type',
                      dataIndex: 'type',
                      key: 'type',
                      width: 180,
                      render: (type: string) => (
                        <MetaTag variant="event" size="small">
                          {type}
                        </MetaTag>
                      ),
                    },
                    {
                      title: 'Source code',
                      dataIndex: 'sourceId',
                      key: 'sourceId',
                      width: 220,
                      render: (id: string) => <Text type="code">{id}</Text>,
                    },
                    {
                      title: 'Target code',
                      dataIndex: 'targetId',
                      key: 'targetId',
                      width: 220,
                      render: (id: string) => <Text type="code">{id}</Text>,
                    },
                    {
                      title: 'Usage count',
                      dataIndex: 'usageCount',
                      key: 'usageCount',
                      width: 130,
                      align: 'right' as const,
                      render: (count: number) => count.toLocaleString(),
                      sorter: (a: any, b: any) => a.usageCount - b.usageCount,
                    },
                    {
                      title: 'Last used',
                      dataIndex: 'lastUsedAt',
                      key: 'lastUsedAt',
                      width: 180,
                      render: (date: string) => formatDateTime(date),
                      sorter: (a: any, b: any) => new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
                    },
                  ]}
                  scroll={{ x: 900 }}
                />
              </section>
            </>
          )}
        </>
      )}
    </PageTemplate>
  );
};
