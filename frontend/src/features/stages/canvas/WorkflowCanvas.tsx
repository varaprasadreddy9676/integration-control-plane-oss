import './canvas.css';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Dropdown, Form, message } from 'antd';
import { useThemeMode } from '../../../app/theme-provider';
import type { SendBindings, StageConfig, StageHook } from '../../../services/stages-api';
import { stageFromTemplate } from '../../../services/stages-api';
import {
  draftFromRunner,
  duplicateStage,
  moveStage,
  newStageId,
  removeStageAt,
  setStageEnabled,
} from '../components/delivery-tab/stageDraft';
import { stageMenu } from '../components/delivery-tab/stageLibrary';
import type { DeliveryTarget } from '../deliveryTargets';
import { CanvasNode, Icon } from './CanvasNode';
import { Connectors } from './Connectors';
import { ExecutionDrawer } from './ExecutionBar';
import { Inspector } from './Inspector';
import type { StageAction } from './Inspector';
import { Minimap } from './Minimap';
import { labelCount, labelText } from './facts';
import type { NodeView } from './execution';
import { traceExecution } from './execution';
import type { Flow, FlowLabel, FlowNode } from './model';
import { boxOf, buildFlow, insertStage } from './model';
import type { StepEditors } from './stepEditors';
import { ownerOf, stagesOf, useCanvasData } from './useCanvasData';
import { useExecution } from './useExecution';
import { useViewport } from './useViewport';

interface WorkflowCanvasProps {
  form: any;
  integrationId?: string;
  targets: DeliveryTarget[];
  /** The integration as the server should validate stages against. */
  context: () => Record<string, unknown>;
  readOnly?: boolean;
  /** Draw this one delivery over the flow (opened from Delivery Logs): read only, no editing. */
  deliveryLogId?: string;
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Open one of the integration page's tabs (Transformation, Reliability...). */
  onOpenTab?: (tab: string) => void;
  /** What to edit in place for the steps that are not stages. */
  stepEditors?: StepEditors;
}

type Snapshot = Record<string, StageConfig[]>;
const COMPACT_AT = 0.6;
/** How far (px) a press must move before it is a drag and not a click. */
const DRAG_THRESHOLD = 6;
const COUNTS_HIDDEN_BELOW = 0.5;
/** The drawer's width for a stage, and for a fixed step that edits one of the page's own forms. */
const DRAWER_WIDTH = { stage: 440, fixed: 560 };
/** Below this canvas width the drawer is a sheet from the bottom (58% of the height). */
const SHEET_BELOW = 640;

/** The neighbouring node in an arrow key's direction among the nodes it is connected to. */
function neighbour(flow: Flow, id: string, key: string): string | null {
  const from = flow.nodes.find((node) => node.id === id);
  if (!from) return null;
  const linked = flow.edges.flatMap((edge) => (edge.from === id ? [edge.to] : edge.to === id ? [edge.from] : []));
  const centre = (node: FlowNode) => {
    const box = boxOf(node, false);
    return [box.x + box.width / 2, box.y + box.height / 2] as const;
  };
  const [fx, fy] = centre(from);
  const direction = { ArrowDown: [0, 1], ArrowUp: [0, -1], ArrowRight: [1, 0], ArrowLeft: [-1, 0] }[key] as [
    number,
    number,
  ];
  let best: { id: string; score: number } | null = null;
  for (const other of flow.nodes.filter((node) => linked.includes(node.id))) {
    const [ox, oy] = centre(other);
    const along = (ox - fx) * direction[0] + (oy - fy) * direction[1];
    const across = Math.abs((ox - fx) * direction[1]) + Math.abs((oy - fy) * direction[0]);
    if (along > 0 && (!best || along + across * 2 < best.score)) best = { id: other.id, score: along + across * 2 };
  }
  return best ? best.id : null;
}

/**
 * The workflow canvas (docs/design/workflow-canvas): a projection of each delivery's
 * pipeline with its 24-hour counts, an inspector for the selected step, and an
 * Executions mode that draws one real delivery over the same flow. Edits go to the
 * integration form as a draft; saving the integration applies them.
 */
