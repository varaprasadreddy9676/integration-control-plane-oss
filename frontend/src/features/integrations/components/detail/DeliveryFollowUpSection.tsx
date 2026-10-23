import { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Form, Input, InputNumber, Select, Space, Switch, Tag, Typography } from 'antd';
import { DeleteOutlined, PlayCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { useMutation, useQuery } from '@tanstack/react-query';
import { getFollowUpPreset, testFollowUpScript, type FollowUpTestResult } from '../../../../services/api';
import { InlineHint } from '../../../../components/common/InlineHint';
import { MonacoEditorInput } from '../MonacoEditorInput';
import { followUpStatusColor, followUpStatusLabel } from '../../../logs/components/followUpStatus';

const { Text } = Typography;

export const MAX_CHECKS = 8;
export const MIN_CHECK_SECONDS = 10;
export const MAX_CHECK_SECONDS = 7 * 24 * 3600;
export const DEFAULT_SCHEDULE = [30, 300, 3600, 86400];

const UNITS = [
  { value: 86400, label: 'days' },
  { value: 3600, label: 'hours' },
  { value: 60, label: 'minutes' },
  { value: 1, label: 'seconds' },
] as const;

/** The largest unit that divides the value evenly: 300 -> 5 minutes. */
export const splitDuration = (seconds: number) => {
  const unit = UNITS.find((candidate) => seconds >= candidate.value && seconds % candidate.value === 0) ?? UNITS[3];
  return { amount: seconds / unit.value, unit: unit.value };
};

export const formatDuration = (seconds: number) => {
  const { amount, unit } = splitDuration(seconds);
  const label = UNITS.find((candidate) => candidate.value === unit)?.label ?? 'seconds';
  return `${amount} ${amount === 1 ? label.slice(0, -1) : label}`;
};

interface ScheduleEditorProps {
  value?: number[];
  onChange?: (value: number[]) => void;
}

/** The times, after the send, at which the provider is asked. One row is one check. */
export const CheckScheduleEditor = ({ value, onChange }: ScheduleEditorProps) => {
  const checks = value && value.length > 0 ? value : DEFAULT_SCHEDULE;
  const update = (index: number, seconds: number | null) =>
    onChange?.(checks.map((current, i) => (i === index ? (seconds ?? MIN_CHECK_SECONDS) : current)));

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {checks.map((seconds, index) => {
        const { amount, unit } = splitDuration(seconds);
        return (
          <Space key={index} align="center" wrap>
            <Text type="secondary" style={{ width: 64, display: 'inline-block' }}>
              Check {index + 1}
            </Text>
            <InputNumber
              min={1}
              precision={0}
              value={amount}
              aria-label={`Check ${index + 1} time`}
              onChange={(next) => update(index, next === null ? null : Number(next) * unit)}
              style={{ width: 90 }}
            />
            <Select
              value={unit}
              aria-label={`Check ${index + 1} unit`}
              options={UNITS.map((u) => ({ value: u.value, label: u.label }))}
              onChange={(nextUnit) => update(index, amount * nextUnit)}
              style={{ width: 110 }}
            />
            <Text type="secondary">after it is sent</Text>
            <Button
              type="text"
              danger
              icon={<DeleteOutlined />}
              aria-label={`Remove check ${index + 1}`}
              disabled={checks.length <= 1}
              onClick={() => onChange?.(checks.filter((_, i) => i !== index))}
            />
          </Space>
        );
      })}
      <Space>
        <Button
          icon={<PlusOutlined />}
          disabled={checks.length >= MAX_CHECKS}
          onClick={() => onChange?.([...checks, Math.min((checks[checks.length - 1] || 60) * 2, MAX_CHECK_SECONDS)])}
        >
          Add a check
        </Button>
        <Button type="link" onClick={() => onChange?.([...DEFAULT_SCHEDULE])}>
          Reset to default
        </Button>
      </Space>
    </Space>
  );
};

/** A schedule problem to show next to the field, or null. */
export const scheduleProblem = (schedule?: number[]): string | null => {
  if (!schedule) return null;
  if (schedule.length === 0) return 'Add at least one check';
  if (schedule.length > MAX_CHECKS) return `Use at most ${MAX_CHECKS} checks`;
  if (schedule.some((s) => !Number.isInteger(s) || s < MIN_CHECK_SECONDS || s > MAX_CHECK_SECONDS)) {
    return 'Each check must be between 10 seconds and 7 days';
  }
  return null;
};

