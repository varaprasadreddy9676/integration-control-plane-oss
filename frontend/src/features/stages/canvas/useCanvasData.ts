import { useDeferredValue, useMemo, useRef } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { StageConfig, StageOutcomes } from '../../../services/stages-api';
import { getFlowStats, getSaveImpact, getStageOutcomes, validateStages } from '../../../services/stages-api';
import type { DeliveryTarget } from '../deliveryTargets';
import { issueText } from '../components/delivery-tab/stageDraft';
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
  context,
}: {
  integrationId?: string;
  values: FormValues;
  targets: DeliveryTarget[];
  readOnly: boolean;
  /** The integration as the server should validate stages against. */
  context: () => Record<string, unknown>;
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

  // The server's checks of every delivery's stages, as they are in the draft: the steps with a problem say so.
  const checkSignature = useDeferredValue(
    JSON.stringify(targets.map((target) => [target.actionIndex, stagesOf(values, target), ownerOf(values, target).send ?? null]))
  );
  const validation = useQuery({
    queryKey: ['stage-issues', integrationId, checkSignature],
    queryFn: async () => {
      const issues: Record<string, string[]> = {};
      await Promise.all(
        targets.map(async (target) => {
          const stages = stagesOf(values, target);
          if (stages.length === 0) return;
          const result = await validateStages({
            integrationId,
            integration: context(),
            actionIndex: target.actionIndex,
            stages,
            send: ownerOf(values, target).send ?? null,
          });
          for (const error of result.errors) {
            const index = Number(error.path.match(/^stages\[(\d+)\]/)?.[1]);
            const stage = Number.isInteger(index) ? stages[index] : undefined;
            if (stage) issues[stage.id] = [...(issues[stage.id] || []), issueText(error.path, error.message)];
          }
        })
      );
      return issues;
    },
    enabled: !readOnly && targets.some((target) => stagesOf(values, target).length > 0),
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 15 * 1000,
  });

  const runnerMap = useMemo(
    () => Object.fromEntries((library.runners.data || []).map((runner) => [runner.type, runner])),
    [library.runners.data]
  );
  const isEdited = (stage: StageConfig) => savedStages.get(stage.id) !== JSON.stringify(stage);

  return {
    library,
    runnerMap,
    outcomes: outcomes.data || {},
    stats: stats.data,
    statsError: stats.isError,
    impact: impact.data,
    issues: validation.data || {},
    dirty,
    isEdited,
  };
}
