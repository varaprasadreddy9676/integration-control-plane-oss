import type { StageHook, StageOutcome, StageRun } from '../../services/stages-api';
import { followUpStatusColor, followUpStatusLabel } from '../logs/components/followUpStatus';

/** The four places a stage can sit, in the order a delivery passes them. */
export const HOOK_GROUPS: Array<{ hook: StageHook; title: string; description: string }> = [
  {
    hook: 'before_send',
    title: 'Before send',
    description: 'After the request is built, before the target is called. A gate can skip, fail or retry the delivery.',
  },
  {
    hook: 'after_response',
    title: 'After the response',
    description: 'Right after the target answers. A gate can turn an accepted send into a failure.',
  },
  {
    hook: 'after_delivery',
    title: 'Later (scheduled)',
    description: 'After an accepted send, on a schedule: asks a provider what became of it, notifies someone. Observes only.',
  },
  {
    hook: 'on_failure',
    title: 'On failure',
    description: 'Once the delivery has finally failed, including before any send. Observes only.',
  },
];

export const hookTitle = (hook: StageHook) => HOOK_GROUPS.find((group) => group.hook === hook)?.title ?? hook;

/** A status word the stage chose, in plain words (READ -> "Read"). */
export const stageStatusLabel = (status?: string | null) => (status ? followUpStatusLabel(status) : '');
export const stageStatusColor = followUpStatusColor;

export const OUTCOME_TAG: Record<StageOutcome, { label: string; color: string }> = {
  ok: { label: 'Done', color: 'green' },
  error: { label: 'Error', color: 'red' },
  timeout: { label: 'Timed out', color: 'orange' },
  skipped: { label: 'Skipped', color: 'default' },
};

/** "Check 2", "Attempt 1", "Failure 1", with the retry when there was one. */
export const runTitle = (run: Pick<StageRun, 'seq' | 'executionAttempt' | 'stage'>) => {
  const noun = run.stage.hook === 'after_delivery' ? 'Check' : run.stage.hook === 'on_failure' ? 'Failure' : 'Attempt';
  return `${noun} ${run.seq}${run.executionAttempt > 1 ? ` · retry ${run.executionAttempt - 1}` : ''}`;
};
