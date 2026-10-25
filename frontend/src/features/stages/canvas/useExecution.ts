import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getLogById, getLogs } from '../../../services/api';
import { getDeliveryStages } from '../../../services/stages-api';

/** The integration's recent deliveries and one of them in full: the log and what its stages did. */
export function useExecution(integrationId: string | undefined, enabled: boolean) {
  const [picked, setPicked] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['canvas-deliveries', integrationId],
    queryFn: () => getLogs({ integrationId, limit: 25 }),
    enabled: enabled && Boolean(integrationId),
    staleTime: 15 * 1000,
  });
  const logs = list.data?.data || [];
  // The newest failed delivery first (that is what people open this to look at), else the newest.
  const fallback = (logs.find((log) => log.status === 'FAILED' || log.status === 'ABANDONED') || logs[0])?.id ?? null;
  const selectedId = picked && logs.some((log) => log.id === picked) ? picked : fallback;
  useEffect(() => {
    if (picked && !logs.some((log) => log.id === picked) && logs.length) setPicked(null);
  }, [logs, picked]);

  const log = useQuery({
    queryKey: ['canvas-delivery', selectedId],
    queryFn: () => getLogById(selectedId as string),
    enabled: enabled && Boolean(selectedId),
  });
  const stages = useQuery({
    queryKey: ['canvas-delivery-stages', selectedId],
    queryFn: () => getDeliveryStages(selectedId as string),
    enabled: enabled && Boolean(selectedId),
  });

  const index = logs.findIndex((entry) => entry.id === selectedId);
  const step = (direction: -1 | 1) => {
    const next = logs[index + direction];
    if (next) setPicked(next.id);
  };
  return {
    logs,
    loading: list.isLoading || log.isLoading || stages.isLoading,
    selectedId,
    select: setPicked,
    previous: index > 0 ? () => step(-1) : undefined,
    next: index >= 0 && index < logs.length - 1 ? () => step(1) : undefined,
    position: index >= 0 ? `${index + 1} of ${logs.length}` : '',
    log: log.data,
    summary: logs[index],
    stageData: stages.data,
    refetch: () => Promise.all([list.refetch(), log.refetch(), stages.refetch()]),
  };
}
