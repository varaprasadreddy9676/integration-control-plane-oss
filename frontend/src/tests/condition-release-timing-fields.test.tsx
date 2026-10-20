import { App, Form, type FormListFieldData } from 'antd';
import { render, screen, waitFor } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { describe, expect, it } from 'vitest';
import { ConditionReleaseTimingFields } from '../features/integrations/routes/integrationDetail/components/ConditionReleaseTimingFields';

// Wrap in Form.List to match real app context — ConditionReleaseTimingFields is
// always rendered inside Form.List name="conditionRules" in production.
function Harness({ initialMode }: { initialMode: string }) {
  const [form] = Form.useForm();
  const [ready, setReady] = useState(false);

  const initialValues = {
    conditionRules: [{
      releaseTiming: { mode: initialMode, eventFieldPath: '', offsetValue: 0, offsetUnit: 'HOURS' },
    }],
  };

  useEffect(() => {
    form.resetFields();
    form.setFieldsValue(initialValues);
    setReady(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form]);

  if (!ready) {
    return null;
  }

  return (
    <App>
      <Form form={form} initialValues={initialValues}>
        <Form.List name="conditionRules">
          {(fields: FormListFieldData[]) => {
            const field = fields[0] ?? { key: 0, name: 0 };
            return (
              <ConditionReleaseTimingFields
                ruleName={field.name}
                dateFieldOptions={[
                  { label: 'datetime (datetime)', value: 'datetime' },
                  { label: 'appt.apptDate (date)', value: 'appt.apptDate' },
                ]}
              />
            );
          }}
        </Form.List>
      </Form>
    </App>
  );
}

describe('ConditionReleaseTimingFields', () => {
  it('hides release offset controls in immediate mode', async () => {
    render(<Harness initialMode="IMMEDIATE" />);
    expect(await screen.findByText('Immediately')).toBeInTheDocument();
    expect(screen.queryByText('Use date from follow-up event')).not.toBeInTheDocument();
  });

  it('shows release offset controls in follow-up date mode', async () => {
    render(<Harness initialMode="OFFSET_FROM_EVENT_FIELD" />);
    await screen.findByText('Later from follow-up date');

    await waitFor(() => {
      expect(screen.getByText('Use date from follow-up event')).toBeInTheDocument();
      expect(screen.getByText('Wait')).toBeInTheDocument();
      expect(screen.getByText('Unit')).toBeInTheDocument();
    });
  });
});
