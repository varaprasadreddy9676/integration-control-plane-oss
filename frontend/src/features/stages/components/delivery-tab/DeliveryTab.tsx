import { useState } from 'react';
import { Form, Segmented, Space, Switch, Typography } from 'antd';
import type { StageConfig } from '../../../../services/stages-api';
import type { DeliveryTarget } from '../../deliveryTargets';
import { protocolLabel } from '../../deliveryTargets';
import { DeliveryStagesSection } from './DeliveryStagesSection';
import { DeliveryStagesView } from './DeliveryStagesView';

const { Text } = Typography;

interface DeliveryTabProps {
  form: any;
  integrationId?: string;
  /** The integration's deliveries: itself, or one per action (deliveryTargets.ts). */
  targets: DeliveryTarget[];
  /** The integration as the server should validate stages against. */
  context: () => Record<string, unknown>;
  readOnly?: boolean;
}

/**
 * The Delivery tab of any integration: one switch for all its stages, and the
 * stages of each of its deliveries. An integration with actions picks the
 * action; every kind of delivery is edited the same way.
 */
export const DeliveryTab = ({ form, integrationId, targets, context, readOnly = false }: DeliveryTabProps) => {
  const [picked, setPicked] = useState(0);
  const index = Math.min(picked, targets.length - 1);
  const target = targets[index];
  if (!target) return null;
  const stages = (form.getFieldValue([...target.namePath, 'stages']) || []) as StageConfig[];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {!readOnly && (
        <Space align="center">
          <Form.Item name="stagesPaused" noStyle getValueProps={(paused) => ({ checked: !paused })} normalize={(checked) => !checked}>
            <Switch aria-label="Run this integration's stages" />
          </Form.Item>
          <Text>Run this integration&apos;s stages</Text>
        </Space>
      )}
      {targets.length > 1 && (
        <div>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
            Each action is its own delivery, with its own stages.
          </Text>
          <Segmented
            aria-label="Action"
            value={index}
            onChange={(next) => setPicked(Number(next))}
            options={targets.map((candidate, position) => ({ value: position, label: `${candidate.label} · ${protocolLabel(candidate.protocol)}` }))}
          />
        </div>
      )}
      {readOnly ? (
        <DeliveryStagesView key={target.key} stages={stages} integrationId={integrationId} />
      ) : (
        <Form.Item key={target.key} name={[...target.namePath, 'stages']} noStyle>
          <DeliveryStagesSection form={form} integrationId={integrationId} target={target} context={context} />
        </Form.Item>
      )}
    </Space>
  );
};
