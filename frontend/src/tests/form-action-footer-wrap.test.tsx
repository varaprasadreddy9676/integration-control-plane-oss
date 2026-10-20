import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { FormActionFooter } from '../features/integrations/routes/integrationDetail/components/FormActionFooter';

// Regression test: the outer footer container and its <Space> both lacked flexWrap, so even
// after FormActions itself was fixed to wrap, the "Activate" button (a sibling of FormActions
// in this outer Space) stayed pinned to the original row height while the wrapped buttons
// dropped below it — a visually disconnected, broken-looking layout on narrow viewports.

const spacing = { 2: '8px', 3: '12px' };
const colors = { neutral: { 900: '#000' } };
const noop = () => {};

describe('FormActionFooter wraps the whole action row as one unit', () => {
  it('sets flexWrap: wrap on both the outer container and the inner Space', () => {
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
        token={{ colorBorderSecondary: '#eee', colorBgBase: '#fff' }}
        colors={colors}
        onActivate={noop}
        showActivate
      />
    );

    const outerContainer = container.firstElementChild as HTMLElement;
    expect(outerContainer.style.flexWrap).toBe('wrap');

    const innerSpace = container.querySelector('.ant-space') as HTMLElement;
    expect(innerSpace.style.flexWrap).toBe('wrap');
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
        token={{ colorBorderSecondary: '#eee', colorBgBase: '#fff' }}
        colors={colors}
        onActivate={noop}
        showActivate
      />
    );

    expect(getByText('Save Changes')).toBeInTheDocument();
    expect(getByText('Activate')).toBeInTheDocument();
  });
});
