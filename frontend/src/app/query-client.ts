import { hashKey, QueryClient } from '@tanstack/react-query';
import type { QueryKey } from '@tanstack/react-query';
import { getCurrentOrgId } from '../services/api';
import { getAuthUser } from '../utils/auth-storage';

interface AppQueryClientOptions {
  staleTime?: number;
  refetchOnWindowFocus?: boolean;
}

export const tenantAwareQueryKeyHash = (queryKey: QueryKey): string =>
  hashKey(['tenant-cache', getCurrentOrgId() ?? 'global', getAuthUser() ?? 'anonymous', queryKey]);

export const createAppQueryClient = (options: AppQueryClientOptions = {}): QueryClient =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: options.staleTime ?? 5 * 60 * 1000,
        refetchOnWindowFocus: options.refetchOnWindowFocus ?? false,
        queryKeyHashFn: tenantAwareQueryKeyHash,
      },
    },
  });
