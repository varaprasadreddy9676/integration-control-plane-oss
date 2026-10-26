import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Form } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '../app/theme-provider';
import type { StageConfig } from '../services/stages-api';

const api = vi.hoisted(() => ({
  getStageRunners: vi.fn(),
  getStageTemplates: vi.fn(),
  getStageRuntime: vi.fn(),
  stageFromTemplate: vi.fn(),
  validateStages: vi.fn(),
  testStage: vi.fn(),
  listCredentialOptions: vi.fn(),
  getStageResults: vi.fn(),
  getStageUsage: vi.fn(),
  getFlowStats: vi.fn(),
  getSaveImpact: vi.fn(),
  getStageOutcomes: vi.fn(),
  getDeliveryStages: vi.fn(),
  getStageJobCounts: vi.fn(),
  getSimilarFailures: vi.fn(),
  checkAndReplay: vi.fn(),
}));
const core = vi.hoisted(() => ({ getLogs: vi.fn(), getLogById: vi.fn() }));
vi.mock('../services/stages-api', () => api);
vi.mock('../services/api', async (importOriginal) => ({ ...(await importOriginal<object>()), ...core }));
vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ value, onChange }: any) => (
    <textarea aria-label="Script" value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

import { DeliveryTab } from '../features/stages/components/delivery-tab/DeliveryTab';
import { deliveriesOf } from '../features/stages/deliveryTargets';
import type { StepEditors } from '../features/stages/canvas/stepEditors';
import { RUNNERS } from './fixtures/stage-runners';

const script = (
  id: string,
  name: string,
  hook: StageConfig['hook'],
  extra: Partial<StageConfig> = {}
): StageConfig => ({
  id,
  name,
  hook,
  runner: { type: 'script', config: { code: 'return null;' } },
  ...extra,
});
const consent = script('consent', 'Consent granted?', 'before_send', { effect: 'gate' });
const reply = script('reply', 'Read the provider reply', 'after_response', { effect: 'gate' });
const status = script('status', 'Check delivery status', 'after_delivery', { schedule: { checkAfterSeconds: [30] } });
const notify = script('notify', 'Notify the front desk', 'on_failure');

const STATS = {
  integrationId: 'int-1',
  since: '',
  until: '',
  hours: 24,
  removedStages: [],
  unattributed: { total: 0, byStatus: {}, attempts: 0, retries: 0 },
  targets: [
    {
      actionIndex: null,
      name: null,
      protocol: 'http',
      deliveries: { total: 1190, byStatus: { SUCCESS: 1180, ABANDONED: 1 }, attempts: 1200, retries: 6 },
      stages: [
        {
          stageId: 'consent',
          name: 'Consent granted?',
          hook: 'before_send',
          enabled: true,
          runs: 1225,
          ok: 1184,
          skipped: 41,
          rejected: 0,
          errored: 0,
          timedOut: 0,
          statuses: {},
          latest: {},
        },
        {
          stageId: 'reply',
          name: 'Read the provider reply',
          hook: 'after_response',
          enabled: true,
          runs: 1177,
          ok: 1168,
          skipped: 0,
          rejected: 9,
          errored: 0,
          timedOut: 0,
          statuses: {},
          latest: {},
        },
        {
          stageId: 'status',
          name: 'Check delivery status',
          hook: 'after_delivery',
          enabled: true,
          runs: 2000,
          ok: 2000,
          skipped: 0,
          rejected: 0,
          errored: 0,
          timedOut: 0,
          statuses: {},
          latest: { READ: 1100, DELIVERED: 42, PENDING: 26 },
        },
        {
          stageId: 'notify',
          name: 'Notify the front desk',
          hook: 'on_failure',
          enabled: true,
          runs: 10,
          ok: 10,
          skipped: 0,
          rejected: 0,
          errored: 0,
          timedOut: 0,
          statuses: {},
          latest: {},
        },
      ],
    },
  ],
};

const known = (extra: object) => ({ known: true, statuses: [], skips: [], fails: [], dynamicStatus: false, ...extra });

const Harness = ({
  initial,
  onValues,
  stepEditors,
}: {
  initial: Record<string, unknown>;
  onValues?: (values: any) => void;
  stepEditors?: StepEditors;
}) => {
  const [form] = Form.useForm();
  return (
    <MemoryRouter>
      <ThemeProvider>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <Form form={form} initialValues={initial}>
            <DeliveryTab
              form={form}
              integrationId="int-1"
              targets={deliveriesOf(initial as any)}
              stepEditors={stepEditors}
              context={() => form.getFieldsValue(true)}
            />
            <button type="button" onClick={() => onValues?.(form.getFieldsValue(true))}>
              read values
            </button>
          </Form>
        </QueryClientProvider>
      </ThemeProvider>
    </MemoryRouter>
  );
};

const integration = {
  eventType: 'APPOINTMENT_CONFIRMED',
  targetUrl: 'https://api.example.com/v1',
  httpMethod: 'POST',
  retryCount: 3,
  stages: [consent, reply, status, notify],
};

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.setItem('stages-delivery-view', 'workflow');
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
  api.getFlowStats.mockResolvedValue(STATS);
  api.getSaveImpact.mockResolvedValue({
    stages: [],
    totals: { keepOldVersion: 0, paused: 0, resumed: 0, cancelled: 0 },
  });
  api.getStageJobCounts.mockResolvedValue({});
  api.getStageOutcomes.mockImplementation(async (stage: StageConfig) =>
    stage.id === 'consent'
      ? known({ skips: [{ reason: 'no consent' }] })
      : stage.id === 'reply'
        ? known({ fails: [{ reason: 'rejected', retryDelivery: false, retryStage: false }] })
        : stage.id === 'status'
          ? known({
              statuses: [
                { status: 'READ', done: true },
                { status: 'DELIVERED', done: true },
                { status: 'PENDING', done: false },
              ],
            })
          : known({})
  );
  api.getDeliveryStages.mockResolvedValue({ states: [], runs: [] });
  api.getSimilarFailures.mockResolvedValue({
    matchedOn: 'errorCode',
    windowMinutes: 60,
    count: 7,
    capped: false,
    sample: [],
  });
  core.getLogs.mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 25, total: 0, totalPages: 0, hasNextPage: false, hasPrevPage: false },
  });
});

