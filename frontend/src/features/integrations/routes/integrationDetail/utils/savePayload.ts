import type { IntegrationConfig } from '../../../../../mocks/types';

interface BuildIntegrationSavePayloadOptions {
  values: Record<string, any>;
  existingIntegration?: Partial<IntegrationConfig> | null;
  outgoingAuthConfig?: Record<string, unknown> | null;
  subjectExtraction?: IntegrationConfig['subjectExtraction'];
  lifecycleRules: IntegrationConfig['lifecycleRules'];
  conditionConfig?: IntegrationConfig['conditionConfig'];
  transformationMode: IntegrationConfig['transformationMode'];
}

/**
 * Keep the editable top-level form fields in one explicit save contract.
 * This prevents a field from being rendered and restored correctly but then
 * silently disappearing when the route rebuilds the request payload.
 */
export const buildIntegrationSavePayload = ({
  values,
  existingIntegration,
  outgoingAuthConfig,
  subjectExtraction,
  lifecycleRules,
  conditionConfig,
  transformationMode,
}: BuildIntegrationSavePayloadOptions): IntegrationConfig => ({
  id: existingIntegration?.id ?? `wh_${Date.now()}`,
  name: values.name,
  eventType: values.eventType,
  tenantId: existingIntegration?.tenantId ?? 100,
  entityName: existingIntegration?.entityName ?? 'Current Entity',
  scope: values.scope,
  excludedOrgUnits: values.excludedOrgUnits,
  provider: values.provider,
  targetUrl: values.targetUrl,
  httpMethod: values.httpMethod,
  outgoingAuthType: values.outgoingAuthType,
  outgoingAuthConfig: outgoingAuthConfig ?? undefined,
  isActive: values.isActive,
  timeoutMs: values.timeoutMs,
  retryCount: values.retryCount,
  rateLimits: values.rateLimits,
  deliveryMode: values.deliveryMode,
  schedulingConfig: values.schedulingConfig,
  resourceType: values.resourceType || null,
  subjectExtraction,
  lifecycleRules,
  conditionConfig,
  transformationMode,
  updatedAt: new Date().toISOString(),
  // Lookups are not editable in this form; preserve them on every save.
  lookups: existingIntegration?.lookups ?? [],
});
