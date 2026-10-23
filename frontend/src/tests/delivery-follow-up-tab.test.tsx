import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import { buildIntegrationSectionItems } from '../features/integrations/routes/integrationDetail/components/IntegrationSectionsContent';

vi.mock('../services/api', () => ({
  getFollowUpPreset: vi.fn(async () => null),
  testFollowUpScript: vi.fn(),
}));
vi.mock('../features/integrations/components/MonacoEditorInput', () => ({
  MonacoEditorInput: ({ value, readOnly }: any) => <textarea aria-label="script" readOnly={readOnly} value={value || ''} onChange={() => {}} />,
}));

const spacing = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px' };
const baseProps = {
  tenant: {},
  eventTypes: [],
  uiConfig: {},
  isCreate: false,
  eventTypesLoading: false,
  actionsCount: 0,
  existingActionsCount: 0,
  selectedEventTypeData: null,
  availableFields: [],
  spacing,
  token: {},
  colors: { primary: { 600: '#1677ff' }, success: { 600: '#52c41a' }, neutral: { 900: '#111' } },
  loadCleverTapTemplate: () => {},
  multiActionValidationErrors: [],
  formatScriptForDisplay: (s?: string) => s || '',
  samplePayload: '',
  schedulingScriptValidation: { status: 'idle' as const },
  isValidatingScript: false,
  onValidateScript: () => {},
  onCopyExampleScript: () => {},
  onValidationClose: () => {},
  transformationTab: 'SIMPLE' as const,
  selectedEventType: 'order.created',
  mappingState: { mappings: [], staticFields: [] },
  scriptValue: '',
  tagTone: () => ({}),
  onPreview: () => {},
  onOpenDesigner: () => {},
  integrationId: 'i1',
};

const build = (form: any, over: Record<string, unknown>) =>
  (buildIntegrationSectionItems({ ...baseProps, form, deliveryModeValue: 'IMMEDIATE', ...over } as any) as any[]) || [];

const renderTab = (over: Record<string, unknown>, formValues: Record<string, unknown>) => {
  const Wrapper = () => {
    const [form] = Form.useForm();
    form.setFieldsValue(formValues);
    const tab = build(form, over).find((item) => item.key === 'deliveryFollowUp');
    return (
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <Form form={form}>{tab?.children}</Form>
        </ThemeProvider>
      </QueryClientProvider>
    );
  };
  return render(<Wrapper />);
};

const labels = (over: Record<string, unknown>) => {
  let items: any[] = [];
  const Probe = () => {
    const [form] = Form.useForm();
    items = build(form, over);
    return null;
  };
  render(<Probe />);
  return items.map((item) => item.key);
};

describe('Delivery follow-up tab', () => {
  it('is its own tab, beside the transformation tabs', () => {
    const keys = labels({ isMultiAction: false, isEditMode: true, isReadOnly: false });
    expect(keys).toContain('deliveryFollowUp');
    expect(keys.indexOf('deliveryFollowUp')).toBeGreaterThan(keys.indexOf('responseTransform'));
  });

  it('is not offered for multi-action deliveries, which are not followed up', () => {
    expect(labels({ isMultiAction: true, isEditMode: true, isReadOnly: false })).not.toContain('deliveryFollowUp');
  });

  it('lets the follow-up be set up and its script written when editing', () => {
    renderTab({ isMultiAction: false, isEditMode: true, isReadOnly: false }, { deliveryFollowUp: { enabled: true, script: 'return null;', checkAfterSeconds: [60, 600] } });
    expect(screen.getByRole('switch')).toBeChecked();
    expect(screen.getAllByText(/^Check \d$/)).toHaveLength(2);
    expect(screen.getByLabelText('script')).not.toHaveAttribute('readonly');
  });

  it('shows the setting as plain text when only viewing, with no switch to flip', () => {
    renderTab({ isMultiAction: false, isEditMode: false, isReadOnly: true }, { deliveryFollowUp: { enabled: true, script: 'return null; // viewed', checkAfterSeconds: [30, 300, 3600] } });
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/30 seconds, 5 minutes, 1 hour/)).toBeInTheDocument();
    expect(screen.getByLabelText('script')).toHaveAttribute('readonly');
  });

  it('says it is off when it is off', () => {
    renderTab({ isMultiAction: false, isEditMode: false, isReadOnly: true }, { deliveryFollowUp: { enabled: false, script: '' } });
    expect(screen.getByText('Off')).toBeInTheDocument();
    expect(screen.getByText(/not followed up/i)).toBeInTheDocument();
  });
});
