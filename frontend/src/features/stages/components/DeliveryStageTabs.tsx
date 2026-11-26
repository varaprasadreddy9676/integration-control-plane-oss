import type { ReactNode } from 'react';
import { Space } from "@/components/common/LegacyAntdControls";
import type { StageRun, StageState } from '../../../services/stages-api';
import type { DeliveryLog } from '../../../mocks/types';
import { StageRunsList } from './StageRunView';
import { OUTCOME_TAG, stageStatusColor, stageStatusLabel } from '../stageLabels';
import { StatusBadge } from '../../../components/common/StatusBadge';
import type { StatusBadgeVariant } from '../../../components/common/StatusBadge';

const statusVariant = (color: string): StatusBadgeVariant => {
  if (color === 'green') return 'success';
  if (color === 'red') return 'error';
  if (color === 'orange') return 'warning';
  if (color === 'blue') return 'info';
  return 'neutral';
};

/**
 * One delivery-popup tab per stage that ran, titled with the stage's own name and
 * built from the delivery's runs, so a new stage needs no new screen.
 */
export const buildStageTabItems = (
  data?: { states: StageState[]; runs: StageRun[] } | null
): Array<{ key: string; label: string; endContent: ReactNode; children: ReactNode }> => {
  if (!data || !Array.isArray(data.runs) || data.runs.length === 0) return [];
  const states = Array.isArray(data.states) ? data.states : [];
  const byStage = new Map<string, StageRun[]>();
  for (const run of data.runs) {
    if (!run?.stage?.id || !run.stage.name) continue;
    byStage.set(run.stage.id, [...(byStage.get(run.stage.id) || []), run]);
  }
  return [...byStage.entries()].map(([stageId, runs]) => {
    const latest = runs[runs.length - 1];
    const state = states.find((candidate) => candidate?.stageId === stageId);
    const status = state?.status ?? latest.status;
    const outcomeTag = OUTCOME_TAG[latest.outcome];
    return {
      key: `stage-${stageId}`,
      label: latest.stage.name,
      endContent: (
        <Space size={6}>
          {status ? (
            <StatusBadge label={stageStatusLabel(status)} variant={statusVariant(stageStatusColor(status, state?.done))} />
          ) : (
            outcomeTag && latest.outcome !== 'ok' && (
              <StatusBadge label={outcomeTag.label} variant={statusVariant(outcomeTag.color)} />
            )
          )}
          {latest.shadow && <StatusBadge label="Shadow" variant="neutral" showIcon={false} />}
        </Space>
      ),
      children: <StageRunsList runs={runs} />,
    };
  });
};

// What happened after the send says most about a delivery; inline stages come after.
const ROW_ORDER: Record<string, number> = { after_delivery: 0, on_failure: 1, after_response: 2, before_send: 3 };
const MAX_ROW_TAGS = 2;

/** The latest status of the stages that say most, as small tags for a delivery row; the rest as +N. */
export const StageSummaryTags = ({ summary }: { summary?: DeliveryLog['stageSummary'] }) => {
  const entries = Object.entries(summary || {})
    .filter(([, value]) => value && value.status)
    .sort(([, a], [, b]) => (ROW_ORDER[a.hook || ''] ?? 4) - (ROW_ORDER[b.hook || ''] ?? 4));
  if (entries.length === 0) return null;
  const shown = entries.slice(0, MAX_ROW_TAGS);
  const rest = entries.slice(MAX_ROW_TAGS);
  return (
    <>
      {shown.map(([stageId, value]) => (
        <span key={stageId} title={value.name ? `${value.name}: ${stageStatusLabel(value.status)}` : undefined}>
          <StatusBadge label={stageStatusLabel(value.status)} variant={statusVariant(stageStatusColor(value.status, value.done))} />
        </span>
      ))}
      {rest.length > 0 && (
        <span title={rest.map(([, value]) => `${value.name}: ${stageStatusLabel(value.status)}`).join('\n')}>
          <StatusBadge label={`+${rest.length}`} variant="neutral" showIcon={false} />
        </span>
      )}
    </>
  );
};