const SCRIPT_HELP = `// delivery.response  what the target answered when the message was sent (parsed if it was JSON)
// delivery.statusCode, delivery.sentAt, delivery.check
// context.headers     the headers this integration sends (its API key and auth)
// http.get(url, { headers })   ask the provider; skip('reason') stops following up
//
// Return { status, done, errorCode, errorMessage }
// status: any short word you choose, e.g. DELIVERED, READ, FAILED, SIGNED_OFF
// done:   true when there is nothing more to wait for (stops the remaining checks)
// Return nothing (or status PENDING) when the provider has no answer yet.`;

const DEFAULT_SAMPLE = '{\n  "status": true,\n  "data": [{ "id": "message-id-from-the-send-response" }]\n}';

const TestPanel = ({ form, integrationId }: { form: any; integrationId?: string }) => {
  const [sample, setSample] = useState(DEFAULT_SAMPLE);
  const run = useMutation<FollowUpTestResult, Error>({
    mutationFn: () => {
      let response: unknown;
      try {
        response = JSON.parse(sample);
      } catch {
        response = sample; // not JSON: the script sees the text
      }
      return testFollowUpScript(integrationId || 'new', {
        script: form.getFieldValue(['deliveryFollowUp', 'script']) || '',
        response,
        statusCode: 200,
      });
    },
  });
  const result = run.data;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Text type="secondary">
        Runs the script now against a sample of what the target answered when a message was sent. Nothing is saved.
        {integrationId && integrationId !== 'new' ? ' It asks the provider for real, with this integration’s headers.' : ''}
      </Text>
      <Input.TextArea
        rows={5}
        value={sample}
        aria-label="Sample send response"
        onChange={(event) => setSample(event.target.value)}
        style={{ fontFamily: 'var(--font-mono, monospace)' }}
      />
      <Button icon={<PlayCircleOutlined />} loading={run.isPending} onClick={() => run.mutate()}>
        Run test
      </Button>
      {run.isError && <Alert type="error" showIcon message={run.error.message} />}
      {result && (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          {result.outcome === 'RESULT' && result.result && (
            <Alert
              type={followUpStatusColor(result.result.status, result.result.done) === 'red' ? 'warning' : 'success'}
              showIcon
              message={
                <Space wrap>
                  <span>The script answered</span>
                  <Tag color={followUpStatusColor(result.result.status, result.result.done)}>
                    {followUpStatusLabel(result.result.status)}
                  </Tag>
                  {result.result.done && <Text type="secondary">(done)</Text>}
                  {result.result.errorCode && <Text code>{result.result.errorCode}</Text>}
                </Space>
              }
              description={result.result.errorMessage || undefined}
            />
          )}
          {result.outcome === 'SKIPPED' && <Alert type="info" showIcon message={`The script stopped following up: ${result.reason}`} />}
          {result.outcome === 'ERROR' && <Alert type="error" showIcon message="The script failed" description={result.error} />}
          {result.httpCalls.map((call, index) => (
            <Text key={index} type="secondary" style={{ display: 'block' }}>
              {call.method} {call.url} → {call.error || call.statusCode} ({call.durationMs ?? '?'} ms)
            </Text>
          ))}
        </Space>
      )}
    </Space>
  );
};

interface DeliveryFollowUpSectionProps {
  form: any;
  integrationId?: string;
}

/**
 * Delivery follow-up: after the target accepts a message, ask the provider
 * what became of it (delivered, read, failed) and keep the answer with the
 * delivery log. A script, written like a transform script, does the asking.
 */
