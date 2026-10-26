import { useQuery } from '@tanstack/react-query';
import { getLogById } from '../../../services/api';
import { getDeliveryStages } from '../../../services/stages-api';

/** One delivery in full: the log and what its steps did (opened from Delivery Logs). */
export function useExecution(logId: string | undefined) {
  const enabled = Boolean(logId);
  const log = useQuery({
    queryKey: ['canvas-delivery', logId],
    queryFn: () => getLogById(logId as string),
    enabled,
  });
  const stages = useQuery({
    queryKey: ['canvas-delivery-stages', logId],
    queryFn: () => getDeliveryStages(logId as string),
    enabled,
  });
  return {
    loading: enabled && (log.isLoading || stages.isLoading),
    selectedId: logId ?? null,
    log: log.data,
    stageData: stages.data,
    refetch: () => Promise.all([log.refetch(), stages.refetch()]),
  };
}
