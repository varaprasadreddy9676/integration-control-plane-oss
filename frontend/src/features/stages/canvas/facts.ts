import type { DeliveryFlowStats, StageFlowStats, StageOutcomes } from '../../../services/stages-api';
import type { FlowLabel } from './model';

/** What the canvas knows about a delivery's last 24 hours (stages-api FlowStats, one target). */
export interface TargetFacts {
  deliveries: DeliveryFlowStats;
  stages: StageFlowStats[];
}

export const count = (value: number) => value.toLocaleString('en-US');

/**
 * The number on a connector label, from recorded facts only (spec 11.2). Returns
 * undefined when there is nothing to count it from, so the label shows no number
 * rather than a guess. Stage counts are runs: a gate runs again on every retry.
 */
export function labelCount(
  fact: FlowLabel['fact'],
  facts: TargetFacts | undefined,
  outcomes: Record<string, StageOutcomes | undefined>
): number | undefined {
  if (!fact || !facts) return undefined;
  if (fact.type === 'retries') return facts.deliveries.retries;
  if (fact.type === 'abandoned') return facts.deliveries.byStatus.ABANDONED || 0;
  const stage = facts.stages.find((entry) => entry.stageId === fact.stageId);
  if (!stage) return undefined;
  if (fact.type === 'stage') return stage[fact.field];
  // Later: deliveries whose latest status is one that ends the check.
  const known = outcomes[fact.stageId];
  if (!known?.known) return undefined;
  const done = new Set(known.statuses.filter((status) => status.done).map((status) => status.status));
  return Object.entries(stage.latest).reduce((sum, [word, deliveries]) => (done.has(word) ? sum + deliveries : sum), 0);
}

export const labelText = (label: FlowLabel, value: number | undefined) =>
  value === undefined ? label.text : `${label.text} · ${count(value)}`;
