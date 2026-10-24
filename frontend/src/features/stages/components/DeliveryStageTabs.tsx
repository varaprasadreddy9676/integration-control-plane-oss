import type { ReactNode } from 'react';
import { Space, Tag } from 'antd';
import type { StageRun, StageState } from '../../../services/stages-api';
import type { DeliveryLog } from '../../../mocks/types';
import { StageRunsList } from './StageRunView';
import { OUTCOME_TAG, stageStatusColor, stageStatusLabel } from '../stageLabels';

/**
 * One delivery-popup tab per stage that ran, titled with the stage's own name and
 * built from the delivery's runs, so a new stage needs no new screen.
 */
export const buildStageTabItems = (
  data?: { states: StageState[]; runs: StageRun[] } | null
): Array<{ key: string; label: ReactNode; children: ReactNode }> => {
  if (!data || data.runs.length === 0) return [];
  const byStage = new Map<string, StageRun[]>();
  for (const run of data.runs) byStage.set(run.stage.id, [...(byStage.get(run.stage.id) || []), run]);
  return [...byStage.entries()].map(([stageId, runs]) => {
    const latest = runs[runs.length - 1];
    const state = data.states.find((candidate) => candidate.stageId === stageId);
    const status = state?.status ?? latest.status;
    return {
      key: `stage-${stageId}`,
      label: (
        <Space size={6}>
          {latest.stage.name}
          {status ? (
            <Tag color={stageStatusColor(status, state?.done)} style={{ margin: 0 }}>
              {stageStatusLabel(status)}
            </Tag>
          ) : (
            latest.outcome !== 'ok' && (
              <Tag color={OUTCOME_TAG[latest.outcome].color} style={{ margin: 0 }}>
                {OUTCOME_TAG[latest.outcome].label}
              </Tag>
            )
          )}
          {latest.shadow && <Tag color="purple" style={{ margin: 0 }}>Shadow</Tag>}
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
        <Tag
          key={stageId}
          color={stageStatusColor(value.status, value.done)}
          title={value.name ? `${value.name}: ${stageStatusLabel(value.status)}` : undefined}
          style={{ margin: 0 }}
        >
          {stageStatusLabel(value.status)}
        </Tag>
      ))}
      {rest.length > 0 && (
        <Tag style={{ margin: 0 }} title={rest.map(([, value]) => `${value.name}: ${stageStatusLabel(value.status)}`).join('\n')}>
          +{rest.length}
        </Tag>
      )}
    </>
  );
};
