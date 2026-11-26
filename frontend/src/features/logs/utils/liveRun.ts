/** Statuses of a run that has not finished: its output is still being written. */
const LIVE_STATUSES = new Set(['PENDING', 'RUNNING']);

export const isLiveStatus = (status: unknown): boolean => LIVE_STATUSES.has(String(status ?? '').toUpperCase());

/** "45s", "3m 07s" — how long a run has been going. */
export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`;
};
