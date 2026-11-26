import { useState } from 'react';
import type { DeliveryLog } from '../../../mocks/types';
import type { StageRun } from '../../../services/stages-api';
import { Icon } from './CanvasNode';
import type { Flow } from './model';
import type { Trace } from './execution';

const stamp = (value?: string) =>
  value
    ? new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';

interface TraceRow {
  id: string;
  name: string;
  durationMs: number;
  failed: boolean;
}

/** One row per visited step, in the order they ran, with the time each took. */
const traceRows = (flow: Flow, trace: Trace, log: DeliveryLog, runs: StageRun[]): TraceRow[] => {
  const rows: TraceRow[] = [];
  for (const node of flow.nodes) {
    const view = trace.nodes[node.id];
    if (!view || view.state === 'unvisited') continue;
    const own = runs.filter((run) => run.stage.id === node.stageId);
    const durationMs =
      node.kind === 'send' ? Number(log.responseTimeMs) || 0 : own.reduce((sum, run) => sum + (run.durationMs || 0), 0);
    if (node.kind === 'send' || own.length > 0)
      rows.push({ id: node.id, name: node.title, durationMs, failed: view.state === 'failed' });
  }
  return rows;
};

const ms = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`);

/** The bottom bar and, opened, the trace of the delivery (spec 6.6). */
export const ExecutionDrawer = ({
  flow,
  trace,
  log,
  runs,
}: {
  flow: Flow;
  trace: Trace;
  log: DeliveryLog;
  runs: StageRun[];
}) => {
  const [open, setOpen] = useState(false);
  const rows = traceRows(flow, trace, log, runs);
  const total = Math.max(
    rows.reduce((sum, row) => sum + row.durationMs, 0),
    1
  );
  let cursor = 0;
  return (
    <div>
      {open && (
        <div className="wf-drawer" role="region" aria-label="Execution trace">
          <div
            className="ui-extracted-a9a78f5196"
          >
            <strong className="console-type-body">Trace</strong>
            <span className={`wf-chip wf-chip--${trace.outcome.tone === 'neutral' ? '' : trace.outcome.tone}`}>
              {trace.outcome.label}
            </span>
          </div>
          <div className="ui-extracted-13ba4b02a0">
            {rows.map((row) => {
              const left = (cursor / total) * 100;
              cursor += row.durationMs;
              return (
                <div key={row.id} className="wf-trace">
                  <span className="ui-extracted-dd98250d76">{row.name}</span>
                  <span className="wf-trace__bar">
                    <i
                      className={row.failed ? 'wf-trace--failed' : ''}
                      style={{ left: `${left}%`, width: `${Math.max((row.durationMs / total) * 100, 1)}%` }}
                    />
                  </span>
                  <span className="wf-mono ui-extracted-91d5a44878" >
                    {ms(row.durationMs)}
                  </span>
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="wf-help ui-extracted-4ee50a45fe" >
                No steps were recorded for this delivery.
              </div>
            )}
          </div>
        </div>
      )}
      <div className="wf-bottombar">
        <strong className="console-type-caption">Execution trace</strong>
        <span>
          <span className={`wf-chip wf-chip--${trace.outcome.tone === 'neutral' ? '' : trace.outcome.tone}`}>
            {trace.outcome.label}
          </span>{' '}
          {stamp(log.createdAt)}
        </span>
        <button
          type="button"
          className="wf-btn ui-extracted-f682e993ab"

          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Close' : 'Open'}
        </button>
      </div>
    </div>
  );
};
