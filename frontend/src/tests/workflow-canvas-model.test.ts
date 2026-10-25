import { describe, expect, it } from 'vitest';
import type { StageConfig, StageOutcomes } from '../services/stages-api';
import { deliveriesOf } from '../features/stages/deliveryTargets';
import { ROW_TOP, buildFlow, insertStage, pathOf } from '../features/stages/canvas/model';

const script = (id: string, hook: StageConfig['hook'], extra: Partial<StageConfig> = {}): StageConfig => ({
  id,
  name: id,
  hook,
  runner: { type: 'script', config: { code: 'return null;' } },
  ...extra,
});
const known = (outcomes: Partial<StageOutcomes>): StageOutcomes => ({ known: true, statuses: [], skips: [], fails: [], dynamicStatus: false, ...outcomes });

const flowOf = (stages: StageConfig[], outcomes: Record<string, StageOutcomes> = {}, extra: Record<string, unknown> = {}) => {
  const owner = { targetUrl: 'https://api.example.com/v1', httpMethod: 'POST', stages };
  return buildFlow({ deliveries: [{ target: deliveriesOf({})[0], owner, stages }], eventType: 'APPOINTMENT_CONFIRMED', retryCount: 3, outcomes, ...extra });
};
const node = (flow: ReturnType<typeof buildFlow>, id: string) => flow.nodes.find((candidate) => candidate.id.endsWith(id))!;
const edges = (flow: ReturnType<typeof buildFlow>, kind: string) => flow.edges.filter((edge) => edge.kind === kind);

describe('the standard flow', () => {
  const gate = script('consent', 'before_send', { effect: 'gate' });
  const reply = script('reply', 'after_response', { effect: 'gate' });
  const check = script('status', 'after_delivery', { schedule: { checkAfterSeconds: [30, 300] } });
  const notify = script('notify', 'on_failure');
  const outcomes = {
    consent: known({ skips: [{ reason: 'no consent' }], fails: [] }),
    reply: known({ fails: [{ reason: 'rejected', retryDelivery: false, retryStage: false }] }),
  };
  const flow = flowOf([gate, reply, check, notify], outcomes);

  it('puts the main column in pipeline order on the spec\'s rows, and On failure beside the later rows', () => {
    const rows = Object.fromEntries(flow.nodes.map((n) => [n.id.replace(/^g0-/, ''), [n.col, n.row]]));
    expect(rows).toMatchObject({
      trigger: ['main', 0],
      transform: ['main', 1],
      'stage-consent': ['main', 2],
      send: ['main', 3],
      'stage-reply': ['main', 4],
      'stage-status': ['main', 5],
      delivered: ['main', 6],
      retry: ['right', 3],
      'stage-notify': ['right', 5],
      failed: ['right', 6],
      skipped: ['right', 2],
    });
    expect(node(flow, 'send')).toMatchObject({ x: 200, y: ROW_TOP(3) });
    expect(node(flow, 'retry')).toMatchObject({ x: 560 });
  });

  it('draws the standard geometry: vertical connectors at x 328, the skip branch, the retry loop to the top of the attempt', () => {
    const next = flow.edges.find((edge) => edge.from === 'g0-transform' && edge.to === 'g0-stage-consent')!;
    expect(next.points).toEqual([[328, 236], [328, 280]]);
    expect(edges(flow, 'skip')[0].points[0]).toEqual([456, 318]);
    const loop = edges(flow, 'retry-loop')[0];
    expect(loop.dashed).toBe(true);
    expect(loop.to).toBe('g0-transform');
    expect(loop.points).toEqual([[816, 438], [876, 438], [876, 198], [457, 198]]);
  });

  it('labels only branches that exist, with the facts they take their counts from', () => {
    const byText = (text: string) => flow.labels.find((label) => label.text === text);
    expect(byText('Yes')?.fact).toEqual({ type: 'stage', stageId: 'consent', field: 'ok' });
    expect(byText('No')?.fact).toEqual({ type: 'stage', stageId: 'consent', field: 'skipped' });
    expect(byText('Answered')).toBeTruthy();
    expect(byText('Accepted')?.fact).toEqual({ type: 'stage', stageId: 'reply', field: 'ok' });
    expect(byText('Rejected')?.fact).toEqual({ type: 'stage', stageId: 'reply', field: 'rejected' });
    expect(byText('Read or delivered')?.fact).toEqual({ type: 'later', stageId: 'status' });
    expect(byText('Exhausted')?.fact).toEqual({ type: 'abandoned' });
    expect(flow.labels.filter((label) => label.fact?.type === 'retries').map((label) => label.text)).toEqual(['Error', 'Retry · new attempt']);
  });

  it('sends rejected answers and exhausted retries to the first On failure step', () => {
    const rejected = edges(flow, 'fail').find((edge) => edge.from === 'g0-stage-reply')!;
    expect(rejected.to).toBe('g0-stage-notify');
    expect(edges(flow, 'exhausted')[0].to).toBe('g0-stage-notify');
    expect(flow.edges.find((edge) => edge.from === 'g0-stage-notify')!.to).toBe('g0-failed');
  });

  it('a gate that cannot skip has no No branch; a gate that cannot fail has no failure branch', () => {
    const noSkip = flowOf([gate], { consent: known({ fails: [{ reason: null, retryDelivery: false, retryStage: false }] }) });
    expect(edges(noSkip, 'skip')).toHaveLength(0);
    expect(node(noSkip, 'delivered')).toBeTruthy();
    expect(noSkip.nodes.some((n) => n.kind === 'skipped')).toBe(false);
    const canNeither = flowOf([{ ...gate, onError: { action: 'ignore' } }], { consent: known({ skips: [{ reason: null }] }) });
    expect(edges(canNeither, 'fail').filter((edge) => edge.from.includes('consent'))).toHaveLength(0);
    expect(canNeither.labels.find((label) => label.text === 'Yes')).toBeTruthy();
  });

  it('a stage that only records has no branches at all', () => {
    const recorder = flowOf([script('log', 'after_response', { effect: 'observe' })]);
    expect(recorder.labels.map((label) => label.text)).not.toContain('Accepted');
    expect(edges(recorder, 'fail')).toHaveLength(0);
  });

  it('unknown outcomes are assumed possible', () => {
    const unknown = flowOf([gate]);
    expect(edges(unknown, 'skip')).toHaveLength(1);
    expect(edges(unknown, 'fail').some((edge) => edge.from.includes('consent'))).toBe(true);
  });

  it('a send always has its error and refusal branches, and the retry policy says how many attempts', () => {
    const plain = flowOf([]);
    expect(edges(plain, 'send-error')).toHaveLength(1);
    expect(edges(plain, 'send-refused')).toHaveLength(1);
    expect(edges(plain, 'send-refused')[0].to).toBe('g0-failed');
    expect(node(plain, 'retry').title).toBe('Retry up to 3 attempts');
    expect(node(flowOf([], {}, { retryCount: 5 }), 'retry').title).toBe('Retry up to 5 attempts');
  });

  it('a gate that may ask for the delivery to be retried gets that branch', () => {
    const asker = { ...gate, allowDeliveryRetry: true };
    const flowWith = flowOf([asker], { consent: known({ skips: [], fails: [{ reason: null, retryDelivery: true, retryStage: false }] }) });
    expect(edges(flowWith, 'retry-request')).toHaveLength(1);
    expect(edges(flowOf([gate], { consent: known({ fails: [{ reason: null, retryDelivery: true, retryStage: false }] }) }), 'retry-request')).toHaveLength(0);
  });

  it('compact nodes attach connectors to their smaller boxes', () => {
    const small = flowOf([], {}, { compact: true });
    const edge = small.edges.find((candidate) => candidate.from === 'g0-transform' && candidate.to === 'g0-send')!;
    expect(edge.points).toEqual([[328, 220], [328, 296]]);
  });

  it('is exactly as tall as its deepest row', () => {
    expect(flowOf([]).height).toBeGreaterThan(ROW_TOP(4));
  });
});