export const DeliveryFollowUpSection = ({ form, integrationId }: DeliveryFollowUpSectionProps) => {
  const isCreate = !integrationId || integrationId === 'new';
  const enabled = Form.useWatch(['deliveryFollowUp', 'enabled'], form);
  const configured = Form.useWatch('deliveryFollowUp', form);
  const targetUrl: string | undefined = Form.useWatch('targetUrl', form);

  // The provider's template, once the URL has settled (not on every keystroke).
  const [settledUrl, setSettledUrl] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setSettledUrl(/^https?:\/\/[^/\s]+\.[^/\s]+/i.test(targetUrl || '') ? (targetUrl as string) : ''), 500);
    return () => clearTimeout(timer);
  }, [targetUrl]);
  const presetQuery = useQuery({
    queryKey: ['follow-up-preset', settledUrl.replace(/^(https?:\/\/[^/]+).*$/i, '$1')],
    queryFn: () => getFollowUpPreset(settledUrl),
    enabled: Boolean(settledUrl),
    staleTime: 10 * 60 * 1000,
  });
  const preset = presetQuery.data ?? null;

  // Never set up: nothing saved, or only the empty object the registered switch leaves in the form.
  const neverSetUp = !configured || (configured.enabled === undefined && !configured.script);

  // A new integration for a known provider starts with its follow-up on, as the server will save it.
  useEffect(() => {
    if (isCreate && preset && neverSetUp) form.setFieldValue('deliveryFollowUp', preset.config);
  }, [isCreate, preset, neverSetUp, form]);

  const applyTemplate = () => form.setFieldValue('deliveryFollowUp', { ...preset!.config });

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Form.Item
        name={['deliveryFollowUp', 'enabled']}
        valuePropName="checked"
        label="Follow up on each accepted message"
        extra="Accepted is not delivered: ask the provider later whether the message was delivered, read, or failed. The answer is shown on the delivery log and counted in the delivery report."
        style={{ marginBottom: 0 }}
      >
        <Switch />
      </Form.Item>

      {preset && !enabled && configured?.enabled === false && (
        <InlineHint tone="info">
          {preset.label} messages are followed up by default. This integration has it switched off.
        </InlineHint>
      )}

      {enabled && (
        <>
          <Form.Item
            name={['deliveryFollowUp', 'checkAfterSeconds']}
            label="Check after"
            tooltip="Each row is one check, counted from when the message was sent. It stops early once the message is read or has failed."
            rules={[{ validator: async (_rule, value) => { const problem = scheduleProblem(value); if (problem) throw new Error(problem); } }]}
          >
            <CheckScheduleEditor />
          </Form.Item>

          <Form.Item
            name={['deliveryFollowUp', 'script']}
            label="Follow-up script"
            rules={[{ required: true, whitespace: true, message: 'The follow-up script is required' }]}
            extra={preset ? `A template for ${preset.label} is available.` : undefined}
          >
            <MonacoEditorInput height="280px" placeholder={SCRIPT_HELP} />
          </Form.Item>

          {preset && <Button onClick={applyTemplate}>Use the {preset.label} template</Button>}

          <Collapse
            ghost
            items={[
              {
                key: 'help',
                label: 'What the script receives and returns',
                children: <pre style={{ margin: 0, fontSize: 12, whiteSpace: 'pre-wrap' }}>{SCRIPT_HELP}</pre>,
              },
              { key: 'test', label: 'Test the script', children: <TestPanel form={form} integrationId={integrationId} /> },
            ]}
          />
        </>
      )}
    </Space>
  );
};

/** The follow-up setting when the integration is only being viewed. */
export const DeliveryFollowUpView = ({ form }: { form: any }) => {
  // The edit fields are not mounted in view mode, so read the form store directly.
  const config = form?.getFieldValue('deliveryFollowUp');
  const on = config?.enabled === true;
  const checks: number[] = Array.isArray(config?.checkAfterSeconds) ? config.checkAfterSeconds : DEFAULT_SCHEDULE;

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Space wrap>
        <Text strong>Follow up on each accepted message</Text>
        <Tag color={on ? 'green' : 'default'}>{on ? 'On' : 'Off'}</Tag>
      </Space>
      {on ? (
        <>
          <Text>
            Checks after it is sent: <strong>{checks.map(formatDuration).join(', ')}</strong>
          </Text>
          <MonacoEditorInput value={config?.script || ''} readOnly height="280px" />
        </>
      ) : (
        <Text type="secondary">
          Messages are not followed up. Turn it on in edit mode to ask the provider what became of each message.
        </Text>
      )}
    </Space>
  );
};
