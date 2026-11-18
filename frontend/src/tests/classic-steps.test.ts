import { describe, expect, it } from 'vitest';
import { applyClassicToSteps, classicFromSteps } from '../features/integrations/routes/integrationDetail/utils/classicSteps';
import type { StageConfig } from '../services/stages-api';

const responseStep: StageConfig = {
  id: 'responseCheck',
  name: 'Response check',
  hook: 'after_response',
  effect: 'gate',
  contract: 'legacy:response-transform',
  runner: { type: 'script', config: { code: 'return payload;' } },
  migratedFrom: 'responseTransformation',
} as StageConfig;
const followUpStep: StageConfig = {
  id: 'deliveryStatus',
  name: 'Delivery status check',
  hook: 'after_delivery',
  effect: 'observe',
  contract: 'legacy:follow-up',
  runner: { type: 'script', config: { code: 'return { status: "READ" };', allowedOrigins: ['https://api.example.com'] } },
  schedule: { checkAfterSeconds: [30, 300] },
} as StageConfig;
const other = { id: 'consent', name: 'Consent', hook: 'before_send', runner: { type: 'script', config: { code: 'return null;' } } } as StageConfig;

describe('the classic tabs over a switched integration\'s steps', () => {
  it('reads each tab from its step', () => {
    expect(classicFromSteps([other, responseStep, followUpStep])).toEqual({
      response: { exists: true, on: true, script: 'return payload;' },
      followUp: { exists: true, on: true, script: 'return { status: "READ" };', checkAfterSeconds: [30, 300] },
    });
    expect(classicFromSteps([other]).response).toEqual({ exists: false, on: false, script: '' });
    expect(classicFromSteps([{ ...responseStep, enabled: false }]).response.on).toBe(false);
  });

  it('leaves every step exactly as it was when nothing changed in the tabs', () => {
    const stages = [other, responseStep, followUpStep];
    const before = classicFromSteps(stages);
    const after = applyClassicToSteps(stages, before, before);
    expect(after).toEqual(stages);
    after.forEach((stage, index) => expect(stage).toBe(stages[index]));
  });

  it('writes an edited response script into its step and nothing else', () => {
    const stages = [responseStep, followUpStep];
    const before = classicFromSteps(stages);
    const [response, followUp] = applyClassicToSteps(stages, { ...before, response: { ...before.response, script: 'return skip("no");' } }, before);
    expect(response.runner.config).toEqual({ code: 'return skip("no");' });
    expect(response.contract).toBe('legacy:response-transform');
    expect(followUp).toBe(stages[1]);
  });

  it('turns a response check off by switching its step off, keeping the script', () => {
    const stages = [responseStep];
    const before = classicFromSteps(stages);
    const [response] = applyClassicToSteps(stages, { ...before, response: { ...before.response, on: false } }, before);
    expect(response.enabled).toBe(false);
    expect(response.runner.config.code).toBe('return payload;');
  });

  it('adds a response check step when switched on and there is none', () => {
    const before = classicFromSteps([other]);
    const result = applyClassicToSteps([other], { ...before, response: { exists: false, on: true, script: 'return payload;' } }, before);
    expect(result).toHaveLength(2);
    expect(result[1]).toMatchObject({ id: 'responseCheck', hook: 'after_response', effect: 'gate', contract: 'legacy:response-transform', runner: { type: 'script', config: { code: 'return payload;' } } });
  });

  it('edits the follow-up step\'s script, schedule and on/off, keeping its allowed origins', () => {
    const stages = [followUpStep];
    const before = classicFromSteps(stages);
    const [step] = applyClassicToSteps(stages, { ...before, followUp: { ...before.followUp, script: 'return { status: "DELIVERED" };', checkAfterSeconds: [60], on: false } }, before);
    expect(step.runner.config).toEqual({ code: 'return { status: "DELIVERED" };', allowedOrigins: ['https://api.example.com'] });
    expect(step.schedule).toEqual({ checkAfterSeconds: [60] });
    expect(step.enabled).toBe(false);
  });

  it('adds the follow-up step the server built when the tab switches a follow-up on and there is none', () => {
    const before = classicFromSteps([other]);
    const built = { ...followUpStep, id: 'deliveryStatus' } as StageConfig;
    const now = { ...before, followUp: { exists: false, on: true, script: 'x', checkAfterSeconds: [30] } };
    expect(applyClassicToSteps([other], now, before, built)).toEqual([other, built]);
    // ...but not when it was not switched on, or one exists already
    expect(applyClassicToSteps([other], before, before, built)).toEqual([other]);
    const hasOne = classicFromSteps([followUpStep]);
    expect(applyClassicToSteps([followUpStep], { ...hasOne, followUp: { ...hasOne.followUp, script: 'y' } }, hasOne, built)).toHaveLength(1);
  });
});
