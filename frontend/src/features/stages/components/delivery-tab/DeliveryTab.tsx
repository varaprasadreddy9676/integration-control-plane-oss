import { useState } from 'react';
import { Form, Segmented, Space, Switch, Typography } from 'antd';
import type { StageConfig } from '../../../../services/stages-api';
import type { DeliveryTarget } from '../../deliveryTargets';
import { protocolLabel } from '../../deliveryTargets';
import { DeliveryStagesSection } from './DeliveryStagesSection';
import { DeliveryStagesView } from './DeliveryStagesView';
import { WorkflowCanvas } from '../../canvas/WorkflowCanvas';
import type { StepEditors } from '../../canvas/stepEditors';

const { Text } = Typography;

interface DeliveryTabProps {
  form: any;
  integrationId?: string;
  /** The integration's deliveries: itself, or one per action (deliveryTargets.ts). */
  targets: DeliveryTarget[];
  /** The integration as the server should validate stages against. */
  context: () => Record<string, unknown>;
  readOnly?: boolean;
  /** Open another tab of the integration page (the canvas links its fixed steps to theirs). */
  onOpenTab?: (tab: string) => void;
  /** What the diagram edits in place for the steps that are not stages (the page's own sections). */
  stepEditors?: StepEditors;
}

type View = 'workflow' | 'list';
const VIEW_KEY = 'stages-delivery-view';
const savedView = (): View => {
  try {
    // The list (each step by name, in order) is the plain way in; the diagram is opt-in.
    return window.localStorage.getItem(VIEW_KEY) === 'workflow' ? 'workflow' : 'list';
  } catch {
    return 'list';
  }
};

/**
 * The Delivery tab of any integration: one switch for all its stages, and the
 * stages of each of its deliveries. An integration with actions picks the
 * action; every kind of delivery is edited the same way.
 */
export const DeliveryTab = ({ form, integrationId, targets, context, readOnly = false, onOpenTab, stepEditors }: DeliveryTabProps) => {
  const [picked, setPicked] = useState(0);
  const [view, setView] = useState<View>(savedView);
  const [fullscreen, setFullscreen] = useState(false);
  const chooseView = (next: View) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      // The choice just is not remembered.
    }
  };
  const index = Math.min(picked, targets.length - 1);
  const target = targets[index];
  if (!target) return null;
  const stages = (form.getFieldValue([...target.namePath, 'stages']) || []) as StageConfig[];

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <Segmented
          aria-label="How to show the delivery"
          value={view}
          onChange={(next) => chooseView(next as View)}
          options={[
            { value: 'list', label: 'List' },
            { value: 'workflow', label: 'Diagram' },
          ]}
        />
        {view === 'workflow' && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Drawn from the engine&apos;s rules: every branch can happen, and every branch that can happen is shown.
          </Text>
        )}
      </div>
      {!readOnly && (
        <Space align="center">
          <Form.Item name="stagesPaused" noStyle getValueProps={(paused) => ({ checked: !paused })} normalize={(checked) => !checked}>
            <Switch aria-label="Run this integration's stages" />
          </Form.Item>
          <Text>Run this integration&apos;s stages</Text>
        </Space>
      )}
      {view === 'workflow' ? (
        <div style={{ width: '100%', height: fullscreen ? undefined : 'max(640px, calc(100vh - 260px))' }}>
          <WorkflowCanvas
            form={form}
            integrationId={integrationId}
            targets={targets}
            context={context}
            readOnly={readOnly}
            fullscreen={fullscreen}
            onToggleFullscreen={() => setFullscreen(!fullscreen)}
            onOpenTab={onOpenTab}
            stepEditors={stepEditors}
          />
        </div>
      ) : (
        <>
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
        </>
      )}
    </Space>
  );
};
