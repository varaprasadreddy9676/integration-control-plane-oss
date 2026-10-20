import { useEffect, useState } from 'react';
import { Typography } from 'antd';
import { cssVar } from '../../design-system/utils';

interface RefreshCountdownProps {
  /** Milliseconds between auto-refreshes. Pass false/0 to disable the countdown. */
  intervalMs: number | false;
  /** Timestamp (ms) of the last completed fetch. */
  lastRefreshAt?: number;
  /** Text shown before the seconds value. */
  label?: string;
  fontSize?: number;
}

/**
 * Renders the "Auto-refresh in Ns" ticker.
 *
 * This exists as its own component ON PURPOSE. The countdown has to setState
 * once a second; when that state lived in a route component, the entire route
 * re-rendered every second. For a controlled AntD input that meant any text the
 * user was midway through typing — a date in the RangePicker especially — got
 * reconciled back to the last committed value before they could finish. Keeping
 * the ticking state in this leaf means the second-by-second update repaints one
 * line of text and nothing else.
 */
export const RefreshCountdown = ({
  intervalMs,
  lastRefreshAt,
  label = 'Auto-refresh in',
  fontSize = 11,
}: RefreshCountdownProps) => {
  const intervalSeconds = intervalMs ? Math.round(intervalMs / 1000) : 0;
  const [secondsLeft, setSecondsLeft] = useState<number>(intervalSeconds);

  useEffect(() => {
    if (!intervalMs) return;

    const tick = () => {
      if (!lastRefreshAt) {
        setSecondsLeft(intervalSeconds);
        return;
      }
      const nextRefreshAt = lastRefreshAt + intervalMs;
      setSecondsLeft(Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000)));
    };

    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [intervalMs, intervalSeconds, lastRefreshAt]);

  if (!intervalMs) return null;

  return (
    <Typography.Text
      type="secondary"
      aria-live="off"
      style={{ fontSize, whiteSpace: 'nowrap', color: cssVar.text.muted, fontVariantNumeric: 'tabular-nums' }}
    >
      {label} {secondsLeft}s
    </Typography.Text>
  );
};

const formatRemaining = (ms: number): string => {
  if (ms <= 0) return 'Now';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
};

interface CountdownToProps {
  /** ISO timestamp or ms epoch of the moment being counted down to. */
  target?: string | number | null;
  fallback?: string;
}

/**
 * "2d 5h" / "45s" until a future moment.
 *
 * Ticks once a second only when the remaining time is under two minutes —
 * above that the rendered string changes at most once a minute, so a
 * per-second tick is pure wasted render.
 */
export const CountdownTo = ({ target, fallback = '—' }: CountdownToProps) => {
  const targetMs = target ? new Date(target).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  const isNear = targetMs !== null && targetMs - now < 2 * 60 * 1000;

  useEffect(() => {
    if (!targetMs) return;
    const timer = window.setInterval(() => setNow(Date.now()), isNear ? 1000 : 30_000);
    return () => window.clearInterval(timer);
  }, [targetMs, isNear]);

  if (targetMs === null || Number.isNaN(targetMs)) return <>{fallback}</>;
  return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatRemaining(targetMs - now)}</span>;
};

interface SecondsAgoProps {
  /** Timestamp (ms) the data was last fetched. */
  since?: number;
  prefix?: string;
}

/** "Last updated: Ns ago", ticking in its own leaf for the same reason as above. */
export const SecondsAgo = ({ since, prefix = 'Last updated:' }: SecondsAgoProps) => {
  const [secondsAgo, setSecondsAgo] = useState(0);

  useEffect(() => {
    if (!since) return;
    const tick = () => setSecondsAgo(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [since]);

  if (!since) return null;
  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {prefix} {secondsAgo}s ago
    </span>
  );
};
