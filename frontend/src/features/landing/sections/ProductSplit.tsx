import type { ReactNode } from 'react';

interface ProductSplitProps {
  id: string;
  title: string;
  lead: string;
  points: Array<{ strong: string; rest: string }>;
  visual: ReactNode;
  flipped?: boolean;
}

/** Copy on one side, a piece of the console on the other. */
export default function ProductSplit({ id, title, lead, points, visual, flipped }: ProductSplitProps) {
  return (
    <section id={id} className="pl-section">
      <div className={`pl-wrap split${flipped ? ' is-flipped' : ''}`}>
        <div>
          <div className="pl-head">
            <h2>{title}</h2>
            <p className="pl-lead">{lead}</p>
          </div>
          <ul className="split-points">
            {points.map((p) => (
              <li key={p.strong}>
                <strong>{p.strong}</strong> {p.rest}
              </li>
            ))}
          </ul>
        </div>
        <div className="split-media">{visual}</div>
      </div>
    </section>
  );
}
