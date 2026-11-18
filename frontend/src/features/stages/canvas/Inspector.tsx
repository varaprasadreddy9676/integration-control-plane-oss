import { useState } from 'react';
import { Collapse, Dropdown } from 'antd';
import { MoreOutlined } from '@ant-design/icons';
import type { DeliveryLog } from '../../../mocks/types';
import type {
  SaveImpact,
  SendBindings,
  StageConfig,
  StageRun,
  StageRunner,
  StageState,
} from '../../../services/stages-api';
import { StageRunsList } from '../components/StageRunView';
import { StageEditor } from '../components/delivery-tab/StageEditorDrawer';
import { canMoveStage, scheduleSummary } from '../components/delivery-tab/stageDraft';
import { FailurePanel } from './FailurePanel';
import type { StepEditors } from './stepEditors';
import { Icon } from './CanvasNode';
import type { FlowNode } from './model';

export type StageAction = 'up' | 'down' | 'duplicate' | 'toggle' | 'remove';

/** Where on the integration page each fixed step is configured. */
const HOME_TAB: Partial<Record<FlowNode['kind'], { tab: string; label: string }>> = {
  trigger: { tab: 'configuration', label: 'Open Configuration' },
  transform: { tab: 'transformation', label: 'Open Transformation' },
  send: { tab: 'configuration', label: 'Open Configuration' },
  retry: { tab: 'reliability', label: 'Open Reliability' },
};

const ABOUT: Record<string, string> = {
  trigger: 'The event that starts a delivery. Every action of this integration starts from it.',
  transform:
    'Builds the message from the event. It runs again on every retry, so a retry is never a copy of the last attempt.',
  send: 'The delivery itself: the target, its authentication and the answer. The steps you add run around it.',
  retry:
    'When a send fails in a way that can pass (a 5xx, a 429, a timeout, a network error) the delivery goes back to the top and tries again, up to the limit. A 4xx fails at once.',
  done: 'The delivery was accepted. Checks that run later only observe: they never change this outcome.',
  skipped: 'A gate decided not to send. Skipped is not an error and does not run the failure steps.',
  failedEnd: 'The delivery failed or was abandoned. The failure steps ran first.',
};

interface InspectorProps {
  node: FlowNode;
  mode: 'configure' | 'executions';
  readOnly: boolean;
  stage?: StageConfig;
  stages: StageConfig[];
  send?: SendBindings | null;
  runners: StageRunner[];
  integrationId?: string;
  integration: Record<string, unknown>;
  protocol: string;
  actionIndex: number | null;
  impact?: SaveImpact;
  /** What the server's check of the draft says is wrong with this step. */
  issues?: string[];
  runs: StageRun[];
  state?: StageState;
  log?: DeliveryLog;
  onApply: (stage: StageConfig) => void;
  onAction: (action: StageAction) => void;
  onClose: () => void;
  onOpenTab?: (tab: string) => void;
  stepEditors?: StepEditors;
  onChanged: () => void;
}

/** A step as it is when the integration is only being viewed: what it is and what it does, nothing to edit. */
const ReadOnlyStage = ({ stage, runner }: { stage: StageConfig; runner?: StageRunner }) => {
  const code = (stage.runner.config as { code?: unknown } | undefined)?.code;
  const schedule = scheduleSummary(stage);
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="wf-help">
        {runner?.label || stage.runner.type} · {stage.enabled === false ? 'Off' : 'On'}
        {schedule ? ` · ${schedule}` : ''}
      </div>
      {typeof code === 'string' && code.trim() && <pre className="wf-code wf-mono">{code}</pre>}
      <div className="wf-help">Choose Edit Integration to change this step.</div>
    </div>
  );
};

/**
 * The right-hand panel (spec 6.7). A stage opens its settings (the same editor as the
 * Delivery tab's drawer), a test, and its runs; the fixed steps explain themselves and
 * point to where they are configured; in Executions a failed send shows its cause first.
 */
/** The page's own sections for a fixed step, edited in place: one is shown as it is, several fold. */
const StepSections = ({ sections }: { sections: NonNullable<StepEditors[keyof StepEditors]> }) => {
  const present = sections.filter((section) => section.node);
  if (present.length === 1) return <>{present[0].node}</>;
  return (
    <Collapse
      bordered={false}
      defaultActiveKey={present[0]?.key}
      items={present.map((section) => ({ key: section.key, label: section.title, children: section.node }))}
    />
  );
};

