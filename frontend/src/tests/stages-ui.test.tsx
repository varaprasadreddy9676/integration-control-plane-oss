import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Form } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import type { StageConfig, StageRun } from '../services/stages-api';

const api = vi.hoisted(() => ({
  getStageRunners: vi.fn(),
  getStageTemplates: vi.fn(),
  getStageRuntime: vi.fn(),
  stageFromTemplate: vi.fn(),
  validateStages: vi.fn(),
  testStage: vi.fn(),
  listCredentialOptions: vi.fn(),
}));
vi.mock('../services/stages-api', () => api);
vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ value, onChange }: any) => (
    <textarea aria-label="Script" value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

import {
  apiFieldErrors,
  errorsForStage,
  newStageId,
  outputsOf,
  scheduleSummary,
} from '../features/stages/components/delivery-tab/stageDraft';
import { SchemaForm, getPath, setPath } from '../features/stages/components/delivery-tab/SchemaForm';
import { StageRunView, buildStageCurl } from '../features/stages/components/StageRunView';
import { buildStageTabItems, StageSummaryTags } from '../features/stages/components/DeliveryStageTabs';
import { DeliveryTab } from '../features/stages/components/delivery-tab/DeliveryTab';
import { deliveriesOf, protocolOf, requestParts, stageCountOf } from '../features/stages/deliveryTargets';
import { sampleScope } from '../features/stages/components/delivery-tab/StageTestPanel';
import { RUNNERS } from './fixtures/stage-runners';
import { buildIntegrationSavePayload } from '../features/integrations/routes/integrationDetail/utils/savePayload';

const run = (overrides: Partial<StageRun> = {}): StageRun => ({
  runId: 'r1',
  deliveryId: 'd1',
  stage: { id: 'check', name: 'Ask the provider', hook: 'after_delivery', runner: 'script' },
  seq: 2,
  executionAttempt: 1,
  at: '2026-10-24T10:00:00Z',
  durationMs: 42,
  outcome: 'ok',
  status: 'READ',
  done: true,
  calls: [
    {
      id: 1,
      method: 'GET',
      url: 'https://api.provider.test/v1/messages?msgid=m-1',
      statusCode: 200,
      durationMs: 30,
      requestHeaders: { 'X-Api-Key': '[REDACTED]' },
      responseBody: { status: 'read', recipient: '[REDACTED]' },
      responseBodyCut: 'recording',
    },
  ],
  logs: [{ level: 'info', message: 'asked', at: '2026-10-24T10:00:00Z' }],
  ...overrides,
});

describe('stage draft helpers', () => {
  it('makes readable, unique IDs from names', () => {
    expect(newStageId('Ask the provider', [])).toBe('askTheProvider');
    expect(newStageId('Ask the provider', ['askTheProvider'])).toBe('askTheProvider2');
    expect(newStageId('2nd check!', [])).toBe('stage2ndCheck');
  });

  it('summarizes schedules and lists outputs', () => {
    expect(
      scheduleSummary({
        id: 'a',
        name: 'a',
        hook: 'after_delivery',
        runner: { type: 'script', config: {} },
        schedule: { checkAfterSeconds: [30, 3600] },
      })
    ).toBe('2 checks: 30 seconds, 1 hour after the send');
    expect(
      outputsOf(
        {
          id: 'h',
          name: 'h',
          hook: 'before_send',
          runner: { type: 'http', config: { extract: [{ name: 'token', from: 'response.body.t' }] } },
        },
        RUNNERS[1]
      )
    ).toEqual([{ name: 'token', type: 'string' }]);
  });

  it('maps server errors to the stage being edited', () => {
    const { runnerFields, other } = errorsForStage(
      [
        { path: 'stages[1].runner.config.url', message: 'A URL is required' },
        { path: 'stages[1].schedule.checkAfterSeconds[0]', message: 'Too short' },
        { path: 'stages[0].name', message: 'not mine' },
      ],
      1
    );
    expect(runnerFields).toEqual({ url: 'A URL is required' });
    expect(other).toEqual([{ path: 'schedule.checkAfterSeconds[0]', message: 'Too short' }]);
    expect(apiFieldErrors({ details: { details: [{ path: 'x', message: 'y' }] } })).toEqual([
      { path: 'x', message: 'y' },
    ]);
    expect(apiFieldErrors(new Error('plain'))).toEqual([]);
  });
});

describe('SchemaForm (generated from a runner schema)', () => {
  it('reads and writes nested paths without changing its input', () => {
    const before = { status: { map: { a: 'A' } } };
    const after = setPath(before, 'status.from', 'state');
    expect(after).toEqual({ status: { map: { a: 'A' }, from: 'state' } });
    expect(before).toEqual({ status: { map: { a: 'A' } } });
    expect(getPath(after, 'status.from')).toBe('state');
  });

  it('renders the runner fields and reports changes, with server errors next to their field', () => {
    const onChange = vi.fn();
    render(
      <ThemeProvider>
        <SchemaForm
          fields={RUNNERS[1].configSchema.fields as any}
          value={{ method: 'GET' }}
          errors={{ url: 'A URL is required' }}
          onChange={onChange}
        />
      </ThemeProvider>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('A URL is required');
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://api.test/x' } });
    expect(onChange).toHaveBeenLastCalledWith({ method: 'GET', url: 'https://api.test/x' });
    fireEvent.change(screen.getByLabelText('Status comes from'), { target: { value: 'state' } });
    expect(onChange).toHaveBeenLastCalledWith({ method: 'GET', status: { from: 'state' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add Headers' }));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'GET', headers: { '': '' } });
  });
});

describe('StageRunView', () => {
  it('shows each call as cURL and response, with what was hidden or shortened said plainly', () => {
    const { container } = render(
      <ThemeProvider>
        <StageRunView run={run()} />
      </ThemeProvider>
    );
    expect(screen.getByText('Check 2')).toBeInTheDocument();
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText(/X-Api-Key: \[REDACTED\]/)).toBeInTheDocument();
    expect(screen.getByText(/Shortened for storage/)).toBeInTheDocument();
    expect(screen.getByText('INFO asked')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-tag')).toHaveLength(0);
    expect(container.querySelectorAll('.ant-alert')).toHaveLength(0);
  });

  it('labels shadow runs, omitted bodies and errors', () => {
    render(
      <ThemeProvider>
        <StageRunView
          run={run({
            shadow: true,
            outcome: 'error',
            status: null,
            error: 'provider down',
            errorCode: 'NETWORK',
            calls: [{ id: 1, method: 'GET', url: 'https://x.test', statusCode: 200, bodiesOmitted: 'errors-only' }],
          })}
        />
      </ThemeProvider>
    );
    expect(screen.getByText('Shadow')).toBeInTheDocument();
    expect(screen.getByText(/recorded for failed calls only/)).toBeInTheDocument();
    expect(screen.getByText('provider down')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(document.body.querySelectorAll('.ant-tag')).toHaveLength(0);
    expect(document.body.querySelectorAll('.ant-alert')).toHaveLength(0);
  });

  it('writes a runnable-looking cURL with the body quoted', () => {
    expect(
      buildStageCurl({
        id: 1,
        method: 'POST',
        url: 'https://x.test/a',
        requestHeaders: { A: 'b' },
        requestBody: { it: "it's" },
      })
    ).toBe(`curl -X POST "https://x.test/a" \\\n  -H "A: b" \\\n  -d '{\n  "it": "it'\\''s"\n}'`);
  });
});

describe('delivery popup', () => {
  it('builds one tab per stage that ran, titled with its own name', () => {
    const tabs = buildStageTabItems({
      states: [
        {
          stageId: 'check',
          stageName: 'Ask the provider',
          hook: 'after_delivery',
          status: 'READ',
          done: true,
          outcome: 'ok',
          seq: 2,
          runs: 2,
        },
      ],
      runs: [
        run({ runId: 'a', seq: 1, status: 'SENT' }),
        run({ runId: 'b' }),
        run({ runId: 'c', stage: { id: 'pre', name: 'Check consent', hook: 'before_send', runner: 'http' } }),
      ],
    });
    expect(tabs.map((tab) => tab.key)).toEqual(['stage-check', 'stage-pre']);
    render(
      <ThemeProvider>
        {tabs[0].label}
        {tabs[0].endContent}
      </ThemeProvider>
    );
    expect(screen.getByText('Ask the provider')).toBeInTheDocument();
    expect(buildStageTabItems({ states: [], runs: [] })).toEqual([]);
  });

  it('ignores incomplete stage responses instead of crashing delivery details', () => {
    expect(buildStageTabItems({ states: [], runs: undefined as any })).toEqual([]);
    expect(buildStageTabItems({ states: undefined as any, runs: [] })).toEqual([]);
    expect(buildStageTabItems({ states: [], runs: [{ stage: null } as any] })).toEqual([]);
    expect(
      buildStageTabItems({
        states: [null] as any,
        runs: [run({ outcome: 'unexpected' as any, status: null })],
      })
    ).toHaveLength(1);
  });

  it('shows at most two stage statuses on a row, scheduled ones first, and the rest as +N', () => {
    render(
      <ThemeProvider>
        <StageSummaryTags
          summary={{
            gate: { status: 'OK', name: 'Gate', hook: 'before_send' },
            reply: { status: 'ACCEPTED', name: 'Reply', hook: 'after_response' },
            check: { status: 'READ', done: true, name: 'Check', hook: 'after_delivery' },
          }}
        />
      </ThemeProvider>
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
    expect(screen.getByText('Accepted')).toBeInTheDocument();
    expect(screen.queryByText('Ok')).not.toBeInTheDocument();
    expect(screen.getByTitle('Gate: Ok')).toBeInTheDocument();
  });

  it('shows the latest stage statuses on a delivery row', () => {
    render(
      <ThemeProvider>
        <StageSummaryTags
          summary={{
            check: { status: 'DELIVERED', done: false, name: 'Ask the provider' },
            quiet: { outcome: 'error' },
          }}
        />
      </ThemeProvider>
    );
    expect(screen.getByTitle('Ask the provider: Delivered')).toBeInTheDocument();
  });
});

describe('the Delivery tab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.setItem('stages-delivery-view', 'list');
    api.getStageRunners.mockResolvedValue(RUNNERS);
    api.getStageTemplates.mockResolvedValue([]);
    api.getStageRuntime.mockResolvedValue({
      ready: true,
      mode: 'host',
      isolated: true,
      problems: [],
      switchedOff: false,
    });
    api.listCredentialOptions.mockResolvedValue([]);
    api.validateStages.mockResolvedValue({ ok: true, errors: [], stages: [] });
  });

  const existing: StageConfig[] = [
    {
      id: 'first',
      name: 'First gate',
      hook: 'before_send',
      effect: 'gate',
      runner: { type: 'script', config: { code: 'return null;' } },
    },
    {
      id: 'second',
      name: 'Second gate',
      hook: 'before_send',
      effect: 'gate',
      runner: { type: 'script', config: { code: 'return null;' } },
    },
    {
      id: 'tell',
      name: 'Tell partner',
      hook: 'on_failure',
      runner: { type: 'script', config: { code: 'return null;' } },
    },
  ];

  const Harness = ({ initial }: { initial: Record<string, unknown> }) => {
    const [form] = Form.useForm();
    return (
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Form form={form} initialValues={initial}>
            <DeliveryTab form={form} targets={deliveriesOf(initial as any)} context={() => form.getFieldsValue(true)} />
            <button type="button" onClick={() => ((window as any).__values = form.getFieldsValue(true))}>
              read
            </button>
          </Form>
        </QueryClientProvider>
      </ThemeProvider>
    );
  };
  const values = () => {
    fireEvent.click(screen.getByText('read'));
    return (window as any).__values;
  };

  it('groups stages by where they run, in their order, and reorders within a group', async () => {
    render(<Harness initial={{ stages: existing }} />);
    await screen.findByText('First gate');
    const firstStep = screen.getByTestId('delivery-step-first');
    expect(firstStep).toHaveTextContent(/script/i);
    expect(firstStep).toHaveTextContent('Decides');
    expect(firstStep.querySelector('.ant-tag')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move First gate up' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Move First gate down' }));
    expect(values().stages.map((s: StageConfig) => s.id)).toEqual(['second', 'first', 'tell']);
    // The failure stage is alone in its group: it cannot move.
    expect(screen.getByRole('button', { name: 'Move Tell partner up' })).toBeDisabled();
  });

  it('keeps the unavailable runtime warning visible without an AntD alert', async () => {
    api.getStageRuntime.mockResolvedValueOnce({
      ready: false,
      mode: 'host',
      isolated: false,
      problems: ['The runtime is not enabled'],
      switchedOff: false,
    });
    const { container } = render(<Harness initial={{ stages: existing }} />);
    expect(await screen.findByText('Steps do not run on this server yet')).toBeInTheDocument();
    expect(container.querySelector('.astryx-banner')).toHaveTextContent('The runtime is not enabled');
    expect(container.querySelector('.ant-alert')).not.toBeInTheDocument();
  });

  it('switches a stage off and on, and removes it after confirming', async () => {
    render(<Harness initial={{ stages: existing }} />);
    fireEvent.click(await screen.findByRole('switch', { name: 'Run Tell partner' }));
    expect(values().stages[2].enabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tell partner' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(values().stages.map((s: StageConfig) => s.id)).toEqual(['first', 'second']));
  });

  it('adds a stage through the editor, checked by the server before it is kept', async () => {
    render(<Harness initial={{ stages: [] }} />);
    const add = await screen.findByRole('button', { name: 'Add a step: Later (scheduled)' });
    await waitFor(() => expect(add).not.toBeDisabled()); // once the runners are loaded
    fireEvent.click(add);
    fireEvent.click(await screen.findByText('HTTP request'));
    const drawer = await screen.findByRole('dialog');
    const settingsTab = within(drawer).getByRole('tab', { name: 'Settings' });
    const testTab = within(drawer).getByRole('tab', { name: 'Test' });
    expect(settingsTab).toHaveAttribute('aria-selected', 'true');
    expect(settingsTab).toHaveAttribute('aria-controls', 'stage-settings-panel');
    expect(drawer.querySelector('#stage-test-panel')).toHaveAttribute('hidden');
    fireEvent.click(testTab);
    expect(testTab).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(settingsTab);
    fireEvent.change(within(drawer).getByLabelText('Step name'), { target: { value: 'Ask Qikchat' } });

    api.validateStages.mockResolvedValueOnce({
      ok: false,
      errors: [{ path: 'stages[0].runner.config.url', message: 'A URL is required' }],
      stages: [],
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }));
    expect(await within(drawer).findByText('A URL is required')).toBeInTheDocument();
    expect(values().stages).toEqual([]);

    fireEvent.change(within(drawer).getByLabelText('URL'), { target: { value: 'https://api.qikchat.in/v1/messages' } });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(values().stages).toHaveLength(1));
    expect(values().stages[0]).toMatchObject({
      id: 'httpRequest1',
      name: 'Ask Qikchat',
      hook: 'after_delivery',
      effect: 'observe',
      runner: { type: 'http', config: { url: 'https://api.qikchat.in/v1/messages' } },
      schedule: { checkAfterSeconds: [30, 300, 3600, 86400] },
    });
    expect(api.validateStages.mock.lastCall?.[0]).toMatchObject({
      stages: [expect.objectContaining({ name: 'Ask Qikchat' })],
    });
  });

  it('marks a later check as the one to ask before sending again', async () => {
    const check: StageConfig = {
      id: 'ask',
      name: 'Ask the provider',
      hook: 'after_delivery',
      schedule: { checkAfterSeconds: [30] },
      runner: { type: 'script', config: { code: 'return null;' } },
    };
    render(<Harness initial={{ stages: [check] }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Ask the provider' }));
    const drawer = await screen.findByRole('dialog');
    const words = within(drawer).getByRole('combobox', { name: 'Status words that allow sending again' });
    fireEvent.change(words, { target: { value: 'not_found' } });
    fireEvent.keyDown(words, { key: 'Enter', keyCode: 13 });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(values().stages[0].verification).toEqual({ resendWhen: ['NOT_FOUND'] }));
    expect(api.validateStages.mock.lastCall?.[0].stages[0].verification).toEqual({ resendWhen: ['NOT_FOUND'] });
  });

  it('passes before-send outputs to the request through the Send bindings', async () => {
    render(
      <Harness
        initial={{
          stages: [
            {
              id: 'tok',
              name: 'Get a token',
              hook: 'before_send',
              runner: { type: 'script', config: { code: 'x' } },
              outputs: [{ name: 'token', type: 'string' }],
            },
          ],
        }}
      />
    );
    expect(await screen.findByText('{{ stages.tok.output.token }}')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Send header' }));
    fireEvent.change(screen.getByLabelText('Send header name 1'), { target: { value: 'Authorization' } });
    fireEvent.change(screen.getByLabelText('Send header value 1'), {
      target: { value: 'Bearer {{ stages.tok.output.token }}' },
    });
    expect(values().send).toEqual({ bindings: { headers: { Authorization: 'Bearer {{ stages.tok.output.token }}' } } });
  });

  it("an integration with actions edits each action's stages; the Send step offers what that delivery's request has", async () => {
    const actions = [
      { name: 'Webhook', kind: 'HTTP', targetUrl: 'https://a.test', stages: [existing[0]] },
      { name: 'Mail', kind: 'COMMUNICATION', communicationConfig: { channel: 'EMAIL' }, stages: [] },
    ];
    render(<Harness initial={{ actions }} />);
    expect(await screen.findByText('First gate')).toBeInTheDocument();
    expect(screen.getByText('Extra headers')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Mail · Email'));
    await waitFor(() => expect(screen.queryByText('First gate')).not.toBeInTheDocument());
    expect(screen.queryByText('Extra headers')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add Send message field' }));
    fireEvent.change(screen.getByLabelText('Send message field name 1'), { target: { value: 'to' } });
    fireEvent.change(screen.getByLabelText('Send message field value 1'), { target: { value: '{{ event.email }}' } });
    expect(values().actions[1].send).toEqual({ bindings: { fields: { to: '{{ event.email }}' } } });
    expect(values().actions[0].stages.map((s: StageConfig) => s.id)).toEqual(['first']);

    const add = screen.getByRole('button', { name: 'Add a step: On failure' });
    await waitFor(() => expect(add).not.toBeDisabled());
    fireEvent.click(add);
    fireEvent.click(await screen.findByText('Script'));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(values().actions[1].stages).toHaveLength(1));
    expect(api.validateStages.mock.lastCall?.[0]).toMatchObject({ actionIndex: 1 });
  });

  it('warns when stages cannot run on this server', async () => {
    api.getStageRuntime.mockResolvedValue({
      ready: false,
      mode: 'host',
      isolated: false,
      problems: ['unshare is not installed'],
      switchedOff: false,
    });
    render(<Harness initial={{ stages: existing }} />);
    expect(await screen.findByText('Steps do not run on this server yet')).toBeInTheDocument();
    expect(screen.getByText('unshare is not installed')).toBeInTheDocument();
  });
});

describe('deliveries', () => {
  it('an integration sends once, or once per action; each kind of delivery is the same to stages', () => {
    expect(deliveriesOf({})).toEqual([expect.objectContaining({ namePath: [], protocol: 'http', actionIndex: null })]);
    expect(
      deliveriesOf({
        actions: [{ name: 'S', kind: 'COMMUNICATION', communicationConfig: { channel: 'SMS' } }, { kind: 'HL7_MLLP' }],
      })
    ).toEqual([
      expect.objectContaining({ label: 'S', namePath: ['actions', 0], protocol: 'sms', actionIndex: 0 }),
      expect.objectContaining({ label: 'Action 2', protocol: 'hl7', actionIndex: 1 }),
    ]);
    expect(protocolOf({ kind: 'COMMUNICATION', communicationConfig: { channel: 'WHATSAPP' } })).toBe('whatsapp');
    expect(requestParts('http')).toEqual(['headers', 'query', 'fields']);
    expect(requestParts('email')).toEqual(['fields']);
    expect(stageCountOf({ stages: [{}], actions: [{ stages: [{}, {}] }, {}] })).toBe(3);
  });

  it('a sample run shows the stage the same shape as a real delivery of its kind', () => {
    const stage = { id: 'c', name: 'c', hook: 'after_response', runner: { type: 'script', config: {} } } as StageConfig;
    expect(
      sampleScope(stage, { event: {}, request: null, code: 'SENT', response: { id: 1 }, protocol: 'sms' }).delivery
    ).toMatchObject({
      response: { protocol: 'sms', ok: true, status: null, code: 'SENT', body: { id: 1 } },
    });
    expect(sampleScope(stage, { event: {}, request: null, code: '503', response: 'down' }).delivery).toMatchObject({
      response: { protocol: 'http', ok: false, status: 503 },
    });
  });
});

describe('saving the integration', () => {
  it('sends stages, Send bindings and the switch as they are in the form', () => {
    const stages = [{ id: 'a', name: 'A', hook: 'on_failure', runner: { type: 'script', config: { code: 'x' } } }];
    const payload = buildIntegrationSavePayload({
      values: { name: 'n', stages, send: { bindings: { query: { a: 'b' } } }, stagesPaused: false },
      lifecycleRules: [],
      transformationMode: 'NONE',
    } as any);
    expect(payload).toMatchObject({ stages, send: { bindings: { query: { a: 'b' } } }, stagesPaused: false });
    expect(
      buildIntegrationSavePayload({ values: { name: 'n' }, lifecycleRules: [], transformationMode: 'NONE' } as any)
        .stages
    ).toBeUndefined();
  });
});
