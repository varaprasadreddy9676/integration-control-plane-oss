import type { EdgeState } from './execution';
import type { Flow } from './model';
import { pathOf } from './model';

interface Look {
  stroke: string;
  width: number;
  dash?: string;
  head: boolean;
}

/** Connector looks (spec 6.4). Colours are the canvas tokens, so light and dark share one set of rules. */
const LOOKS: Record<EdgeState | 'retry-configured', Look> = {
  configured: { stroke: 'var(--wf-connector)', width: 1.5, head: true },
  'retry-configured': { stroke: 'var(--wf-connector)', width: 1.5, dash: '5 5', head: true },
  taken: { stroke: 'var(--wf-taken)', width: 2, head: true },
  failure: { stroke: 'var(--wf-danger)', width: 2, head: true },
  retry: { stroke: 'var(--wf-retry)', width: 2, dash: '6 4', head: true },
  notTaken: { stroke: 'var(--wf-not-taken)', width: 1.5, dash: '4 4', head: false },
};

const lookOf = (state: EdgeState | undefined, dashed?: boolean): { key: string; look: Look } => {
  if (!state || state === 'configured')
    return {
      key: dashed ? 'retry-configured' : 'configured',
      look: dashed ? LOOKS['retry-configured'] : LOOKS.configured,
    };
  return { key: state, look: LOOKS[state] };
};

interface ConnectorsProps {
  flow: Flow;
  states?: Record<string, EdgeState>;
  /** Edge ids to draw as the insertion preview. */
  previewEdge?: string | null;
}

/** Every connector of the flow, in one SVG laid over the host. */
export const Connectors = ({ flow, states }: ConnectorsProps) => {
  const used = new Map<string, Look>();
  const paths = flow.edges.map((edge) => {
    const { key, look } = lookOf(states?.[edge.id], edge.dashed);
    used.set(key, look);
    return { edge, key, look };
  });
  return (
    <svg
      width={flow.width}
      height={flow.height}
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <defs>
        {[...used.entries()].map(([key, look]) => (
          <marker
            key={key}
            id={`wf-head-${key}`}
            markerWidth="5"
            markerHeight="5"
            refX="2"
            refY="2"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0 0 L4 2 L0 4 Z" fill={look.stroke} stroke="none" />
          </marker>
        ))}
      </defs>
      {paths.map(({ edge, key, look }) => (
        <path
          key={edge.id}
          data-edge={edge.id}
          d={pathOf(edge.points, look.head ? 3 : 0)}
          stroke={look.stroke}
          strokeWidth={look.width}
          strokeDasharray={look.dash}
          markerEnd={look.head ? `url(#wf-head-${key})` : undefined}
          style={{ transition: 'stroke 160ms cubic-bezier(.2,0,0,1)' }}
        />
      ))}
    </svg>
  );
};
