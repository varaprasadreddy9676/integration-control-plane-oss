import { useState } from 'react';
import { Alert, Button, Dropdown, Form, Popconfirm, Space, Switch, Tag, Typography } from 'antd';
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, PlayCircleOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import type { SendBindings, StageConfig, StageHook } from '../../../../services/stages-api';
import { stageFromTemplate } from '../../../../services/stages-api';
import { HOOK_GROUPS } from '../../stageLabels';
import { KeyValueEditor } from './SchemaForm';
import { StageEditorDrawer } from './StageEditorDrawer';
import { canMoveStage, draftFromRunner, moveStage, newStageId, outputsOf, removeStageAt, scheduleSummary, setStageEnabled } from './stageDraft';
import { stageMenu, useStageLibrary } from './stageLibrary';
import type { DeliveryTarget, RequestPart } from '../../deliveryTargets';
import { requestParts } from '../../deliveryTargets';

const { Text } = Typography;

const rowStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
  border: '1px solid var(--border-subtle, #e5e7eb)',
  borderRadius: 8,
};

// What the Send step can set, by part of the delivery's request.
const SEND_PARTS: Record<RequestPart, { title: string; label: string; hint?: string }> = {
  fields: { title: 'Message fields', label: 'Send message field', hint: 'A field of the outgoing message by its path, such as to or recipient.phone.' },
  headers: { title: 'Extra headers', label: 'Send header' },
  query: { title: 'Extra query parameters', label: 'Send query parameter' },
};

/** The Send step's bindings: values from stages that run before sending, into the parts of the request this delivery has. */
const SendBindingsEditor = ({
  value,
  onChange,
  available,
  parts,
}: {
  value?: SendBindings | null;
  onChange?: (value: SendBindings | null) => void;
  available: string[];
  parts: RequestPart[];
}) => {
  const bindings = value?.bindings || {};
  const write = (part: RequestPart, next?: Record<string, string>) => {
    const merged = Object.fromEntries(Object.entries({ ...bindings, [part]: next }).filter(([, entries]) => entries));
    onChange?.(Object.keys(merged).length ? { bindings: merged } : null);
  };
  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      {parts.map((part) => (
        <div key={part}>
          <Text strong>{SEND_PARTS[part].title}</Text>
          {SEND_PARTS[part].hint && <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{SEND_PARTS[part].hint}</Text>}
          <KeyValueEditor label={SEND_PARTS[part].label} value={bindings[part]} onChange={(next) => write(part, next)} />
        </div>
      ))}
      <Text type="secondary" style={{ fontSize: 12 }}>
        {available.length ? (
          <>Available: {available.map((item) => <code key={item} style={{ marginRight: 8 }}>{item}</code>)}</>
        ) : (
          'Add a step before send with outputs to pass its values on (a token, for example).'
        )}
      </Text>
    </Space>
  );
};

interface DeliveryStagesSectionProps {
  /** The integration form (for the Send step and the migration state). */
  form: any;
  integrationId?: string;
  /** The delivery these stages belong to: the integration itself, or one action. */
  target: DeliveryTarget;
  /** The integration as the server should validate these stages against. */
  context: () => Record<string, unknown>;
  value?: StageConfig[];
  onChange?: (value: StageConfig[]) => void;
}

/**
 * The stages around one delivery, grouped by where they run, each named by the
 * user. Changes are kept in the form and saved with the integration.
 */
