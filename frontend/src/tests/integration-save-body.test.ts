import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createIntegration, updateIntegration } from '../services/api';

const sentBody = () => JSON.parse(String((vi.mocked(globalThis.fetch).mock.calls[0][1] as RequestInit).body));

// The page builds one explicit save payload; the client must not drop a field of it on the way to the server.
describe('what saving an integration sends', () => {
  beforeEach(() => {
    localStorage.setItem('integration_gateway_token', 't');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  const payload = {
    name: 'n',
    eventType: 'E',
    targetUrl: 'https://a.example',
    httpMethod: 'POST',
    stages: [{ id: 's', name: 'S', hook: 'before_send', runner: { type: 'script', config: { code: 'return null;' } } }],
    send: { url: 'x' },
    stagesPaused: true,
    deliveryFollowUp: { enabled: true, script: 'return {};', checkAfterSeconds: [30] },
    preDeliveryChecks: [{ type: 'URL_REACHABLE' }],
  } as any;

  it('sends the steps, the follow-up and the pre-delivery checks on update', async () => {
    await updateIntegration('1', payload);
    expect(sentBody()).toMatchObject({
      stages: payload.stages,
      send: payload.send,
      stagesPaused: true,
      deliveryFollowUp: payload.deliveryFollowUp,
      preDeliveryChecks: payload.preDeliveryChecks,
    });
  });

  it('and on create', async () => {
    await createIntegration(payload);
    expect(sentBody()).toMatchObject({ stages: payload.stages, deliveryFollowUp: payload.deliveryFollowUp, preDeliveryChecks: payload.preDeliveryChecks });
  });
});
