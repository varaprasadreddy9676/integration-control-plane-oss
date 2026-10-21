import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Form } from 'antd';
import { HttpConfigFields } from '../shared/integration-forms/http/HttpConfigFields';

const colors = { primary: { 600: '#1677ff' } } as any;
const spacing = { 2: '8px', 3: '12px', 4: '16px' } as any;

function Harness() {
  const [form] = Form.useForm();
  return (
    <Form form={form}>
      <HttpConfigFields form={form} uiConfig={{} as any} mode="inbound" spacing={spacing} colors={colors} />
    </Form>
  );
}

describe('Target URL validation timing', () => {
  it('does not flag a half-typed URL until the field loses focus', async () => {
    render(<Harness />);
    const input = screen.getByPlaceholderText('https://api.example.com/integration');

    fireEvent.change(input, { target: { value: 'https://' } });
    await new Promise((r) => setTimeout(r, 600));
    expect(screen.queryByText('Must be a valid HTTPS URL')).not.toBeInTheDocument();

    fireEvent.blur(input);
    await waitFor(() => expect(screen.getByText('Must be a valid HTTPS URL')).toBeInTheDocument());
  });
});
