import { describe, expect, it } from 'vitest';
import { buildIntegrationSavePayload } from '../features/integrations/routes/integrationDetail/utils/savePayload';

describe('outbound integration form save payload', () => {
  it('keeps editable top-level fields when rebuilding the request payload', () => {
    const payload = buildIntegrationSavePayload({
      values: {
        name: 'Lab order rule',
        eventType: 'LAB_ORDER_SENT_TO_EXTERNAL',
        scope: 'INCLUDE_CHILDREN',
        excludedOrgUnits: [1451],
        provider: 'Northwind LIS',
        httpMethod: 'POST',
        outgoingAuthType: 'NONE',
        isActive: true,
        timeoutMs: 15000,
        retryCount: 3,
        rateLimits: { enabled: true, maxRequests: 25, windowSeconds: 60 },
      },
      existingIntegration: {
        id: 'integration-1',
        tenantId: 145,
        entityName: 'Org 145',
        lookups: [
          {
            type: 'LAB',
            sourceField: 'sourceCode',
            targetField: 'targetCode',
            unmappedBehavior: 'PASSTHROUGH',
          },
        ],
      },
      lifecycleRules: [],
      transformationMode: 'SCRIPT',
    });

    expect(payload).toMatchObject({
      id: 'integration-1',
      provider: 'Northwind LIS',
      excludedOrgUnits: [1451],
      rateLimits: { enabled: true, maxRequests: 25, windowSeconds: 60 },
      lookups: [
        {
          type: 'LAB',
          sourceField: 'sourceCode',
          targetField: 'targetCode',
          unmappedBehavior: 'PASSTHROUGH',
        },
      ],
    });
  });

  it('sends pre-delivery checks without cleared optional inputs', () => {
    const payload = buildIntegrationSavePayload({
      values: {
        preDeliveryChecks: [
          { name: '', urlPath: 'document.link', method: 'GET', timeoutMs: null, expectedContentTypes: [], minBytes: 1000 },
        ],
      },
      lifecycleRules: [],
      transformationMode: 'SCRIPT',
    });

    expect(payload.preDeliveryChecks).toEqual([{ urlPath: 'document.link', method: 'GET', minBytes: 1000 }]);
  });

  it('clears pre-delivery checks when all are removed and leaves them alone when not loaded', () => {
    const build = (preDeliveryChecks: unknown) =>
      buildIntegrationSavePayload({ values: { preDeliveryChecks }, lifecycleRules: [], transformationMode: 'SCRIPT' })
        .preDeliveryChecks;

    expect(build([])).toBeNull();
    expect(build(null)).toBeNull();
    expect(build(undefined)).toBeUndefined();
  });
});
