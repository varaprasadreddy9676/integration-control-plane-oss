/**
 * One real delivery drawn on the canvas (Executions mode): which steps it visited,
 * what each did, and which connectors it took. Built from the delivery log and its
 * stage runs; nothing is guessed: a step with no record is "not taken".
 */

import type { DeliveryLog } from '../../../mocks/types';
import type { StageRun, StageState } from '../../../services/stages-api';
import type { Flow, FlowEdge, FlowNode } from './model';

export type NodeState = '' | 'ok' | 'failed' | 'running' | 'skipped' | 'unvisited' | 'off' | 'issue' | 'edited';
export type EdgeState = 'configured' | 'taken' | 'failure' | 'retry' | 'notTaken';

export interface NodeView {
  state: NodeState;
  /** Replaces the status word (a duration, ×3, READ...). */
  meta?: string;
  summary?: string;
  eyebrow?: string;
}

export interface Trace {
  nodes: Record<string, NodeView>;
  edges: Record<string, EdgeState>;
  /** The delivery's own outcome in words, for the trace drawer. */
  outcome: { label: string; tone: 'success' | 'danger' | 'neutral' | 'warning' };
}

const MS = (value?: number | null) =>
  value === undefined || value === null
    ? undefined
    : value >= 1000
      ? `${(value / 1000).toFixed(1)} s`
      : `${Math.round(value)} ms`;
const times = (count: number) => (count > 1 ? `×${count}` : undefined);

const lastOf = <T>(items: T[]) => items[items.length - 1];

