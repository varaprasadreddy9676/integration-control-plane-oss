import type { StageConfig } from '../../../../../services/stages-api';

/**
 * The classic tabs over an integration that already runs on steps (a migrated one, whose old settings
 * were cleared): Response Transform edits the step `responseCheck`, Delivery follow-up edits
 * `deliveryStatus`. The steps keep their legacy script contract, so a script behaves as the tab always said.
 * The tabs edit a copy of the values; only what a person changed is written back into the steps.
 */

export const RESPONSE_STEP_ID = 'responseCheck';
export const FOLLOW_UP_STEP_ID = 'deliveryStatus';

export interface ClassicSteps {
  response: { exists: boolean; on: boolean; script: string };
  followUp: { exists: boolean; on: boolean; script: string; checkAfterSeconds?: number[] };
}

const codeOf = (stage?: StageConfig) => String((stage?.runner?.config as { code?: unknown } | undefined)?.code ?? '');

export const classicFromSteps = (stages: StageConfig[] = []): ClassicSteps => {
  const response = stages.find((stage) => stage.id === RESPONSE_STEP_ID);
  const followUp = stages.find((stage) => stage.id === FOLLOW_UP_STEP_ID);
  return {
    response: { exists: Boolean(response), on: Boolean(response) && response?.enabled !== false, script: codeOf(response) },
    followUp: {
      exists: Boolean(followUp),
      on: Boolean(followUp) && followUp?.enabled !== false,
      script: codeOf(followUp),
      ...(followUp?.schedule?.checkAfterSeconds ? { checkAfterSeconds: followUp.schedule.checkAfterSeconds } : {}),
    },
  };
};

const sameList = (a?: number[], b?: number[]) => JSON.stringify(a || []) === JSON.stringify(b || []);

const newResponseStep = (script: string): StageConfig =>
  ({
    id: RESPONSE_STEP_ID,
    name: 'Response check',
    hook: 'after_response',
    effect: 'gate',
    contract: 'legacy:response-transform',
    runner: { type: 'script', config: { code: script } },
    allowDeliveryRetry: true,
    onError: { action: 'ignore' },
    timeoutMs: 30000,
  }) as StageConfig;

/** The steps with the tabs' changes written in; a step the tabs did not change is returned as the same object. */
export const applyClassicToSteps = (stages: StageConfig[], now: ClassicSteps, before: ClassicSteps, newFollowUp?: StageConfig): StageConfig[] => {
  const responseChanged = now.response.on !== before.response.on || now.response.script !== before.response.script;
  const followUpChanged =
    now.followUp.on !== before.followUp.on ||
    now.followUp.script !== before.followUp.script ||
    !sameList(now.followUp.checkAfterSeconds, before.followUp.checkAfterSeconds);

  let result = stages.map((stage) => {
    if (stage.id === RESPONSE_STEP_ID && responseChanged) {
      return { ...stage, enabled: now.response.on, runner: { ...stage.runner, config: { ...stage.runner.config, code: now.response.script } } };
    }
    if (stage.id === FOLLOW_UP_STEP_ID && followUpChanged) {
      return {
        ...stage,
        enabled: now.followUp.on,
        runner: { ...stage.runner, config: { ...stage.runner.config, code: now.followUp.script } },
        ...(now.followUp.checkAfterSeconds ? { schedule: { ...stage.schedule, checkAfterSeconds: now.followUp.checkAfterSeconds } } : {}),
      };
    }
    return stage;
  });
  if (responseChanged && !before.response.exists && now.response.on) result = [...result, newResponseStep(now.response.script)];
  // The follow-up step is built by the server (provider script, allowed hosts): added when the tab switched one on.
  if (newFollowUp && !before.followUp.exists && now.followUp.on) result = [...result, newFollowUp];
  return result;
};