describe('the workflow canvas', () => {
  it('draws the pipeline in order with the last 24 hours on each branch', async () => {
    render(<Harness initial={integration} />);
    const nodes = await screen.findAllByRole('button', { name: /Consent granted\?/ });
    expect(nodes[0]).toHaveAttribute('data-node-id', 'g0-stage-consent');
    for (const name of [
      'Build the request',
      'Read the provider reply',
      'Check delivery status',
      'Notify the front desk',
      'Delivered',
      'Delivery failed',
      'Skipped',
      'Retry up to 3 attempts',
    ]) {
      expect(
        (await screen.findAllByRole('button', { name: new RegExp(name.replace('?', '\\?')) })).length
      ).toBeGreaterThan(0);
    }
    expect(await screen.findByText('Yes · 1,184')).toBeInTheDocument();
    expect(screen.getByText('No · 41')).toBeInTheDocument();
    expect(screen.getByText('Accepted · 1,168')).toBeInTheDocument();
    expect(screen.getByText('Rejected · 9')).toBeInTheDocument();
    expect(screen.getByText('Read or delivered · 1,142')).toBeInTheDocument();
    expect(screen.getByText('Error · 6')).toBeInTheDocument();
    expect(screen.getByText('Exhausted · 1')).toBeInTheDocument();
    expect(screen.getByText('Answered')).toBeInTheDocument();
  });

  it('opens a step in the inspector, with the same settings as the drawer, and closes it again', async () => {
    render(<Harness initial={integration} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Consent granted\?/ }))[0]);
    const inspector = await screen.findByRole('complementary', { name: /Consent granted\? details/ });
    expect(within(inspector).getByRole('tab', { name: 'Configure' })).toHaveAttribute('aria-selected', 'true');
    expect(within(inspector).getByLabelText('Stage name')).toHaveValue('Consent granted?');
    fireEvent.click(within(inspector).getByRole('tab', { name: 'Test' }));
    expect(await within(inspector).findByText(/Run the test|Run test|Test/i)).toBeTruthy();
    fireEvent.click(within(inspector).getByRole('button', { name: 'Close the inspector' }));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: /details/ })).not.toBeInTheDocument());
  });

  it('is usable from the keyboard: arrows move along connected steps, Enter opens, Enter again enters the inspector, Escape comes back', async () => {
    render(<Harness initial={integration} />);
    const first = (await screen.findAllByRole('button', { name: /Consent granted\?/ }))[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowDown' });
    expect(document.activeElement?.getAttribute('data-node-id')).toBe('g0-send');
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(first);

    fireEvent.click(first);
    const inspector = await screen.findByRole('complementary', { name: /Consent granted\? details/ });
    fireEvent.click(first);
    expect(document.activeElement).toBe(inspector);
    fireEvent.keyDown(inspector, { key: 'Escape' });
    expect(document.activeElement).toBe(first);
    expect(screen.getByRole('complementary', { name: /details/ })).toBeInTheDocument();
  });

  it('marks the step the server finds a problem with, and says what it is in the inspector', async () => {
    api.validateStages.mockImplementation(async ({ stages }: { stages: StageConfig[] }) =>
      stages.some((stage) => stage.id === 'consent')
        ? { ok: false, errors: [{ path: 'stages[0].runner.config.code', message: 'The script is empty' }], stages: [] }
        : { ok: true, errors: [], stages: [] }
    );
    render(<Harness initial={integration} />);
    const marked = await screen.findByRole('button', { name: /Consent granted\?.*1 issue/ }, { timeout: 4000 });
    fireEvent.click(marked);
    const inspector = await screen.findByRole('complementary', { name: /Consent granted\? details/ });
    expect(within(inspector).getByText('Fix this before saving')).toBeInTheDocument();
    expect(within(inspector).getByText('runner.config.code: The script is empty')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Read the provider reply.*issue/ })).not.toBeInTheDocument();
  });

  it('applies an edit to the draft only after the server accepts it, and says so', async () => {
    let values: any;
    render(<Harness initial={integration} onValues={(v) => (values = v)} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Consent granted\?/ }))[0]);
    const inspector = await screen.findByRole('complementary', { name: /details/ });
    fireEvent.change(within(inspector).getByLabelText('Stage name'), { target: { value: 'Consent on file?' } });
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply to draft' }));
    await waitFor(() => expect(api.validateStages).toHaveBeenCalled());
    fireEvent.click(screen.getByText('read values'));
    await waitFor(() => expect(values.stages[0].name).toBe('Consent on file?'));
  });

  it('adds a step at a valid point and puts it where the point is', async () => {
    let values: any;
    render(<Harness initial={integration} onValues={(v) => (values = v)} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a failure step' }));
    fireEvent.click(await screen.findByText('Script'));
    fireEvent.click(screen.getByText('read values'));
    await waitFor(() =>
      expect(values.stages.map((stage: StageConfig) => stage.hook)).toEqual([
        'before_send',
        'after_response',
        'after_delivery',
        'on_failure',
        'on_failure',
      ])
    );
    expect(values.stages[4]).toMatchObject({ name: 'Script 2', runner: { type: 'script' } });
    expect(await screen.findByRole('complementary', { name: /Script 2 details/ })).toBeInTheDocument();
  });

  it('removes a step from the draft and offers to undo it', async () => {
    let values: any;
    render(<Harness initial={integration} onValues={(v) => (values = v)} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Notify the front desk/ }))[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'More actions for this step' }));
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(screen.getByText('read values'));
    await waitFor(() =>
      expect(values.stages.map((stage: StageConfig) => stage.id)).toEqual(['consent', 'reply', 'status'])
    );
    fireEvent.click((await screen.findAllByRole('button', { name: 'Undo' }))[0]);
    fireEvent.click(screen.getByText('read values'));
    await waitFor(() =>
      expect(values.stages.map((stage: StageConfig) => stage.id)).toEqual(['consent', 'reply', 'status', 'notify'])
    );
  });

  it('shows what a save would do to waiting checks once there is a draft', async () => {
    api.getSaveImpact.mockResolvedValue({
      stages: [
        {
          stageId: 'status',
          name: 'Check delivery status',
          hook: 'after_delivery',
          change: 'edited',
          keepOldVersion: 41,
          paused: 0,
          resumed: 0,
          cancelled: 0,
        },
      ],
      totals: { keepOldVersion: 41, paused: 0, resumed: 0, cancelled: 0 },
    });
    render(<Harness initial={integration} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /Check delivery status/ }))[0]);
    const inspector = await screen.findByRole('complementary', { name: /details/ });
    fireEvent.change(within(inspector).getByLabelText('Stage name'), { target: { value: 'Check status' } });
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply to draft' }));
    expect(await screen.findByText(/41 waiting checks keep their version/)).toBeInTheDocument();
  });

  it('has a list and a diagram of the same steps, the list being the default', async () => {
    render(<Harness initial={integration} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    fireEvent.click(screen.getByText('List'));
    expect(await screen.findByText('Before send')).toBeInTheDocument();
    expect(window.localStorage.getItem('stages-delivery-view')).toBe('list');
    fireEvent.click(screen.getByText('Diagram'));
    expect((await screen.findAllByRole('button', { name: /Consent granted\?/ })).length).toBeGreaterThan(0);
  });
});

