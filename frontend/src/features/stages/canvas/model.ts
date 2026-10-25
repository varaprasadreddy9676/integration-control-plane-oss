/**
 * The workflow canvas, as data. The canvas is a projection of a delivery's pipeline
 * (docs/design/workflow-canvas/README.md): nothing is stored, nothing is dragged.
 * `buildFlow` turns the stages of each delivery into nodes, connectors, connector
 * labels, band labels and insertion points, in the fixed coordinates of the design
 * (sections 7 and 11.3). Rendering, counts and run state are applied elsewhere.
 *
 * Every branch drawn can happen in the engine, and every branch that can happen is
 * drawn (spec 2.3): a gate gets a `No` branch only if it can skip, a failure branch
 * only if it can fail, and so on. A stage whose outcomes are unknown is assumed to
 * be able to do both.
 */

import type { StageConfig, StageHook, StageOutcomes } from '../../../services/stages-api';
import type { DeliveryTarget } from '../deliveryTargets';
import { protocolLabel } from '../deliveryTargets';

export type NodeKind =
  | 'trigger'
  | 'transform'
  | 'http'
  | 'script'
  | 'gate'
  | 'send'
  | 'retry'
  | 'schedule'
  | 'notify'
  | 'done'
  | 'skipped'
  | 'failedEnd';

export type Point = [number, number];

export interface FlowNode {
  id: string;
  kind: NodeKind;
  eyebrow: string;
  title: string;
  summary: string;
  group: number;
  col: 'main' | 'right';
  row: number;
  stageId?: string;
  hook?: StageHook;
  /** Index of the stage in its delivery's `stages` list. */
  stageIndex?: number;
  /** Top-left of the full-size node, in host coordinates. */
  x: number;
  y: number;
}

export type BranchKind =
  | 'next'
  | 'yes'
  | 'skip'
  | 'fail'
  | 'answered'
  | 'accepted'
  | 'delivered'
  | 'send-error'
  | 'send-refused'
  | 'retry-loop'
  | 'exhausted'
  | 'retry-request'
  | 'fan-out';

export interface FlowEdge {
  id: string;
  from: string;
  to: string;
  kind: BranchKind;
  points: Point[];
  dashed?: boolean;
  group: number;
}

export interface FlowLabel {
  id: string;
  edgeId: string;
  text: string;
  /** Where the label's count comes from (see label table in the spec, 11.2). */
  fact?: LabelFact;
  variant: 'success' | 'neutral' | 'warning' | 'danger' | 'plain';
  x: number;
  y: number;
}

export type LabelFact =
  | { type: 'stage'; stageId: string; field: 'ok' | 'skipped' | 'rejected' }
  | { type: 'retries' }
  | { type: 'abandoned' }
  | { type: 'later'; stageId: string };

export interface InsertionPoint {
  id: string;
  group: number;
  hook: StageHook;
  /** Position within the delivery's stages of that hook. */
  position: number;
  x: number;
  y: number;
  label: string;
}

export interface Band {
  id: string;
  text: string;
  x: number;
  y: number;
  width?: number;
}

export interface FlowGroup {
  index: number;
  target: DeliveryTarget;
  title: string | null;
  titlePos: Point;
  nodeIds: string[];
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
  labels: FlowLabel[];
  bands: Band[];
  brackets: Array<{ x: number; y: number; height: number }>;
  insertions: InsertionPoint[];
  groups: FlowGroup[];
  width: number;
  height: number;
  compact: boolean;
}

export interface DeliveryInput {
  target: DeliveryTarget;
  /** The action, or the integration itself when it sends once. */
  owner: Record<string, any>;
  stages: StageConfig[];
}

export interface FlowInput {
  deliveries: DeliveryInput[];
  eventType?: string | null;
  retryCount?: number | null;
  runnerLabels?: Record<string, string>;
  /** What each stage can end with (by stage id); a missing entry means unknown. */
  outcomes?: Record<string, StageOutcomes | undefined>;
  compact?: boolean;
}

