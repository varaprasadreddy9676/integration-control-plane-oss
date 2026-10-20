import { App, Form } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { LifecyclePanelContent } from '../features/integrations/routes/integrationDetail/components/LifecyclePanel';

vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ placeholder }: { placeholder?: string }) => (
    <textarea aria-label="Extraction Script" placeholder={placeholder} />
  ),
}));

const eventTypes = [
  { eventType: 'APPOINTMENT_CONFIRMATION' },
  { eventType: 'APPOINTMENT_CANCELLATION' },
  { eventType: 'BOOKING_CANCELLED' },
];

const token = {
  borderRadiusLG: 12,
  borderRadius: 8,
};

const colors = {
  primary: { 50: '#f5faff', 200: '#c7d7ff' },
  secondary: { 200: '#ffd79d' },
  neutral: { 200: '#e5e7eb', 300: '#d9d9d9' },
};

function LifecycleHarness({
  initialValues,
  deliveryModeValue = 'DELAYED',
  hasPersistedConfig = false,
}: {
  initialValues: Record<string, unknown>;
  deliveryModeValue?: 'IMMEDIATE' | 'DELAYED' | 'WAIT_FOR_CONDITION';
  hasPersistedConfig?: boolean;
}) {
  const [form] = Form.useForm();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
    setReady(true);
  }, [form, initialValues]);

  if (!ready) {
    return null;
  }

  return (
    <App>
      <Form form={form} initialValues={initialValues}>
        <LifecyclePanelContent
          form={form}
          eventTypes={eventTypes}
          hasPersistedConfig={hasPersistedConfig}
          deliveryModeValue={deliveryModeValue}
          spacing={{ 4: '16' }}
          token={token}
          colors={colors}
        />
      </Form>
    </App>
  );
}

describe('LifecyclePanelContent', () => {
  it('shows the customize javascript button when extraction mode is PATHS', async () => {
    render(
      <LifecycleHarness
        initialValues={{
          subjectExtractionMode: 'PATHS',
          lifecycleRules: [],
        }}
      />
    );

    expect(await screen.findByText('Customize matching with JavaScript')).toBeInTheDocument();
  });

  it('hides follow-up configuration entirely for immediate mode with no saved config', () => {
    render(
      <LifecycleHarness
        deliveryModeValue="IMMEDIATE"
        initialValues={{
          subjectExtractionMode: 'PATHS',
          lifecycleRules: [],
          conditionRules: [],
        }}
      />
    );

    expect(screen.queryByText('Customize matching with JavaScript')).not.toBeInTheDocument();
    expect(
      screen.queryByText('These matching and follow-up settings are saved but inactive for immediate delivery.')
    ).not.toBeInTheDocument();
  });

  it('shows a compact inactive panel for immediate mode when saved config exists', async () => {
    const user = userEvent.setup();

    render(
      <LifecycleHarness
        deliveryModeValue="IMMEDIATE"
        hasPersistedConfig
        initialValues={{
          subjectExtractionMode: 'PATHS',
          lifecycleRules: [{ eventTypes: ['BOOKING_CANCELLED'], action: 'CANCEL_PENDING', matchKeys: ['booking_ref'] }],
          conditionRules: [],
        }}
      />
    );

    expect(
      await screen.findByText('These matching and follow-up settings are saved but inactive for immediate delivery.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Customize matching with JavaScript')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Show advanced matching' }));

    expect(screen.getByText('Customize matching with JavaScript')).toBeInTheDocument();
    expect(screen.getByText('Does this event later get cancelled or rescheduled?')).toBeInTheDocument();
  });

  it('shows compact matching summary and expands on demand for delayed mode with rules', async () => {
    const user = userEvent.setup();

    render(
      <LifecycleHarness
        initialValues={{
          subjectExtractionMode: 'PATHS',
          lifecycleRules: [{ eventTypes: ['BOOKING_CANCELLED'], action: 'CANCEL_PENDING', matchKeys: ['booking_ref'] }],
        }}
      />
    );

    expect(screen.getByText('Does this event later get cancelled or rescheduled?')).toBeInTheDocument();
    expect(screen.queryByText('Customize matching with JavaScript')).not.toBeInTheDocument();
    expect(screen.getByText('Using booking_ref to match the same record.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change matching fields' }));

    await waitFor(() => {
      expect(screen.getByText('Customize matching with JavaScript')).toBeInTheDocument();
    });
  });
});
