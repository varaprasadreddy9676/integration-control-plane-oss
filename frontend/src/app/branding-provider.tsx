import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getUIConfig, updateAdminUiConfig } from '../services/api';
import {
  DEFAULT_BRANDING,
  brandingDocumentTitle,
  normalizeBranding,
  type Branding,
} from './branding';

interface BrandingContextValue {
  branding: Branding;
  /** Persists organisation branding (administrators). */
  updateBranding: (next: Partial<Branding>) => Promise<void>;
  isSaving: boolean;
}

// A default keeps presentational components renderable outside the provider
// (unit tests, isolated previews); updates simply resolve without persisting.
const BrandingContext = createContext<BrandingContextValue>({
  branding: DEFAULT_BRANDING,
  updateBranding: async () => undefined,
  isSaving: false,
});

export const BrandingProvider = ({ children }: { children: ReactNode }) => {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);

  const { data } = useQuery({
    queryKey: ['ui-branding'],
    queryFn: getUIConfig,
    staleTime: 5 * 60_000,
    retry: false,
    // Before sign-in this call is unauthorised; the environment defaults apply.
    refetchOnWindowFocus: false,
  });

  const branding = useMemo(
    () => normalizeBranding((data as { branding?: unknown } | undefined)?.branding),
    [data]
  );

  useEffect(() => {
    document.title = brandingDocumentTitle(branding);
  }, [branding]);

  const updateBranding = async (next: Partial<Branding>) => {
    setIsSaving(true);
    try {
      await updateAdminUiConfig({ branding: normalizeBranding({ ...branding, ...next }) });
      await queryClient.invalidateQueries({ queryKey: ['ui-branding'] });
    } finally {
      setIsSaving(false);
    }
  };

  const value = useMemo(
    () => ({ branding, updateBranding, isSaving }),
    [branding, isSaving]
  );

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
};

export const useBranding = () => useContext(BrandingContext);
