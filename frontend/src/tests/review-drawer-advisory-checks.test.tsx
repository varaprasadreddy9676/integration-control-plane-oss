import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { ReviewConfirmDrawer } from '../features/integrations/routes/integrationDetail/components/ReviewConfirmDrawer';

const baseProps = {
  open: true,
  onClose: () => {},
  onConfirm: () => {},
  isCreating: true,
  ruleName: 'Orders to partner CRM',
  eventType: 'ORDER_PLACED',
  targetUrl: 'https://partner.example.com/orders',
  httpMethod: 'POST',
  scope: 'ENTITY_ONLY',
  deliveryMode: 'IMMEDIATE',
  retryPolicy: '3 retries',
  authMethod: 'NONE',
  isSaving: false,
};

describe('ReviewConfirmDrawer readiness', () => {
  it('allows activation when only an advisory check is incomplete (no transform = passthrough)', () => {
    render(
      <ThemeProvider>
      <ReviewConfirmDrawer
        {...baseProps}
        readinessChecks={[
          { label: 'Target endpoint configured', isComplete: true },
          { label: 'Transformation configured', isComplete: false, advisory: true, warning: 'Payload is sent as-is' },
        ]}
      />
      </ThemeProvider>
    );
    expect(screen.queryByText('Complete all readiness checks first')).not.toBeInTheDocument();
    expect(screen.getByText('Payload is sent as-is')).toBeInTheDocument();
  });

  it('still blocks activation when a required check is incomplete', () => {
    render(
      <ThemeProvider>
      <ReviewConfirmDrawer
        {...baseProps}
        readinessChecks={[{ label: 'Target endpoint configured', isComplete: false, warning: 'Required field missing' }]}
      />
      </ThemeProvider>
    );
    expect(screen.getByText('Complete all readiness checks first')).toBeInTheDocument();
  });
});
