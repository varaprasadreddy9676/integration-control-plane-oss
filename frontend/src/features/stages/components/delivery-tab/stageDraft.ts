import type { StageConfig, StageHook, StageRunner, StageValidationError } from '../../../../services/stages-api';
import { formatDuration } from '../../../integrations/components/detail/DeliveryFollowUpSection';

/** Where a stage may change the delivery, and what it may do when it fails. */
export const INLINE_HOOKS: StageHook[] = ['before_send', 'after_response'];
export const isInline = (hook: StageHook) => INLINE_HOOKS.includes(hook);

/** "Ask the provider" -> "askTheProvider", unique among `taken`. */
export const newStageId = (name: string, taken: string[]): string => {
  const words = name
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  let base = words.map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())).join('');
  if (!/^[A-Za-z]/.test(base)) base = `stage${base}`;
  base = base.slice(0, 56);
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}${n}`;
  return id;
};

/** A new stage of `runner` at `hook`, with sensible defaults (the server fills in the rest). */
export const defaultStage = (runner: StageRunner, hook: StageHook, name: string, taken: string[]): StageConfig => ({
  id: newStageId(name, taken),
  name,
  hook,
  enabled: true,
  effect: isInline(hook) ? 'gate' : 'observe',
  runner: {
    type: runner.type,
    config: JSON.parse(JSON.stringify(runner.presentation?.defaultConfigByHook?.[hook] ?? runner.presentation?.defaultConfig ?? {})),
  },
  ...(hook === 'after_delivery' ? { schedule: { checkAfterSeconds: [30, 300, 3600, 86400] } } : {}),
});

/** "4 checks: 30 seconds ... 1 day after the send", "every 10 minutes for 1 day". */
export const scheduleSummary = (stage: StageConfig): string | null => {
  const schedule = stage.schedule;
  if (!schedule) return null;
  if (schedule.checkAfterSeconds?.length) {
    const list = schedule.checkAfterSeconds;
    return `${list.length} check${list.length === 1 ? '' : 's'}: ${list.map(formatDuration).join(', ')} after the send`;
  }
  if (schedule.everySeconds && schedule.maxAgeSeconds) {
    return `every ${formatDuration(schedule.everySeconds)} for ${formatDuration(schedule.maxAgeSeconds)}`;
  }
  return null;
};

/**
 * The server's errors for the stage at `index`: runner settings by field name
 * (for the generated form) and the rest as { path, message } with the stage
 * prefix removed.
 */
export const errorsForStage = (errors: StageValidationError[], index: number) => {
  const prefix = `stages[${index}].`;
  const runnerFields: Record<string, string> = {};
  const other: StageValidationError[] = [];
  for (const error of errors) {
    if (!error.path.startsWith(prefix)) continue;
    const path = error.path.slice(prefix.length);
    if (path.startsWith('runner.config.')) runnerFields[path.slice('runner.config.'.length).split(/[.[]/)[0]] = error.message;
    else other.push({ path, message: error.message });
  }
  return { runnerFields, other };
};

const PLACES: Record<string, string> = {
  name: 'Name',
  'runner.config.url': 'URL',
  'auth.credentialRef': 'Credential',
  'auth.allowedOrigins': 'Sent only to',
  'auth.headers': 'How to send it',
  timeoutMs: 'Time limit',
  onError: 'When it fails',
  schedule: 'Schedule',
  outputs: 'Outputs',
  inputs: 'Inputs',
  effect: 'What it may do',
  verification: 'Ask this before sending again',
};

/** What is wrong with a step, for a person: the place it is in words, then what the server said. */
export const issueText = (path: string, message: string): string => {
  const local = path.replace(/^stages\[\d+\]\./, '');
  const known = Object.keys(PLACES)
    .filter((key) => local === key || local.startsWith(`${key}.`) || local.startsWith(`${key}[`))
    .sort((a, b) => b.length - a.length)[0];
  if (known) return `${PLACES[known]}: ${message}`;
  const field = local.match(/^runner\.config\.([A-Za-z]+)/)?.[1];
  if (field) return `${field.replace(/([A-Z])/g, ' $1').toLowerCase().replace(/^./, (c) => c.toUpperCase())}: ${message}`;
  return message;
};

/**
 * The outputs a stage offers to later stages and the Send step: the ones the user lists on
 * the stage, or, for a runner that names them in its configuration, those (the runner says
 * which list: presentation.outputs.fromConfig).
 */
export const outputsOf = (stage: StageConfig, runner?: StageRunner): Array<{ name: string; type: string }> => {
  const field = runner?.presentation?.outputs?.fromConfig;
  if (field) {
    return ((stage.runner.config[field] as Array<{ name: string; type?: string }>) || [])
      .filter((rule) => rule && rule.name)
      .map((rule) => ({ name: rule.name, type: rule.type || 'string' }));
  }
  return stage.outputs || [];
};

/** The per-field errors of a failed API call (the server sends them as `details`). */
export const apiFieldErrors = (error: unknown): StageValidationError[] => {
  const body = (error as { details?: { details?: unknown } } | null)?.details;
  return Array.isArray(body?.details) ? (body?.details as StageValidationError[]) : [];
};

/** A new stage of a runner at a hook, named after the runner and numbered among the stages already there. */
export const draftFromRunner = (runner: StageRunner, hook: StageHook, stages: StageConfig[]): StageConfig =>
  defaultStage(
    runner,
    hook,
    `${runner.label} ${stages.filter((stage) => stage.hook === hook).length + 1}`,
    stages.map((stage) => stage.id)
  );

/** Move the stage one place up or down among the stages of its hook; the others stay where they are. */
export const moveStage = (stages: StageConfig[], index: number, direction: -1 | 1): StageConfig[] => {
  const hook = stages[index].hook;
  const same = stages.map((stage, i) => (stage.hook === hook ? i : -1)).filter((i) => i >= 0);
  const swapWith = same[same.indexOf(index) + direction];
  if (swapWith === undefined) return stages;
  const next = [...stages];
  [next[index], next[swapWith]] = [next[swapWith], next[index]];
  return next;
};

export const canMoveStage = (stages: StageConfig[], index: number, direction: -1 | 1): boolean =>
  moveStage(stages, index, direction) !== stages;

export const setStageEnabled = (stages: StageConfig[], index: number, enabled: boolean): StageConfig[] =>
  stages.map((stage, i) => (i === index ? { ...stage, enabled } : stage));

export const removeStageAt = (stages: StageConfig[], index: number): StageConfig[] =>
  stages.filter((_, i) => i !== index);

/** A copy right after the original, with its own name and ID (its history and scheduled checks stay with the original). */
export const duplicateStage = (stages: StageConfig[], index: number): StageConfig[] => {
  const original = stages[index];
  const name = `${original.name} copy`.slice(0, 80);
  const copy: StageConfig = {
    ...JSON.parse(JSON.stringify(original)),
    id: newStageId(
      name,
      stages.map((stage) => stage.id)
    ),
    name,
  };
  delete copy.template;
  delete copy.migratedFrom;
  delete copy.shadow;
  return [...stages.slice(0, index + 1), copy, ...stages.slice(index + 1)];
};