// ── Geometry (spec section 7.1)
export const ROW_TOP = (row: number) => 40 + row * 120;
const NODE_HEIGHT = 76;
const MAIN_X = 200;
const RIGHT_X = 560;
const NODE_WIDTH = 256;
const RETRY_STRIP_X = 876;
const FAIL_BUS_X = 546;
const RETRY_REQUEST_X = 534;
const SKIP_LANE_X = 514;
export const GROUP_PITCH = 1000;
const HOST_WIDTH = 920;

const NODE_PLACE = { main: MAIN_X, right: RIGHT_X } as const;

/** The box a node occupies for connector maths: compact nodes are 208 x 44, centred in the full cell. */
export const boxOf = (node: Pick<FlowNode, 'x' | 'y'>, compact: boolean) =>
  compact
    ? { x: node.x + 24, y: node.y + 16, width: 208, height: 44 }
    : { x: node.x, y: node.y, width: NODE_WIDTH, height: NODE_HEIGHT };

const topOf = (node: FlowNode, compact: boolean, dx = 0): Point => {
  const box = boxOf(node, compact);
  return [box.x + box.width / 2 + dx, box.y];
};
const bottomOf = (node: FlowNode, compact: boolean, dx = 0): Point => {
  const box = boxOf(node, compact);
  return [box.x + box.width / 2 + dx, box.y + box.height];
};
const rightOf = (node: FlowNode, compact: boolean, dy = 0): Point => {
  const box = boxOf(node, compact);
  return [box.x + box.width, box.y + box.height / 2 + dy];
};
const leftOf = (node: FlowNode, compact: boolean, dy = 0): Point => {
  const box = boxOf(node, compact);
  return [box.x, box.y + box.height / 2 + dy];
};

// ── What a stage is called on the canvas
const WHERE: Record<StageHook, string> = {
  before_send: 'before send',
  after_response: 'after the response',
  after_delivery: 'later',
  on_failure: 'on failure',
};

const isInline = (hook: StageHook) => hook === 'before_send' || hook === 'after_response';
const effectOf = (stage: StageConfig) => stage.effect || (isInline(stage.hook) ? 'gate' : 'observe');
const isGate = (stage: StageConfig) => isInline(stage.hook) && effectOf(stage) === 'gate';

const kindOf = (stage: StageConfig): NodeKind => {
  if (stage.hook === 'on_failure') return 'notify';
  if (stage.hook === 'after_delivery') return 'schedule';
  if (isGate(stage)) return 'gate';
  return stage.runner.type === 'http' || stage.runner.type === 'url-check' ? 'http' : 'script';
};

/** A gate can skip only before the send, and only if its script says so (unknown: assume it can). */
export const canSkip = (stage: StageConfig, outcomes?: StageOutcomes) =>
  isGate(stage) &&
  stage.hook === 'before_send' &&
  (outcomes?.known ? outcomes.skips.length > 0 : stage.runner.type === 'script' && !outcomes);

/** A gate fails the delivery by `fail()`, or when it breaks and is set to fail closed. */
export const canFail = (stage: StageConfig, outcomes?: StageOutcomes) => {
  if (!isGate(stage)) return false;
  const failsClosed = (stage.onError?.action ?? 'fail_stage') === 'fail_stage';
  return outcomes?.known ? outcomes.fails.length > 0 || failsClosed : true;
};

/** `fail(..., { retryDelivery: true })` from a gate that is allowed to ask for a retry. */
export const canAskRetry = (stage: StageConfig, outcomes?: StageOutcomes) =>
  Boolean(stage.allowDeliveryRetry) && (outcomes?.known ? outcomes.fails.some((fail) => fail.retryDelivery) : false);

const hostOf = (url: unknown) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url || '');
  }
};

const stageSummary = (stage: StageConfig): string => {
  const config = stage.runner.config || {};
  if (stage.runner.type === 'http') return `${config.method || 'GET'} ${hostOf(config.url) || 'request'}`;
  if (stage.runner.type === 'url-check')
    return `${(config.checks || []).length} linked URL${(config.checks || []).length === 1 ? '' : 's'}`;
  if (stage.runner.type === 'script') {
    const lines = String(config.code || '')
      .split('\n')
      .filter((line) => line.trim() && !line.trim().startsWith('//')).length;
    return `${lines} line${lines === 1 ? '' : 's'} of script`;
  }
  return stage.runner.type;
};

