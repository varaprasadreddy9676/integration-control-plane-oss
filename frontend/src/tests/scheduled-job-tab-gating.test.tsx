import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from 'antd';

// Regression tests for two bugs found on the Scheduled Job edit screen:
//
// 1. Same tab-gating deadlock as the inbound integration screen: editing an existing,
//    fully-configured script job left Script/Review & Submit disabled until the user
//    manually visited Schedule (and then Script) first, because scheduleComplete/
//    transformComplete depend on Form.useWatch('cronExpression'/'transformScript'), which
//    can't see loaded data until those tabs' Form.Items mount. Fixed with `forceRender` on
//    the Schedule and Script ('transformation') tab items.
//
// 2. The Script/SQL/Mongo Monaco editors mounted at ~5x5px while their tab pane was hidden
//    and never re-measured, so an existing job's real (1,476-char, in this fixture's case
//    shorter) script rendered as nearly blank even though the underlying value was intact.
//    Fixed with `automaticLayout: true` on all 5 Editor instances in this file.

const monacoOptionsSeen: any[] = [];

vi.mock('@monaco-editor/react', () => ({
  default: (props: any) => {
    monacoOptionsSeen.push(props.options);
    return <div data-testid="monaco-editor" />;
  },
}));

vi.mock('../components/common/PageHeader', () => ({
  PageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../features/scheduled-jobs/components/CronBuilder', () => ({
  CronBuilder: () => <div data-testid="cron-builder" />,
}));

vi.mock('../shared/integration-forms', () => ({
  AuthenticationFields: () => <div data-testid="auth-fields" />,
}));

vi.mock('../app/auth-context', () => ({
  useAuth: () => ({ user: { role: 'SUPER_ADMIN' } }),
}));

vi.mock('../design-system/utils', () => ({
  spacingToNumber: (value: string | number) => {
    if (typeof value === 'number') return value;
    const parsed = parseInt(String(value), 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  },
  withAlpha: (hex: string, alpha: number) => `rgba(${hex}, ${alpha})`,
  useDesignTokens: () => ({
    spacing: { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px', 8: '32px' },
    // ModernTable (used by the Execution History tab) reads antd's token.
    token: { borderRadiusSM: 4, borderRadiusLG: 8 },
  }),
  cssVar: {
    legacy: {
      primary: { 600: '#1677ff' },
      success: { 600: '#52c41a' },
      warning: { 50: '#fffbe6', 200: '#ffe58f', 600: '#faad14' },
      error: { 600: '#ff4d4f' },
      neutral: { 50: '#fafafa', 200: '#eee', 600: '#595959', 900: '#111111' },
      info: { 50: '#f0f5ff', 200: '#adc6ff', 600: '#1677ff', 700: '#0958d9' },
    },
    bg: { base: '#fff', surface: '#fff' },
    border: { default: '#eee' },
    text: { secondary: '#666' },
  },
}));

const mockApi = {
  getScheduledJobById: vi.fn(),
  createScheduledJob: vi.fn(),
  updateScheduledJob: vi.fn(),
  executeScheduledJob: vi.fn(),
  installScheduledJobDependencies: vi.fn(),
  revealScheduledJobEnvVar: vi.fn(),
  getScheduledJobLogs: vi.fn(),
  getUIConfig: vi.fn(),
  testDataSource: vi.fn(),
};

vi.mock('../services/api', () => mockApi);

describe('Scheduled Job edit — tab gating and Monaco layout on an already-complete script job', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    monacoOptionsSeen.length = 0;
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getScheduledJobById.mockResolvedValue({
      _id: '6a4611f9a3e87fcccd2548c7',
      name: 'Tailspin Daily Sync Report',
      type: 'DAILY_EXPORT',
      direction: 'SCRIPT_JOB',
      isActive: true,
      runtime: 'VM_SANDBOX',
      script: 'const yesterday = date.yesterday();\nconst results = await mysql.queryMany([]);\nreturn results;',
      schedule: { type: 'CRON', expression: '0 6 * * *', timezone: 'Asia/Kolkata' },
      environmentVariables: [],
      dependencies: [],
    });
  });

  it('does not leave the Script or Review & Submit tabs disabled on initial render', async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    const { container } = render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/scheduled-jobs/6a4611f9a3e87fcccd2548c7?orgId=33']}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument();
    });

    const disabledTabLabels = Array.from(container.querySelectorAll('.ant-tabs-tab-disabled')).map((el) =>
      el.textContent?.trim()
    );

    expect(disabledTabLabels).toEqual([]);
  });

  it('passes automaticLayout: true to every Monaco editor instance', async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/scheduled-jobs/6a4611f9a3e87fcccd2548c7?orgId=33']}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument();
    });

    // With the tab-gating fix, Schedule + Script panes forceRender immediately, so their
    // Monaco instances (the Script editor at minimum) should already be mounted here.
    await waitFor(() => expect(monacoOptionsSeen.length).toBeGreaterThan(0));
    for (const options of monacoOptionsSeen) {
      expect(options).toMatchObject({ automaticLayout: true });
    }
  });

  it('says "saving" rather than "creating" on Review & Submit when editing an existing job', async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/scheduled-jobs/6a4611f9a3e87fcccd2548c7?orgId=33']}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Review & Submit'));

    expect(await screen.findByText(/Please review all settings before saving the scheduled job/)).toBeInTheDocument();
    expect(screen.queryByText(/before creating the scheduled job/)).not.toBeInTheDocument();
  });

  it('shows Active as selected in the Status radio group for an active job', async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');

    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/scheduled-jobs/6a4611f9a3e87fcccd2548c7?orgId=33']}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument();
    });

    const activeRadio = screen.getByRole('radio', { name: 'Active' }) as HTMLInputElement;
    const pausedRadio = screen.getByRole('radio', { name: 'Paused' }) as HTMLInputElement;
    expect(activeRadio.checked).toBe(true);
    expect(pausedRadio.checked).toBe(false);
  });
});