export const DeliveryStagesSection = ({ form, integrationId, target, context, value, onChange }: DeliveryStagesSectionProps) => {
  const stages = value || [];
  const [editing, setEditing] = useState<{ stage: StageConfig; index: number; tab: 'settings' | 'test' } | null>(null);
  const { runners, templates, runtime } = useStageLibrary(integrationId);
  const send = Form.useWatch([...target.namePath, 'send'], { form, preserve: true }) as SendBindings | null | undefined;
  const migration = form.getFieldValue('stageMigration');

  const write = (next: StageConfig[]) => onChange?.(next);
  const taken = stages.map((stage) => stage.id);

  const addFromRunner = (hook: StageHook, type: string) => {
    const runner = runners.data?.find((candidate) => candidate.type === type);
    if (!runner) return;
    setEditing({ stage: draftFromRunner(runner, hook, stages), index: stages.length, tab: 'settings' });
  };
  const addFromTemplate = async (templateId: string) => {
    const stage = await stageFromTemplate(templateId);
    setEditing({ stage: { ...stage, id: newStageId(stage.name, taken) }, index: stages.length, tab: 'settings' });
  };

  const move = (index: number, direction: -1 | 1) => write(moveStage(stages, index, direction));

  const beforeSendOutputs = stages
    .filter((stage) => stage.hook === 'before_send')
    .flatMap((stage) => outputsOf(stage, runners.data?.find((candidate) => candidate.type === stage.runner.type)).map((output) => `{{ stages.${stage.id}.output.${output.name} }}`));

  const groupRows = (hook: StageHook) =>
    stages
      .map((stage, index) => ({ stage, index }))
      .filter(({ stage }) => stage.hook === hook)
      .map(({ stage, index }) => (
        <div key={stage.id} style={rowStyle}>
          <Space direction="vertical" size={2} style={{ minWidth: 0 }}>
            <Space wrap size={[6, 4]}>
              <Text strong>{stage.name}</Text>
              <Tag style={{ margin: 0 }}>{runners.data?.find((r) => r.type === stage.runner.type)?.label || stage.runner.type}</Tag>
              {stage.hook === 'before_send' || stage.hook === 'after_response' ? (
                <Tag color={stage.effect === 'observe' ? 'default' : 'blue'} style={{ margin: 0 }}>
                  {stage.effect === 'observe' ? 'Records' : 'Decides'}
                </Tag>
              ) : null}
              {stage.template && <Tag style={{ margin: 0 }}>From a template</Tag>}
              {stage.migratedFrom && <Tag style={{ margin: 0 }}>Moved from the old {stage.migratedFrom}</Tag>}
              {stage.shadow && <Tag color="purple" style={{ margin: 0 }}>Being compared</Tag>}
            </Space>
            {scheduleSummary(stage) && <Text type="secondary" style={{ fontSize: 12 }}>{scheduleSummary(stage)}</Text>}
          </Space>
          <Space size={4}>
            <Switch
              size="small"
              checked={stage.enabled !== false}
              aria-label={`Run ${stage.name}`}
              onChange={(enabled) => write(setStageEnabled(stages, index, enabled))}
            />
            <Button type="text" icon={<ArrowUpOutlined />} aria-label={`Move ${stage.name} up`} disabled={!canMoveStage(stages, index, -1)} onClick={() => move(index, -1)} />
            <Button type="text" icon={<ArrowDownOutlined />} aria-label={`Move ${stage.name} down`} disabled={!canMoveStage(stages, index, 1)} onClick={() => move(index, 1)} />
            <Button type="text" icon={<PlayCircleOutlined />} aria-label={`Test ${stage.name}`} onClick={() => setEditing({ stage, index, tab: 'test' })} />
            <Button type="text" icon={<EditOutlined />} aria-label={`Edit ${stage.name}`} onClick={() => setEditing({ stage, index, tab: 'settings' })} />
            <Popconfirm
              title={`Remove ${stage.name}?`}
              description="Its scheduled checks are cancelled when the integration is saved. Its history stays."
              okText="Remove"
              okButtonProps={{ danger: true }}
              onConfirm={() => write(removeStageAt(stages, index))}
            >
              <Button type="text" danger icon={<DeleteOutlined />} aria-label={`Remove ${stage.name}`} />
            </Popconfirm>
          </Space>
        </div>
      ));

  const addMenu = (hook: StageHook) =>
    stageMenu(hook, { runners: runners.data, templates: templates.data }, { onRunner: (type) => addFromRunner(hook, type), onTemplate: (id) => void addFromTemplate(id) });

  return (
    <Space direction="vertical" size={20} style={{ width: '100%' }}>
      {runtime.data && !runtime.data.ready && stages.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="Steps do not run on this server yet"
          description={runtime.data.problems.join('. ')}
        />
      )}
      {runtime.data && runtime.data.ready && !runtime.data.isolated && (
        <Alert type="info" showIcon message="Scripts run without the operating system's isolation here (development only)." />
      )}
      {migration && migration.state && migration.state !== 'ROLLED_BACK' && (
        <Alert
          type="info"
          showIcon
          message={migration.state === 'SWITCHED' ? 'Moved from the old configuration' : 'Comparing with the old configuration'}
          description={
            migration.state === 'SWITCHED'
              ? 'These steps now do what the old settings did, under the same rules.'
              : 'The steps marked "Being compared" run beside the old settings without effect, until the comparison is conclusive.'
          }
        />
      )}

      {HOOK_GROUPS.map((group) => (
        <div key={group.hook}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
            <div>
              <Text strong style={{ fontSize: 15 }}>{group.title}</Text>
              <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
                {group.description}
              </Text>
            </div>
            <Dropdown menu={addMenu(group.hook)} trigger={['click']} disabled={!runners.data}>
              <Button icon={<PlusOutlined />} aria-label={`Add a step: ${group.title}`}>
                Add a step
              </Button>
            </Dropdown>
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {groupRows(group.hook)}
            {!stages.some((stage) => stage.hook === group.hook) && <Text type="secondary">No steps here.</Text>}
          </Space>

          {group.hook === 'before_send' && (
            <div style={{ ...rowStyle, display: 'block', marginTop: 16, background: 'var(--bg-subtle, #fafafa)' }}>
              <Space style={{ marginBottom: 8 }}>
                <SendOutlined />
                <Text strong>Send</Text>
                <Text type="secondary">The delivery itself: target, authentication and retries are on their own tabs.</Text>
              </Space>
              <Form.Item name={[...target.namePath, 'send']} noStyle>
                <SendBindingsEditor available={beforeSendOutputs} parts={requestParts(target.protocol)} />
              </Form.Item>
            </div>
          )}
        </div>
      ))}


      {runners.data && (
        <StageEditorDrawer
          open={Boolean(editing)}
          stage={editing?.stage || null}
          index={editing?.index ?? 0}
          initialTab={editing?.tab}
          stages={stages}
          send={send}
          runners={runners.data}
          integrationId={integrationId}
          integration={context()}
          protocol={target.protocol}
          actionIndex={target.actionIndex}
          onClose={() => setEditing(null)}
          onApply={(stage) => {
            const next = [...stages];
            if (editing && editing.index < next.length) next[editing.index] = stage;
            else next.push(stage);
            write(next);
            setEditing(null);
          }}
        />
      )}
    </Space>
  );
};
