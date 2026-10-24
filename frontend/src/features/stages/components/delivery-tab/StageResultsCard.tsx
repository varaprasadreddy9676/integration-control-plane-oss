import { Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import type { StageConfig } from '../../../../services/stages-api';
import { getStageResults, getStageUsage } from '../../../../services/stages-api';
import { OUTCOME_TAG, stageStatusColor, stageStatusLabel } from '../../stageLabels';

const { Text } = Typography;

const WEEK_MS = 7 * 24 * 3600 * 1000;

/**
 * The last seven days of this integration's stages: how deliveries ended per
 * stage (each delivery counted once, by its latest status) and how the stage
 * ran (runs, errors, retries, time). Two different questions, kept apart.
 */
export const StageResultsCard = ({ integrationId, stages }: { integrationId: string; stages: StageConfig[] }) => {
  const from = new Date(Date.now() - WEEK_MS).toISOString().slice(0, 10);
  const results = useQuery({ queryKey: ['stage-results', integrationId, from], queryFn: () => getStageResults({ integrationId, from }) });
  const usage = useQuery({ queryKey: ['stage-usage'], queryFn: getStageUsage });
  if (!results.data || stages.length === 0) return null;

  const rows = stages.map((stage) => ({
    key: stage.id,
    name: stage.name,
    outcomes: results.data.outcomes.filter((row) => row.stageId === stage.id),
    execution: results.data.executions.find((row) => row.stageId === stage.id),
  }));

  return (
    <div>
      <Text strong style={{ fontSize: 15 }}>Last 7 days</Text>
      <Table
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText: 'No stage has run yet.' }}
        columns={[
          { title: 'Stage', dataIndex: 'name' },
          {
            title: 'Deliveries by latest status',
            dataIndex: 'outcomes',
            render: (outcomes: typeof rows[number]['outcomes']) =>
              outcomes.length ? (
                <Space wrap size={[4, 4]}>
                  {outcomes.map((row) => (
                    <Tag
                      key={`${row.status}-${row.outcome}`}
                      color={row.status ? stageStatusColor(row.status) : (OUTCOME_TAG[row.outcome] ?? OUTCOME_TAG.error).color}
                      style={{ margin: 0 }}
                    >
                      {row.status ? stageStatusLabel(row.status) : (OUTCOME_TAG[row.outcome] ?? OUTCOME_TAG.error).label} · {row.deliveries}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary">None</Text>
              ),
          },
          { title: 'Runs', dataIndex: 'execution', render: (row?: { runs: number }) => row?.runs ?? 0 },
          { title: 'Errors', dataIndex: 'execution', render: (row?: { errors: number; timeouts: number }) => (row ? row.errors + row.timeouts : 0) },
          { title: 'Retries', dataIndex: 'execution', render: (row?: { retries: number }) => row?.retries ?? 0 },
          { title: 'Average', dataIndex: 'execution', render: (row?: { averageMs: number | null }) => (row?.averageMs != null ? `${row.averageMs} ms` : '—') },
        ]}
      />
      {usage.data && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          Stage calls today for this organization: {usage.data.used.toLocaleString()} of {usage.data.quota.toLocaleString()}.
        </Text>
      )}
    </div>
  );
};
