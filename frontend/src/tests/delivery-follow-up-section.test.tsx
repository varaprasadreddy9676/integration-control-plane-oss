import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Form } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import {
  CheckScheduleEditor,
  DeliveryFollowUpSection,
  formatDuration,
  scheduleProblem,
  splitDuration,
} from '../features/integrations/components/detail/DeliveryFollowUpSection';

const api = vi.hoisted(() => ({
  getFollowUpPreset: vi.fn(),
  testFollowUpScript: vi.fn(),
}));
vi.mock('../services/api', () => api);
// Monaco does not run in jsdom: a plain textarea stands in for the editor.
vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ value, onChange }: any) => (
    <textarea aria-label="Follow-up script" value={value || ''} onChange={(e) => onChange?.(e.target.value)} />
  ),
}));

const PRESET = {
  id: 'qikchat',
  label: 'Qikchat WhatsApp',
  config: { enabled: true, script: 'return null; // qikchat', checkAfterSeconds: [30, 300, 3600, 86400] },
};

const Harness = ({ initial, integrationId }: { initial?: any; integrationId?: string }) => {
  const [form] = Form.useForm();
  return (
    <ThemeProvider>
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Form form={form} initialValues={initial}>
        {/* The real form has this field; useWatch only sees registered fields. */}
        <Form.Item name="targetUrl" hidden>
          <input />
        </Form.Item>
        <DeliveryFollowUpSection form={form} integrationId={integrationId} />
        <button type="button" onClick={() => (window as any).__values = form.getFieldsValue(true)}>
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

describe('duration helpers', () => {
  it('shows a time in the largest whole unit', () => {
    expect(splitDuration(300)).toEqual({ amount: 5, unit: 60 });
    expect(splitDuration(86400)).toEqual({ amount: 1, unit: 86400 });
    expect(splitDuration(90)).toEqual({ amount: 90, unit: 1 });
    expect(formatDuration(3600)).toBe('1 hour');
    expect(formatDuration(7200)).toBe('2 hours');
  });

  it('reports a schedule problem the server would also reject', () => {
    expect(scheduleProblem([30, 300])).toBeNull();
    expect(scheduleProblem([])).toMatch(/at least one/i);
    expect(scheduleProblem([5])).toMatch(/between/i);
    expect(scheduleProblem(Array(9).fill(60))).toMatch(/at most/i);
    expect(scheduleProblem(undefined)).toBeNull();
  });
});

describe('CheckScheduleEditor', () => {
  it('shows the default checks and lets one be removed or added', async () => {
    const onChange = vi.fn();
    render(<CheckScheduleEditor value={undefined} onChange={onChange} />);
    expect(screen.getAllByText(/^Check \d$/)).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: 'Remove check 2' }));
    expect(onChange).toHaveBeenLastCalledWith([30, 3600, 86400]);
    fireEvent.click(screen.getByRole('button', { name: /Add a check/ }));
    expect(onChange).toHaveBeenLastCalledWith([30, 300, 3600, 86400, 172800]);
  });

  it('will not add past the limit or remove the last check', () => {
    const { rerender } = render(<CheckScheduleEditor value={Array(8).fill(60)} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /Add a check/ })).toBeDisabled();
    rerender(<CheckScheduleEditor value={[60]} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Remove check 1' })).toBeDisabled();
  });

  it('changes a check by amount', async () => {
    const onChange = vi.fn();
    render(<CheckScheduleEditor value={[30, 300]} onChange={onChange} />);
    const second = screen.getByLabelText('Check 2 time');
    fireEvent.change(second, { target: { value: '10' } });
    expect(onChange).toHaveBeenLastCalledWith([30, 600]);
  });
});