export function traceExecution(
  flow: Flow,
  group: number,
  log: DeliveryLog,
  data: { states: StageState[]; runs: StageRun[] } | undefined
): Trace {
  const nodes: Record<string, NodeView> = {};
  const edges: Record<string, EdgeState> = {};
  const runs = data?.runs || [];
  const states = data?.states || [];
  const attempts = Math.max(Number(log.attemptCount) || 1, 1);
  const status = log.status;
  const skippedDelivery = status === 'SKIPPED';
  const failed = status === 'FAILED' || status === 'ABANDONED';
  const succeeded = status === 'SUCCESS';
  const timedOut = failed && (log.responseStatus === null || log.responseStatus === undefined);
  // The provider answered and accepted: a later failure came from a step, not from the send.
  const answered = log.responseStatus !== null && log.responseStatus !== undefined && log.responseStatus < 400;
  const mine = (node: FlowNode) => node.group === group || node.kind === 'trigger';

  const runsOf = (stageId?: string) => runs.filter((run) => run.stage.id === stageId);
  // A before-send gate that broke or failed the delivery on its first attempt means nothing was sent.
  const blockedBeforeSend =
    failed &&
    attempts === 1 &&
    flow.nodes.some(
      (node) =>
        mine(node) &&
        node.hook === 'before_send' &&
        ['error', 'timeout'].includes(lastOf(runsOf(node.stageId))?.outcome || '')
    );

  const sendView = (): NodeView => {
    if (skippedDelivery || blockedBeforeSend) return { state: 'unvisited', summary: 'not reached' };
    // The provider accepted it: a later failure came from a step after the response, not from the send.
    if (answered || !failed) return status === 'RETRYING' ? { state: 'running', meta: 'Retrying' } : { state: 'ok', meta: MS(log.responseTimeMs) };
    if (timedOut) return { state: 'failed', meta: 'Timeout', eyebrow: `Send · attempt ${attempts} of ${attempts}`, summary: 'no answer in time' };
    return { state: 'failed', meta: log.responseStatus ? `HTTP ${log.responseStatus}` : 'Failed', summary: log.errorMessage };
  };

  for (const node of flow.nodes) {
    if (!mine(node)) {
      nodes[node.id] = { state: 'unvisited' };
      continue;
    }
    const stageRuns = runsOf(node.stageId);
    const latest = lastOf(stageRuns);
    switch (node.kind) {
      case 'trigger':
        nodes[node.id] = {
          state: 'ok',
          meta: log.createdAt
            ? new Date(log.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
            : undefined,
        };
        break;
      case 'transform':
        nodes[node.id] = {
          state: 'ok',
          meta: times(attempts),
          eyebrow: attempts > 1 ? `Transform · ${attempts} attempts` : undefined,
        };
        break;
      case 'send':
        nodes[node.id] = sendView();
        break;
      case 'retry':
        nodes[node.id] =
          status === 'ABANDONED'
            ? { state: 'failed', meta: 'Exhausted', summary: `retried ${Math.max(attempts - 1, 0)}× · then gave up` }
            : attempts > 1
              ? { state: 'ok', meta: times(attempts), summary: `retried ${attempts - 1}×` }
              : { state: 'unvisited', summary: 'not needed' };
        break;
      case 'done':
        nodes[node.id] = succeeded ? { state: 'ok', meta: 'Delivered' } : { state: 'unvisited' };
        break;
      case 'skipped':
        nodes[node.id] = skippedDelivery
          ? { state: 'skipped', meta: 'Skipped', summary: log.errorMessage || 'not sent, not an error' }
          : { state: 'unvisited' };
        break;
      case 'failedEnd':
        nodes[node.id] = failed
          ? {
              state: 'failed',
              meta: status === 'ABANDONED' ? 'Abandoned' : 'Failed',
              summary: status === 'ABANDONED' ? `ABANDONED after ${attempts} attempts` : log.errorMessage,
            }
          : { state: 'unvisited' };
        break;
      default: {
        if (!latest) {
          nodes[node.id] = {
            state: 'unvisited',
            summary:
              node.hook === 'after_response' && timedOut
                ? 'not reached: no answer'
                : node.hook === 'after_delivery' && succeeded
                  ? 'scheduled, not run yet'
                  : 'not reached',
          };
        } else if (latest.outcome === 'skipped')
          nodes[node.id] = { state: 'skipped', meta: 'Skipped', summary: latest.reason || undefined };
        else if (latest.outcome === 'error' || latest.outcome === 'timeout') {
          nodes[node.id] = {
            state: 'failed',
            meta: latest.outcome === 'timeout' ? 'Timeout' : 'Failed',
            summary: latest.error,
          };
        } else {
          const state = states.find((candidate) => candidate.stageId === node.stageId);
          nodes[node.id] = {
            state: 'ok',
            meta:
              (node.hook === 'after_delivery' ? state?.status : undefined) ||
              times(stageRuns.length) ||
              MS(latest.durationMs),
          };
        }
      }
    }
  }

  const visited = (id: string) => nodes[id] && nodes[id].state !== 'unvisited';
  const failedNode = (id: string) => nodes[id]?.state === 'failed';
  const edgeState = (edge: FlowEdge): EdgeState => {
    if (!visited(edge.from) || !visited(edge.to)) return 'notTaken';
    switch (edge.kind) {
      case 'skip':
        return nodes[edge.from].state === 'skipped' || skippedDelivery ? 'taken' : 'notTaken';
      case 'fail':
      case 'send-refused':
        return failedNode(edge.from) && !(edge.kind === 'send-refused' && attempts > 1) ? 'failure' : 'notTaken';
      case 'send-error':
        return failedNode(edge.from) && attempts > 1 ? 'failure' : 'notTaken';
      case 'retry-loop':
        return attempts > 1 ? 'retry' : 'notTaken';
      case 'exhausted':
        return status === 'ABANDONED' ? 'failure' : 'notTaken';
      case 'retry-request':
        return 'notTaken';
      default:
        return failedNode(edge.from) && edge.to.endsWith('-failed')
          ? 'failure'
          : nodes[edge.from].state === 'skipped'
            ? 'notTaken'
            : 'taken';
    }
  };
  for (const edge of flow.edges)
    edges[edge.id] = edge.group === group || edge.kind === 'fan-out' ? edgeState(edge) : 'notTaken';

  const outcome = skippedDelivery
    ? { label: 'Skipped', tone: 'neutral' as const }
    : status === 'ABANDONED'
      ? { label: `Abandoned · ${attempts} attempts`, tone: 'danger' as const }
      : failed
        ? { label: 'Failed', tone: 'danger' as const }
        : status === 'RETRYING'
          ? { label: `Retrying · attempt ${attempts}`, tone: 'warning' as const }
          : succeeded
            ? { label: 'Delivered', tone: 'success' as const }
            : { label: String(status || 'Pending'), tone: 'neutral' as const };
  return { nodes, edges, outcome };
}
