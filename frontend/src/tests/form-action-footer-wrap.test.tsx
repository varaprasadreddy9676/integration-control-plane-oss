import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FormActionFooter } from '../features/integrations/routes/integrationDetail/components/FormActionFooter';

// Regression test: the outer footer container and its <Space> both lacked flexWrap, so even
// after FormActions itself was fixed to wrap, the "Activate" button (a sibling of FormActions
// in this outer Space) stayed pinned to the original row height while the wrapped buttons
// dropped below it — a visually disconnected, broken-looking layout on narrow viewports.

const spacing = { 2: '8px', 3: '12px' };
const noop = () => {};

describe('FormActionFooter wraps the whole action row as one unit', () => {
  it('wraps the outer footer and the inner action row', () => {
    const { container } = render(
      <FormActionFooter
        visible
        isCreate={false}
        isSaving={false}
        isActiveValue={false}
        canTest
        canSave
        onSave={noop}
        onTest={noop}
        onCancel={noop}
        saveText="Save Changes"
        testText="Test"
        testDisabledTooltip="Fix errors first"
        testEnabledTooltip="Send a test event"
        spacing={spacing}
        onActivate={noop}
        showActivate
      />
    );

    const outerContainer = container.firstElementChild as HTMLElement;
    expect(outerContainer.style.flexWrap).toBe('wrap');

    expect(container.querySelector('[data-wrap="wrap"]')).toBeInTheDocument();
  });

  it('still renders the Activate button alongside Save Changes when showActivate is true', () => {
    const { getByText } = render(
      <FormActionFooter
        visible
        isCreate={false}
        isSaving={false}
        isActiveValue={false}
        canTest={false}
        canSave
        onSave={noop}
        onTest={noop}
        onCancel={noop}
        saveText="Save Changes"
        testText="Test"
        testDisabledTooltip="Fix errors first"
        testEnabledTooltip="Send a test event"
        spacing={spacing}
        onActivate={noop}
        showActivate
      />
    );

    expect(getByText('Save Changes')).toBeInTheDocument();
    expect(getByText('Activate')).toBeInTheDocument();
  });
});
