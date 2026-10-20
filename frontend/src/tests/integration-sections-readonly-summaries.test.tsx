import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Form } from 'antd';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '../app/theme-provider';
import { buildIntegrationSectionItems } from '../features/integrations/routes/integrationDetail/components/IntegrationSectionsContent';

// Regression test: viewing (not editing) an outbound integration wrapped every
// tab's content in <fieldset disabled>, so Basic Info, Multi-Action,
// Authentication, Timing & Follow-up, and Transformation all silently
// disabled their controls with no visual explanation and no console error —
// the same bug reported for the Reliability tab, just not yet noticed
// elsewhere. Fixed by rendering a read-only summary (Tag/Text, no inputs)
// for every tab when isReadOnly is true, consistent with what the
// Review & Submit tab already did. Also fixes a pre-existing bug in that
// Review tab summary: it read `values.authType`, but the actual registered
// field is `outgoingAuthType`, so it always displayed "NONE" regardless of
// the real auth type.

const spacing = { 1: '4px', 2: '8px', 3: '12px', 4: '16px', 6: '24px' };
const colors = {
  primary: { 600: '#1677ff' },
  success: { 600: '#52c41a' },
  neutral: { 900: '#111111' },
};

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
  colors,
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
};

const renderTab = (tabKey: string, isReadOnly: boolean, formValues: Record<string, unknown>) => {
  const Wrapper = () => {
    const [form] = Form.useForm();
    // Set values directly rather than relying on <Form initialValues>, which
    // only applies once the Form mounts — after buildIntegrationSectionItems
    // has already read form.getFieldsValue() for this render.
    form.setFieldsValue(formValues);
    const items = buildIntegrationSectionItems({
      ...baseProps,
      form,
      isMultiAction: false,
      isEditMode: !isReadOnly,
      isReadOnly,
      deliveryModeValue: 'IMMEDIATE',
    } as any);
    const tab = items?.find((item: any) => item.key === tabKey) as any;

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

describe('Outbound Integration tabs — read-only summaries instead of disabled forms', () => {
  it('shows Basic Info as read-only text, not editable inputs, when viewing (not editing)', () => {
    renderTab('configuration', true, {
      name: 'My Rule',
      eventType: 'order.created',
      targetUrl: 'https://x.com',
      httpMethod: 'POST',
    });

    expect(screen.getByText('My Rule')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /event rule name/i })).not.toBeInTheDocument();
  });

  it('shows the Authentication tab reading outgoingAuthType (not the stale authType field)', () => {
    renderTab('authentication', true, { outgoingAuthType: 'OAUTH2' });

    expect(screen.getByText('OAUTH2')).toBeInTheDocument();
  });

  it('shows Reliability as a read-only summary with no switch or radio controls', () => {
    renderTab('reliability', true, { timeoutMs: 15000, retryCount: 2, rateLimits: { enabled: false } });

    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
  });

  it('renders the real editable Authentication Type select (not a summary tag) when in edit mode', () => {
    renderTab('authentication', false, { outgoingAuthType: 'NONE' });

    expect(screen.getByText('Authentication Type')).toBeInTheDocument();
    expect(screen.queryByText('Auth Type:')).not.toBeInTheDocument();
  });
});
