import type { FlowEdge, FlowNode } from './flowTypes';

const NODE_COLUMN_GAP = 260;
const NODE_ROW_GAP = 110;
const CANVAS_ORIGIN_X = 140;
const CANVAS_ORIGIN_Y = 32;

/** Position a directed acyclic flow top-to-bottom without changing its graph. */
export function layoutFlowGraph(nodes: FlowNode[], edges: FlowEdge[]): FlowNode[] {
  if (nodes.length < 2) return nodes;

  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const depth = new Map<string, number>();

  nodes.forEach((node) => {
    outgoing.set(node.id, []);
    indegree.set(node.id, 0);
    depth.set(node.id, 0);
  });

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  });

  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  let visited = 0;

  while (ready.length > 0) {
    const source = ready.shift()!;
    visited += 1;

    (outgoing.get(source) ?? []).forEach((target) => {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(source) ?? 0) + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);
      if (indegree.get(target) === 0) ready.push(target);
    });
  }

  // Keep the previous positions if an imported or user-edited graph contains a cycle.
  if (visited !== nodes.length) return nodes;

  const layers = new Map<number, FlowNode[]>();
  nodes.forEach((node) => {
    const layer = depth.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  });

  return nodes.map((node) => {
    const layer = depth.get(node.id) ?? 0;
    const siblings = layers.get(layer) ?? [node];
    const siblingIndex = siblings.findIndex((sibling) => sibling.id === node.id);
    const layerWidth = (siblings.length - 1) * NODE_COLUMN_GAP;

    return {
      ...node,
      position: {
        x: CANVAS_ORIGIN_X - layerWidth / 2 + siblingIndex * NODE_COLUMN_GAP,
        y: CANVAS_ORIGIN_Y + layer * NODE_ROW_GAP,
      },
      data: { ...node.data, layoutDirection: 'vertical' },
    };
  });
}
