import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Flow } from './model';
import { boxOf } from './model';
import type { Size, View } from './useViewport';
import { visibleRect } from './useViewport';

const WIDTH = 132;
const HEIGHT = 120;

/** The whole flow in miniature with the visible part framed; click or drag to move the view. */
export const Minimap = ({
  flow,
  view,
  size,
  selectedId,
  onView,
}: {
  flow: Flow;
  view: View;
  size: Size;
  selectedId: string | null;
  onView: (view: View) => void;
}) => {
  const scale = Math.min((WIDTH - 12) / flow.width, (HEIGHT - 12) / flow.height);
  const frame = visibleRect(view, size);
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointermove' && event.buttons !== 1) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const hostX = (event.clientX - bounds.left - 6) / scale;
    const hostY = (event.clientY - bounds.top - 6) / scale;
    onView({ ...view, x: size.width / 2 - hostX * view.z, y: size.height / 2 - hostY * view.z });
  };
  return (
    <div
      className="wf-minimap"
      role="img"
      aria-label="Overview of the workflow"
      data-no-pan
      onPointerDown={move}
      onPointerMove={move}
    >
      <svg width={WIDTH} height={HEIGHT} aria-hidden="true">
        <g transform={`translate(6 6) scale(${scale})`}>
          {flow.nodes.map((node) => {
            const box = boxOf(node, false);
            return (
              <rect
                key={node.id}
                x={box.x}
                y={box.y + 20}
                width={box.width}
                height={34}
                rx={6}
                fill={node.id === selectedId ? 'var(--wf-accent)' : 'var(--wf-border-strong)'}
              />
            );
          })}
          <rect
            x={frame.x}
            y={frame.y}
            width={frame.width}
            height={frame.height}
            fill="var(--wf-accent)"
            fillOpacity={0.05}
            stroke="var(--wf-accent)"
            strokeWidth={1.5 / scale}
          />
        </g>
      </svg>
    </div>
  );
};