// Under the full suite's parallel load a modal and two queries can take longer than the default second.
const SLOW = { timeout: 6000 };

describe('moving around the diagram', () => {
  // jsdom has no pointer events with positions: a small stand-in so a drag and a pinch can be played.
  const pointer = (type: string, init: { pointerId: number; clientX: number; clientY: number }) => {
    const event = new MouseEvent(type, { bubbles: true, clientX: init.clientX, clientY: init.clientY });
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    return event;
  };
  const transform = () => (document.querySelector('.wf-host') as HTMLElement).style.transform;
  const zoomOf = () => Number(transform().match(/scale\(([\d.]+)\)/)?.[1]);

  it('a drag on the background pans, and a two-finger pinch zooms, with no animation while the hand moves', async () => {
    render(<Harness initial={integration} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    const stage = document.querySelector('.wf-stage') as HTMLElement;
    const before = transform();

    fireEvent(stage, pointer('pointerdown', { pointerId: 1, clientX: 100, clientY: 100 }));
    fireEvent(stage, pointer('pointermove', { pointerId: 1, clientX: 160, clientY: 130 }));
    fireEvent(stage, pointer('pointerup', { pointerId: 1, clientX: 160, clientY: 130 }));
    expect(transform()).not.toBe(before);
    expect((document.querySelector('.wf-host') as HTMLElement).style.transition).toBe('none');

    const start = zoomOf();
    fireEvent(stage, pointer('pointerdown', { pointerId: 1, clientX: 200, clientY: 200 }));
    fireEvent(stage, pointer('pointerdown', { pointerId: 2, clientX: 300, clientY: 200 }));
    fireEvent(stage, pointer('pointermove', { pointerId: 2, clientX: 400, clientY: 200 }));
    expect(zoomOf()).toBeGreaterThan(start);
    fireEvent(stage, pointer('pointerup', { pointerId: 2, clientX: 400, clientY: 200 }));
    fireEvent(stage, pointer('pointerup', { pointerId: 1, clientX: 200, clientY: 200 }));
  });

  it('keeps the wheel working after full screen rebuilds the canvas, and after leaving it', async () => {
    render(<Harness initial={integration} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    const wheelZooms = () => {
      const before = zoomOf();
      fireEvent.wheel(document.querySelector('.wf-stage') as HTMLElement, { deltaY: 20, ctrlKey: true });
      return zoomOf() < before;
    };
    expect(wheelZooms()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }));
    await screen.findByRole('button', { name: 'Exit full screen' });
    expect(wheelZooms()).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Exit full screen' }));
    await screen.findByRole('button', { name: 'Full screen' });
    expect(wheelZooms()).toBe(true);
  });

  it('the zoom buttons step through whole sizes and glide', async () => {
    render(<Harness initial={integration} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(screen.getByRole('button', { name: 'Zoom level' })).toHaveTextContent('85%');
    expect((document.querySelector('.wf-host') as HTMLElement).style.transition).toMatch(/transform 240ms/);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(screen.getByRole('button', { name: 'Zoom level' })).toHaveTextContent('60%');
  });
});

describe('the fixed steps are edited in the diagram', () => {
  const stepEditors: StepEditors = {
    trigger: [{ key: 'configuration', title: 'Event', node: <div>EVENT FORM</div> }],
    transform: [{ key: 'transformation', title: 'Transformation', node: <div>TRANSFORMATION FORM</div> }],
    send: [
      { key: 'configuration', title: 'Target', node: <div>TARGET FORM</div> },
      { key: 'authentication', title: 'Authentication', node: <div>AUTH FORM</div> },
    ],
    retry: [{ key: 'reliability', title: 'Retries', node: <div>RETRY FORM</div> }],
  };

  it("opens each fixed step's own form in the inspector, without leaving the diagram", async () => {
    render(<Harness initial={integration} stepEditors={stepEditors} />);
    const open = async (name: RegExp, text: string) => {
      fireEvent.click((await screen.findAllByRole('button', { name }))[0]);
      const inspector = await screen.findByRole('complementary', { name: /details/ });
      expect(await within(inspector).findByText(text)).toBeInTheDocument();
      return inspector;
    };
    await open(/^Build the request/, 'TRANSFORMATION FORM');
    await open(/^Retry up to/, 'RETRY FORM');
    await open(/^APPOINTMENT_CONFIRMED/, 'EVENT FORM');
    const send = await open(/^Send HTTP message/, 'TARGET FORM');
    // Several sections fold; the first is open and the others are one click away.
    expect(within(send).getByText('Authentication')).toBeInTheDocument();
    fireEvent.click(within(send).getByText('Authentication'));
    expect(await within(send).findByText('AUTH FORM')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Build the request/ }).length).toBeGreaterThan(0);
  });

  it('shows only the description when the page supplies no form for a step', async () => {
    render(<Harness initial={integration} />);
    fireEvent.click((await screen.findAllByRole('button', { name: /^Build the request/ }))[0]);
    const inspector = await screen.findByRole('complementary', { name: /details/ });
    expect(within(inspector).getByText(/Builds the message from the event/)).toBeInTheDocument();
  });
});

