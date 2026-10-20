import { useQuery } from '@tanstack/react-query';
import { getEventType } from '../../../../../services/api';

export const useEventTypeData = (eventType?: string) =>
  useQuery({
    queryKey: ['eventType', eventType],
    queryFn: () => getEventType(eventType!),
    enabled: Boolean(eventType) && eventType !== '*',
    staleTime: 5 * 60 * 1000,
  });
