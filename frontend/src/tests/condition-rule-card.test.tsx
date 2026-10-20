import { App, Form, type FormListFieldData } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConditionRuleCard } from '../features/integrations/routes/integrationDetail/components/ConditionRuleCard';

vi.mock('../features/integrations/routes/integrationDetail/hooks/useEventTypeData', () => ({
  useEventTypeData: (eventType?: string) => {
    if (eventType === 'APPOINTMENT_RESCHEDULED') {
      return {
        data: {
          fields: [
            { path: 'entityCode', type: 'string' },
            { path: 'datetime', type: 'string', example: '24/01/2026 04:43 PM' },
            { path: 'appt.apptDate', type: 'string', example: '2026-01-24' },
            { path: 'appt.rescheduledAt', type: 'string', example: '24/01/2026 04:43 PM' },
            { path: 'appt.status', type: 'string' },
          ],
        },
        isLoading: false,
      };
    }

    return {
      data: undefined,
      isLoading: false,
    };
  },
}));

const token = {
  borderRadiusLG: 12,
  borderRadius: 8,
};

const colors = {
  neutral: { 200: '#e5e7eb' },
};

let latestForm: ReturnType<typeof Form.useForm>[0] | null = null;

function Harness() {
  const [form] = Form.useForm();
  latestForm = form;

  return (
    <App>
      <Form
        form={form}
        initialValues={{
          conditionRules: [
            {
              eventTypes: [],
              action: 'RELEASE_HELD',
              conditions: [],
              releaseTiming: {
                mode: 'IMMEDIATE',
                eventFieldPath: '',
                offsetValue: 0,
                offsetUnit: 'HOURS',
              },
            },
          ],
        }}
      >
        {/* Mirror the real app: ConditionRuleCard always lives inside
            Form.List name="conditionRules". Without this wrapper the Form.Item
            names (which are relative to the list) would be missing the
            'conditionRules' prefix, producing invalid CSS ids like '0_action'. */}
        <Form.List name="conditionRules">
          {(fields: FormListFieldData[]) => {
            const field = fields[0] ?? { key: 0, name: 0 };
            return (
              <ConditionRuleCard
                field={field}
                eventTypeOptions={[
                  { label: 'APPOINTMENT_RESCHEDULED', value: 'APPOINTMENT_RESCHEDULED' },
                  { label: 'APPOINTMENT_CANCELLATION', value: 'APPOINTMENT_CANCELLATION' },
                ]}
                onRemove={() => {}}
                token={token}
                colors={colors as any}
              />
            );
          }}
        </Form.List>
      </Form>
    </App>
  );
}

describe('ConditionRuleCard', () => {
  it('loads condition fields from the selected follow-up event and infers date-like fields', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    expect(screen.getByText('Choose the follow-up event first.')).toBeInTheDocument();
    expect(screen.getByText('Release it now')).toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Follow-up event' }));
    await user.click(await screen.findByTitle('APPOINTMENT_RESCHEDULED'));

    await waitFor(() => {
      expect(screen.queryByText('Choose the follow-up event first.')).not.toBeInTheDocument();
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions'])).toEqual([
        expect.objectContaining({
          operator: 'EQUALS',
        }),
      ]);
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'eventTypes'])).toEqual(['APPOINTMENT_RESCHEDULED']);
    });
  });

  it('typed condition value survives an unrelated form.setFieldValue and re-selecting the same follow-up event', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    // Select a follow-up event
    await user.click(screen.getByRole('combobox', { name: 'Follow-up event' }));
    await user.click(await screen.findByTitle('APPOINTMENT_RESCHEDULED'));

    // Wait for the condition row to initialise
    await waitFor(() => {
      expect(screen.queryByText('Choose the follow-up event first.')).not.toBeInTheDocument();
    });

    // Directly seed a condition value via the form store (simulates user selecting field + typing value)
    latestForm?.setFieldValue(['conditionRules', 0, 'conditions', 0, 'fieldPath'], 'entityCode');
    latestForm?.setFieldValue(['conditionRules', 0, 'conditions', 0, 'value'], 'test-code');

    await waitFor(() => {
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions', 0, 'value'])).toBe('test-code');
    });

    // Simulate an unrelated form write (e.g. matchKeys sync patching a single rule field)
    latestForm?.setFieldValue(['conditionRules', 0, 'matchKeys'], ['id']);

    await waitFor(() => {
      // Condition value must survive the unrelated write
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions', 0, 'value'])).toBe('test-code');
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions', 0, 'fieldPath'])).toBe('entityCode');
    });

    // Re-select the SAME follow-up event — should NOT reset the condition value
    await user.click(screen.getByRole('combobox', { name: 'Follow-up event' }));
    // Use getByRole('option') to target the dropdown item, not the selection display span
    await user.click(await screen.findByRole('option', { name: 'APPOINTMENT_RESCHEDULED' }));

    await waitFor(() => {
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions', 0, 'value'])).toBe('test-code');
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'conditions', 0, 'fieldPath'])).toBe('entityCode');
    });
  });

  it('resets conditions when the follow-up event is changed to a different event', async () => {
    const user = userEvent.setup();

    render(<Harness />);

    // Select initial event and type a value
    await user.click(screen.getByRole('combobox', { name: 'Follow-up event' }));
    await user.click(await screen.findByTitle('APPOINTMENT_RESCHEDULED'));

    await waitFor(() => {
      expect(screen.queryByText('Choose the follow-up event first.')).not.toBeInTheDocument();
    });

    // Set a condition value directly in the form store (simulates user typing)
    latestForm?.setFieldValue(['conditionRules', 0, 'conditions', 0, 'value'], 'old-value');

    // Switch to a DIFFERENT event type
    await user.click(screen.getByRole('combobox', { name: 'Follow-up event' }));
    await user.click(await screen.findByTitle('APPOINTMENT_CANCELLATION'));

    await waitFor(() => {
      // Conditions should be reset because the event type changed
      const conditions = latestForm?.getFieldValue(['conditionRules', 0, 'conditions']);
      const firstCondition = Array.isArray(conditions) ? conditions[0] : undefined;
      expect(firstCondition?.value ?? null).toBeNull();
      expect(latestForm?.getFieldValue(['conditionRules', 0, 'eventTypes'])).toEqual(['APPOINTMENT_CANCELLATION']);
    });
  });
});
