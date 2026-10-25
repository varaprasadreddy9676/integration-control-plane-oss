import { useDeferredValue, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { StageConfig, StageOutcomes } from '../../../services/stages-api';
import { getFlowStats, getSaveImpact, getStageOutcomes } from '../../../services/stages-api';
import type { DeliveryTarget } from '../deliveryTargets';
import { useStageLibrary } from '../components/delivery-tab/stageLibrary';

type FormValues = Record<string, any>;

export const stagesOf = (values: FormValues, target: DeliveryTarget): StageConfig[] => {
  const owner = target.namePath.length ? values.actions?.[target.namePath[1] as number] : values;
  return (owner?.stages || []) as StageConfig[];
};

export const ownerOf = (values: FormValues, target: DeliveryTarget): Record<string, any> =>
  (target.namePath.length ? values.actions?.[target.namePath[1] as number] : values) || {};

/** The part of the form the canvas edits: every delivery's stages and Send step. */
const draftOf = (values: FormValues) => ({
  stages: values.stages || [],
  send: values.send ?? null,
  actions: Array.isArray(values.actions)
    ? values.actions.map((action: FormValues) => ({
        ...action,
        stages: action?.stages || [],
        send: action?.send ?? null,
      }))
    : undefined,
});

/** Only what decides a stage's branches, so typing a name does not ask the server again. */
const outcomeKey = (stage: StageConfig) => ({
  id: stage.id,
  hook: stage.hook,
  effect: stage.effect,
  runner: stage.runner,
  onError: stage.onError,
  allowDeliveryRetry: stage.allowDeliveryRetry,
});

/**
 * What the canvas reads from the server besides the form: runner labels, what each
 * stage can end with, the last 24 hours' counts, and what saving the draft would do to
 * waiting checks. The form is the draft; `dirty` says it differs from when the canvas
 * opened.
 */
export function useCanvasData({
  integrationId,
  values,
  targets,
  readOnly,
}: {
  integrationId?: string;
  values: FormValues;
  targets: DeliveryTarget[];
  readOnly: boolean;
}) {
  const library = useStageLibrary(integrationId);
  const initial = useRef<string | null>(null);
  const current = JSON.stringify(draftOf(values));
  if (initial.current === null) initial.current = current;
  const dirty = current !== initial.current;
  const savedStages = useMemo(() => {
    const parsed = JSON.parse(initial.current as string) as ReturnType<typeof draftOf>;
    const map = new Map<string, string>();
    [...parsed.stages, ...(parsed.actions || []).flatMap((action: FormValues) => action.stages)].forEach(
      (stage: StageConfig) => map.set(stage.id, JSON.stringify(stage))
    );
    return map;
    // The snapshot never changes while the canvas is open.
  }, []);

  const allStages = targets.flatMap((target) => stagesOf(values, target));
  const outcomeSignature = useDeferredValue(JSON.stringify(allStages.map(outcomeKey)));
  const outcomes = useQuery({
    queryKey: ['stage-outcomes', outcomeSignature],
    queryFn: async () => {
      const stages = JSON.parse(outcomeSignature) as StageConfig[];
      const entries = await Promise.all(
        stages.map(async (stage) => [stage.id, await getStageOutcomes(stage).catch(() => undefined)] as const)
      );
      return Object.fromEntries(entries) as Record<string, StageOutcomes | undefined>;
    },
    placeholderData: keepPreviousData,
    staleTime: 60 * 1000,
  });

  const stats = useQuery({
    queryKey: ['flow-stats', integrationId],
    queryFn: () => getFlowStats(integrationId as string, 24),
    enabled: Boolean(integrationId),
    refetchInterval: 60 * 1000,
    retry: false,
  });

  const draftSignature = useDeferredValue(current);
  const impact = useQuery({
    queryKey: ['save-impact', integrationId, draftSignature],
    queryFn: () => getSaveImpact(integrationId as string, JSON.parse(draftSignature)),
    enabled: Boolean(integrationId) && dirty && !readOnly,
    retry: false,
    staleTime: 30 * 1000,
  });

  const runnerLabels = useMemo(
    () => Object.fromEntries((library.runners.data || []).map((runner) => [runner.type, runner.label])),
    [library.runners.data]
  );
  const isEdited = (stage: StageConfig) => savedStages.get(stage.id) !== JSON.stringify(stage);

  return {
    library,
    runnerLabels,
    outcomes: outcomes.data || {},
    stats: stats.data,
    statsError: stats.isError,
    impact: impact.data,
    dirty,
    isEdited,
  };
}