// Regression: saved Script Job environment variables (e.g. EMAIL_TO) always showed
// only a "Saved, leave blank to keep" placeholder, with no way to see the current
// value before editing it — so appending a second recipient risked silently
// clobbering the existing one. Fixed with a "reveal" action that fetches the real
// value on demand and a native show/hide toggle on the now-populated field.
describe('Scheduled Job edit — environment variable reveal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getScheduledJobById.mockResolvedValue({
      _id: '6a4679fdc45b4f1c52bc08fa',
      name: 'Tailspin Daily Sync Report',
      type: 'DAILY_EXPORT',
      direction: 'SCRIPT_JOB',
      isActive: true,
      runtime: 'NODE_PROCESS',
      script: 'console.log("hi")',
      schedule: { type: 'CRON', expression: '0 6 * * *', timezone: 'Asia/Kolkata' },
      environmentVariables: [
        { key: 'EMAIL_TO', hasValue: true },
        { key: 'EMAIL_API_URL', hasValue: true },
      ],
      dependencies: [],
    });
  });

  const renderRoute = async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    return render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={['/scheduled-jobs/6a4679fdc45b4f1c52bc08fa?orgId=33']}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );
  };

  // The reveal action reuses the password field's own eye icon (no separate
  // button next to it — an earlier version had two differently-styled icons
  // side by side, which looked inconsistent) — so tests click that icon
  // directly rather than a named button.
  const getEyeIcons = (container: HTMLElement) => Array.from(container.querySelectorAll('.ant-input-password-icon'));

  it('fetches and displays the real value when the eye icon is clicked', async () => {
    mockApi.revealScheduledJobEnvVar.mockResolvedValue({ key: 'EMAIL_TO', value: 'dev@example.com' });
    const { container } = await renderRoute();

    await waitFor(() => expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Script/ }));

    const eyeIcons = getEyeIcons(container);
    expect(eyeIcons).toHaveLength(2);

    fireEvent.click(eyeIcons[0]);

    expect(await screen.findByDisplayValue('dev@example.com')).toBeInTheDocument();
    expect(mockApi.revealScheduledJobEnvVar).toHaveBeenCalledWith('6a4679fdc45b4f1c52bc08fa', 'EMAIL_TO', '33');
  });

  it('shows an error message and leaves the field untouched if the reveal request fails', async () => {
    mockApi.revealScheduledJobEnvVar.mockRejectedValue(new Error('Environment variable not found'));
    const { container } = await renderRoute();

    await waitFor(() => expect(screen.getByDisplayValue('Tailspin Daily Sync Report')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('tab', { name: /Script/ }));

    fireEvent.click(getEyeIcons(container)[0]);

    expect(await screen.findByText('Environment variable not found')).toBeInTheDocument();
    // Still masked/placeholder — nothing was populated on failure.
    expect(screen.queryByDisplayValue(/@/)).not.toBeInTheDocument();
  });
});