describe('DeliveryFollowUpSection', () => {
  beforeEach(() => {
    api.getFollowUpPreset.mockReset().mockResolvedValue(null);
    api.testFollowUpScript.mockReset();
  });

  it('is off, with nothing else shown, until it is switched on', () => {
    render(<Harness initial={{ deliveryFollowUp: { enabled: false, script: '' } }} integrationId="i1" />);
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.queryByText('Check after')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Follow-up script')).not.toBeInTheDocument();
  });

  it('shows the schedule and script once switched on, and saves what is typed', async () => {
    render(<Harness initial={{ deliveryFollowUp: { enabled: true, script: '', checkAfterSeconds: [60, 600] } }} integrationId="i1" />);
    expect(screen.getAllByText(/^Check \d$/)).toHaveLength(2);
    fireEvent.change(screen.getByLabelText('Follow-up script'), { target: { value: 'return { status: "READ" };' } });
    expect(values().deliveryFollowUp).toMatchObject({ enabled: true, script: 'return { status: "READ" };', checkAfterSeconds: [60, 600] });
  });

  it('offers the provider template for a known URL, and applies it', async () => {
    api.getFollowUpPreset.mockResolvedValue(PRESET);
    render(
      <Harness initial={{ targetUrl: 'https://api.qikchat.in/v1/messages', deliveryFollowUp: { enabled: true, script: 'own' } }} integrationId="i1" />
    );
    const button = await screen.findByRole('button', { name: /Use the Qikchat WhatsApp template/ });
    fireEvent.click(button);
    await waitFor(() => expect(values().deliveryFollowUp.script).toBe('return null; // qikchat'));
  });

  it('starts a new integration for a known provider with the follow-up already on', async () => {
    api.getFollowUpPreset.mockResolvedValue(PRESET);
    render(<Harness initial={{ targetUrl: 'https://api.qikchat.in/v1/messages' }} />);
    await waitFor(() => expect(screen.getByRole('switch')).toBeChecked());
    expect(values().deliveryFollowUp).toMatchObject({ enabled: true, script: 'return null; // qikchat' });
  });

  it('does not switch on an existing integration that was never set up, just by opening it', async () => {
    api.getFollowUpPreset.mockResolvedValue(PRESET);
    render(<Harness initial={{ targetUrl: 'https://api.qikchat.in/v1/messages' }} integrationId="existing-1" />);
    await waitFor(() => expect(api.getFollowUpPreset).toHaveBeenCalled());
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('keeps a switched-off integration off even though its provider has a default', async () => {
    api.getFollowUpPreset.mockResolvedValue(PRESET);
    render(<Harness initial={{ targetUrl: 'https://api.qikchat.in/v1/messages', deliveryFollowUp: { enabled: false, script: '' } }} />);
    await screen.findByText(/messages are followed up by default\. This integration has it switched off/);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('runs the script against the sample and shows what it answered', async () => {
    api.testFollowUpScript.mockResolvedValue({
      outcome: 'RESULT',
      durationMs: 12,
      result: { status: 'DELIVERED' },
      httpCalls: [{ method: 'GET', url: 'https://p.example/v1/messages?msgid=m1', statusCode: 200, durationMs: 40, error: null, responseBody: null }],
    });
    render(<Harness initial={{ deliveryFollowUp: { enabled: true, script: 'return 1;' } }} integrationId="i1" />);
    await userEvent.click(screen.getByText('Test the script'));
    await userEvent.click(await screen.findByRole('button', { name: /Run test/ }));
    await waitFor(() =>
      expect(api.testFollowUpScript).toHaveBeenCalledWith('i1', expect.objectContaining({ script: 'return 1;', statusCode: 200 }))
    );
    expect(await screen.findByText('Delivered')).toBeInTheDocument();
    expect(screen.getByText(/GET https:\/\/p\.example\/v1\/messages\?msgid=m1 → 200/)).toBeInTheDocument();
  });

  it('shows a script error from the test instead of hiding it', async () => {
    api.testFollowUpScript.mockResolvedValue({ outcome: 'ERROR', durationMs: 5, error: 'HTTP GET failed: ECONNRESET', httpCalls: [] });
    render(<Harness initial={{ deliveryFollowUp: { enabled: true, script: 'return 1;' } }} />);
    await userEvent.click(screen.getByText('Test the script'));
    await userEvent.click(await screen.findByRole('button', { name: /Run test/ }));
    expect(await screen.findByText('HTTP GET failed: ECONNRESET')).toBeInTheDocument();
    expect(api.testFollowUpScript).toHaveBeenCalledWith('new', expect.anything());
  });
});
