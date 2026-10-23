'use strict';

/**
 * Stages as part of an integration's configuration: one validation for every
 * save path (create, update, duplicate, import, template, restore), and what a
 * change does to the work already scheduled.
 *
 *   create   given stages, or the provider's default templates (Qikchat...)
 *   update   validated whenever stages, the Send bindings or what they depend on
 *            (actions, direction) change
 *   jobs     a removed stage cancels its pending jobs; a disabled stage,
 *            integration or kill switch pauses them; switching back resumes them
 *            (missed checks are skipped, see schedule.js)
 */

const { validateStages, stagesNotSupported } = require('./config');
const runners = require('./runners');
const { defaultStagesFor } = require('./templates');
const { ValidationError } = require('../utils/errors');

const STAGE_FIELDS = ['stages', 'send', 'stagesPaused', 'stageBudgetMs'];
const DEPENDS_ON = ['stages', 'send', 'actions', 'direction', 'stageBudgetMs'];
const MIN_BUDGET_MS = 100;
const MAX_BUDGET_MS = 30000;

// A ValidationError, so the API answers 400 with the per-field errors in `details`.
class StageConfigError extends ValidationError {
  constructor(errors) {
    super(`Invalid stages: ${errors.map((error) => `${error.path}: ${error.message}`).join('; ')}`, errors);
    this.name = 'ValidationError';
  }
}

async function defaultCredentialExists(orgId, credentialRef) {
  const credentials = require('../data/credentials');
  return Boolean(await credentials.getCredentialPlaceholder(orgId, credentialRef));
}

async function validated(orgId, integration, stages, send, { credentialExists = defaultCredentialExists } = {}) {
  const result = validateStages(stages, { integration, send, runners });
  const errors = [...result.errors];
  // A disabled stage may name a credential this org does not have yet (an
  // import); it must exist before the stage is switched on.
  for (const [index, stage] of (result.stages || []).entries()) {
    const ref = stage && stage.enabled !== false && stage.auth && stage.auth.credentialRef;
    if (ref && !(await credentialExists(orgId, ref))) {
      errors.push({ path: `stages[${index}].auth.credentialRef`, message: `Credential ${ref} does not exist in this organization` });
    }
  }
  const budget = integration.stageBudgetMs;
  if (budget !== undefined && budget !== null && (!Number.isInteger(budget) || budget < MIN_BUDGET_MS || budget > MAX_BUDGET_MS)) {
    errors.push({ path: 'stageBudgetMs', message: `stageBudgetMs is ${MIN_BUDGET_MS} to ${MAX_BUDGET_MS}` });
  }
  if (errors.length) throw new StageConfigError(errors);
  return { stages: result.stages, send: send || null };
}

/** The stage fields a new integration is stored with. Throws StageConfigError. */
async function stageFieldsForCreate(orgId, payload, deps) {
  const given = Array.isArray(payload.stages) ? payload.stages : null;
  const stages = given !== null ? given : stagesNotSupported(payload) ? [] : defaultStagesFor(payload);
  const { stages: saved, send } = await validated(orgId, payload, stages, payload.send, deps);
  return {
    stages: saved,
    send,
    stagesPaused: payload.stagesPaused === true,
    stageBudgetMs: payload.stageBudgetMs || null,
  };
}

/**
 * The stage fields an update must store, or null when the update does not touch
 * them. `existing` is the integration as stored. Throws StageConfigError.
 */
async function stageFieldsForUpdate(orgId, existing, patch, deps) {
  if (!DEPENDS_ON.some((field) => Object.prototype.hasOwnProperty.call(patch, field))) return null;
  const merged = { ...existing, ...patch };
  const stages = Object.prototype.hasOwnProperty.call(patch, 'stages') ? patch.stages : (existing && existing.stages) || [];
  const send = Object.prototype.hasOwnProperty.call(patch, 'send') ? patch.send : existing && existing.send;
  const { stages: saved, send: savedSend } = await validated(orgId, merged, stages, send, deps);
  return { stages: saved, send: savedSend };
}

const switchedOn = (integration) => Boolean(integration) && integration.isActive !== false && integration.stagesPaused !== true;

/**
 * Bring pending jobs in line with a configuration change. `before` and `after`
 * are the integration before and after (either may be null). It runs after the
 * change is saved, so it never fails the save: what it cannot do now, the job
 * worker does when it next looks (cancel, pause) and its repair pass (resume).
 */
async function applyStageLifecycle(change, jobs = require('./store/jobs')) {
  try {
    await syncJobs(change, jobs);
  } catch (error) {
    const { log } = require('../logger');
    log('warn', 'Stage jobs not yet in line with the configuration; the worker will catch up', {
      orgId: change.orgId,
      integrationId: String(change.integrationId),
      error: error.message,
    });
  }
}