// The Execution History tab used to render `job.lastExecution` — a field the
// backend never writes. It therefore reported "No executions yet" for every job,
// including ones that had run hundreds of times, while GET /scheduled-jobs/:id/logs
// held the real history the whole time.
describe('Scheduled Job — Execution History tab', () => {
  const JOB_ID = '6a4ba7cfb651832c3127d38b';

  const renderRoute = async () => {
    const { ScheduledJobDetailRoute } = await import('../features/scheduled-jobs/routes/ScheduledJobDetailRoute');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <App>
          <MemoryRouter initialEntries={[`/scheduled-jobs/${JOB_ID}?orgId=33`]}>
            <Routes>
              <Route path="/scheduled-jobs/:id" element={<ScheduledJobDetailRoute />} />
            </Routes>
          </MemoryRouter>
        </App>
      </QueryClientProvider>
    );
  };

  const openHistoryTab = async () => {
    const tab = await screen.findByRole('tab', { name: /Execution History/i });
    fireEvent.click(tab);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi.getUIConfig.mockResolvedValue({});
    mockApi.getScheduledJobLogs.mockReset();
    mockApi.getScheduledJobById.mockReset().mockResolvedValue({
      _id: JOB_ID,
      name: 'Daily HTTP Intelligence Report',
      direction: 'SCRIPT_JOB',
      isActive: true,
      runtime: 'NODE_PROCESS',
      script: 'console.log("x");',
      schedule: { type: 'CRON', expression: '0 6 * * *', timezone: 'Asia/Kolkata' },
      environmentVariables: [],
      dependencies: [],
      // Deliberately absent: lastExecution. The tab must not depend on it.
    });
  });

  it('renders real executions from the logs endpoint, not job.lastExecution', async () => {
    mockApi.getScheduledJobLogs.mockResolvedValue([
      { _id: 'l1', status: 'FAILED', startedAt: '2026-08-01T05:35:08.309Z', durationMs: 91804, trigger: 'MANUAL' },
      { _id: 'l2', status: 'SUCCESS', startedAt: '2026-08-01T00:30:00.307Z', durationMs: 48408, trigger: 'SCHEDULE' },
    ]);

    await renderRoute();
    await openHistoryTab();

    expect(await screen.findByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('SUCCESS')).toBeInTheDocument();
    // Durations are humanised, not raw milliseconds.
    expect(screen.getByText('91.8s')).toBeInTheDocument();
    expect(screen.getByText('48.4s')).toBeInTheDocument();
    expect(screen.getByText('MANUAL')).toBeInTheDocument();
    expect(screen.queryByText('No executions yet')).not.toBeInTheDocument();
  });

  it('surfaces the failure reason inline so the tab answers "did it work?"', async () => {
    mockApi.getScheduledJobLogs.mockResolvedValue([
      {
        _id: 'l1',
        status: 'FAILED',
        startedAt: '2026-08-01T05:35:08.309Z',
        durationMs: 91804,
        trigger: 'MANUAL',
        error: { message: '$addToSet used too much memory and cannot spill to disk' },
      },
    ]);

    await renderRoute();
    await openHistoryTab();

    expect(await screen.findByText(/\$addToSet used too much memory/)).toBeInTheDocument();
  });

  it('shows the empty state only when there genuinely are no runs', async () => {
    mockApi.getScheduledJobLogs.mockResolvedValue([]);

    await renderRoute();
    await openHistoryTab();

    expect(await screen.findByText('No executions yet')).toBeInTheDocument();
  });

  it('requests the logs for this job id rather than reading the job document', async () => {
    mockApi.getScheduledJobLogs.mockResolvedValue([]);

    await renderRoute();
    await openHistoryTab();

    await waitFor(() => expect(mockApi.getScheduledJobLogs).toHaveBeenCalled());
    expect(mockApi.getScheduledJobLogs.mock.calls[0][0]).toBe(JOB_ID);
  });
});
