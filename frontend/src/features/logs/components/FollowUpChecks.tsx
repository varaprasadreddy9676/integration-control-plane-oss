import { Space, Tooltip } from "@/components/common/LegacyAntdControls";
import { Typography } from '@/components/common/LegacyTypography';
import { Banner } from '@astryxdesign/core/Banner';
import type { DeliveryFollowUp, FollowUpCheck, FollowUpHttpCall } from '../../../mocks/types';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { followUpStatusLabel, followUpStatusVariant } from './followUpStatus';
import { cssVar } from '../../../design-system/utils';
import { StatusBadge } from '../../../components/common/StatusBadge';

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
  margin: 'var(--spacing-0)',
  padding: 'var(--spacing-3)',
  borderRadius: 4,
  background: cssVar.bg.subtle,
  fontSize: 'var(--console-type-caption)',
  whiteSpace: 'pre-wrap' as const,
  wordBreak: 'break-all' as const,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
};

const HttpCall = ({ call }: { call: FollowUpHttpCall }) => (
  <Space direction="vertical" size={8} className="console-width-full">
    <div>
      <Text type="secondary" className="console-type-caption">
        Request
      </Text>
      <pre style={blockStyle}>{buildFollowUpCurl(call)}</pre>
    </div>
    <div>
      <Text type="secondary" className="console-type-caption">
        Response
        {call.statusCode !== null && call.statusCode !== undefined ? ` · ${call.statusCode}` : ''}
        {call.durationMs !== null && call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ''}
      </Text>
      {call.error && <Banner status="error" title={call.error} className="console-margin-bottom-2" />}
      {call.responseBody ? (
        <pre style={blockStyle}>{prettyBody(call.responseBody)}</pre>
      ) : (
        !call.error && <Text type="secondary"> (empty)</Text>
      )}
    </div>
  </Space>
);

const Check = ({ entry }: { entry: FollowUpCheck }) => (
  <div style={{ border: `1px solid ${cssVar.border.subtle}`, borderRadius: 4, padding: 'var(--spacing-3)' }}>
    <Space direction="vertical" size={10} className="console-width-full">
      <Space wrap>
        <Text strong>Check {entry.check}</Text>
        <Text type="secondary">{formatDateTimeWithSeconds(entry.at)}</Text>
        {entry.outcome === 'RESULT' && entry.status && (
          <StatusBadge
            label={followUpStatusLabel(entry.status)}
            variant={followUpStatusVariant(entry.status)}
            showIcon={false}
          />
        )}
        {entry.outcome === 'ERROR' && <StatusBadge label="Script error" variant="error" showIcon={false} />}
        {entry.outcome === 'SKIPPED' && <StatusBadge label="Stopped" variant="neutral" showIcon={false} />}
      </Space>

      {entry.httpCalls.length === 0 && <Text type="secondary">The script made no request.</Text>}
      {entry.httpCalls.map((call, index) => (
        <HttpCall key={index} call={call} />
      ))}

      {entry.outcome === 'ERROR' && entry.error && <Banner status="error" title={entry.error} />}
      {entry.outcome === 'SKIPPED' && entry.reason && <Text>Stopped following up: {entry.reason}</Text>}
      {entry.outcome === 'RESULT' && (entry.errorCode || entry.errorMessage) && (
        <Banner
          status="warning"
          title={entry.errorCode ? `Reason ${entry.errorCode}` : 'Reason'}
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
    <Space direction="vertical" size={12} className="console-width-full">
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