const sendSummary = (delivery: DeliveryInput): string => {
  const owner = delivery.owner;
  const protocol = delivery.target.protocol;
  if (protocol === 'http') return `${owner.httpMethod || 'POST'} ${hostOf(owner.targetUrl) || 'target'}`;
  if (protocol === 'hl7') return `${owner.hl7Config?.host || 'host'}:${owner.hl7Config?.port || ''}`;
  return [owner.communicationConfig?.channel, owner.communicationConfig?.provider]
    .filter(Boolean)
    .join(' · ')
    .toLowerCase();
};

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;

// ── Building one delivery's column
interface Built {
  nodes: FlowNode[];
  edges: FlowEdge[];
  labels: FlowLabel[];
  bands: Band[];
  brackets: Flow['brackets'];
  insertions: InsertionPoint[];
  firstNode: FlowNode;
  title: string | null;
}

function buildDelivery(delivery: DeliveryInput, group: number, input: FlowInput, compact: boolean): Built {
  const dx = group * GROUP_PITCH;
  const labelOf = (type: string) => (input.runnerLabels || {})[type] || type;
  const outcomesOf = (stage: StageConfig) => (input.outcomes || {})[stage.id];
  const stages = delivery.stages.map((stage, stageIndex) => ({ stage, stageIndex }));
  const at = (hook: StageHook) => stages.filter(({ stage }) => stage.hook === hook);
  const before = at('before_send');
  const after = at('after_response');
  const later = at('after_delivery');
  const onFailure = at('on_failure');

  const sendRow = 2 + before.length;
  const lastMain = sendRow + after.length + later.length;
  const onFailureStart = after.length > 0 ? sendRow + after.length + 1 : sendRow + 2;
  const outcomeRow = Math.max(lastMain + 1, onFailureStart + onFailure.length);

  const nodes: FlowNode[] = [];
  const make = (partial: Omit<FlowNode, 'x' | 'y' | 'group' | 'id'> & { id: string }) => {
    const node: FlowNode = { ...partial, group, x: NODE_PLACE[partial.col] + dx, y: ROW_TOP(partial.row) };
    nodes.push(node);
    return node;
  };
  const stageNode = ({ stage, stageIndex }: (typeof stages)[number], row: number, col: 'main' | 'right') =>
    make({
      id: `g${group}-stage-${stage.id}`,
      kind: kindOf(stage),
      eyebrow: `${isGate(stage) ? 'Gate' : labelOf(stage.runner.type)} · ${WHERE[stage.hook]}`,
      title: stage.name,
      summary: stage.schedule ? scheduleWords(stage) : stageSummary(stage),
      col,
      row,
      stageId: stage.id,
      hook: stage.hook,
      stageIndex,
    });

  const transform = make({
    id: `g${group}-transform`,
    kind: 'transform',
    eyebrow: 'Transform · prepare',
    title: 'Build the request',
    summary: 'event to message',
    col: 'main',
    row: 1,
  });
  const beforeNodes = before.map((entry, i) => stageNode(entry, 2 + i, 'main'));
  const send = make({
    id: `g${group}-send`,
    kind: 'send',
    eyebrow: `Send · ${protocolLabel(delivery.target.protocol)}`,
    title: delivery.target.label
      ? `Send ${delivery.target.label}`
      : `Send ${protocolLabel(delivery.target.protocol)} message`,
    summary: sendSummary(delivery),
    col: 'main',
    row: sendRow,
  });
  const afterNodes = after.map((entry, i) => stageNode(entry, sendRow + 1 + i, 'main'));
  const laterNodes = later.map((entry, i) => stageNode(entry, sendRow + 1 + after.length + i, 'main'));
  const retries = Number(input.retryCount) > 0 ? Number(input.retryCount) : 3;
  const retry = make({
    id: `g${group}-retry`,
    kind: 'retry',
    eyebrow: 'Retry policy',
    title: `Retry up to ${plural(retries, 'attempt')}`,
    summary: 'then: on failure',
    col: 'right',
    row: sendRow,
  });
  const failureNodes = onFailure.map((entry, i) => stageNode(entry, onFailureStart + i, 'right'));
  const delivered = make({
    id: `g${group}-delivered`,
    kind: 'done',
    eyebrow: 'Outcome',
    title: 'Delivered',
    summary: '',
    col: 'main',
    row: outcomeRow,
  });
  const failedEnd = make({
    id: `g${group}-failed`,
    kind: 'failedEnd',
    eyebrow: 'Outcome',
    title: 'Delivery failed',
    summary: '',
    col: 'right',
    row: outcomeRow,
  });

  const stageOf = (node: FlowNode): StageConfig | undefined =>
    node.stageIndex === undefined ? undefined : delivery.stages[node.stageIndex];
  const skippers = beforeNodes.filter((node) =>
    canSkip(stageOf(node) as StageConfig, outcomesOf(stageOf(node) as StageConfig))
  );
  const skipped = skippers.length
    ? make({
        id: `g${group}-skipped`,
        kind: 'skipped',
        eyebrow: 'Outcome',
        title: 'Skipped',
        summary: 'not sent, not an error',
        col: 'right',
        row: skippers[0].row,
      })
    : null;

  const edges: FlowEdge[] = [];
  const labels: FlowLabel[] = [];
  const edge = (kind: BranchKind, from: FlowNode, to: FlowNode, points: Point[], dashed = false) => {
    const created: FlowEdge = {
      id: `${from.id}>${to.id}:${kind}`,
      from: from.id,
      to: to.id,
      kind,
      points,
      dashed,
      group,
    };
    edges.push(created);
    return created;
  };
  const label = (
    created: FlowEdge,
    text: string,
    variant: FlowLabel['variant'],
    x: number,
    y: number,
    fact?: LabelFact
  ) => labels.push({ id: `${created.id}#label`, edgeId: created.id, text, variant, x, y, fact });
  const vertical = (from: FlowNode, to: FlowNode): Point[] => [bottomOf(from, compact), topOf(to, compact)];

  const failTarget = failureNodes[0] || failedEnd;
  const failTargetPoint = leftOf(failTarget, compact);

  // The failure bus: failures from the main column drop along one lane into On failure.
  const toFailure = (kind: BranchKind, source: FlowNode, dy: number): FlowEdge => {
    const start = rightOf(source, compact, dy);
    return edge(kind, source, failTarget, [
      start,
      [FAIL_BUS_X + dx, start[1]],
      [FAIL_BUS_X + dx, failTargetPoint[1]],
      [failTargetPoint[0] - 1, failTargetPoint[1]],
    ]);
  };

  // The main chain.
  const chain: FlowNode[] = [transform, ...beforeNodes, send, ...afterNodes, ...laterNodes, delivered];
  chain.slice(0, -1).forEach((from, i) => {
    const to = chain[i + 1];
    const fromStage = stageOf(from);
    const gate = Boolean(fromStage && isGate(fromStage));
    const kind: BranchKind =
      from === send
        ? 'answered'
        : to === delivered
          ? 'delivered'
          : gate
            ? from.hook === 'before_send'
              ? 'yes'
              : 'accepted'
            : 'next';
    const created = edge(kind, from, to, vertical(from, to));
    const mid = (bottomOf(from, compact)[1] + topOf(to, compact)[1]) / 2;
    const labelAt = (text: string, variant: FlowLabel['variant'], fact?: LabelFact) =>
      label(created, text, variant, bottomOf(from, compact)[0] + 12, mid - 10, fact);
    if (kind === 'answered') labelAt('Answered', 'plain');
    else if (kind === 'delivered' && from.hook === 'after_delivery')
      labelAt('Read or delivered', 'plain', { type: 'later', stageId: from.stageId as string });
    else if (
      kind === 'yes' &&
      fromStage &&
      (canSkip(fromStage, outcomesOf(fromStage)) || canFail(fromStage, outcomesOf(fromStage)))
    ) {
      labelAt('Yes', 'success', { type: 'stage', stageId: from.stageId as string, field: 'ok' });
    } else if (kind === 'accepted' && fromStage && canFail(fromStage, outcomesOf(fromStage))) {
      labelAt('Accepted', 'success', { type: 'stage', stageId: from.stageId as string, field: 'ok' });
    }
  });

  // Skipped, failures and asking for a retry, from the gates.
  [...beforeNodes, ...afterNodes].forEach((node) => {
    const stage = stageOf(node) as StageConfig;
    const outcomes = outcomesOf(stage);
    const start = rightOf(node, compact);
    if (skipped && canSkip(stage, outcomes)) {
      const target = leftOf(skipped, compact);
      const points: Point[] =
        start[1] === target[1]
          ? [start, [target[0] - 1, target[1]]]
          : [start, [SKIP_LANE_X + dx, start[1]], [SKIP_LANE_X + dx, target[1]], [target[0] - 1, target[1]]];
      const created = edge('skip', node, skipped, points);
      label(created, 'No', 'neutral', start[0] + 20, start[1] - 28, {
        type: 'stage',
        stageId: node.stageId as string,
        field: 'skipped',
      });
    }
    if (canFail(stage, outcomes)) {
      const created = toFailure('fail', node, 16);
      const y = rightOf(node, compact, 16)[1];
      label(created, node.hook === 'after_response' ? 'Rejected' : 'Fails', 'danger', start[0] + 20, y + 6, {
        type: 'stage',
        stageId: node.stageId as string,
        field: 'rejected',
      });
    }
    if (node.hook === 'before_send' && canAskRetry(stage, outcomes)) {
      const from = rightOf(node, compact, 32);
      const to = leftOf(retry, compact, 14);
      edge(
        'retry-request',
        node,
        retry,
        [from, [RETRY_REQUEST_X + dx, from[1]], [RETRY_REQUEST_X + dx, to[1]], [to[0] - 1, to[1]]],
        true
      );
    }
  });

  // Send: any error that can be retried goes to the retry policy; a refusal fails at once.
  const sendRight = rightOf(send, compact);
  const retryLeft = leftOf(retry, compact);
  const toRetry = edge('send-error', send, retry, [sendRight, [retryLeft[0] - 1, retryLeft[1]]]);
  label(toRetry, 'Error', 'warning', sendRight[0] + 14, sendRight[1] - 28, { type: 'retries' });
  const refused = toFailure('send-refused', send, 30);
  label(refused, 'Refused: not retried', 'plain', rightOf(send, compact)[0] + 14, rightOf(send, compact, 30)[1] + 6);

  // The retry loop goes back to the top of the attempt.
  const retryRight = rightOf(retry, compact);
  const transformRight = rightOf(transform, compact);
  const loop = edge(
    'retry-loop',
    retry,
    transform,
    [
      retryRight,
      [RETRY_STRIP_X + dx, retryRight[1]],
      [RETRY_STRIP_X + dx, transformRight[1]],
      [transformRight[0] + 1, transformRight[1]],
    ],
    true
  );
  label(loop, 'Retry · new attempt', 'warning', 576 + dx, transformRight[1] - 28, { type: 'retries' });

  // Retry exhausted: On failure.
  const retryBottom = bottomOf(retry, compact, 43);
  const exhausted = edge('exhausted', retry, failTarget, [
    retryBottom,
    [retryBottom[0], topOf(failTarget, compact)[1] - 1],
  ]);
  label(
    exhausted,
    'Exhausted',
    'danger',
    retryBottom[0] + 12,
    (retryBottom[1] + topOf(failTarget, compact)[1]) / 2 - 10,
    { type: 'abandoned' }
  );

  // On failure ends in Delivery failed.
  [...failureNodes, failedEnd].slice(0, -1).forEach((from, i) => {
    const to = [...failureNodes, failedEnd][i + 1];
    edge('next', from, to, vertical(from, to));
  });

  // Where a new step can go (spec 10): only at valid insertion points.
  const insertions: InsertionPoint[] = [];
  const plus = (
    id: string,
    hook: StageHook,
    position: number,
    from: FlowNode,
    to: FlowNode | null,
    label_: string,
    x?: number
  ) => {
    const y = to ? (bottomOf(from, compact)[1] + topOf(to, compact)[1]) / 2 : bottomOf(from, compact)[1] + 24;
    insertions.push({
      id: `g${group}-add-${hook}-${position}`,
      group,
      hook,
      position,
      x: x ?? bottomOf(from, compact)[0],
      y,
      label: label_,
    });
  };
  const beforeChain = [transform, ...beforeNodes, send];
  beforeChain
    .slice(0, -1)
    .forEach((from, i) => plus(`b${i}`, 'before_send', i, from, beforeChain[i + 1], 'Add a step before the send'));
  const afterChain = [send, ...afterNodes, ...(laterNodes[0] ? [laterNodes[0]] : [delivered])];
  afterChain
    .slice(0, -1)
    .forEach((from, i) => plus(`a${i}`, 'after_response', i, from, afterChain[i + 1], 'Add a step after the response'));
  const laterChain = [...(afterNodes.length ? [afterNodes[afterNodes.length - 1]] : [send]), ...laterNodes, delivered];
  if (laterNodes.length) {
    laterChain
      .slice(1, -1)
      .forEach((from, i) => plus(`l${i}`, 'after_delivery', i + 1, from, laterChain[i + 2], 'Add a later check'));
    plus(
      'l-end',
      'after_delivery',
      laterNodes.length,
      laterNodes[laterNodes.length - 1],
      delivered,
      'Add a later check'
    );
  } else {
    plus('l-end', 'after_delivery', 0, afterNodes[afterNodes.length - 1] || send, delivered, 'Add a later check');
  }
  const failChain = [...failureNodes, failedEnd];
  failureNodes.forEach((from, i) =>
    plus(`f${i}`, 'on_failure', i + 1, from, failChain[i + 1], 'Add a failure step', 688 + dx)
  );
  if (failureNodes.length === 0) {
    insertions.push({
      id: `g${group}-add-on_failure-0`,
      group,
      hook: 'on_failure',
      position: 0,
      x: 688 + dx,
      y: topOf(failedEnd, compact)[1] - 24,
      label: 'Add a failure step',
    });
  }

  // Band labels (mono, left of the column) and the before-send bracket.
  const bandX = 64 + dx;
  const bands: Band[] = [
    ...(group === 0 ? [{ id: 'event', text: 'EVENT', x: bandX, y: ROW_TOP(0) + 4 }] : []),
    { id: `g${group}-prepare`, text: 'PREPARE', x: bandX, y: ROW_TOP(1) + 4 },
    ...(before.length ? [{ id: `g${group}-before`, text: 'BEFORE SEND', x: bandX, y: ROW_TOP(2) + 4 }] : []),
    { id: `g${group}-send`, text: 'SEND', x: bandX, y: ROW_TOP(sendRow) + 4 },
    ...(after.length
      ? [{ id: `g${group}-after`, text: 'AFTER THE RESPONSE', x: bandX, y: ROW_TOP(sendRow + 1) + 4, width: 120 }]
      : []),
    ...(later.length
      ? [{ id: `g${group}-later`, text: 'LATER', x: bandX, y: ROW_TOP(sendRow + 1 + after.length) + 4 }]
      : []),
    { id: `g${group}-outcome`, text: 'OUTCOME', x: bandX, y: ROW_TOP(outcomeRow) + 4 },
  ];
  const brackets = before.length ? [{ x: 56 + dx, y: ROW_TOP(2) + 28, height: before.length * 120 - 72 }] : [];

  return {
    nodes,
    edges,
    labels,
    bands,
    brackets,
    insertions,
    firstNode: transform,
    title: delivery.target.label ? `${delivery.target.label} · ${protocolLabel(delivery.target.protocol)}` : null,
  };
}