describe('insertion points', () => {
  it('offers a point between steps of every hook, and only there', () => {
    const flow = flowOf([script('a', 'before_send', { effect: 'gate' }), script('b', 'before_send'), script('n', 'on_failure')]);
    const at = (hook: string) => flow.insertions.filter((point) => point.hook === hook).map((point) => point.position);
    expect(at('before_send')).toEqual([0, 1, 2]);
    expect(at('after_response')).toEqual([0]);
    expect(at('after_delivery')).toEqual([0]);
    expect(at('on_failure')).toEqual([1]);
    const bare = flowOf([]);
    expect(bare.insertions.filter((point) => point.hook === 'on_failure').map((point) => point.position)).toEqual([0]);
  });

  it('inserts a stage among the stages of its hook without moving the others', () => {
    const list = [script('a', 'before_send'), script('x', 'after_response'), script('b', 'before_send')];
    const added = script('new', 'before_send');
    expect(insertStage(list, added, 'before_send', 1).map((stage) => stage.id)).toEqual(['a', 'x', 'new', 'b']);
    expect(insertStage(list, added, 'before_send', 2).map((stage) => stage.id)).toEqual(['a', 'x', 'b', 'new']);
    expect(insertStage(list, added, 'before_send', 0).map((stage) => stage.id)).toEqual(['new', 'a', 'x', 'b']);
    expect(insertStage(list, script('l', 'after_delivery'), 'after_delivery', 0).map((stage) => stage.id)).toEqual(['a', 'x', 'b', 'l']);
    expect(list).toHaveLength(3);
  });
});

describe('actions', () => {
  it('draws one group per action side by side, under one trigger', () => {
    const actions = [
      { name: 'Message', kind: 'HTTP', stages: [script('a', 'before_send')] },
      { name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL' }, stages: [] },
    ];
    const targets = deliveriesOf({ actions });
    const flow = buildFlow({
      deliveries: targets.map((target, index) => ({ target, owner: actions[index], stages: actions[index].stages as StageConfig[] })),
      outcomes: {},
    });
    expect(flow.groups.map((group) => group.title)).toEqual(['Message · HTTP', 'Mail · Email']);
    expect(flow.nodes.filter((n) => n.kind === 'trigger')).toHaveLength(1);
    expect(flow.nodes.find((n) => n.id === 'g1-send')!.x).toBe(1200);
    expect(flow.edges.filter((edge) => edge.kind === 'fan-out')).toHaveLength(2);
    expect(flow.width).toBeGreaterThan(1900);
    expect(flow.nodes.find((n) => n.id === 'g1-send')!.title).toBe('Send Mail');
  });
});

describe('connector paths', () => {
  it('stops 3 px short of the tip so the arrowhead sits on it', () => {
    expect(pathOf([[328, 0], [328, 40]])).toBe('M 328 0 L 328 37');
    expect(pathOf([[0, 0], [10, 0], [10, 50]])).toBe('M 0 0 L 10 0 L 10 47');
  });
});
