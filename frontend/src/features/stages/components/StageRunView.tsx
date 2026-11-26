import { Space } from '@/components/common/LegacyAntdControls';
import { Text as AstryxText } from '@astryxdesign/core/Text';
import { Banner } from '@astryxdesign/core/Banner';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import type { StageCall, StageRun } from '../../../services/stages-api';
import { formatDateTimeWithSeconds } from '../../../utils/format';
import { OUTCOME_TAG, runTitle, stageStatusColor, stageStatusLabel } from '../stageLabels';
import { cssVar } from '../../../design-system/utils';
import { Button } from '../../../components/common/LegacyButton';
import { StatusBadge, type StatusBadgeVariant } from '../../../components/common/StatusBadge';

const blockStyle = {
  margin: 'var(--spacing-0)',
  padding: 'var(--spacing-3)',
  borderRadius: 4,
  background: cssVar.bg.subtle,
  fontSize: 'var(--console-type-caption)',
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
  if (call.requestBody !== undefined && call.requestBody !== null && call.requestBody !== '')
    lines.push(`  -d ${quote(asText(call.requestBody))}`);
  return lines.join(' \\\n');
};

const CUT_NOTE: Record<string, string> = {
  network: 'Only the first part of the answer was read (size limit).',
  recording: 'Shortened for storage.',
};
const OMITTED_NOTE: Record<string, string> = {
  'errors-only': 'Headers and bodies are recorded for failed calls only.',
  summary: 'Headers and bodies are not recorded for this step.',
};

const statusVariantByColor: Record<string, StatusBadgeVariant> = {
  default: 'neutral',
  red: 'error',
  green: 'success',
  orange: 'warning',
  blue: 'info',
};

// The runtime's reasons, in words; the code stays visible for searching.
const ERROR_TEXT: Record<string, string> = {
  STAGE_FAILED: 'The step decided this failed',
  TIMEOUT: 'It took longer than its time limit',
  BINDING_ERROR: 'A {{ }} value it needs was missing',
  BAD_RESULT: 'It returned something that is not { status, done, data }',
  CREDENTIAL_UNAVAILABLE: 'Its credential is missing or not filled in',
  NOT_ISOLATED: 'Steps cannot run on this server yet',
  UNSUPPORTED_CREDENTIAL_USE: 'It used the credentials in a way that is not supported',
  OUT_OF_MEMORY: 'It ran out of memory',
};
export const describeErrorCode = (code?: string | null) =>
  code ? `${ERROR_TEXT[code] ? `${ERROR_TEXT[code]} ` : ''}(${code})` : undefined;

const copy = (text: string) => navigator.clipboard?.writeText(text);

const Call = ({ call }: { call: StageCall }) => {
  const curl = buildStageCurl(call);
  return (
    <Space direction="vertical" size={8} className="console-width-full">
      <div>
        <Space size={4}>
          <AstryxText type="supporting" color="secondary" className="console-type-caption">
            Request
          </AstryxText>
          <Button
            size="small"
            type="text"
            icon={<GatewayIcon name="CopyOutlined" />}
            aria-label={`Copy request ${call.id} as cURL`}
            onClick={() => copy(curl)}
          />
        </Space>
        <pre style={blockStyle} tabIndex={0}>
          {curl}
        </pre>
        {call.requestBodyCut && (
          <AstryxText type="supporting" color="secondary" className="console-type-caption">
            {CUT_NOTE[call.requestBodyCut]}
          </AstryxText>
        )}
        {call.redirects && call.redirects.length > 0 && (
          <AstryxText type="supporting" color="secondary" className="console-caption-block">
            Redirected {call.redirects.length} time{call.redirects.length === 1 ? '' : 's'}, ending at{' '}
            {call.finalUrl || call.redirects[call.redirects.length - 1].url}
          </AstryxText>
        )}
      </div>
      <div>
        <AstryxText type="supporting" color="secondary" className="console-type-caption">
          Response
          {call.statusCode !== null && call.statusCode !== undefined ? (
            <>
              {' '}
              ·{' '}
              <AstryxText type="code" style={{ color: call.statusCode >= 400 ? cssVar.error.text : undefined }}>
                {call.statusCode}
              </AstryxText>
            </>
          ) : null}
          {call.durationMs !== null && call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ''}
        </AstryxText>
        {call.error && (
          <Banner
            status="error"
            title={call.error.message}
            description={call.error.code}
            className="console-margin-bottom-2"
          />
        )}
        {call.bodiesOmitted ? (
          <AstryxText type="supporting" color="secondary" className="console-display-block">
            {OMITTED_NOTE[call.bodiesOmitted]}
          </AstryxText>
        ) : call.responseBody !== undefined && call.responseBody !== null && call.responseBody !== '' ? (
          <pre style={blockStyle} tabIndex={0}>
            {asText(call.responseBody)}
          </pre>
        ) : (
          !call.error && (
            <AstryxText type="supporting" color="secondary">
              {' '}
              (empty)
            </AstryxText>
          )
        )}
        {call.responseBodyCut && (
          <AstryxText type="supporting" color="secondary" className="console-type-caption">
            {CUT_NOTE[call.responseBodyCut]}
          </AstryxText>
        )}
      </div>
    </Space>
  );
};

