'use strict';

jest.mock('../../../src/config', () => ({ security: {}, worker: {}, stages: {} }));

const { newFollowUpStage } = require('../../../src/stages/migration/plan');

const qikchat = { targetUrl: 'https://api.qikchat.in/v1/messages' };
const other = { targetUrl: 'https://hooks.acme.example/send' };

describe('a delivery follow-up set up on an integration that already runs on steps', () => {
  it('starts a recognised provider from its own script and schedule, allowed only to its own host', () => {
    const stage = newFollowUpStage(qikchat, {});
    expect(stage).toMatchObject({ id: 'deliveryStatus', hook: 'after_delivery', contract: 'legacy:follow-up', effect: 'observe' });
    expect(stage.runner.config.code).toMatch(/\S/);
    expect(stage.runner.config.allowedOrigins).toEqual(['https://api.qikchat.in']);
    expect(stage.schedule.checkAfterSeconds.length).toBeGreaterThan(0);
  });

  it('keeps what the person wrote and the schedule they chose', () => {
    const stage = newFollowUpStage(qikchat, { script: 'return { status: "READ", done: true };', checkAfterSeconds: [60, 600] });
    expect(stage.runner.config.code).toBe('return { status: "READ", done: true };');
    expect(stage.schedule.checkAfterSeconds).toEqual([60, 600]);
  });

  it('allows the hosts the script actually calls, not every host', () => {
    const script = "const r = await http.get('https://status.acme.example/v1/' + id); const s = await http.get(`https://${'x'}.nope.example`); return { status: 'PENDING' };";
    const stage = newFollowUpStage(other, { script });
    expect(stage.runner.config.allowedOrigins).toEqual(['https://status.acme.example']);
  });

  it('falls back to the integration\'s own host when the script sends its headers and names no host', () => {
    const stage = newFollowUpStage(other, { script: 'const h = context.headers; return { status: "PENDING" };' });
    expect(stage.runner.config.allowedOrigins).toEqual(['https://hooks.acme.example']);
  });

  it('refuses an empty script when there is no provider script to start from', () => {
    expect(newFollowUpStage(other, { script: '   ' })).toBeNull();
  });
});
