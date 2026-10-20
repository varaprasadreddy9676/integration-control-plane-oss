import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getIntegrationById,
  getIntegrations,
  getAllEventTypes,
  getEventType,
  getUIConfig
} from '../../../../../services/api';
import { useTenant } from '../../../../../app/tenant-context';

export const useIntegrationQueries = (id: string | undefined, selectedEventType?: string) => {
  const { orgId } = useTenant();

  const { data: existingIntegration, isLoading: integrationLoading } = useQuery({
    queryKey: ['integration', id],
    queryFn: () => (id ? getIntegrationById(id) : Promise.resolve(undefined)),
    enabled: Boolean(id && id !== 'new'),
    staleTime: 30_000,
  });

  const { data: allIntegrations = [] } = useQuery({
    queryKey: ['integrations'],
    queryFn: () => getIntegrations(),
    staleTime: 60_000,
  });

  const { data: eventTypes = [], isLoading: eventTypesLoading } = useQuery({
    queryKey: ['eventTypeCatalog', orgId],
    queryFn: getAllEventTypes,
    staleTime: 5 * 60 * 1000, // event catalogue changes rarely — 5 min matches backend cache TTL
  });

  const { data: uiConfig } = useQuery({
    queryKey: ['uiConfig'],
    queryFn: getUIConfig,
    staleTime: 5 * 60 * 1000,
  });

  const eventOptions = useMemo(() => {
    return ['*', ...eventTypes.map((et) => et.eventType)];
  }, [eventTypes]);

  const { data: selectedEventTypeData } = useQuery({
    queryKey: ['eventType', selectedEventType],
    queryFn: () => getEventType(selectedEventType!),
    enabled: Boolean(selectedEventType) && selectedEventType !== '*',
    staleTime: 5 * 60 * 1000, // backend caches for 5 min — match it
  });

  return {
    existingIntegration,
    integrationLoading,
    allIntegrations,
    eventTypes,
    eventTypesLoading,
    uiConfig,
    eventOptions,
    selectedEventTypeData
  };
};
