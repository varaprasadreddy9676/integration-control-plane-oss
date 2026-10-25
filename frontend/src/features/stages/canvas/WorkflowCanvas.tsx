import './canvas.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ExecutionDrawer, RunPicker } from './ExecutionBar';
import { Inspector } from './Inspector';
import type { StageAction } from './Inspector';
import { Minimap } from './Minimap';
import { labelCount, labelText } from './facts';
import type { NodeView } from './execution';
import { traceExecution } from './execution';
import type { Flow, FlowLabel, FlowNode } from './model';
import { boxOf, buildFlow, insertStage } from './model';
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
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
  /** Open one of the integration page's tabs (Transformation, Reliability...). */
  onOpenTab?: (tab: string) => void;
}

type Snapshot = Record<string, StageConfig[]>;
const COMPACT_AT = 0.6;
const COUNTS_HIDDEN_BELOW = 0.5;
const INSPECTOR_WIDTH = 400;

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
  readOnly = false,
  fullscreen = false,
  onToggleFullscreen,
  onOpenTab,
}: WorkflowCanvasProps) => {
  const { mode: themeMode } = useThemeMode();
  const watched = Form.useWatch([], { form, preserve: true }) as Record<string, any> | undefined;
  const values = watched && Object.keys(watched).length ? watched : (form.getFieldsValue(true) as Record<string, any>);
  const [toast, holder] = message.useMessage();

  const [mode, setMode] = useState<'configure' | 'executions'>('configure');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A flow with many deliveries starts with all but the first folded into one step each.
  const [folded, setFolded] = useState<number[]>(() => (targets.length > 3 ? targets.slice(1).map((_, index) => index + 1) : []));
  const [query, setQuery] = useState('');
  const history = useRef<{ past: Snapshot[]; future: Snapshot[] }>({ past: [], future: [] });
  const [, bump] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const data = useCanvasData({ integrationId, values, targets, readOnly });
  const execution = useExecution(integrationId, mode === 'executions');
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
        runnerLabels: data.runnerLabels,
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
      data.runnerLabels,
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
            runnerLabels: data.runnerLabels,
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
  const apply = (state: Snapshot) => {
    targets.forEach((target) => form.setFieldValue([...target.namePath, 'stages'], state[target.key] || []));
    bump((n) => n + 1);
  };
  const writeStages = (target: DeliveryTarget, next: StageConfig[]) => {
    history.current = { past: [...history.current.past, snapshot()].slice(-50), future: [] };
    form.setFieldValue([...target.namePath, 'stages'], next);
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

  const select = useCallback(
    (node: FlowNode) => {
      if (node.kind === 'group') {
        toggleGroup(node.group);
        return;
      }
      const wasOpen = Boolean(selectedId);
      setSelectedId(node.id);
      const box = boxOf(node, flow.compact);
      viewport.ensureVisible(
        { x: box.x, y: box.y, width: box.width, height: box.height },
        wasOpen ? viewport.size.width : viewport.size.width - INSPECTOR_WIDTH
      );
    },
    [flow.compact, selectedId, viewport]
  );

  // Executions: one delivery drawn over the flow.
  const group = loggedGroup;
  const trace =
    mode === 'executions' && execution.log ? traceExecution(flow, group, execution.log, execution.stageData) : null;

  const viewOf = (node: FlowNode): NodeView | undefined => {
    if (trace) return trace.nodes[node.id];
    const stage = node.stageIndex === undefined ? undefined : deliveries[node.group].stages[node.stageIndex];
    if (!stage) return undefined;
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
      if (!root || (!root.contains(document.activeElement) && document.activeElement !== document.body)) return;
      const typing = (event.target as HTMLElement | null)?.closest(
        'input, textarea, select, [contenteditable="true"], .monaco-editor'
      );
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
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
      } else if (event.key === 'Escape' && selectedId && !typing) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
  const sortedNodes = [...flow.nodes].sort((a, b) => a.group - b.group || a.row - b.row || (a.col === 'main' ? -1 : 1));
  const zoomLabel = `${Math.round(viewport.view.z * 100)}%`;
  const changedCount = data.impact ? data.impact.stages.filter((entry) => entry.change !== 'unchanged').length : 0;

  return (
    <div
      className={`wf wf-root${fullscreen ? ' wf-root--full' : ''}`}
      data-theme={themeMode === 'dark' ? 'dark' : 'light'}
    >
      {holder}
      <div className="wf-body">
        <div className="wf-main">
          <div className="wf-topbar">
            <div className="wf-group">
              <div className="wf-seg" role="group" aria-label="Mode">
                <button type="button" aria-pressed={mode === 'configure'} onClick={() => setMode('configure')}>
                  Configure
                </button>
                <button type="button" aria-pressed={mode === 'executions'} onClick={() => setMode('executions')}>
                  Executions
                </button>
              </div>
              {mode === 'configure' ? (
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
              ) : (
                <RunPicker
                  logs={execution.logs}
                  selectedId={execution.selectedId}
                  position={execution.position}
                  onSelect={execution.select}
                  onPrevious={execution.previous}
                  onNext={execution.next}
                />
              )}
            </div>
            <div className="wf-group">
              {mode === 'configure' && (
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
              )}
              <button type="button" className="wf-btn" onClick={viewport.fit}>
                Fit
              </button>
              {mode === 'executions' && !readOnly && (
                <button type="button" className="wf-btn wf-btn--primary" onClick={() => setMode('configure')}>
                  <Icon name="pencil" size={15} /> Edit workflow
                </button>
              )}
              {onToggleFullscreen && (
                <button type="button" className="wf-btn" aria-pressed={fullscreen} onClick={onToggleFullscreen}>
                  {fullscreen ? 'Exit full screen' : 'Full screen'}
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
              <Connectors flow={flow} states={trace?.edges} />
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
                    kind={node.kind}
                    eyebrow={node.eyebrow}
                    title={node.title}
                    summary={node.summary}
                    view={viewOf(node)}
                    selected={node.id === selectedId}
                    compact={flow.compact}
                    left={box.x}
                    top={box.y}
                    onSelect={() => select(node)}
                    onKeyNav={(key) => {
                      const next = neighbour(flow, node.id, key);
                      if (next) document.getElementById(next)?.focus();
                    }}
                  />
                );
              })}
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
                onView={viewport.setView}
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
                    ? `${changedCount} step${changedCount === 1 ? '' : 's'} changed · ${data.impact.totals.keepOldVersion.toLocaleString('en-US')} waiting check${data.impact.totals.keepOldVersion === 1 ? '' : 's'} keep their version${data.impact.totals.cancelled ? ` · ${data.impact.totals.cancelled} cancelled` : ''}${data.impact.totals.paused ? ` · ${data.impact.totals.paused} paused` : ''}`
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
            stats={factsOf(selected.group)?.stages.find((entry) => entry.stageId === selected.stageId)}
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
            onOpenTab={onOpenTab && ((tab) => onOpenTab(tab === 'transformation' && targets[0]?.actionIndex !== null ? 'multiAction' : tab))}
            onChanged={() => void execution.refetch()}
          />
        )}
      </div>
    </div>
  );
};
