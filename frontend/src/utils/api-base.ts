/**
 * Resolves the API base URL. A relative value ("/api/v1") resolves against
 * the page's own origin, so one build works on any host behind a proxy that
 * forwards /api to the backend (the Docker image's nginx does).
 */
export const resolveApiBase = (raw: string | undefined, fallback = 'http://localhost:4000/api/v1'): string => {
  const value = (raw || fallback).replace(/\/+$/, '');
  if (value.startsWith('/') && typeof window !== 'undefined') {
    return `${window.location.origin}${value}`;
  }
  return value;
};
