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
 */

const RUNNERS = [require('./script'), require('./http'), require('./url-check'), require('./mapping')];

const byType = new Map(RUNNERS.map((runner) => [runner.type, runner]));

function register(runner) {
  byType.set(runner.type, runner);
}

module.exports = {
  get: (type) => byType.get(type) || null,
  list: ({ includeInternal = false } = {}) => [...byType.values()].filter((runner) => includeInternal || !runner.internal),
  register,
};
