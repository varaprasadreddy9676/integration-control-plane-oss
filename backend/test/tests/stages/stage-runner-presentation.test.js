'use strict';

/**
 * Every runner says how the console shows it (presentation), so adding a runner never
 * needs a console change. This holds each runner, including the internal one, to that.
 */

jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const runners = require('../../../src/stages/runners');

const all = runners.list({ includeInternal: true });
const fieldNames = (runner) => new Set(runner.configSchema.fields.map((field) => field.name.split('.')[0]));

describe.each(all.map((runner) => [runner.type, runner]))('the %s runner', (_type, runner) => {
  it('describes how it is shown', () => {
    const presentation = runner.presentation;
    expect(presentation).toBeDefined();
    expect(runners.PRESENTATION_ICONS).toContain(presentation.icon);
    expect(typeof presentation.mayDecide).toBe('boolean');
    expect(presentation.outputs).toEqual(expect.any(Object));
  });

  it('says in one line what it is for, so the console can offer it with a reason', () => {
    expect(runner.description).toEqual(expect.any(String));
    expect(runner.description.length).toBeGreaterThan(10);
    expect(runner.description.length).toBeLessThanOrEqual(90);
  });

  it('summarises, and starts, from fields it really has', () => {
    const { summary, defaultConfig, defaultConfigByHook, outputs } = runner.presentation;
    const names = fieldNames(runner);
    for (const entry of summary) expect(names).toContain(entry.field);
    for (const key of Object.keys(defaultConfig || {})) expect(names).toContain(key);
    for (const [hook, config] of Object.entries(defaultConfigByHook || {})) {
      expect(runner.hooks).toContain(hook);
      for (const key of Object.keys(config)) expect(names).toContain(key);
    }
    if (outputs.fromConfig) expect(typeof outputs.fromConfig).toBe('string');
  });
});

it('a runner with a default for every hook it runs at gives a new step a working start', () => {
  const script = runners.get('script');
  for (const hook of script.hooks) expect(script.presentation.defaultConfigByHook[hook].code).toEqual(expect.any(String));
});
