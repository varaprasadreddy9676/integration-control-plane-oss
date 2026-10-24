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

const STARTER_SCRIPTS: Record<StageHook, string> = {
  before_send: `// ctx.event: the event; ctx.delivery.request: { url, method, body } about to be sent
// return skip('reason') to not send it, fail('reason') to fail it
return { status: 'OK' };`,
  after_response: `// ctx.delivery.response: { status, headers, body } the target answered
// return fail('reason') when the answer means the send did not work
return { status: 'OK' };`,
  after_delivery: `// ctx.delivery.response: what the target answered when the message was sent
// ctx.run.seq: which check this is; http.get(url) to ask the provider
// return { status: 'DELIVERED', done: true } when there is nothing more to wait for
return { status: 'PENDING' };`,
  on_failure: `// ctx.delivery.status: FAILED or ABANDONED; ctx.delivery.errorMessage: why
return { status: 'NOTED' };`,
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
    config: runner.type === 'script' ? { code: STARTER_SCRIPTS[hook] } : runner.type === 'http' ? { method: 'GET', url: '' } : {},
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

/** The outputs a stage offers to later stages and the Send step. */
export const outputsOf = (stage: StageConfig): Array<{ name: string; type: string }> => {
  if (stage.runner.type === 'http') {
    return ((stage.runner.config.extract as Array<{ name: string; type?: string }>) || [])
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
