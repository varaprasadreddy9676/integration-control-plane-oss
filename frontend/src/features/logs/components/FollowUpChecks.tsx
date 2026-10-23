import { Alert, Space, Tag, Typography } from 'antd';
import type { DeliveryFollowUp, FollowUpCheck, FollowUpHttpCall } from '../../../mocks/types';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { followUpStatusColor, followUpStatusLabel } from './followUpStatus';

const { Text } = Typography;

/** The follow-up request written like the delivery's cURL. Credentials arrive already masked. */
export const buildFollowUpCurl = (call: FollowUpHttpCall): string => {
  const headers = Object.entries(call.headers || {}).map(([name, value]) => `  -H "${name}: ${value}"`);
  return [`curl -X ${call.method} "${call.url}"`, ...headers].join(' \\\n');
};

/** A JSON body laid out for reading; anything else as it is. */
const prettyBody = (body: string): string => {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
};

const blockStyle = {
  margin: 0,
  padding: 12,
  borderRadius: 8,
  background: 'var(--bg-subtle, #f5f5f5)',
  fontSize: 12,
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-all' as const,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
};

const HttpCall = ({ call }: { call: FollowUpHttpCall }) => (
  <Space direction="vertical" size={8} style={{ width: '100%' }}>
    <div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Request
      </Text>
      <pre style={blockStyle}>{buildFollowUpCurl(call)}</pre>
    </div>
    <div>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Response
        {call.statusCode !== null && call.statusCode !== undefined ? ` · ${call.statusCode}` : ''}
        {call.durationMs !== null && call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ''}
      </Text>
      {call.error && <Alert type="error" showIcon message={call.error} style={{ marginBottom: 8 }} />}
      {call.responseBody ? <pre style={blockStyle}>{prettyBody(call.responseBody)}</pre> : !call.error && <Text type="secondary"> (empty)</Text>}
    </div>
  </Space>
);

const Check = ({ entry }: { entry: FollowUpCheck }) => (
  <div style={{ border: '1px solid var(--border-subtle, #e5e7eb)', borderRadius: 8, padding: 12 }}>
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Space wrap>
        <Text strong>Check {entry.check}</Text>
        <Text type="secondary">{formatDateTimeWithSeconds(entry.at)}</Text>
        {entry.outcome === 'RESULT' && entry.status && (
          <Tag color={followUpStatusColor(entry.status)} style={{ margin: 0 }}>
            {followUpStatusLabel(entry.status)}
          </Tag>
        )}
        {entry.outcome === 'ERROR' && <Tag color="red" style={{ margin: 0 }}>Script error</Tag>}
        {entry.outcome === 'SKIPPED' && <Tag style={{ margin: 0 }}>Stopped</Tag>}
      </Space>

      {entry.httpCalls.length === 0 && <Text type="secondary">The script made no request.</Text>}
      {entry.httpCalls.map((call, index) => (
        <HttpCall key={index} call={call} />
      ))}

      {entry.outcome === 'ERROR' && entry.error && <Alert type="error" showIcon message={entry.error} />}
      {entry.outcome === 'SKIPPED' && entry.reason && <Text>Stopped following up: {entry.reason}</Text>}
      {entry.outcome === 'RESULT' && (entry.errorCode || entry.errorMessage) && (
        <Alert
          type="warning"
          showIcon
          message={entry.errorCode ? `Reason ${entry.errorCode}` : 'Reason'}
          description={entry.errorMessage || undefined}
        />
      )}
    </Space>
  </div>
);

/** The "Follow-up" tab of a delivery: every check, with what was asked and what came back. */
export const FollowUpChecks = ({ followUp }: { followUp: DeliveryFollowUp }) => {
  const history = followUp.history || [];
  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      {history.length === 0 && (
        <Text type="secondary">
          The requests of each check are not recorded for this delivery (it was followed up before checks were kept).
        </Text>
      )}
      {history.map((entry) => (
        <Check key={entry.check} entry={entry} />
      ))}
      {!followUp.done && followUp.nextCheckAt && (
        <Text type="secondary">Next check {formatDateTimeWithSeconds(followUp.nextCheckAt)}</Text>
      )}
    </Space>
  );
};
