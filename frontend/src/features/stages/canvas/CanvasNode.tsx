import type { CSSProperties } from 'react';
import type { NodeKind } from './model';
import type { NodeView } from './execution';

/** Icons of the node types (spec 6.1): 24 x 24, stroke only. */
const ICONS: Record<
  NodeKind | 'plus' | 'search' | 'fit' | 'pencil' | 'shield' | 'cursor' | 'hand' | 'undo' | 'redo' | 'x',
  JSX.Element
> = {
  trigger: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />,
  transform: (
    <>
      <path d="M8 3H6a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2" />
      <path d="M16 3h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2" />
    </>
  ),
  http: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  script: (
    <>
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </>
  ),
  gate: (
    <>
      <path d="M12 3 21 12 12 21 3 12z" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </>
  ),
  send: (
    <>
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22l-4-9-9-4z" />
    </>
  ),
  retry: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  schedule: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  notify: (
    <>
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </>
  ),
  done: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  skipped: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </>
  ),
  failedEnd: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6" />
      <path d="m15 9-6 6" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  plus: (
    <>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  fit: (
    <>
      <path d="M4 9V4h5" />
      <path d="M20 9V4h-5" />
      <path d="M4 15v5h5" />
      <path d="M20 15v5h-5" />
    </>
  ),
  pencil: <path d="M4 20h4L19 9l-4-4L4 16v4z" />,
  shield: <path d="M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3z" />,
  cursor: <path d="m5 3 14 7-6 2-2 6L5 3z" />,
  hand: (
    <path d="M8 13V6a1.5 1.5 0 0 1 3 0v5m0-6a1.5 1.5 0 0 1 3 0v6m0-4a1.5 1.5 0 0 1 3 0v7a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-3l-2-4a1.5 1.5 0 0 1 2.5-1.6L8 14" />
  ),
  undo: (
    <>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10a6 6 0 0 1 0 12h-3" />
    </>
  ),
  redo: (
    <>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H10a6 6 0 0 0 0 12h3" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
};

export const Icon = ({ name, size = 18 }: { name: keyof typeof ICONS; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {ICONS[name]}
  </svg>
);

const DEFAULT_WORD: Partial<Record<NonNullable<NodeView['state']>, string>> = {
  ok: 'Done',
  failed: 'Failed',
  running: 'Running',
  skipped: 'Skipped',
  unvisited: 'Not taken',
  off: 'Off',
  issue: '1 issue',
  edited: 'Edited',
};
const HOLLOW = new Set(['skipped', 'off', 'unvisited']);

interface CanvasNodeProps {
  id: string;
  kind: NodeKind;
  eyebrow: string;
  title: string;
  summary: string;
  view?: NodeView;
  selected?: boolean;
  /** Found by the search box. */
  matched?: boolean;
  compact?: boolean;
  left: number;
  top: number;
  onSelect: () => void;
  onKeyNav?: (key: string) => void;
}

/** Past this many characters a title takes two lines instead of being cut short (spec 6.1). */
const TWO_LINE_AT = { full: 24, compact: 19 };

export const CanvasNode = ({
  id,
  kind,
  eyebrow,
  title,
  summary,
  view,
  selected,
  matched,
  compact,
  left,
  top,
  onSelect,
  onKeyNav,
}: CanvasNodeProps) => {
  const state = view?.state || '';
  const word = view?.meta ?? (state ? DEFAULT_WORD[state] : undefined);
  const twoLines = title.length > (compact ? TWO_LINE_AT.compact : TWO_LINE_AT.full);
  const shownEyebrow = view?.eyebrow || eyebrow;
  const shownSummary = view?.summary ?? summary;
  const noTopPort = kind === 'trigger';
  const noBottomPort = kind === 'done' || kind === 'skipped' || kind === 'failedEnd';
  const label = [title, shownEyebrow, word].filter(Boolean).join(', ');
  const style = { left, top, '--tint': `var(--t-${kind})` } as CSSProperties;
  const status = word ? (
    <span className={`wf-status wf-status--${state || 'ok'}${HOLLOW.has(state) ? ' wf-status--hollow' : ''}`}>
      {word}
    </span>
  ) : null;

  return (
    <button
      type="button"
      id={id}
      data-node-id={id}
      data-match={matched || undefined}
      className={`wf-node${compact ? ' wf-node--compact' : ''}${state ? ` wf-node--${state}` : ''}`}
      style={style}
      title={title}
      aria-pressed={Boolean(selected)}
      aria-label={label}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (onKeyNav && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          onKeyNav(event.key);
        }
      }}
    >
      {!noTopPort && <span className="wf-port wf-port--top" />}
      <span className="wf-node__tile">
        <Icon name={kind} size={compact ? 15 : 18} />
      </span>
      {compact ? (
        <>
          <span className={`wf-node__title${twoLines ? ' wf-node__title--two' : ''}`}>{title}</span>
          {word && (
            <span
              role="img"
              aria-label={word}
              className={`wf-node__dot wf-status--${state || 'ok'}${HOLLOW.has(state) ? ' wf-status--hollow' : ''}`}
            />
          )}
        </>
      ) : (
        <span className="wf-node__text">
          <span className="wf-node__eyebrow">
            <span>{shownEyebrow}</span>
            {twoLines && status}
          </span>
          <span className={`wf-node__title${twoLines ? ' wf-node__title--two' : ''}`}>{title}</span>
          {!twoLines && (
            <span className="wf-node__row">
              <span className="wf-node__summary">{shownSummary}</span>
              {status}
            </span>
          )}
        </span>
      )}
      {!noBottomPort && <span className="wf-port wf-port--bottom" />}
    </button>
  );
};
