import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Alert, Button, Checkbox, Collapse, Drawer, Input, InputNumber, Radio, Select, Space, Tabs, Typography } from 'antd';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { SchemaField, SendBindings, StageConfig, StageRunner, StageValidationError } from '../../../../services/stages-api';
import { listCredentialOptions, validateStages } from '../../../../services/stages-api';
import { CheckScheduleEditor } from '../../../integrations/components/detail/DeliveryFollowUpSection';
import { hookTitle } from '../../stageLabels';
import { KeyValueEditor, SchemaForm, Widget } from './SchemaForm';
import { StageTestPanel } from './StageTestPanel';
import { errorsForStage, isInline, outputsOf } from './stageDraft';

const { Text } = Typography;

const OUTPUT_COLUMNS: SchemaField[] = [
  { name: 'name', label: 'Name', widget: 'text' },
  { name: 'type', label: 'Type', widget: 'select', options: ['string', 'number', 'boolean', 'object'], default: 'string' },
  { name: 'sensitive', label: 'Sensitive', widget: 'checkbox' },
];

const ERROR_ACTIONS = {
  gate: [
    { value: 'fail_stage', label: 'Fail closed: stop the delivery' },
    { value: 'ignore', label: 'Fail open: carry on as if it passed' },
    { value: 'retry_stage', label: 'Try again at once, then fail closed' },
  ],
  observeInline: [{ value: 'ignore', label: 'Record the error and carry on' }],
  deferred: [
    { value: 'retry_stage', label: 'Try again later, then give up (dead letter)' },
    { value: 'ignore', label: 'Move on to the next check' },
    { value: 'fail_stage', label: 'Stop' },
  ],
};

const Field = ({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: React.ReactNode }) => (
  <div>
    <Text strong style={{ display: 'block', marginBottom: 4 }}>
      {label}
    </Text>
    {children}
    {hint && !error && <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>{hint}</Text>}
    {error && (
      <Text type="danger" role="alert" style={{ display: 'block', fontSize: 12 }}>
        {error}
      </Text>
    )}
  </div>
);

interface StageEditorDrawerProps {
  open: boolean;
  stage: StageConfig | null;
  /** Where the stage is (or will be) in the integration's list. */
  index: number;
  stages: StageConfig[];
  send?: SendBindings | null;
  runners: StageRunner[];
  integrationId?: string;
  integration: Record<string, unknown>;
  /** The delivery the stage belongs to: its kind, and which one for the server (null: the integration itself). */
  protocol?: string;
  actionIndex?: number | null;
  initialTab?: 'settings' | 'test';
  onApply: (stage: StageConfig) => void;
  onClose: () => void;
}

export interface StageEditorApi {
  draft: StageConfig;
  settings: ReactNode;
  test: ReactNode;
  tab: 'settings' | 'test';
  setTab: (tab: 'settings' | 'test') => void;
  /** Check the stage with the server, then hand it to onApply. */
  apply: () => Promise<void>;
  applying: boolean;
  /** Does the editor hold changes that were not applied yet? */
  changed: boolean;
}

/**
 * The stage editor's state and content, so the same editor serves the drawer and the
 * canvas's inspector: the Settings form, the Test panel, and Apply (which checks the
 * stage with the server before it reaches the integration form).
 */
