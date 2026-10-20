import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { flowToPayload } from '../features/flowBuilder/state/flowToPayload';
import { payloadToFlow } from '../features/flowBuilder/state/payloadToFlow';
import { createDefaultOutboundEventFlow } from '../features/flowBuilder/state/flowSchema';
import type { BackendIntegrationPayload, FlowState } from '../features/flowBuilder/state/flowTypes';

const buildMultiActionFlow = (): FlowState =>
  ({
    name: 'Multi target delivery',
    mode: 'OUTBOUND_EVENT',
    orgId: 33,
    isActive: true,
    isValid: true,
    isDirty: true,
    errors: [],
    warnings: [],
    rateLimits: { enabled: false, maxRequests: 100, windowSeconds: 60 },
    edges: [],
    nodes: [
      {
        id: 'trigger-1',
        type: 'trigger' as const,
        position: { x: 0, y: 0 },
        data: {
          nodeType: 'trigger',
          label: 'Event',
          isValid: true,
          triggerType: 'OUTBOUND_EVENT',
          eventName: 'ORDER_READY',
        },
      },
      {
        id: 'multi-action-1',
        type: 'multiAction' as const,
        position: { x: 200, y: 0 },
        data: {
          nodeType: 'multiAction',
          label: 'Deliver',
          isValid: true,
          executeInParallel: true,
          continueOnError: true,
          resultAggregation: 'all',
          actions: [
            {
              id: 'action-1',
              name: 'CRM',
              enabled: true,
              url: 'https://crm.example.test/events',
              method: 'POST',
              headers: { 'X-Source': 'gateway' },
            },
          ],
        },
      },
    ],
  }) as FlowState;

describe('Flow Builder production contracts', () => {
  it('serializes multi-action endpoints using the delivery-engine field names', () => {
    const payload = flowToPayload(buildMultiActionFlow(), 33);

    expect(payload.actions).toEqual([
      {
        name: 'CRM',
        targetUrl: 'https://crm.example.test/events',
        httpMethod: 'POST',
        customHeaders: { 'X-Source': 'gateway' },
      },
    ]);
    expect(payload.actions?.[0]).not.toHaveProperty('url');
    expect(payload.actions?.[0]).not.toHaveProperty('method');
  });

  it('loads both canonical and legacy multi-action field names', () => {
    const base = {
      name: 'Existing',
      direction: 'OUTBOUND',
      orgId: 33,
      isActive: true,
      type: 'ORDER_READY',
      eventType: 'ORDER_READY',
      deliveryMode: 'IMMEDIATE',
    } satisfies Partial<BackendIntegrationPayload>;

    const canonical = payloadToFlow({
      ...base,
      actions: [{ name: 'Canonical', targetUrl: 'https://canonical.test', httpMethod: 'PUT' }],
    } as BackendIntegrationPayload);
    const legacy = payloadToFlow({
      ...base,
      actions: [{ name: 'Legacy', url: 'https://legacy.test', method: 'POST' }],
    } as BackendIntegrationPayload);

    expect((canonical.nodes.find((node) => node.type === 'multiAction')?.data as any).actions[0]).toMatchObject({
      url: 'https://canonical.test',
      method: 'PUT',
    });
    expect((legacy.nodes.find((node) => node.type === 'multiAction')?.data as any).actions[0]).toMatchObject({
      url: 'https://legacy.test',
      method: 'POST',
    });
  });

  it('does not ship hard-coded tenant defaults or visible coming-soon editors', () => {
    const listRoute = readFileSync(
      resolve(__dirname, '../features/flowBuilder/routes/FlowBuilderListRoute.tsx'),
      'utf8'
    );
    const detailRoute = readFileSync(
      resolve(__dirname, '../features/flowBuilder/routes/FlowBuilderRoute.tsx'),
      'utf8'
    );
    const inspector = readFileSync(
      resolve(__dirname, '../features/flowBuilder/components/InspectorPanel.tsx'),
      'utf8'
    );

    expect(listRoute).not.toContain('orgId=100');
    expect(detailRoute).not.toContain("|| '100'");
    expect(inspector.toLowerCase()).not.toContain('coming soon');
  });

  it('does not place a non-executable filter node in new outbound flows', () => {
    const flow = createDefaultOutboundEventFlow(33);

    expect(flow.nodes.some((node) => node.type === 'filter')).toBe(false);
    expect(flow.edges).toContainEqual(expect.objectContaining({ source: 'trigger-1', target: 'transform-1' }));
  });
});
