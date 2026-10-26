import { describe, expect, it } from 'vitest';
import type { DeliveryLog } from '../mocks/types';
import type { StageConfig, StageOutcomes, StageRun } from '../services/stages-api';
import { deliveriesOf } from '../features/stages/deliveryTargets';
import { RUNNER_MAP } from './fixtures/stage-runners';
import { buildFlow } from '../features/stages/canvas/model';
import { traceExecution } from '../features/stages/canvas/execution';

const script = (id: string, hook: StageConfig['hook'], extra: Partial<StageConfig> = {}): StageConfig => ({ id, name: id, hook, runner: { type: 'script', config: { code: 'return null;' } }, ...extra });
const stages = [
  script('consent', 'before_send', { effect: 'gate' }),
  script('reply', 'after_response', { effect: 'gate' }),
  script('status', 'after_delivery', { schedule: { checkAfterSeconds: [30] } }),
  script('notify', 'on_failure'),
];
const flow = buildFlow({ deliveries: [{ target: deliveriesOf({})[0], owner: {}, stages }], retryCount: 3, runners: RUNNER_MAP });
const log = (extra: Partial<DeliveryLog>) => ({ id: 'l1', status: 'SUCCESS', attemptCount: 1, responseStatus: 200, responseTimeMs: 212, createdAt: '2026-10-25T08:00:00Z', ...extra }) as DeliveryLog;
const run = (id: string, outcome: StageRun['outcome'], extra: Partial<StageRun> = {}) =>
  ({ runId: `r-${id}`, stage: { id, name: id, hook: 'before_send' }, seq: 1, executionAttempt: 1, at: '', durationMs: 5, outcome, status: null, done: false, calls: [], logs: [], ...extra }) as StageRun;
const state = (trace: ReturnType<typeof traceExecution>, id: string) => trace.nodes[`g0-${id}`];
const edge = (trace: ReturnType<typeof traceExecution>, kind: string) => flow.edges.filter((candidate) => candidate.kind === kind).map((candidate) => trace.edges[candidate.id]);

describe('one delivery drawn over the flow', () => {
  it('a delivered message takes the main path; the alternatives are not taken', () => {
    const trace = traceExecution(flow, 0, log({}), { states: [{ stageId: 'status', status: 'READ', done: true, stageName: 'status', hook: 'after_delivery', outcome: 'ok', seq: 2, runs: 2 }], runs: [run('consent', 'ok'), run('reply', 'ok'), run('status', 'ok', { stage: { id: 'status', name: 'status', hook: 'after_delivery', runner: 'script' }, status: 'READ' })] });
    expect(state(trace, 'send')).toMatchObject({ state: 'ok', meta: '212 ms' });
    expect(state(trace, 'stage-status')).toMatchObject({ state: 'ok', meta: 'READ' });
    expect(state(trace, 'delivered').state).toBe('ok');
    for (const id of ['skipped', 'retry', 'failed', 'stage-notify']) expect(state(trace, id).state).toBe('unvisited');
    expect(edge(trace, 'retry-loop')).toEqual(['notTaken']);
    expect(edge(trace, 'exhausted')).toEqual(['notTaken']);
    expect(trace.outcome).toEqual({ label: 'Delivered', tone: 'success' });
  });

  it('a timeout on every attempt: the send failed, the retries ran out, the failure step ran', () => {
    const trace = traceExecution(flow, 0, log({ status: 'ABANDONED', attemptCount: 3, responseStatus: null, responseTimeMs: 10000 }), {
      states: [],
      runs: [run('consent', 'ok'), run('consent', 'ok'), run('consent', 'ok'), run('notify', 'ok', { stage: { id: 'notify', name: 'notify', hook: 'on_failure', runner: 'script' } })],
    });
    expect(state(trace, 'transform')).toMatchObject({ state: 'ok', meta: '×3' });
    expect(state(trace, 'send')).toMatchObject({ state: 'failed', meta: 'Timeout' });
    expect(state(trace, 'retry')).toMatchObject({ state: 'failed', meta: 'Exhausted' });
    expect(state(trace, 'stage-reply')).toMatchObject({ state: 'unvisited', summary: 'not reached: no answer' });
    expect(state(trace, 'failed')).toMatchObject({ state: 'failed', meta: 'Abandoned' });
    expect(edge(trace, 'retry-loop')).toEqual(['retry']);
    expect(edge(trace, 'exhausted')).toEqual(['failure']);
    expect(trace.outcome.label).toBe('Abandoned · 3 attempts');
  });

  it('an accepted send that a step rejected: the send is fine, the step failed, the failure branch is taken', () => {
    const trace = traceExecution(flow, 0, log({ status: 'FAILED', errorMessage: 'Invalid phone number' }), {
      states: [],
      runs: [run('consent', 'ok'), run('reply', 'error', { stage: { id: 'reply', name: 'reply', hook: 'after_response', runner: 'script' }, error: 'Invalid phone number' }), run('notify', 'ok', { stage: { id: 'notify', name: 'notify', hook: 'on_failure', runner: 'script' } })],
    });
    expect(state(trace, 'send').state).toBe('ok');
    expect(state(trace, 'stage-reply')).toMatchObject({ state: 'failed', summary: 'Invalid phone number' });
    expect(edge(trace, 'fail').filter((s) => s === 'failure')).toHaveLength(1);
    expect(edge(trace, 'exhausted')).toEqual(['notTaken']);
  });

  it('a skipped delivery visits Skipped, never the send, and the skip branch is the one taken', () => {
    const trace = traceExecution(flow, 0, log({ status: 'SKIPPED', responseStatus: null }), { states: [], runs: [run('consent', 'skipped', { reason: 'no consent' })] });
    expect(state(trace, 'skipped').state).toBe('skipped');
    expect(state(trace, 'send')).toMatchObject({ state: 'unvisited' });
    expect(state(trace, 'failed').state).toBe('unvisited');
    expect(edge(trace, 'skip')).toEqual(['taken']);
    expect(trace.outcome.tone).toBe('neutral');
  });

  it('a delivery of another action leaves this action\'s group not taken', () => {
    const trace = traceExecution(flow, 1, log({}), { states: [], runs: [] });
    expect(state(trace, 'send').state).toBe('unvisited');
  });
});
