import { useQuery } from '@tanstack/react-query';
import { App, Timeline, Tooltip } from "@/components/common/LegacyAntdControls";
import { Text } from '@astryxdesign/core/Text';
import { getExecutionLogTimeline } from '../../../services/api';
import { useDesignTokens } from '../../../design-system/utils';
import { StatePanel } from '../../../components/common/StatePanel';
import { StatusBadge } from '../../../components/common/StatusBadge';
import { Icon as GatewayIcon } from '../../../components/common/Icon';
import { copyTextToClipboard } from '../../../utils/clipboard';
import type { StageRun } from '../../../services/stages-api';
import { OUTCOME_TAG, runTitle, stageStatusColor, stageStatusLabel } from '../../stages/stageLabels';
import { Button } from '../../../components/common/LegacyButton';

const statusVariant = (color: string) => {
  if (color === 'red') return 'error' as const;
  if (color === 'orange') return 'warning' as const;
  if (color === 'green') return 'success' as const;
  if (color === 'blue') return 'info' as const;
  return 'neutral' as const;
};

/**
 * The gateway already records an execution trace per delivery — the steps a
 * message went through, how long each took, and which one failed — and exposes
 * it at /execution-logs/:traceId/timeline. Nothing surfaced it, so answering
 * "where did this actually break" meant reading a payload and inferring.
 *
 * Delivery logs carry the traceId (backend src/data/logs.js), so this is a
 * join, not new instrumentation.
 */
export const DeliveryTraceTimeline = ({ traceId, stageRuns = [] }: { traceId: string; stageRuns?: StageRun[] }) => {
  const { spacing } = useDesignTokens();
  const { message } = App.useApp();

  const copyTraceId = async () => {
    const copied = await copyTextToClipboard(traceId);
    if (copied) message.success('Trace ID copied');
    else message.error('Failed to copy trace ID');
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['execution-log-timeline', traceId],
    queryFn: () => getExecutionLogTimeline(traceId),
    enabled: Boolean(traceId),
    staleTime: 5 * 60 * 1000,
    // A missing trace is a 404, not a blip — traces age out sooner than
    // delivery logs. Retrying just delays telling the user that.
    retry: false,
  });

  if (isLoading) {
    return <StatePanel glyph="connecting" tone="busy" size="compact" title="Loading delivery trace" />;
  }

  if (isError || !data) {
    return (
      <StatePanel
        glyph="disrupted"
        tone="critical"
        size="compact"
        title="Trace unavailable"
        description="Trace retention may have expired."
        actions={
          <Button size="small" onClick={() => void refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const steps = data.timeline || [];
  if (!steps.length) {
    return (
      <StatePanel
        glyph="searching"
        tone="neutral"
        size="compact"
        title="No steps recorded"
        description="The pipeline recorded no steps."
      />
    );
  }

  const failedStep = data.summary?.errorStep;

  return (
    <div>
      <div style={{ display: 'flex', gap: spacing[3], flexWrap: 'wrap', alignItems: 'center', marginBottom: spacing[3] }}>
        <Text type="supporting" color="secondary">
          {data.summary?.stepCount ?? steps.length} steps
        </Text>
        {data.summary?.totalDuration != null && (
          <Text type="supporting" color="secondary">{data.summary.totalDuration} ms total</Text>
        )}
        <Text type="code" color="secondary">{traceId}</Text>
        <Tooltip title="Copy trace ID">
          <Button
            type="text"
            size="small"
            aria-label="Copy trace ID"
            icon={<GatewayIcon name="CopyOutlined" />}
            onClick={() => void copyTraceId()}
          />
        </Tooltip>
      </div>

      <Timeline
        items={[
          ...steps.map((step) => ({ at: step.timestamp, step, run: null as StageRun | null })),
          // The delivery's pipeline stages, in time order with the steps (later checks come after).
          ...stageRuns.map((run) => ({ at: run.at, step: null as (typeof steps)[number] | null, run })),
        ]
          .sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
          .map(({ step: maybeStep, run }) => {
          if (run) {
            const outcome = OUTCOME_TAG[run.outcome] ?? OUTCOME_TAG.error;
            const runColor = run.status ? stageStatusColor(run.status, run.done) : outcome.color;
            return {
              children: (
                <div>
                  <div style={{ display: 'flex', gap: spacing[2], alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <Text weight="semibold">
                      {run.stage.name}
                    </Text>
                    <Text type="supporting" color="secondary">
                      {runTitle(run)} · {run.durationMs} ms
                    </Text>
                    <StatusBadge
                      status={run.status || run.outcome}
                      label={run.status ? stageStatusLabel(run.status) : outcome.label}
                      variant={statusVariant(runColor)}
                      size="small"
                    />
                  </div>
                  {run.error && <Text type="supporting" color="secondary" as="div" style={{ marginTop: spacing[1], overflowWrap: 'anywhere' }}>{run.error}</Text>}
                </div>
              ),
            };
          }
          const step = maybeStep!;
          const isFailure =
            step.status?.toUpperCase() === 'FAILED' ||
            Boolean(step.error) ||
            (failedStep && step.name === failedStep);
          const normalizedStatus = step.status?.toUpperCase();
          const label = isFailure
            ? 'Failed'
            : normalizedStatus === 'SKIPPED'
              ? 'Skipped'
              : normalizedStatus === 'SUCCESS'
                ? 'Completed'
                : stageStatusLabel(step.status);
          const color = isFailure ? 'red' : stageStatusColor(step.status, normalizedStatus === 'SUCCESS');

          return {
            children: (
              <div>
                <div style={{ display: 'flex', gap: spacing[2], alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Text weight="semibold">
                    {step.name}
                  </Text>
                  {step.durationMs != null && (
                    <Text type="supporting" color="secondary">{step.durationMs} ms</Text>
                  )}
                  {/* Gap since the previous step — where a delivery sat waiting
                      is often more useful than how long a step itself ran. */}
                  {step.gapMs != null && step.gapMs > 0 && (
                    <Text type="supporting" color="secondary">+{step.gapMs} ms after previous</Text>
                  )}
                  {step.status && (
                    <StatusBadge
                      status={normalizedStatus}
                      label={label}
                      variant={statusVariant(normalizedStatus === 'SKIPPED' ? 'default' : color)}
                      size="small"
                    />
                  )}
                </div>
                {step.error?.message && (
                  <Text
                    as="div"
                    type="code"
                    color="secondary"
                    style={{
                      marginTop: spacing[1],
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {step.error.message}
                  </Text>
                )}
              </div>
            ),
          };
        })}
      />
    </div>
  );
};
