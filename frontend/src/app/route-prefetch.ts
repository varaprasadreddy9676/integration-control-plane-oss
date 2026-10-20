/**
 * Start loading a detail page's code when the pointer reaches a link to it, so
 * the click lands on a ready page (and the title morph has something to land
 * on) instead of a loading spinner. Same import specifiers as App.tsx's lazy
 * routes, so the bundler shares the chunk.
 */
const loaders = {
  integration: () => import('../features/integrations/routes/IntegrationDetailRoute'),
  inbound: () => import('../features/inbound-integrations'),
  scheduledJob: () => import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute'),
  template: () => import('../features/templates/routes/TemplateDetailRoute'),
} as const;

export type DetailRouteKind = keyof typeof loaders;

const started = new Set<DetailRouteKind>();

export function prefetchDetailRoute(kind: DetailRouteKind): void {
  if (started.has(kind)) return;
  started.add(kind);
  // A failed prefetch is retried on the next hover; navigation loads it anyway.
  loaders[kind]().catch(() => started.delete(kind));
}