export const Inspector = (props: InspectorProps) => {
  const {
    node,
    mode,
    readOnly,
    stage,
    stages,
    runners,
    impact,
    issues,
    runs,
    log,
    integrationId,
    onClose,
    onOpenTab,
    stepEditors,
    onAction,
  } = props;
  const [tab, setTab] = useState<'configure' | 'test' | 'runs'>(mode === 'executions' ? 'runs' : 'configure');
  const [reset, setReset] = useState(0);
  const runner = runners.find((candidate) => candidate.type === stage?.runner.type);
  const index = stage ? stages.findIndex((candidate) => candidate.id === stage.id) : -1;
  const waiting = stage ? impact?.stages.find((entry) => entry.stageId === stage.id)?.keepOldVersion : undefined;

  const menu =
    stage && !readOnly && mode === 'configure'
      ? {
          items: [
            { key: 'up', label: 'Move up', disabled: !canMoveStage(stages, index, -1) },
            { key: 'down', label: 'Move down', disabled: !canMoveStage(stages, index, 1) },
            { key: 'duplicate', label: 'Duplicate' },
            { key: 'toggle', label: stage.enabled === false ? 'Turn on' : 'Turn off' },
            { type: 'divider' as const },
            { key: 'remove', label: 'Remove', danger: true },
          ],
          onClick: ({ key }: { key: string }) => onAction(key as StageAction),
        }
      : null;

  const head = (
    <>
      <div className="wf-inspector__title">
        <span
          className="wf-node__tile"
          style={{ ['--tint' as string]: `var(--t-${node.kind})`, width: 36, height: 36, flexBasis: 36 }}
        >
          <Icon name={node.kind} size={20} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              font: '500 11px/14px var(--wf-font)',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: 'var(--wf-ink-3)',
            }}
          >
            {node.eyebrow}
          </div>
          <h3>{stage?.name || node.title}</h3>
        </div>
        {menu && (
          <Dropdown menu={menu} trigger={['click']}>
            <button type="button" className="wf-btn" aria-label="More actions for this step">
              <MoreOutlined />
            </button>
          </Dropdown>
        )}
        <button type="button" className="wf-btn" aria-label="Close the inspector" onClick={onClose}>
          <Icon name="x" size={16} />
        </button>
      </div>
    </>
  );

  if (!stage) {
    const home = HOME_TAB[node.kind];
    const editors = (stepEditors as Record<string, StepEditors[keyof StepEditors]> | undefined)?.[node.kind];
    const failedLog = log && (node.kind === 'send' || node.kind === 'failedEnd' || node.kind === 'retry');
    return (
      <aside className={`wf-inspector${editors ? ' wf-inspector--wide' : ''}`} tabIndex={-1} aria-label="Step details">
        <div className="wf-inspector__head">
          {head}
          <div style={{ height: 12 }} />
        </div>
        <div className="wf-inspector__body">
          {mode === 'executions' && failedLog && (
            <FailurePanel log={log} integrationId={integrationId} onChanged={props.onChanged} />
          )}
          <p className="wf-help" style={{ margin: 0 }}>
            {ABOUT[node.kind]}
          </p>
          <div className="wf-help wf-mono">{node.summary}</div>
          {editors && <StepSections sections={editors} />}
          {!editors && home && onOpenTab && !readOnly && (
            <div>
              <button type="button" className="wf-btn" onClick={() => onOpenTab(home.tab)}>
                {home.label}
              </button>
            </div>
          )}
        </div>
      </aside>
    );
  }

  return (
    <aside className="wf-inspector" tabIndex={-1} aria-label={`${stage.name} details`}>
      <StageEditor
        key={`${stage.id}-${reset}`}
        open
        stage={stage}
        index={index}
        stages={stages}
        send={props.send}
        runners={runners}
        integrationId={integrationId}
        integration={props.integration}
        protocol={props.protocol}
        actionIndex={props.actionIndex}
        onApply={props.onApply}
      >
        {(editor) => (
          <>
            <div className="wf-inspector__head">
              {head}
              <div className="wf-tabs" role="tablist">
                {(mode === 'executions' ? (['configure', 'runs'] as const) : (['configure', 'test'] as const)).map((key) => (
                  <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
                    {key === 'configure' ? 'Configure' : key === 'test' ? 'Test' : 'Runs'}
                    {key === 'runs' && runs.length > 0 && (
                      <span className="wf-chip" style={{ marginLeft: 6, height: 18 }}>
                        {runs.length}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
            <div className="wf-inspector__body">
              {issues && issues.length > 0 && (
                <div className="wf-callout" role="alert">
                  <h4>{issues.length === 1 ? 'Fix this before saving' : 'Fix these before saving'}</h4>
                  {issues.map((issue) => (
                    <p key={issue}>{issue}</p>
                  ))}
                </div>
              )}
              {tab === 'configure' &&
                (readOnly ? <ReadOnlyStage stage={stage} runner={runner} /> : editor.settings)}
              {tab === 'test' && editor.test}
              {tab === 'runs' &&
                (runs.length > 0 ? (
                  <StageRunsList runs={runs} />
                ) : (
                  <div className="wf-help">This step did not run for this delivery.</div>
                ))}
            </div>
            {!readOnly && mode === 'configure' && (
              <div className="wf-inspector__foot">
                <span>
                  Applying keeps the change in the draft; saving the integration applies it to new deliveries.
                  {stage.hook === 'after_delivery' &&
                    waiting !== undefined &&
                    waiting > 0 &&
                    ` ${waiting.toLocaleString('en-US')} scheduled check${waiting === 1 ? '' : 's'} already waiting keep the version they started with.`}
                </span>
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    className="wf-btn"
                    disabled={!editor.changed}
                    onClick={() => setReset((n) => n + 1)}
                  >
                    Discard edits
                  </button>
                  <button
                    type="button"
                    className="wf-btn wf-btn--primary"
                    disabled={editor.applying}
                    onClick={() => void editor.apply()}
                  >
                    {editor.applying ? 'Checking…' : 'Apply to draft'}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </StageEditor>
    </aside>
  );
};
