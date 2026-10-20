import { useQuery } from '@tanstack/react-query';
import { Timeline, Typography, Skeleton, Button } from 'antd';
import { getExecutionLogTimeline } from '../../../services/api';
import { cssVar, useDesignTokens } from '../../../design-system/utils';
import { StatePanel } from '../../../components/common/StatePanel';

/**
 * The gateway already records an execution trace per delivery — the steps a
 * message went through, how long each took, and which one failed — and exposes
 * it at /execution-logs/:traceId/timeline. Nothing surfaced it, so answering
 * "where did this actually break" meant reading a payload and inferring.
 *
 * Delivery logs carry the traceId (backend src/data/logs.js), so this is a
 * join, not new instrumentation.
 */
export const DeliveryTraceTimeline = ({ traceId }: { traceId: string }) => {
  const { spacing } = useDesignTokens();

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
    return <Skeleton active paragraph={{ rows: 4 }} />;
  }

  if (isError || !data) {
    return (
      <StatePanel
        glyph="disrupted"
        tone="neutral"
        size="compact"
        title="Trace unavailable"
        description="This delivery has a trace id, but its execution trace could not be loaded. Traces are retained for a shorter window than delivery logs."
        actions={
          <Button size="small" onClick={() => void refetch()}>
            Try again
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
        description="The trace exists but has no steps — usually a delivery that failed before the pipeline started."
      />
    );
  }

  const failedStep = data.summary?.errorStep;

  return (
    <div>
      <div style={{ display: 'flex', gap: spacing[4], flexWrap: 'wrap', marginBottom: spacing[3], fontSize: 12 }}>
        <span style={{ color: cssVar.text.secondary }}>
          {data.summary?.stepCount ?? steps.length} steps
        </span>
        {data.summary?.totalDuration != null && (
          <span style={{ color: cssVar.text.secondary }}>{data.summary.totalDuration} ms total</span>
        )}
        <Typography.Text
          copyable={{ text: traceId }}
          style={{ fontSize: 12, color: cssVar.text.secondary, fontFamily: 'ui-monospace, monospace' }}
        >
          {traceId}
        </Typography.Text>
      </div>

      <Timeline
        items={steps.map((step) => {
          const isFailure =
            step.status?.toUpperCase() === 'FAILED' ||
            Boolean(step.error) ||
            (failedStep && step.name === failedStep);

          return {
            color: isFailure ? 'red' : step.status?.toUpperCase() === 'SKIPPED' ? 'gray' : 'green',
            children: (
              <div>
                <div style={{ display: 'flex', gap: spacing[2], alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <Typography.Text strong style={{ fontSize: 13 }}>
                    {step.name}
                  </Typography.Text>
                  {step.durationMs != null && (
                    <span style={{ fontSize: 12, color: cssVar.text.secondary }}>{step.durationMs} ms</span>
                  )}
                  {/* Gap since the previous step — where a delivery sat waiting
                      is often more useful than how long a step itself ran. */}
                  {step.gapMs != null && step.gapMs > 0 && (
                    <span style={{ fontSize: 12, color: cssVar.text.muted }}>+{step.gapMs} ms after previous</span>
                  )}
                </div>
                {step.error?.message && (
                  <div
                    style={{
                      fontSize: 12,
                      color: cssVar.error.text,
                      fontFamily: 'ui-monospace, monospace',
                      marginTop: 2,
                      overflowWrap: 'anywhere',
                    }}
                  >
                    {step.error.message}
                  </div>
                )}
              </div>
            ),
          };
        })}
      />
    </div>
  );
};
