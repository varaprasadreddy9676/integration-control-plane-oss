import { useEffect, useState } from 'react';
import { Spin } from "@/components/common/LegacyAntdControls";
import { InlineNotice as Notice } from './InlineNotice';
import { formatElapsed } from '../../features/logs/utils/liveRun';

/** Shown while a script job runs: that it is running, for how long, and that its output follows. */
export const LiveRunNotice = ({ startedAt, lines }: { startedAt?: string; lines: number }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const started = startedAt ? new Date(startedAt).getTime() : NaN;
  const elapsed = Number.isFinite(started) ? ` for ${formatElapsed(now - started)}` : '';
  return (
    <Notice
      type="info"
      icon={<Spin size="small" />}
      message={`Running${elapsed}`}
      description={
        lines === 0
          ? 'No output yet. Lines appear here as the job writes them, and this updates by itself.'
          : `${lines} line${lines === 1 ? '' : 's'} so far. This updates by itself.`
      }
    />
  );
};
