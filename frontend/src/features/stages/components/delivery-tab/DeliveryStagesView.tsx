import { Space } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import type { StageConfig } from '../../../../services/stages-api';
import { StatusBadge } from '../../../../components/common/StatusBadge';
import { HOOK_GROUPS } from '../../stageLabels';
import { scheduleSummary } from './stageDraft';

const { Text } = Typography;

/** The Delivery tab when the integration is only being viewed. */
export const DeliveryStagesView = ({ stages = [] }: { stages?: StageConfig[] }) => (
  <Space direction="vertical" size={16} className="console-width-full">
    {stages.length === 0 && <Text type="secondary">This integration has no steps.</Text>}
    {HOOK_GROUPS.filter((group) => stages.some((stage) => stage.hook === group.hook)).map((group) => (
      <div key={group.hook}>
        <Text strong>{group.title}</Text>
        <Space direction="vertical" size={6} className="ui-extracted-bd82151654">
          {stages
            .filter((stage) => stage.hook === group.hook)
            .map((stage) => (
              <Space key={stage.id} wrap size={[6, 4]}>
                <Text>{stage.name}</Text>
                <Text type="supporting" color="secondary">
                  {stage.runner.type}
                </Text>
                <StatusBadge
                  label={stage.enabled === false ? 'Off' : 'On'}
                  variant={stage.enabled === false ? 'neutral' : 'success'}
                  showIcon={false}
                />
                {stage.shadow && <StatusBadge label="Being compared" variant="info" showIcon={false} />}
                {scheduleSummary(stage) && <Text type="secondary">{scheduleSummary(stage)}</Text>}
              </Space>
            ))}
        </Space>
      </div>
    ))}
  </Space>
);