function scheduleWords(stage: StageConfig): string {
  const schedule = stage.schedule;
  if (schedule?.checkAfterSeconds?.length) return plural(schedule.checkAfterSeconds.length, 'check');
  if (schedule?.everySeconds) return `every ${Math.round(schedule.everySeconds / 60)} min`;
  return 'on a schedule';
}

export function buildFlow(input: FlowInput): Flow {
  const compact = Boolean(input.compact);
  const built = input.deliveries.map((delivery, index) => buildDelivery(delivery, index, input, compact));
  const count = Math.max(built.length, 1);
  const centreX = MAIN_X + NODE_WIDTH / 2 + ((count - 1) * GROUP_PITCH) / 2;
  const trigger: FlowNode = {
    id: 'trigger',
    kind: 'trigger',
    eyebrow: 'Trigger · event',
    title: input.eventType || 'Event',
    summary: count > 1 ? plural(count, 'delivery').replace('delivery', 'action') : 'starts the delivery',
    group: 0,
    col: 'main',
    row: 0,
    x: centreX - NODE_WIDTH / 2,
    y: ROW_TOP(0),
  };

  const fanOut: FlowEdge[] = built.map((entry, index) => {
    const from = bottomOf(trigger, compact);
    const to = topOf(entry.firstNode, compact);
    const points: Point[] =
      from[0] === to[0] ? [from, to] : [from, [from[0], (from[1] + to[1]) / 2], [to[0], (from[1] + to[1]) / 2], to];
    return {
      id: `trigger>${entry.firstNode.id}:fan-out`,
      from: trigger.id,
      to: entry.firstNode.id,
      kind: built.length > 1 ? 'fan-out' : 'next',
      points,
      group: index,
    };
  });

  const nodes = [trigger, ...built.flatMap((entry) => entry.nodes)];
  const deepest = Math.max(...nodes.map((node) => node.row));
  return {
    nodes,
    edges: [...fanOut, ...built.flatMap((entry) => entry.edges)],
    labels: built.flatMap((entry) => entry.labels),
    bands: built.flatMap((entry) => entry.bands),
    brackets: built.flatMap((entry) => entry.brackets),
    insertions: built.flatMap((entry) => entry.insertions),
    groups: built.map((entry, index) => ({
      index,
      target: input.deliveries[index].target,
      title: entry.title,
      titlePos: [MAIN_X + index * GROUP_PITCH + NODE_WIDTH / 2 + 14, ROW_TOP(1) - 20] as Point,
      nodeIds: entry.nodes.map((node) => node.id),
    })),
    width: HOST_WIDTH + (count - 1) * GROUP_PITCH,
    height: ROW_TOP(deepest) + NODE_HEIGHT + 60,
    compact,
  };
}