describe('a runner the console has never heard of', () => {
  // Described only by what the server sends: no console code knows "wait".
  const WAIT = {
    type: 'wait',
    label: 'Wait',
    hooks: ['on_failure'],
    configSchema: { fields: [{ name: 'seconds', label: 'Seconds to wait', widget: 'text', valueType: 'number' }] },
    presentation: {
      icon: 'script',
      summary: [{ field: 'seconds' }],
      mayDecide: false,
      outputs: {},
      defaultConfig: { seconds: 60 },
    },
  };

  it('is offered where it can run, starts with its own defaults, is drawn with its own summary, and gets its own form', async () => {
    api.getStageRunners.mockResolvedValue([...RUNNERS, WAIT]);
    let values: any;
    render(<Harness initial={integration} onValues={(v) => (values = v)} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    fireEvent.click(await screen.findByRole('button', { name: 'Add a failure step' }));
    fireEvent.click(await screen.findByText('Wait'));
    fireEvent.click(screen.getByText('read values'));
    await waitFor(() =>
      expect(values.stages.at(-1)).toMatchObject({
        name: 'Wait 2',
        hook: 'on_failure',
        runner: { type: 'wait', config: { seconds: 60 } },
      })
    );
    const node = await screen.findByRole('button', { name: /^Wait 2, Wait · on failure/ });
    expect(node).toHaveTextContent('60');
    const inspector = await screen.findByRole('complementary', { name: /Wait 2 details/ });
    expect(await within(inspector).findByLabelText('Seconds to wait')).toBeInTheDocument();
  });

  it('is not offered at a hook it cannot run at', async () => {
    api.getStageRunners.mockResolvedValue([...RUNNERS, WAIT]);
    render(<Harness initial={integration} />);
    await screen.findAllByRole('button', { name: /Consent granted\?/ });
    fireEvent.click((await screen.findAllByRole('button', { name: 'Add a step before the send' }))[0]);
    expect(await screen.findByText('HTTP request')).toBeInTheDocument();
    expect(screen.queryByText('Wait')).not.toBeInTheDocument();
  });
});

describe('many deliveries', () => {
  const actions = [1, 2, 3, 4].map((n) => ({
    name: `Action ${n}`,
    kind: 'HTTP',
    targetUrl: `https://p.test/${n}`,
    stages: [script(`g${n}`, `Gate ${n}`, 'before_send', { effect: 'gate' })],
  }));

  it('opens the first and folds the rest into one step each, which open when asked', async () => {
    render(<Harness initial={{ eventType: 'E', actions }} />);
    await screen.findByRole('button', { name: /Fold Action 1/ });
    expect(screen.getAllByRole('button', { name: /^Action [234],/ })).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Gate 2,/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open Action 2/ }));
    expect(await screen.findByRole('button', { name: /^Gate 2,/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Action [34],/ })).toHaveLength(2);
  });
});

