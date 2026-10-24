import { Alert, Button, Space, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import type { StageCall, StageRun } from '../../../services/stages-api';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { OUTCOME_TAG, runTitle, stageStatusColor, stageStatusLabel } from '../stageLabels';

const { Text } = Typography;

const blockStyle = {
  margin: 0,
  padding: 12,
  borderRadius: 8,
  background: 'var(--bg-subtle, #f5f5f5)',
  fontSize: 12,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-all' as const,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  maxHeight: 320,
  overflow: 'auto' as const,
};

const asText = (body: unknown) => (typeof body === 'string' ? body : JSON.stringify(body, null, 2));

const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/** The call written as a cURL command. Credentials arrive already masked. */
export const buildStageCurl = (call: StageCall): string => {
  const lines = [`curl -X ${call.method} "${call.url}"`];
  for (const [name, value] of Object.entries(call.requestHeaders || {})) lines.push(`  -H "${name}: ${value}"`);
  if (call.requestBody !== undefined && call.requestBody !== null && call.requestBody !== '') lines.push(`  -d ${quote(asText(call.requestBody))}`);
  return lines.join(' \\\n');
};

const CUT_NOTE: Record<string, string> = {
  network: 'Only the first part of the answer was read (size limit).',
  recording: 'Shortened for storage.',
};
const OMITTED_NOTE: Record<string, string> = {
  'errors-only': 'Headers and bodies are recorded for failed calls only.',
  summary: 'Headers and bodies are not recorded for this stage.',
};

// The runtime's reasons, in words; the code stays visible for searching.
const ERROR_TEXT: Record<string, string> = {
  STAGE_FAILED: 'The stage decided this failed',
  TIMEOUT: 'It took longer than its time limit',
  BINDING_ERROR: 'A {{ }} value it needs was missing',
  BAD_RESULT: 'It returned something that is not { status, done, data }',
  CREDENTIAL_UNAVAILABLE: 'Its credential is missing or not filled in',
  NOT_ISOLATED: 'Stages cannot run on this server yet',
  UNSUPPORTED_CREDENTIAL_USE: 'It used the credentials in a way that is not supported',
  OUT_OF_MEMORY: 'It ran out of memory',
};
export const describeErrorCode = (code?: string | null) => (code ? `${ERROR_TEXT[code] ? `${ERROR_TEXT[code]} ` : ''}(${code})` : undefined);

const copy = (text: string) => navigator.clipboard?.writeText(text);

const Call = ({ call }: { call: StageCall }) => {
  const curl = buildStageCurl(call);
  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      <div>
        <Space size={4}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            Request
          </Text>
          <Button size="small" type="text" icon={<CopyOutlined />} aria-label={`Copy request ${call.id} as cURL`} onClick={() => copy(curl)} />
        </Space>
        <pre style={blockStyle} tabIndex={0}>
          {curl}
        </pre>
        {call.requestBodyCut && <Text type="secondary" style={{ fontSize: 12 }}>{CUT_NOTE[call.requestBodyCut]}</Text>}
        {call.redirects && call.redirects.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12, display: 'block' }}>
            Redirected {call.redirects.length} time{call.redirects.length === 1 ? '' : 's'}, ending at {call.finalUrl || call.redirects[call.redirects.length - 1].url}
          </Text>
        )}
      </div>
      <div>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Response
          {call.statusCode !== null && call.statusCode !== undefined ? ` · ${call.statusCode}` : ''}
          {call.durationMs !== null && call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ''}
        </Text>
        {call.error && <Alert type="error" showIcon message={`${call.error.message}`} description={call.error.code} style={{ marginBottom: 8 }} />}
        {call.bodiesOmitted ? (
          <Text type="secondary" style={{ display: 'block' }}>
            {OMITTED_NOTE[call.bodiesOmitted]}
          </Text>
        ) : call.responseBody !== undefined && call.responseBody !== null && call.responseBody !== '' ? (
          <pre style={blockStyle} tabIndex={0}>
            {asText(call.responseBody)}
          </pre>
        ) : (
          !call.error && <Text type="secondary"> (empty)</Text>
        )}
        {call.responseBodyCut && <Text type="secondary" style={{ fontSize: 12 }}>{CUT_NOTE[call.responseBodyCut]}</Text>}
      </div>
    </Space>
  );
};

/** One run of a stage, exactly as it was recorded: what it asked, what came back, what it decided. */
export const StageRunView = ({ run }: { run: StageRun }) => {
  const outcome = OUTCOME_TAG[run.outcome] ?? OUTCOME_TAG.error;
  return (
    <div style={{ border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: 8, padding: 12 }}>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space wrap size={[8, 4]}>
          <Text strong>{runTitle(run)}</Text>
          <Text type="secondary">{formatDateTimeWithSeconds(run.at)}</Text>
          <Text type="secondary">{run.durationMs} ms</Text>
          {run.status ? (
            <Tag color={stageStatusColor(run.status, run.done)} style={{ margin: 0 }}>
              {stageStatusLabel(run.status)}
            </Tag>
          ) : (
            <Tag color={outcome.color} style={{ margin: 0 }}>
              {outcome.label}
            </Tag>
          )}
          {run.status && run.outcome !== 'ok' && <Tag color={outcome.color} style={{ margin: 0 }}>{outcome.label}</Tag>}
          {run.done && run.stage.hook === 'after_delivery' && <Tag style={{ margin: 0 }}>Finished</Tag>}
          {run.shadow && (
            <Tag color="purple" style={{ margin: 0 }} title="A migration is comparing this stage with the old configuration. It had no effect.">
              Shadow
            </Tag>
          )}
          {run.replayOfRunId && <Tag style={{ margin: 0 }}>Replay</Tag>}
          {run.fromFollowUp && <Tag style={{ margin: 0 }}>Recorded by the old follow-up</Tag>}
        </Space>

        {run.calls.length === 0 && <Text type="secondary">No request was made.</Text>}
        {run.calls.map((call) => (
          <Call key={call.id} call={call} />
        ))}
        {run.callsOmitted ? <Text type="secondary">{run.callsOmitted} more requests were made but not recorded.</Text> : null}

        {run.error && <Alert type={run.outcome === 'ok' ? 'warning' : 'error'} showIcon message={run.error} description={describeErrorCode(run.errorCode)} />}
        {run.reason && <Text>Skipped: {run.reason}</Text>}

        {run.result !== undefined && run.result !== null && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Result
            </Text>
            <pre style={blockStyle}>{asText(run.result)}</pre>
          </div>
        )}
        {run.logs.length > 0 && (
          <div>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Logs
            </Text>
            <pre style={blockStyle}>
              {run.logs.map((entry) => `${entry.level.toUpperCase()} ${entry.message}`).join('\n')}
            </pre>
            {run.logsOmitted ? <Text type="secondary" style={{ fontSize: 12 }}>{run.logsOmitted} more lines not kept.</Text> : null}
          </div>
        )}
      </Space>
    </div>
  );
};

/** Every run of one stage for a delivery, newest first. */
export const StageRunsList = ({ runs }: { runs: StageRun[] }) => (
  <Space direction="vertical" size={12} style={{ width: '100%' }}>
    {[...runs].reverse().map((run) => (
      <StageRunView key={run.runId} run={run} />
    ))}
  </Space>
);
