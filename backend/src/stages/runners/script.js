'use strict';

/**
 * The `script` runner: JavaScript in the stage runtime (runtime/), never in the
 * delivery process. The stage's contract (contracts.js) decides what the script
 * sees and how its answer is read: contract 1 gives `ctx` (event, delivery,
 * stages, run, vars, inputs; read-only) and the helpers http, lookup, log, skip
 * and fail, and expects `{ status, done, data }`; legacy contracts reproduce the
 * environments migrated scripts were written for.
 */

const { getContract } = require('../contracts');
const { scanScript } = require('../outcomes');

const MAX_CODE_CHARS = 100000;

function validate(config, stage = {}) {
  const problems = [];
  if (typeof config.code !== 'string' || !config.code.trim()) problems.push({ path: 'code', message: 'The script is empty' });
  else if (config.code.length > MAX_CODE_CHARS) problems.push({ path: 'code', message: `A script is at most ${MAX_CODE_CHARS} characters` });
  if (config.allowedOrigins !== undefined) {
    // Only migrated follow-ups name the origins their credential references may go to.
    if (stage.contract !== 'legacy:follow-up') problems.push({ path: 'allowedOrigins', message: 'Use stage.auth for credentials' });
    else if (!Array.isArray(config.allowedOrigins) || config.allowedOrigins.some((origin) => typeof origin !== 'string')) {
      problems.push({ path: 'allowedOrigins', message: 'allowedOrigins lists origins like https://api.example.com' });
    }
  }
  return problems;
}

/** ctx: { stage, scope, inputs, http, lookup, pool, timeoutMs, integration, orgId, addSecret } */
async function run(ctx) {
  const { stage, scope, inputs, pool, timeoutMs } = ctx;
  if (!pool) return { outcome: 'error', errorCode: 'NOT_ISOLATED', error: 'The stage runtime is not available on this server', logs: [] };

  const contract = getContract(stage.contract);
  if (contract && contract.shouldRun && !contract.shouldRun(scope)) {
    return { outcome: 'skipped', reason: 'Does not apply to this answer', logs: [] };
  }
  const prepared = contract && contract.prepare ? await contract.prepare(ctx) : { globals: { ctx: { ...scope, inputs } }, helpers: {} };
  const helpers = {
    http: (args, options) => ctx.http(args, options),
    lookup: ({ value, type }) => ctx.lookup(value, type),
    ...prepared.helpers,
  };
  const result = await pool.run({
    code: contract && contract.code ? contract.code(stage) : stage.runner.config.code,
    globals: prepared.globals,
    helpers,
    timeoutMs,
    freezeInputs: !(contract && contract.freezeInputs === false),
    extras: (contract && contract.extras) || [],
  });
  return contract && contract.readResult ? contract.readResult(result, scope) : result;
}

module.exports = {
  type: 'script',
  label: 'Script',
  hooks: ['before_send', 'after_response', 'after_delivery', 'on_failure'],
  configSchema: {
    fields: [{ name: 'code', label: 'Script', widget: 'code', language: 'javascript', required: true }],
  },
  validate,
  outputs: null, // declared on the stage (stage.outputs)
  outcomes: (config) => scanScript(config.code),
  run,
};