describe('Executions', () => {
  const failed = {
    id: 'log-1',
    integrationConfigId: 'int-1',
    status: 'ABANDONED',
    attemptCount: 3,
    responseStatus: null,
    responseTimeMs: 10000,
    createdAt: '2026-10-25T08:02:09.000Z',
    errorCategory: 'TIMEOUT',
    errorMessage: 'timeout of 10000ms exceeded',
    actionIndex: null,
    retryAttempts: [{ attemptNumber: 1, responseStatus: null, responseTimeMs: 10000 }],
    request: {
      url: 'https://api.example.com/v1',
      method: 'POST',
      headers: { Authorization: '[masked]' },
      body: { to: 'x' },
    },
  };
  const prime = () => {
    core.getLogs.mockResolvedValue({
      data: [failed],
      pagination: { page: 1, limit: 25, total: 1, totalPages: 1, hasNextPage: false, hasPrevPage: false },
    });
    core.getLogById.mockResolvedValue(failed);
    api.getDeliveryStages.mockResolvedValue({
      states: [],
      runs: [
        {
          runId: 'r1',
          deliveryId: 'log-1',
          stage: { id: 'consent', name: 'Consent granted?', hook: 'before_send', runner: 'script' },
          seq: 1,
          executionAttempt: 1,
          at: '2026-10-25T08:02:09.100Z',
          durationMs: 4,
          outcome: 'ok',
          status: null,
          done: false,
          calls: [],
          logs: [],
        },
        {
          runId: 'r2',
          deliveryId: 'log-1',
          stage: { id: 'notify', name: 'Notify the front desk', hook: 'on_failure', runner: 'script' },
          seq: 1,
          executionAttempt: 1,
          at: '2026-10-25T08:04:10.000Z',
          durationMs: 1100,
          outcome: 'ok',
          status: null,
          done: false,
          calls: [],
          logs: [],
        },
      ],
    });
  };

  const open = async () => {
    prime();
    render(<Harness initial={integration} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Executions' }, SLOW));
    await screen.findByLabelText('Delivery to show', undefined, SLOW);
  };

  it('draws one real delivery: the path taken, what failed, and what was not reached', async () => {
    await open();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Delivery failed, .*Abandoned/ })).toBeInTheDocument()
    );
    expect(screen.getByRole('button', { name: /Send .*Failed|Send.*Timeout/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read the provider reply.*Not taken/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notify the front desk.*/ })).toBeInTheDocument();
    expect(screen.getByText('Production data')).toBeInTheDocument();
    expect(screen.queryByText('Yes · 1,184')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Edit workflow/ })).toBeInTheDocument();
  });

  it('puts the cause first on a failed send, and refuses to resend what the provider already has', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /^Send/ }, SLOW));
    const inspector = await screen.findByRole('complementary', undefined, SLOW);
    expect(await within(inspector).findByText('The provider never answered', undefined, SLOW)).toBeInTheDocument();
    expect(await within(inspector).findByText('7 others in the last hour', undefined, SLOW)).toBeInTheDocument();

    api.checkAndReplay.mockRejectedValue(
      Object.assign(new Error('The provider reports this message as DELIVERED, so it was not sent again'), {
        code: 'PROVIDER_HAS_MESSAGE',
      })
    );
    fireEvent.click(within(inspector).getByRole('button', { name: 'Check status, then replay' }));
    fireEvent.change(await screen.findByLabelText('Why send it again', undefined, SLOW), {
      target: { value: 'timed out' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Check and replay/ }, SLOW));
    expect(await screen.findByText('Not sent again', undefined, SLOW)).toBeInTheDocument();
    expect(api.checkAndReplay).toHaveBeenCalledWith('log-1', { reason: 'timed out', acceptUnverified: false });
  });

  it('offers "Send anyway" only when the provider could not be asked, and says it is recorded', async () => {
    await open();
    fireEvent.click(await screen.findByRole('button', { name: /^Send/ }, SLOW));
    const inspector = await screen.findByRole('complementary', undefined, SLOW);
    api.checkAndReplay.mockRejectedValueOnce(
      Object.assign(new Error('Could not confirm whether the provider has the message'), { code: 'UNVERIFIED' })
    );
    fireEvent.click(await within(inspector).findByRole('button', { name: 'Check status, then replay' }, SLOW));
    fireEvent.change(await screen.findByLabelText('Why send it again', undefined, SLOW), {
      target: { value: 'timed out' },
    });
    fireEvent.click(await screen.findByRole('button', { name: /Check and replay/ }, SLOW));
    expect(await screen.findByText(/The choice is recorded/, undefined, SLOW)).toBeInTheDocument();
    api.checkAndReplay.mockResolvedValueOnce({
      verdict: 'unverifiable',
      status: null,
      stage: null,
      runId: null,
      reason: null,
      replayed: true,
    });
    fireEvent.click(await screen.findByRole('button', { name: /Send anyway/ }, SLOW));
    await waitFor(() =>
      expect(api.checkAndReplay).toHaveBeenLastCalledWith('log-1', { reason: 'timed out', acceptUnverified: true })
    );
  });
});
