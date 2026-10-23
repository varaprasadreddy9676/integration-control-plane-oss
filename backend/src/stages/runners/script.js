'use strict';

/**
 * The `script` runner: JavaScript in the stage runtime (runtime/), never in the
 * delivery process. Contract 1 gives the script `ctx` (event, delivery, stages,
 * run, vars, inputs; read-only) and the helpers http, lookup, log, skip and fail,
 * and expects `{ status, done, data }` back.
 *
 * Legacy contracts (migrated configurations) give their old globals instead and
 * are registered in legacy-contracts.js.
 */

const MAX_CODE_CHARS = 100000;

function validate(config) {
  const problems = [];
  if (typeof config.code !== 'string' || !config.code.trim()) problems.push({ path: 'code', message: 'The script is empty' });
  else if (config.code.length > MAX_CODE_CHARS) problems.push({ path: 'code', message: `A script is at most ${MAX_CODE_CHARS} characters` });
  return problems;
}

/**
 * ctx: { stage, scope, inputs, http, lookup, pool, timeoutMs, contract }
 * `contract` (from legacy-contracts.js) can replace the globals and the result reading.
 */
async function run(ctx) {
  const { stage, scope, inputs, pool, timeoutMs } = ctx;
  if (!pool) return { outcome: 'error', errorCode: 'NOT_ISOLATED', error: 'The stage runtime is not available on this server', logs: [] };

  const contract = ctx.contract;
  const globals = contract ? contract.globals(scope, inputs) : { ctx: { ...scope, inputs } };
  const helpers = {
    http: (args, options) => ctx.http(args, options),
    lookup: ({ value, type }) => ctx.lookup(value, type),
    ...(contract && contract.helpers ? contract.helpers(ctx) : {}),
  };
  const result = await pool.run({ code: stage.runner.config.code, globals, helpers, timeoutMs });
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
  run,
};