export const StageEditor = ({
  children,
  open,
  stage,
  index,
  stages,
  send,
  runners,
  integrationId,
  integration,
  protocol = 'http',
  actionIndex = null,
  initialTab = 'settings',
  onApply,
}: Omit<StageEditorDrawerProps, 'onClose'> & { children: (editor: StageEditorApi) => ReactNode }) => {
  const [draft, setDraft] = useState<StageConfig | null>(stage);
  const [tab, setTab] = useState(initialTab);
  const [errors, setErrors] = useState<StageValidationError[]>([]);
  useEffect(() => {
    setDraft(stage);
    setTab(initialTab);
    setErrors([]);
  }, [stage, initialTab]);

  const credentials = useQuery({ queryKey: ['stage-credentials'], queryFn: listCredentialOptions, enabled: open, retry: false });
  const validate = useMutation({ mutationFn: validateStages });

  const runner = runners.find((candidate) => candidate.type === draft?.runner.type);
  const { runnerFields, other } = useMemo(() => errorsForStage(errors, index), [errors, index]);
  const errorAt = (path: string) => other.find((error) => error.path === path || error.path.startsWith(`${path}.`) || error.path.startsWith(`${path}[`))?.message;
  // Outputs of stages that run before this one, for {{ }} inputs.
  const earlier = stages.slice(0, index).filter((candidate) => candidate.id !== draft?.id);

  if (!draft) return null;
  const update = (patch: Partial<StageConfig>) => setDraft({ ...draft, ...patch });
  const inline = isInline(draft.hook);
  const effect = draft.effect || (inline ? 'gate' : 'observe');
  const errorOptions = inline ? (effect === 'gate' ? ERROR_ACTIONS.gate : ERROR_ACTIONS.observeInline) : ERROR_ACTIONS.deferred;
  const onError = draft.onError || { action: errorOptions[0].value as 'ignore' };
  const authMode = draft.auth ? (draft.auth.source === 'integration' ? 'integration' : 'credential') : 'none';
  const legacy = typeof draft.contract === 'string' && draft.contract.startsWith('legacy:');

  const apply = async () => {
    const next = [...stages];
    if (index < next.length) next[index] = draft;
    else next.push(draft);
    try {
      const result = await validate.mutateAsync({ integrationId, integration, actionIndex, stages: next, send });
      const mine = result.errors.filter((error) => error.path.startsWith(`stages[${index}]`));
      setErrors(result.errors);
      if (mine.length === 0) onApply(draft);
      else setTab('settings');
    } catch (error) {
      setErrors([{ path: `stages[${index}].name`, message: (error as Error).message }]);
    }
  };

  const settings = (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      {legacy && (
        <Alert
          type="info"
          showIcon
          message={`Moved here from the old ${draft.migratedFrom || 'configuration'}`}
          description="It runs under the rules it always had, so it behaves exactly as before."
        />
      )}
      {draft.shadow && (
        <Alert type="warning" showIcon message="Being compared" description="A migration runs this stage beside the old configuration to compare them. It has no effect yet." />
      )}
      <Field label="Name *" error={errorAt('name')} hint="Shown on the delivery's tab and in results. Renaming keeps the history.">
        <Input aria-label="Stage name" value={draft.name} maxLength={80} onChange={(e) => update({ name: e.target.value })} />
      </Field>
      <Text type="secondary">
        {runner?.label || draft.runner.type} · {hookTitle(draft.hook)} · ID <code>{draft.id}</code>
      </Text>

      {inline && (
        <Field label="What it may do" error={errorAt('effect')}>
          <Radio.Group value={effect} onChange={(e) => update({ effect: e.target.value })}>
            <Space direction="vertical">
              <Radio value="gate">{draft.hook === 'before_send' ? 'Decide: it can skip or fail the delivery' : 'Decide: it can turn an accepted send into a failure'}</Radio>
              <Radio value="observe">Only record what it finds</Radio>
            </Space>
          </Radio.Group>
        </Field>
      )}

      {runner ? (
        <SchemaForm
          fields={runner.configSchema.fields}
          value={draft.runner.config}
          errors={runnerFields}
          onChange={(config) => update({ runner: { ...draft.runner, config } })}
        />
      ) : (
        <Alert type="warning" showIcon message={`The ${draft.runner.type} runner is not offered for new stages; its settings are kept as they are.`} />
      )}

      {draft.runner.type === 'script' && (
        <Field label="Outputs" error={errorAt('outputs')} hint="What later stages and the Send step may use: return { data: { name: value } }.">
          <Widget field={{ name: 'outputs', label: 'Output', widget: 'rows', columns: OUTPUT_COLUMNS }} label="Output" value={draft.outputs} onChange={(outputs) => update({ outputs })} />
        </Field>
      )}

      {draft.hook === 'after_delivery' && (
        <Field label="When it runs" error={errorAt('schedule')}>
          <Radio.Group
            value={draft.schedule?.everySeconds ? 'repeat' : 'times'}
            onChange={(e) =>
              update({ schedule: e.target.value === 'repeat' ? { everySeconds: 600, maxAgeSeconds: 86400 } : { checkAfterSeconds: [30, 300, 3600, 86400] } })
            }
          >
            <Radio value="times">At set times after the send</Radio>
            <Radio value="repeat">Repeat until done</Radio>
          </Radio.Group>
          <div style={{ marginTop: 8 }}>
            {draft.schedule?.everySeconds ? (
              <Space wrap>
                <Text>Every</Text>
                <InputNumber aria-label="Repeat every (seconds)" min={30} value={draft.schedule.everySeconds} onChange={(v) => update({ schedule: { ...draft.schedule, everySeconds: Number(v) } })} />
                <Text>seconds, for at most</Text>
                <InputNumber aria-label="For at most (seconds)" min={60} value={draft.schedule.maxAgeSeconds} onChange={(v) => update({ schedule: { ...draft.schedule, maxAgeSeconds: Number(v) } })} />
                <Text>seconds</Text>
              </Space>
            ) : (
              <CheckScheduleEditor value={draft.schedule?.checkAfterSeconds} onChange={(checkAfterSeconds) => update({ schedule: { checkAfterSeconds } })} />
            )}
          </div>
        </Field>
      )}

      {draft.hook === 'after_delivery' && (
        <Field
          label="Ask this before sending again"
          error={errorAt('verification')}
          hint="Status words that mean the provider does not have the message, such as NOT_FOUND. When someone replays a failed delivery, this check runs first and the message is sent again only if it returns one of these. Leave empty if this check cannot tell."
        >
          <Select
            aria-label="Status words that allow sending again"
            mode="tags"
            style={{ width: '100%' }}
            tokenSeparators={[',', ' ']}
            value={draft.verification?.resendWhen || []}
            onChange={(words: string[]) => {
              const resendWhen = [...new Set(words.map((word) => word.trim().toUpperCase()).filter(Boolean))];
              const { verification: _dropped, ...rest } = draft;
              setDraft(resendWhen.length ? { ...rest, verification: { resendWhen } } : rest);
            }}
          />
        </Field>
      )}

      <Collapse
        bordered={false}
        items={[
          {
            key: 'errors',
            label: 'When it fails',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Field label="Then" error={errorAt('onError')}>
                  <Select
                    aria-label="When it fails"
                    style={{ width: '100%' }}
                    value={onError.action}
                    options={errorOptions}
                    onChange={(action) =>
                      update({
                        onError:
                          action === 'retry_stage'
                            ? { action, maxAttempts: inline ? 2 : 3, ...(inline ? {} : { backoffSeconds: [30, 120, 600] }) }
                            : { action },
                      })
                    }
                  />
                </Field>
                {onError.action === 'retry_stage' && (
                  <Space wrap>
                    <Text>Attempts</Text>
                    <InputNumber aria-label="Attempts" min={2} max={inline ? 3 : 10} value={onError.maxAttempts} onChange={(v) => update({ onError: { ...onError, maxAttempts: Number(v) } })} />
                  </Space>
                )}
                {onError.action === 'retry_stage' && !inline && (
                  <Field label="Wait before each retry">
                    <CheckScheduleEditor value={onError.backoffSeconds} onChange={(backoffSeconds) => update({ onError: { ...onError, backoffSeconds } })} />
                  </Field>
                )}
                {onError.action === 'retry_stage' && (
                  <Checkbox checked={Boolean(onError.allowUncertainSideEffects)} onChange={(e) => update({ onError: { ...onError, allowUncertainSideEffects: e.target.checked } })}>
                    Retry even when a call that changes something got no answer (it may happen twice)
                  </Checkbox>
                )}
                {inline && effect === 'gate' && (
                  <Checkbox checked={Boolean(draft.allowDeliveryRetry)} onChange={(e) => update({ allowDeliveryRetry: e.target.checked })}>
                    {draft.hook === 'before_send'
                      ? 'Let it retry the delivery later (nothing has been sent yet)'
                      : 'Let it ask for the message to be sent again (only with fail(..., { retryDelivery: true }))'}
                  </Checkbox>
                )}
                <Field label="Time limit (ms)" error={errorAt('timeoutMs')} hint={inline ? 'Stages inside the delivery share one time budget.' : undefined}>
                  <InputNumber aria-label="Time limit in milliseconds" min={100} step={500} value={draft.timeoutMs} placeholder={inline ? '3000' : '15000'} onChange={(v) => update({ timeoutMs: v === null ? undefined : Number(v) })} />
                </Field>
              </Space>
            ),
          },
          {
            key: 'credential',
            label: 'Credential',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Radio.Group
                  value={authMode}
                  onChange={(e) =>
                    update({
                      auth:
                        e.target.value === 'none'
                          ? undefined
                          : e.target.value === 'integration'
                            ? { source: 'integration', allowedOrigins: draft.auth?.allowedOrigins || [] }
                            : { credentialRef: '', headers: { Authorization: 'Bearer {{ credential.token }}' }, allowedOrigins: draft.auth?.allowedOrigins || [] },
                    })
                  }
                >
                  <Space direction="vertical">
                    <Radio value="none">None: calls go out without credentials</Radio>
                    <Radio value="credential">One of this organization&apos;s credentials</Radio>
                    <Radio value="integration">This integration&apos;s own authentication</Radio>
                  </Space>
                </Radio.Group>
                {authMode === 'credential' && (
                  <>
                    <Field label="Credential" error={errorAt('auth.credentialRef')}>
                      {credentials.data ? (
                        <Select
                          aria-label="Credential"
                          style={{ width: '100%' }}
                          value={draft.auth?.credentialRef || undefined}
                          options={credentials.data.map((c) => ({ value: c.placeholderId, label: `${c.name} (${c.provider}, ${c.environment})` }))}
                          onChange={(credentialRef) => update({ auth: { ...draft.auth!, credentialRef } })}
                        />
                      ) : (
                        <Input aria-label="Credential ID" value={draft.auth?.credentialRef} placeholder="cred_..." onChange={(e) => update({ auth: { ...draft.auth!, credentialRef: e.target.value } })} />
                      )}
                    </Field>
                    <Field label="Headers" error={errorAt('auth.headers')} hint="Where the credential goes, e.g. Authorization: Bearer {{ credential.token }}.">
                      <KeyValueEditor label="Credential header" value={draft.auth?.headers} onChange={(headers) => update({ auth: { ...draft.auth!, headers } })} />
                    </Field>
                  </>
                )}
                {authMode !== 'none' && (
                  <Field label="Only for these origins" error={errorAt('auth.allowedOrigins')} hint="The credential is added only to calls to these, e.g. https://api.example.com. It is never shown to the script.">
                    <Select
                      aria-label="Allowed origins"
                      mode="tags"
                      style={{ width: '100%' }}
                      value={draft.auth?.allowedOrigins || []}
                      onChange={(allowedOrigins: string[]) => update({ auth: { ...draft.auth!, allowedOrigins } })}
                    />
                  </Field>
                )}
              </Space>
            ),
          },
          {
            key: 'recording',
            label: 'What is recorded',
            children: (
              <Space direction="vertical" size={12} style={{ width: '100%' }}>
                <Select
                  aria-label="Recording level"
                  style={{ width: '100%' }}
                  value={draft.recording?.level || 'full'}
                  options={[
                    { value: 'full', label: 'Every call, with headers and bodies' },
                    { value: 'errors-only', label: 'Headers and bodies only when something failed' },
                    { value: 'summary', label: 'Method, URL, status and timing only' },
                  ]}
                  onChange={(level) => update({ recording: { ...(draft.recording || {}), level } })}
                />
                <Field label="Personal data: key names to hide anywhere" hint="e.g. phone, recipient. Credentials and tokens are always hidden.">
                  <Select
                    aria-label="Sensitive key names"
                    mode="tags"
                    style={{ width: '100%' }}
                    value={draft.recording?.sensitiveKeys || []}
                    onChange={(sensitiveKeys: string[]) => update({ recording: { level: draft.recording?.level || 'full', ...(draft.recording || {}), sensitiveKeys } })}
                  />
                </Field>
                <Field label="Personal data: exact paths to hide" hint="e.g. data[*].to">
                  <Select
                    aria-label="Sensitive paths"
                    mode="tags"
                    style={{ width: '100%' }}
                    value={draft.recording?.sensitivePaths || []}
                    onChange={(sensitivePaths: string[]) => update({ recording: { level: draft.recording?.level || 'full', ...(draft.recording || {}), sensitivePaths } })}
                  />
                </Field>
              </Space>
            ),
          },
          {
            key: 'inputs',
            label: 'Inputs',
            children: (
              <Field label="Values the stage receives" error={errorAt('inputs')} hint={'Use {{ event.field }}, {{ delivery.response.body.id }} or an earlier stage\'s output; add ?? "default" for a fallback.'}>
                <KeyValueEditor label="Input" value={draft.inputs} onChange={(inputs) => update({ inputs })} />
                {earlier.some((candidate) => outputsOf(candidate).length) && (
                  <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 6 }}>
                    Available:{' '}
                    {earlier.flatMap((candidate) => outputsOf(candidate).map((output) => `{{ stages.${candidate.id}.output.${output.name} }}`)).join('  ')}
                  </Text>
                )}
              </Field>
            ),
          },
        ]}
      />
      {other.filter((error) => !['name', 'effect', 'schedule', 'onError', 'timeoutMs', 'outputs', 'inputs', 'verification'].some((key) => error.path.startsWith(key)) && !error.path.startsWith('auth')).length > 0 && (
        <Alert
          type="error"
          showIcon
          role="alert"
          message="Fix these before applying"
          description={other.map((error) => `${error.path}: ${error.message}`).join('; ')}
        />
      )}
    </Space>
  );

  return (
    <>
      {children({
        draft,
        settings,
        test: <StageTestPanel stage={draft} integrationId={integrationId} protocol={protocol} />,
        tab,
        setTab,
        apply,
        applying: validate.isPending,
        changed: JSON.stringify(draft) !== JSON.stringify(stage),
      })}
    </>
  );
};

export const StageEditorDrawer = ({ open, onClose, ...editorProps }: StageEditorDrawerProps) => (
  <StageEditor open={open} {...editorProps}>
    {({ draft, settings, test, tab, setTab, apply, applying }) => (
      <Drawer
        open={open}
        onClose={onClose}
        width={760}
        title={draft.name || 'New stage'}
        destroyOnClose
        footer={
          <Space style={{ justifyContent: 'flex-end', width: '100%' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={applying} onClick={apply}>
              Apply
            </Button>
          </Space>
        }
      >
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'settings' | 'test')}
          items={[
            { key: 'settings', label: 'Settings', children: settings },
            { key: 'test', label: 'Test', children: test },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12 }}>
          Applying keeps the change in this form; it takes effect when the integration is saved.
        </Text>
      </Drawer>
    )}
  </StageEditor>
);
