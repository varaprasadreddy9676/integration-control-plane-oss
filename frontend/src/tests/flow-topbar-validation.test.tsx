import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import { FlowTopBar } from '../features/flowBuilder/components/FlowTopBar';
import type { FlowState, FlowValidationResult } from '../features/flowBuilder/state/flowTypes';

const flowState = {
  name: 'Test flow',
  mode: 'INBOUND',
  isActive: true,
} as FlowState;

const actions = {
  onSave: () => undefined,
  onTest: () => undefined,
  onPreview: () => undefined,
  onBack: () => undefined,
  onNameChange: () => undefined,
  onActiveToggle: () => undefined,
};

const renderTopBar = (validation: FlowValidationResult) => render(
  <ThemeProvider>
    <FlowTopBar
      flowState={flowState}
      validation={validation}
      isDirty={false}
      isSaving={false}
      isTesting={false}
      {...actions}
    />
  </ThemeProvider>
);

describe('FlowTopBar validation state', () => {
  it('shows a visible, sentence-case error count and keeps details available', () => {
    const { container } = renderTopBar({
      isValid: false,
      errors: [{ message: 'Configure the event trigger' }, { message: 'Add a target URL' }],
      warnings: [],
    });

    expect(screen.getByText('Inbound')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).toBeNull();
    expect(container.querySelector('.ant-typography')).toBeNull();
    expect(screen.getByText('2 errors')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('shows a visible warning count when the flow has no errors', () => {
    renderTopBar({
      isValid: true,
      errors: [],
      warnings: [{ message: 'Retry policy uses the default' }],
    });

    expect(screen.getByText('1 warning')).toBeInTheDocument();
  });
});