/** One run of a stage, exactly as it was recorded: what it asked, what came back, what it decided. */
export const StageRunView = ({ run }: { run: StageRun }) => {
  const outcome = OUTCOME_TAG[run.outcome] ?? OUTCOME_TAG.error;
  const outcomeLabel = outcome.label === 'Error' ? 'Failed' : outcome.label;
  const hasCustomStatus = Boolean(run.status);
  const statusVariant = run.status
    ? statusVariantByColor[stageStatusColor(run.status, run.done)] || 'neutral'
    : statusVariantByColor[outcome.color] || 'neutral';
  return (
    <div style={{ border: `1px solid ${cssVar.border.subtle}`, borderRadius: 4, padding: 'var(--spacing-3)' }}>
      <Space direction="vertical" size={10} className="console-width-full">
        <Space wrap size={[8, 4]}>
          <AstryxText weight="semibold">{runTitle(run)}</AstryxText>
          <AstryxText type="supporting" color="secondary">
            {formatDateTimeWithSeconds(run.at)}
          </AstryxText>
          <AstryxText type="supporting" color="secondary" className="tabular-nums">
            {run.durationMs} ms
          </AstryxText>
          <StatusBadge
            status={hasCustomStatus ? (run.status ?? undefined) : outcomeLabel}
            label={
              hasCustomStatus && run.outcome !== 'ok'
                ? outcomeLabel
                : hasCustomStatus
                  ? stageStatusLabel(run.status)
                  : outcomeLabel
            }
            variant={statusVariant}
            size="small"
          />
          {hasCustomStatus && run.outcome !== 'ok' && (
            <AstryxText type="supporting" color="secondary">
              Provider status: {stageStatusLabel(run.status)}
            </AstryxText>
          )}
          {run.done && run.stage.hook === 'after_delivery' && (
            <AstryxText type="supporting" color="secondary">
              Finished
            </AstryxText>
          )}
          {run.shadow && (
            <span title="A migration is comparing this step with the old configuration. It had no effect.">
              <AstryxText type="supporting" color="secondary">
                Shadow
              </AstryxText>
            </span>
          )}
          {run.replayOfRunId && (
            <AstryxText type="supporting" color="secondary">
              Replay
            </AstryxText>
          )}
          {run.fromFollowUp && (
            <AstryxText type="supporting" color="secondary">
              Recorded by the old follow-up
            </AstryxText>
          )}
        </Space>

        {run.calls.length === 0 && (
          <AstryxText type="supporting" color="secondary">
            No request was made.
          </AstryxText>
        )}
        {run.calls.map((call) => (
          <Call key={call.id} call={call} />
        ))}
        {run.callsOmitted ? (
          <AstryxText type="supporting" color="secondary">
            {run.callsOmitted} more requests were made but not recorded.
          </AstryxText>
        ) : null}

        {run.error && (
          <Banner
            status={run.outcome === 'ok' ? 'warning' : 'error'}
            title={run.error}
            description={describeErrorCode(run.errorCode)}
          />
        )}
        {run.reason && <AstryxText>Skipped: {run.reason}</AstryxText>}

        {run.result !== undefined && run.result !== null && (
          <div>
            <AstryxText type="supporting" color="secondary" className="console-type-caption">
              Result
            </AstryxText>
            <pre style={blockStyle}>{asText(run.result)}</pre>
          </div>
        )}
        {run.logs.length > 0 && (
          <div>
            <AstryxText type="supporting" color="secondary" className="console-type-caption">
              Logs
            </AstryxText>
            <pre style={blockStyle}>
              {run.logs.map((entry) => `${entry.level.toUpperCase()} ${entry.message}`).join('\n')}
            </pre>
            {run.logsOmitted ? (
              <AstryxText type="supporting" color="secondary" className="console-type-caption">
                {run.logsOmitted} more lines not kept.
              </AstryxText>
            ) : null}
          </div>
        )}
      </Space>
    </div>
  );
};

/** Every run of one stage for a delivery, newest first. */
export const StageRunsList = ({ runs }: { runs: StageRun[] }) => (
  <Space direction="vertical" size={12} className="console-width-full">
    {[...runs].reverse().map((run) => (
      <StageRunView key={run.runId} run={run} />
    ))}
  </Space>
);