export const WorkflowCanvas = ({
  form,
  integrationId,
  targets,
  context,
  readOnly: readOnlyProp = false,
  deliveryLogId,
  fullscreen = false,
  onToggleFullscreen,
  onOpenTab,
  stepEditors,
}: WorkflowCanvasProps) => {
  const readOnly = readOnlyProp || Boolean(deliveryLogId);
  // Configuration shows the flow to edit; what happened to a delivery is shown with that delivery in Delivery Logs.
  const mode: 'configure' | 'executions' = deliveryLogId ? 'executions' : 'configure';
  const { mode: themeMode } = useThemeMode();
  const watched = Form.useWatch([], { form, preserve: true }) as Record<string, any> | undefined;
  const values = watched && Object.keys(watched).length ? watched : (form.getFieldsValue(true) as Record<string, any>);
  const [toast, holder] = message.useMessage();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A flow with many deliveries starts with all but the first folded into one step each.
  const [folded, setFolded] = useState<number[]>(() => (targets.length > 3 ? targets.slice(1).map((_, index) => index + 1) : []));
  const [query, setQuery] = useState('');
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [, bump] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const data = useCanvasData({ integrationId, values, targets, readOnly, context });
  const execution = useExecution(deliveryLogId);
  const deliveries = targets.map((target) => ({
    target,
    owner: ownerOf(values, target),
    stages: stagesOf(values, target),
  }));

  // The delivery an Executions run belongs to is always shown open.
  const loggedGroup = Math.max(
    targets.findIndex((target) => target.actionIndex === (execution.log?.actionIndex ?? null)),
    0
  );
  const collapsed = folded.filter((index) => !(mode === 'executions' && index === loggedGroup));
  const toggleGroup = (index: number) => setFolded((current) => (current.includes(index) ? current.filter((entry) => entry !== index) : [...current, index]));

  // The flow is built twice at most: full size, and compact once the zoom is low (spec 10).
  const baseFlow = useMemo(
    () =>
      buildFlow({
        deliveries,
        eventType: values.eventType,
        retryCount: values.retryCount,
        runners: data.runnerMap,
        outcomes: data.outcomes,
        collapsed,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      JSON.stringify(
        deliveries.map((delivery) => [
          delivery.target.key,
          delivery.stages,
          delivery.owner.name,
          delivery.owner.kind,
          delivery.owner.targetUrl,
          delivery.owner.httpMethod,
        ])
      ),
      values.eventType,
      values.retryCount,
      data.runnerMap,
      data.outcomes,
      collapsed.join(','),
    ]
  );
  const viewport = useViewport(stageRef, { width: baseFlow.width, height: baseFlow.height });
  const compact = viewport.view.z <= COMPACT_AT;
  const flow = useMemo(
    () =>
      compact
        ? buildFlow({
            deliveries,
            eventType: values.eventType,
            retryCount: values.retryCount,
            runners: data.runnerMap,
            outcomes: data.outcomes,
            collapsed,
            compact: true,
          })
        : baseFlow,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compact, baseFlow]
  );

  const snapshot = (): Snapshot =>
    Object.fromEntries(targets.map((target) => [target.key, stagesOf(form.getFieldsValue(true), target)]));
  // A change made here counts as a change to the form, so the page warns before it is thrown away.
  const writeToForm = (changes: { target: DeliveryTarget; stages: StageConfig[] }[]) =>
    form.setFields(changes.map(({ target, stages }) => ({ name: [...target.namePath, 'stages'], value: stages, touched: true })));
  const apply = (state: Snapshot) => {
    writeToForm(targets.map((target) => ({ target, stages: state[target.key] || [] })));
    bump((n) => n + 1);
  };
  const writeStages = (target: DeliveryTarget, next: StageConfig[]) => {
    history.current = { past: [...history.current.past, snapshot()].slice(-50), future: [] };
    writeToForm([{ target, stages: next }]);
    bump((n) => n + 1);
  };
  const undo = () => {
    const previous = history.current.past[history.current.past.length - 1];
    if (!previous) return;
    history.current = { past: history.current.past.slice(0, -1), future: [snapshot(), ...history.current.future] };
    apply(previous);
  };
  const redo = () => {
    const [next, ...rest] = history.current.future;
    if (!next) return;
    history.current = { past: [...history.current.past, snapshot()], future: rest };
    apply(next);
  };

  const selected = flow.nodes.find((node) => node.id === selectedId) || null;
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  /** How much of the canvas the drawer covers when it shows `node`: width beside it, or height as a sheet. */
  const drawerFor = (node: FlowNode | null) => {
    if (!node) return { width: 0, height: 0 };
    if (viewport.size.width <= SHEET_BELOW) return { width: 0, height: viewport.size.height * 0.58 };
    const fixed = node.stageIndex === undefined && Boolean(stepEditors?.[node.kind as keyof StepEditors]);
    return { width: Math.min(fixed ? DRAWER_WIDTH.fixed : DRAWER_WIDTH.stage, viewport.size.width * 0.92), height: 0 };
  };

  const select = useCallback(
    (node: FlowNode) => {
      if (node.kind === 'group') {
        toggleGroup(node.group);
        return;
      }
      // Activating the step that is already open moves the keyboard into its inspector.
      if (node.id === selectedId) {
        document.querySelector<HTMLElement>('.wf-inspector')?.focus();
        return;
      }
      setSelectedId(node.id);
      // Pan only as far as needed to show the step beside the drawer (spec 10); zoom and position otherwise stay.
      const drawer = drawerFor(node);
      const box = boxOf(node, flow.compact);
      viewport.ensureVisible(
        { x: box.x, y: box.y, width: box.width, height: box.height },
        viewport.size.width - drawer.width,
        viewport.size.height - drawer.height
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flow.compact, selectedId, viewport, stepEditors]
  );

  // Executions: one delivery drawn over the flow.
  const group = loggedGroup;
  const trace =
    mode === 'executions' && execution.log ? traceExecution(flow, group, execution.log, execution.stageData) : null;

  // A delivery opens on the path it took, not on the top-left of the flow.
  const shownLog = useRef<string | null>(null);
  useEffect(() => {
    if (!deliveryLogId || !trace || shownLog.current === deliveryLogId || viewport.size.width <= 0) return;
    const taken = flow.nodes.filter((node) => trace.nodes[node.id] && trace.nodes[node.id].state !== 'unvisited').map((node) => boxOf(node, flow.compact));
    if (taken.length === 0) return;
    const left = Math.min(...taken.map((box) => box.x));
    const top = Math.min(...taken.map((box) => box.y));
    shownLog.current = deliveryLogId;
    viewport.showBox({
      x: left,
      y: top,
      width: Math.max(...taken.map((box) => box.x + box.width)) - left,
      height: Math.max(...taken.map((box) => box.y + box.height)) - top,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trace, deliveryLogId, viewport.size.width]);

  const viewOf = (node: FlowNode): NodeView | undefined => {
    if (trace) return trace.nodes[node.id];
    const stage = node.stageIndex === undefined ? undefined : deliveries[node.group].stages[node.stageIndex];
    if (!stage) return undefined;
    const problems = data.issues[stage.id];
    if (problems?.length) return { state: 'issue', meta: `${problems.length} issue${problems.length === 1 ? '' : 's'}` };
    if (stage.enabled === false) return { state: 'off' };
    return data.isEdited(stage) ? { state: 'edited' } : undefined;
  };

  const factsOf = (groupIndex: number) =>
    data.stats?.targets.find((entry) => entry.actionIndex === targets[groupIndex].actionIndex);
  const labelView = (label: FlowLabel) => {
    const edgeState = trace?.edges[label.edgeId];
    const variant = trace
      ? edgeState === 'notTaken'
        ? 'notTaken'
        : edgeState === 'taken'
          ? 'taken'
          : label.variant
      : label.variant;
    const edge = flow.edges.find((candidate) => candidate.id === label.edgeId);
    const text =
      trace || viewport.view.z < COUNTS_HIDDEN_BELOW
        ? label.text
        : labelText(label, labelCount(label.fact, factsOf(edge?.group ?? 0), data.outcomes));
    return { variant, text };
  };

  // Reordering: drag a step up or down within its group; the others stay where they are and a line shows where it lands.
  const [drag, setDrag] = useState<{ id: string; offset: number; lineY: number } | null>(null);
  const dragging = useRef<{ startY: number; moved: boolean } | null>(null);
  const clickedAfterDrag = useRef(false);
  const latestView = useRef(viewport.view);
  latestView.current = viewport.view;

  const startPress = (node: FlowNode, event: React.PointerEvent<HTMLButtonElement>) => {
    if (readOnly || mode !== 'configure' || node.stageIndex === undefined || event.button !== 0) return;
    const siblings = flow.nodes.filter((other) => other.group === node.group && other.hook === node.hook && other.stageIndex !== undefined).sort((a, b) => a.row - b.row);
    if (siblings.length < 2) return;
    const others = siblings.filter((other) => other.id !== node.id);
    const heightOf = (other: FlowNode) => boxOf(other, flow.compact).height;
    const topOf = (other: FlowNode) => boxOf(other, flow.compact).y;
    const state = { startY: event.clientY, moved: false };
    dragging.current = state;
    let landing = siblings.indexOf(node);

    const place = (clientY: number) => {
      const offset = (clientY - state.startY) / latestView.current.z;
      const centre = topOf(node) + heightOf(node) / 2 + offset;
      landing = others.filter((other) => topOf(other) + heightOf(other) / 2 < centre).length;
      const before = others[landing - 1];
      const after = others[landing];
      const lineY = before && after ? (topOf(before) + heightOf(before) + topOf(after)) / 2 : before ? topOf(before) + heightOf(before) + 22 : topOf(after) - 22;
      setDrag({ id: node.id, offset, lineY });
    };
    const onMove = (move: PointerEvent) => {
      if (!state.moved && Math.abs(move.clientY - state.startY) < DRAG_THRESHOLD) return;
      state.moved = true;
      place(move.clientY);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragging.current = null;
      setDrag(null);
      if (!state.moved) return;
      // The click that ends a drag is not a selection.
      clickedAfterDrag.current = true;
      window.setTimeout(() => {
        clickedAfterDrag.current = false;
      }, 0);
      if (landing === siblings.indexOf(node)) return;
      const delivery = deliveries[node.group];
      const moved = delivery.stages[node.stageIndex as number];
      writeStages(delivery.target, insertStage(removeStageAt(delivery.stages, node.stageIndex as number), moved, node.hook as StageHook, landing));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  const act = (node: FlowNode, action: StageAction) => {
    const delivery = deliveries[node.group];
    const index = node.stageIndex as number;
    const stages = delivery.stages;
    if (action === 'up' || action === 'down')
      writeStages(delivery.target, moveStage(stages, index, action === 'up' ? -1 : 1));
    else if (action === 'duplicate') writeStages(delivery.target, duplicateStage(stages, index));
    else if (action === 'toggle')
      writeStages(delivery.target, setStageEnabled(stages, index, stages[index].enabled === false));
    else {
      const removed = stages[index];
      writeStages(delivery.target, removeStageAt(stages, index));
      setSelectedId(null);
      toast.info({
        content: (
          <span>
            Removed {removed.name}.{' '}
            <button type="button" className="wf-btn" style={{ height: 24, marginLeft: 8 }} onClick={undo}>
              Undo
            </button>
          </span>
        ),
        duration: 6,
      });
    }
  };

  const addAt = async (
    groupIndex: number,
    hook: StageHook,
    position: number,
    source: { runner?: string; template?: string }
  ) => {
    const delivery = deliveries[groupIndex];
    let created: StageConfig | undefined;
    if (source.runner) {
      const runner = data.library.runners.data?.find((candidate) => candidate.type === source.runner);
      if (runner) created = draftFromRunner(runner, hook, delivery.stages);
    } else if (source.template) {
      const fromTemplate = await stageFromTemplate(source.template);
      created = {
        ...fromTemplate,
        id: newStageId(
          fromTemplate.name,
          delivery.stages.map((stage) => stage.id)
        ),
      };
    }
    if (!created) return;
    writeStages(delivery.target, insertStage(delivery.stages, created, hook, position));
    setSelectedId(`g${groupIndex}-stage-${created.id}`);
    setAdding(false);
  };

  // Keyboard: search, undo, delete, arrows between connected steps.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const root = stageRef.current?.closest('.wf-root');
      // Only while the keyboard is in the canvas: the console has its own shortcuts (⌘K opens its command palette).
      if (!root || !root.contains(document.activeElement)) return;
      const typing = (event.target as HTMLElement | null)?.closest?.(
        'input, textarea, select, [contenteditable="true"], .monaco-editor'
      );
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        event.stopImmediatePropagation();
        searchRef.current?.focus();
      } else if (!typing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !readOnly) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (
        !typing &&
        (event.key === 'Delete' || event.key === 'Backspace') &&
        selected?.stageId &&
        !readOnly &&
        mode === 'configure'
      ) {
        event.preventDefault();
        act(selected, 'remove');
      } else if (event.key === 'Escape' && selectedId && !typing) {
        // From inside the inspector go back to the step; from the step, close the inspector.
        // The page cancels editing on Escape: this one is the canvas's.
        event.stopPropagation();
        const inInspector = Boolean(document.activeElement?.closest('.wf-inspector'));
        document.getElementById(selectedId)?.focus();
        if (!inInspector) setSelectedId(null);
      } else if (event.key === 'Escape' && fullscreen && !typing) {
        event.stopPropagation();
        onToggleFullscreen?.();
      }
    };
    // Capture, so a shortcut the canvas takes is not also taken by the page.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  const matches = useMemo(() => {
    const text = query.trim().toLowerCase();
    return new Set(
      text
        ? flow.nodes
            .filter((node) => `${node.title} ${node.eyebrow} ${node.summary}`.toLowerCase().includes(text))
            .map((node) => node.id)
        : []
    );
  }, [flow.nodes, query]);

  const selectedDelivery = selected ? deliveries[selected.group] : null;
  const selectedStage =
    selected && selectedDelivery && selected.stageIndex !== undefined
      ? selectedDelivery.stages[selected.stageIndex]
      : undefined;
  const send = selectedDelivery
    ? (form.getFieldValue([...selectedDelivery.target.namePath, 'send']) as SendBindings | null | undefined)
    : undefined;
  // Steps that appear after the canvas was first drawn settle in; the first drawing does not animate.
  // The class stays for the length of the animation (taking it off early would cut it short).
  const knownNodes = useRef<Set<string> | null>(null);
  const [entering, setEntering] = useState<Set<string>>(new Set());
  useLayoutEffect(() => {
    const known = knownNodes.current;
    knownNodes.current = new Set(flow.nodes.map((node) => node.id));
    if (!known) return;
    const added = flow.nodes.filter((node) => !known.has(node.id)).map((node) => node.id);
    if (added.length === 0) return;
    setEntering((current) => new Set([...current, ...added]));
    window.setTimeout(() => setEntering((current) => new Set([...current].filter((id) => !added.includes(id)))), 400);
  }, [flow.nodes]);
  const sortedNodes = [...flow.nodes].sort((a, b) => a.group - b.group || a.row - b.row || (a.col === 'main' ? -1 : 1));
  const zoomLabel = `${Math.round(viewport.view.z * 100)}%`;
  const changedCount = data.impact ? data.impact.stages.filter((entry) => entry.change !== 'unchanged').length : 0;

  const canvas = (
    <div
      className={`wf wf-root${fullscreen ? ' wf-root--full' : ''}`}
      data-theme={themeMode === 'dark' ? 'dark' : 'light'}
    >
      {holder}
      <div className="wf-body" data-drawer={selected ? 'open' : 'closed'} style={{ ['--wf-drawer-w' as string]: `${selected ? drawerFor(selected).width : 0}px` }}>
        <div className="wf-main">
          <div className="wf-topbar">
            <div className="wf-group">
              <label className="wf-search">
                <Icon name="search" size={16} />
                <input
                  ref={searchRef}
                  aria-label="Search steps"
                  placeholder="Search steps"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      const first = flow.nodes.find((node) => matches.has(node.id));
                      if (first) select(first);
                    } else if (event.key === 'Escape') setQuery('');
                  }}
                />
                <kbd>⌘K</kbd>
              </label>
            </div>
            <div className="wf-group">
              <div className="wf-seg" role="group" aria-label="Zoom">
                <button type="button" aria-label="Zoom out" onClick={viewport.zoomOut}>
                  −
                </button>
                <button type="button" aria-label="Zoom level" disabled style={{ cursor: 'default', minWidth: 52 }}>
                  {zoomLabel}
                </button>
                <button type="button" aria-label="Zoom in" onClick={viewport.zoomIn}>
                  +
                </button>
              </div>
              <button type="button" className="wf-btn" onClick={viewport.fit}>
                Fit
              </button>
              {onToggleFullscreen && (
                <button
                  type="button"
                  className="wf-btn"
                  aria-pressed={fullscreen}
                  aria-label={fullscreen ? 'Exit full screen' : 'Full screen'}
                  title={fullscreen ? 'Exit full screen' : 'Full screen'}
                  onClick={onToggleFullscreen}
                >
                  <Icon name="fit" size={15} />
                  <span className="wf-hide-narrow">{fullscreen ? 'Exit full screen' : 'Full screen'}</span>
                </button>
              )}
            </div>
          </div>

          {mode === 'configure' && !readOnly && (
            <div className="wf-palette" role="toolbar" aria-label="Tools">
              <button
                type="button"
                aria-label="Add a step"
                title="Add a step"
                aria-pressed={adding}
                onClick={() => setAdding(!adding)}
              >
                <Icon name="plus" />
              </button>
              <button
                type="button"
                aria-label="Undo"
                title="Undo (⌘Z)"
                disabled={history.current.past.length === 0}
                onClick={undo}
              >
                <Icon name="undo" />
              </button>
              <button
                type="button"
                aria-label="Redo"
                title="Redo (⇧⌘Z)"
                disabled={history.current.future.length === 0}
                onClick={redo}
              >
                <Icon name="redo" />
              </button>
            </div>
          )}

          <div
            ref={stageRef}
            className="wf-stage"
            tabIndex={-1}
            {...viewport.handlers}
            onClick={(event) => {
              if (event.target === event.currentTarget) setSelectedId(null);
            }}
          >
            <div
              className="wf-host"
              style={{
                width: flow.width,
                height: flow.height,
                transform: `translate(${viewport.view.x}px, ${viewport.view.y}px) scale(${viewport.view.z})`,
                transition: viewport.smooth ? 'transform 240ms cubic-bezier(0.2, 0, 0, 1)' : 'none',
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelectedId(null);
              }}
            >
              {flow.bands.map((band) => (
                <div key={band.id} className="wf-band" style={{ left: band.x, top: band.y, width: band.width }}>
                  {band.text}
                </div>
              ))}
              {flow.brackets.map((bracket) => (
                <div
                  key={`${bracket.x}-${bracket.y}`}
                  className="wf-bracket"
                  style={{ left: bracket.x, top: bracket.y, height: bracket.height }}
                />
              ))}
              {flow.groups
                .filter((entry) => entry.title && flow.groups.length > 1)
                .map((entry) => (
                  <button
                    key={entry.index}
                    type="button"
                    data-no-pan
                    className="wf-group-title"
                    style={{ left: entry.titlePos[0], top: entry.titlePos[1] }}
                    aria-expanded={!entry.collapsed}
                    aria-label={`${entry.collapsed ? 'Open' : 'Fold'} ${entry.title}`}
                    onClick={() => toggleGroup(entry.index)}
                  >
                    {entry.collapsed ? '▸' : '▾'} {entry.title}
                  </button>
                ))}
              <Connectors flow={flow} states={trace?.edges} traceKey={trace ? execution.selectedId : null} />
              {flow.labels.map((label) => {
                const view = labelView(label);
                return (
                  <div
                    key={label.id}
                    className={`wf-label wf-label--${view.variant}`}
                    style={{ left: label.x, top: label.y }}
                  >
                    {view.text}
                  </div>
                );
              })}
              {sortedNodes.map((node) => {
                const box = boxOf(node, flow.compact);
                return (
                  <CanvasNode
                    key={node.id}
                    id={node.id}
                    matched={matches.has(node.id)}
                    entering={entering.has(node.id)}
                    kind={node.kind}
                    eyebrow={node.eyebrow}
                    title={node.title}
                    summary={node.summary}
                    view={viewOf(node)}
                    selected={node.id === selectedId}
                    compact={flow.compact}
                    left={box.x}
                    top={box.y}
                    onSelect={() => {
                      if (!clickedAfterDrag.current) select(node);
                    }}
                    onPress={(event) => startPress(node, event)}
                    dragOffset={drag?.id === node.id ? drag.offset : null}
                    onKeyNav={(key) => {
                      const next = neighbour(flow, node.id, key);
                      if (next) document.getElementById(next)?.focus();
                    }}
                  />
                );
              })}
              {drag && <div className="wf-drop" style={{ left: boxOf(flow.nodes.find((n) => n.id === drag.id) as FlowNode, flow.compact).x, top: drag.lineY, width: flow.compact ? 208 : 256 }} />}
              {mode === 'configure' &&
                !readOnly &&
                flow.insertions.map((point) => (
                  <Dropdown
                    key={point.id}
                    trigger={['click']}
                    menu={stageMenu(
                      point.hook,
                      { runners: data.library.runners.data, templates: data.library.templates.data },
                      {
                        onRunner: (runner) => void addAt(point.group, point.hook, point.position, { runner }),
                        onTemplate: (template) => void addAt(point.group, point.hook, point.position, { template }),
                      }
                    )}
                  >
                    <button
                      type="button"
                      data-no-pan
                      className={`wf-plus${adding ? ' wf-plus--visible' : ''}`}
                      style={{ left: point.x, top: point.y }}
                      aria-label={point.label}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                  </Dropdown>
                ))}
            </div>
            {flow.width > 1200 || flow.height > 900 ? (
              <Minimap
                flow={flow}
                view={viewport.view}
                size={viewport.size}
                selectedId={selectedId}
                onView={viewport.jumpTo}
                onDrag={viewport.setView}
              />
            ) : null}
          </div>

          {mode === 'executions' ? (
            execution.log && trace ? (
              <ExecutionDrawer flow={flow} trace={trace} log={execution.log} runs={execution.stageData?.runs || []} />
            ) : (
              <div className="wf-bottombar">
                {execution.loading ? 'Loading the delivery…' : 'No deliveries to show yet.'}
              </div>
            )
          ) : (
            <div className="wf-bottombar">
              {data.dirty && !readOnly ? (
                <span>
                  <span className="wf-chip wf-chip--warning">Draft</span>{' '}
                  {data.impact
                    ? `${changedCount === 0 ? "No step's settings changed" : `${changedCount} step${changedCount === 1 ? '' : 's'} changed`} · ${data.impact.totals.keepOldVersion.toLocaleString('en-US')} waiting check${data.impact.totals.keepOldVersion === 1 ? '' : 's'} keep their version${data.impact.totals.cancelled ? ` · ${data.impact.totals.cancelled} cancelled` : ''}${data.impact.totals.paused ? ` · ${data.impact.totals.paused} paused` : ''}`
                    : 'Save the integration to apply it to new deliveries.'}
                </span>
              ) : (
                <span className="wf-help">Saved</span>
              )}
              <span className="wf-help" style={{ marginLeft: 'auto' }}>
                {data.statsError
                  ? 'Counts unavailable'
                  : integrationId
                    ? 'Connector counts: last 24 h, production'
                    : 'Counts appear once the integration is saved'}
              </span>
            </div>
          )}
        </div>

        {selected && selectedDelivery && (
          <Inspector
            key={selected.id}
            node={selected}
            mode={mode}
            readOnly={readOnly}
            stage={selectedStage}
            stages={selectedDelivery.stages}
            send={send}
            runners={data.library.runners.data || []}
            integrationId={integrationId}
            integration={context()}
            protocol={selectedDelivery.target.protocol}
            actionIndex={selectedDelivery.target.actionIndex}
            impact={data.impact}
            issues={selected.stageId ? data.issues[selected.stageId] : undefined}
            runs={(execution.stageData?.runs || []).filter((run) => run.stage.id === selected.stageId)}
            state={execution.stageData?.states.find((entry) => entry.stageId === selected.stageId)}
            log={mode === 'executions' ? execution.log : undefined}
            onApply={(stage) => {
              writeStages(
                selectedDelivery.target,
                selectedDelivery.stages.map((candidate, index) => (index === selected.stageIndex ? stage : candidate))
              );
              toast.success('Applied to the draft');
            }}
            onAction={(action) => act(selected, action)}
            onClose={() => setSelectedId(null)}
            stepEditors={stepEditors}
            onOpenTab={onOpenTab && ((tab) => onOpenTab(tab === 'transformation' && targets[0]?.actionIndex !== null ? 'multiAction' : tab))}
            onChanged={() => void execution.refetch()}
          />
        )}
      </div>
    </div>
  );
  // Full screen is the canvas over the whole window: out of the page, whose animated sections would pin `fixed` to themselves.
  return fullscreen ? createPortal(canvas, document.body) : canvas;
};
