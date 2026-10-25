'use strict';

/**
 * The runner registry: one module per runner, the same pattern as
 * services/notifications/plugins. A runner is
 *   { type, label, hooks, configSchema, validate(config, stage) -> [{ path, message }],
 *     outputs(config) -> [{ name, type, sensitive }] | null, run(ctx), internal? }
 * `internal` runners serve migrated configurations only and are not offered for
 * new stages. The console builds each runner's form from configSchema with the
 * fixed widget set: text, select, checkbox, code, key-value, rows, tags,
 * duration-list.
 *
 * `presentation` is everything the console needs to show a runner without knowing
 * it: a new runner is a module here and nothing in the console changes.
 *   icon                one of the canvas icons (script, http, ...)
 *   summary             [{ field, as?: 'text'|'host'|'lines'|'count', unit? }] the step's one-line summary
 *   mayDecide           can it skip or fail the delivery (a gate that has no outcomes read yet is assumed to)
 *   outputs             { declaredOnStage: true } (listed by the user) | { fromConfig: 'field' } (named in that
 *                       config list) | {} (fixed, or none)
 *   defaultConfig / defaultConfigByHook   what a new step of it starts with
 * `exportOmits` (on the runner) lists configuration fields that stay out of an export without sensitive data.
 */

const RUNNERS = [require('./script'), require('./http'), require('./url-check'), require('./mapping')];

const byType = new Map(RUNNERS.map((runner) => [runner.type, runner]));

function register(runner) {
  byType.set(runner.type, runner);
}

/** The icons the console can draw a runner with (frontend features/stages/canvas/CanvasNode.tsx). */
const PRESENTATION_ICONS = ['script', 'http', 'transform', 'send'];

module.exports = {
  PRESENTATION_ICONS,
  get: (type) => byType.get(type) || null,
  list: ({ includeInternal = false } = {}) => [...byType.values()].filter((runner) => includeInternal || !runner.internal),
  register,
};
