import { useState } from 'react';
import { Alert, Button, Input, Radio, Space, Switch, Typography } from 'antd';
import { PlayCircleOutlined } from '@ant-design/icons';
import { useMutation } from '@tanstack/react-query';
import type { StageConfig, StageRun } from '../../../../services/stages-api';
import { testStage } from '../../../../services/stages-api';
import { StageRunView } from '../StageRunView';
import { apiFieldErrors } from './stageDraft';
import { sampleRequest, sampleResponse } from '../../deliveryTargets';

const { Text } = Typography;

const mono = { fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12 };

const parse = (text: string, what: string): { value?: unknown; error?: string } => {
  if (text.trim() === '') return { value: undefined };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: `${what} is not valid JSON` };
  }
};

/** What the stage sees, for a sample run: the event plus what exists at its position. */
export const sampleScope = (
  stage: StageConfig,
  { event, request, code, response, protocol = 'http' }: { event: unknown; request: unknown; code: string; response: unknown; protocol?: string }
) => {
  const delivery: Record<string, unknown> = { attempt: 1 };
  if (stage.hook === 'before_send') delivery.request = sampleRequest(protocol, request);
  else delivery.response = sampleResponse(protocol, code, response);
  if (stage.hook === 'after_delivery') delivery.acceptedAt = new Date().toISOString();
  if (stage.hook === 'on_failure') Object.assign(delivery, { status: 'FAILED', errorMessage: 'Sample failure' });
  return { event: event ?? {}, delivery, stages: {}, run: { seq: 1, executionAttempt: 1 } };
};

interface StageTestPanelProps {
  stage: StageConfig;
  integrationId?: string;
  /** The kind of delivery the stage belongs to (http, email, sms, hl7...). */
  protocol?: string;
}

/**
 * Run the stage once and see exactly what it did, with the same view as real
 * runs. HTTP is answered by stand-ins unless "live" is switched on; a test
 * schedules nothing, changes no delivery, and is not kept.
 */
export const StageTestPanel = ({ stage, integrationId, protocol = 'http' }: StageTestPanelProps) => {
  const [source, setSource] = useState<'sample' | 'delivery'>('sample');
  const [eventText, setEventText] = useState('{\n  "patientId": "P-1001"\n}');
  const [bodyText, setBodyText] = useState('{\n  "data": [{ "id": "message-id" }]\n}');
  const [code, setCode] = useState(protocol === 'http' ? '200' : 'SENT');
  const [deliveryId, setDeliveryId] = useState('');
  const [stubText, setStubText] = useState('[\n  { "status": 200, "body": { "status": "delivered" } }\n]');
  const [live, setLive] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const run = useMutation({ mutationFn: testStage });

  const start = () => {
    setProblem(null);
    const event = parse(eventText, 'The event');
    const body = parse(bodyText, stage.hook === 'before_send' ? 'The request' : 'The answer');
    const stubs = parse(stubText, 'The stand-in answers');
    const firstError = [event, body, stubs].find((entry) => entry.error)?.error;
    if (firstError) return setProblem(firstError);
    if (source === 'delivery' && !deliveryId.trim()) return setProblem('Give the ID of a delivery to run against');
    return run.mutate({
      integrationId,
      stage,
      live,
      ...(source === 'delivery'
        ? { deliveryId: deliveryId.trim() }
        : { sample: sampleScope(stage, { event: event.value, request: body.value, code, response: body.value, protocol }) }),
      ...(live ? {} : { stubResponses: Array.isArray(stubs.value) ? (stubs.value as Array<{ status: number; body: unknown }>) : [] }),
    });
  };

  const error = run.error as Error | null;
  const fieldErrors = apiFieldErrors(run.error);

  return (
    <Space direction="vertical" size={14} style={{ width: '100%' }}>
      <Radio.Group value={source} onChange={(e) => setSource(e.target.value)} optionType="button">
        <Radio.Button value="sample">A sample</Radio.Button>
        <Radio.Button value="delivery" disabled={!integrationId}>
          A real delivery
        </Radio.Button>
      </Radio.Group>

      {source === 'sample' ? (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div>
            <Text strong>The event</Text>
            <Input.TextArea aria-label="Sample event" value={eventText} onChange={(e) => setEventText(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} style={mono} />
          </div>
          {stage.hook === 'before_send' ? (
            <div>
              <Text strong>The request about to be sent</Text>
              <Input.TextArea aria-label="Sample request body" value={bodyText} onChange={(e) => setBodyText(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} style={mono} />
            </div>
          ) : (
            <div>
              <Space>
                <Text strong>What came back</Text>
                <Input
                  aria-label="Sample answer code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  style={{ width: 120 }}
                  placeholder={protocol === 'http' ? '200' : 'SENT'}
                />
              </Space>
              <Input.TextArea aria-label="Sample answer body" value={bodyText} onChange={(e) => setBodyText(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} style={mono} />
            </div>
          )}
        </Space>
      ) : (
        <div>
          <Text strong>Delivery ID</Text>
          <Input aria-label="Delivery ID" value={deliveryId} onChange={(e) => setDeliveryId(e.target.value)} placeholder="From the delivery logs" />
        </div>
      )}

      <Space align="center">
        <Switch checked={live} onChange={setLive} aria-label="Call the real APIs" />
        <Text>Call the real APIs</Text>
      </Space>
      {live ? (
        <Alert
          type="warning"
          showIcon
          message="The step will call the real APIs"
          description="Anything those calls change is changed for real. The test is recorded in the audit log; it schedules nothing and changes no delivery."
        />
      ) : (
        <div>
          <Text strong>Stand-in answers</Text>
          <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
            Each HTTP call gets the next answer in this list (the last one repeats). Nothing leaves the gateway.
          </Text>
          <Input.TextArea aria-label="Stand-in answers" value={stubText} onChange={(e) => setStubText(e.target.value)} autoSize={{ minRows: 3, maxRows: 10 }} style={mono} />
        </div>
      )}

      <Button type="primary" icon={<PlayCircleOutlined />} loading={run.isPending} onClick={start}>
        Run the stage
      </Button>

      {problem && <Alert type="error" showIcon message={problem} role="alert" />}
      {error && (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={error.message}
          description={fieldErrors.length ? fieldErrors.map((d) => `${d.path}: ${d.message}`).join('; ') : undefined}
        />
      )}
      {run.data && (
        <div aria-live="polite">
          {run.data.live && <Text type="secondary">Ran against the real APIs.</Text>}
          <StageRunView run={run.data.record as StageRun} />
        </div>
      )}
    </Space>
  );
};
