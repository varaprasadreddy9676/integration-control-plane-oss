import type { ReactNode } from 'react';
import './primitives.css';

export interface MetricStripProps {
  children: ReactNode;
  className?: string;
}

/**
 * A divided strip of metrics — one surface, not four floating cards. The
 * divider carries the grouping, so no metric needs its own border or shadow.
 */
export const MetricStrip = ({ children, className }: MetricStripProps) => (
  <div className={['ds-metrics', className].filter(Boolean).join(' ')}>{children}</div>
);

export interface MetricProps {
  label: ReactNode;
  value: ReactNode;
  /** A delta or share. Neutral by default; colour is reserved for status. */
  change?: ReactNode;
  detail?: ReactNode;
  /** Small decorative glyph in the label row. */
  icon?: ReactNode;
  /** `bad` colours the value only. Use for a failure count, nothing else. */
  tone?: 'neutral' | 'bad';
  /** Makes the metric a drill-down. The accessible name should carry the value. */
  onClick?: () => void;
  ariaLabel?: string;
}

export const Metric = ({
  label,
  value,
  change,
  detail,
  icon,
  tone = 'neutral',
  onClick,
  ariaLabel,
}: MetricProps) => {
  // A metric with no number should recede rather than carry the same mass as a
  // real figure — an empty failure card must not look like an incident.
  const placeholder = typeof value === 'string' && /^[—–-]$/.test(value.trim());
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper
      {...(onClick
        ? { type: 'button' as const, onClick, 'aria-label': ariaLabel ?? `${label}: ${value}` }
        : {})}
      className="ds-metric"
      data-tone={tone}
      data-placeholder={placeholder || undefined}
    >
      <div className="ds-metric__top">
        <span className="ds-metric__label">{label}</span>
        {icon && (
          <span className="ds-metric__icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="ds-metric__value-row">
        <span className="ds-metric__value">{value}</span>
        {change && <span className="ds-metric__change">{change}</span>}
      </div>
      {detail && <div className="ds-metric__detail">{detail}</div>}
    </Wrapper>
  );
};