/** The polyline as an SVG path, ending 3 px short of the tip so the arrowhead sits on the end. */
export function pathOf(points: Point[], gap = 3): string {
  const pts = points.map(([x, y]) => [x, y] as Point);
  const last = pts[pts.length - 1];
  const before = pts[pts.length - 2];
  if (before) {
    const length = Math.hypot(last[0] - before[0], last[1] - before[1]);
    if (length > gap) {
      pts[pts.length - 1] = [
        last[0] - ((last[0] - before[0]) / length) * gap,
        last[1] - ((last[1] - before[1]) / length) * gap,
      ];
    }
  }
  return pts
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${Math.round(x * 10) / 10} ${Math.round(y * 10) / 10}`)
    .join(' ');
}

/** Put a new stage at `position` among the stages of `hook`, leaving every other stage where it is. */
export function insertStage(
  stages: StageConfig[],
  stage: StageConfig,
  hook: StageHook,
  position: number
): StageConfig[] {
  const same = stages.map((candidate, index) => (candidate.hook === hook ? index : -1)).filter((index) => index >= 0);
  if (same.length === 0 || position >= same.length) {
    const last = same.length ? same[same.length - 1] + 1 : stages.length;
    return [...stages.slice(0, last), stage, ...stages.slice(last)];
  }
  const at = same[Math.max(position, 0)];
  return [...stages.slice(0, at), stage, ...stages.slice(at)];
}
