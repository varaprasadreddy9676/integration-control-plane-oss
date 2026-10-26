import { Space, Tag, Typography } from 'antd';
import type { StageConfig } from '../../../../services/stages-api';
import { HOOK_GROUPS } from '../../stageLabels';
import { scheduleSummary } from './stageDraft';

const { Text } = Typography;

/** The Delivery tab when the integration is only being viewed. */
export const DeliveryStagesView = ({ stages = [] }: { stages?: StageConfig[] }) => (
  <Space direction="vertical" size={16} style={{ width: '100%' }}>
    {stages.length === 0 && <Text type="secondary">This integration has no steps.</Text>}
    {HOOK_GROUPS.filter((group) => stages.some((stage) => stage.hook === group.hook)).map((group) => (
      <div key={group.hook}>
        <Text strong>{group.title}</Text>
        <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 6 }}>
          {stages
            .filter((stage) => stage.hook === group.hook)
            .map((stage) => (
              <Space key={stage.id} wrap size={[6, 4]}>
                <Text>{stage.name}</Text>
                <Tag style={{ margin: 0 }}>{stage.runner.type}</Tag>
                <Tag color={stage.enabled === false ? 'default' : 'green'} style={{ margin: 0 }}>
                  {stage.enabled === false ? 'Off' : 'On'}
                </Tag>
                {stage.shadow && <Tag color="purple" style={{ margin: 0 }}>Being compared</Tag>}
                {scheduleSummary(stage) && <Text type="secondary">{scheduleSummary(stage)}</Text>}
              </Space>
            ))}
        </Space>
      </div>
    ))}
  </Space>
);