async function syncJobs({ orgId, integrationId, before, after }, jobs) {
  const id = String(integrationId);
  if (!after) {
    await jobs.cancelJobs(orgId, id);
    return;
  }
  const previous = new Map(((before && before.stages) || []).filter(Boolean).map((stage) => [stage.id, stage]));
  const current = new Map((after.stages || []).filter(Boolean).map((stage) => [stage.id, stage]));
  for (const stageId of previous.keys()) {
    if (!current.has(stageId)) await jobs.cancelJobs(orgId, id, stageId);
  }
  for (const [stageId, stage] of current) {
    const onNow = switchedOn(after) && stage.enabled !== false;
    const onBefore = previous.has(stageId) && switchedOn(before) && previous.get(stageId).enabled !== false;
    if (onNow && !onBefore) await jobs.resumeJobs(orgId, id, stageId);
    else if (!onNow && onBefore) await jobs.pauseJobs(orgId, id, stageId);
  }
}

const OMITTED_SCRIPT = "return skip('The script was not included in the export');";

/**
 * Stages for an export: as they are with sensitive data, otherwise with each
 * script's code left out (like transformation scripts); the export's own masking
 * then hides credential-like fields, headers and URL secrets.
 */
function stagesForExport(stages, includeSensitive) {
  if (!Array.isArray(stages)) return [];
  if (includeSensitive) return stages;
  return stages.map((stage) => {
    if (!stage || !stage.runner || stage.runner.type !== 'script') return stage;
    const code = (stage.runner.config && stage.runner.config.code) || '';
    return { ...stage, runner: { ...stage.runner, config: { codeOmitted: true, codeLength: code.length } } };
  });
}

/**
 * Stages arriving in an import, made safe to save: a script left out of the
 * export, or a masked value, is restored from the same stage of the integration
 * being updated; when there is none, the stage is imported switched off. A stage
 * whose credential does not exist in this org is switched off until it is
 * rebound. Resolves to { stages, attention: [{ stageId, reason }] }.
 */
async function prepareStagesForImport(stages, { orgId, existingStages = [], credentialExists = defaultCredentialExists } = {}) {
  if (!Array.isArray(stages)) return { stages: undefined, attention: [] };
  const { containsSecretMask, restoreMaskedSecrets } = require('../utils/integration-secrets');
  const attention = [];
  const prepared = [];
  for (const incoming of stages) {
    if (!incoming || typeof incoming !== 'object') continue;
    let stage = JSON.parse(JSON.stringify(incoming));
    const stored = existingStages.find((candidate) => candidate && candidate.id === stage.id);
    const switchOff = (reason) => {
      stage.enabled = false;
      attention.push({ stageId: stage.id, reason });
    };

    if (stage.runner && stage.runner.config && stage.runner.config.codeOmitted) {
      const storedCode = stored && stored.runner && stored.runner.config && stored.runner.config.code;
      stage.runner = { ...stage.runner, config: { code: storedCode || OMITTED_SCRIPT } };
      if (!storedCode) switchOff('The script was not in the export; paste it before switching the stage on');
    }
    if (containsSecretMask({ stage })) {
      if (stored) stage = restoreMaskedSecrets({ stage }, { stage: stored }).stage;
      if (containsSecretMask({ stage })) switchOff('Masked values were not in the export; fill them in before switching the stage on');
    }
    const ref = stage.auth && stage.auth.credentialRef;
    if (ref && !(await credentialExists(orgId, ref))) {
      switchOff(`Credential ${ref} does not exist in this organization; choose one of yours`);
    }
    prepared.push(stage);
  }
  return { stages: prepared, attention };
}

/**
 * Does a save change stages or the Send bindings (so it needs stages:edit)? A
 * form that sends back what it was given, unchanged, does not; on create, empty
 * values do not.
 */
function changesStages(body, before = null) {
  const { stableStringify } = require('./store/definitions');
  const empty = (value) => value === undefined || value === null || value === false || (Array.isArray(value) && value.length === 0);
  const same = (a, b) => stableStringify(a === undefined ? null : a) === stableStringify(b === undefined ? null : b);
  return STAGE_FIELDS.some((field) => {
    if (!Object.prototype.hasOwnProperty.call(body, field)) return false;
    return before ? !same(body[field], before[field]) : !empty(body[field]);
  });
}

module.exports = {
  changesStages,
  stageFieldsForCreate,
  stageFieldsForUpdate,
  applyStageLifecycle,
  stagesForExport,
  prepareStagesForImport,
  StageConfigError,
  STAGE_FIELDS,
};
