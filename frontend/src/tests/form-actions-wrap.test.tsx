import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { FormActions } from '../features/integrations/components/common/FormActions';

// Regression test for the narrow-viewport bug where the button row inside FormActions
// overflowed the visible page instead of wrapping onto a second line (see FormActionFooter.tsx
// and InboundIntegrationDetailRoute.tsx bottom action bar for the two other places this was fixed).
// AntD's <Space wrap> sets flexWrap: 'wrap' as an inline style on its wrapper div rather than
// a dedicated class, so we assert on that style directly.

const spacing = { 2: '8px' };
const colors = { neutral: { 900: '#000' } };
const noop = () => {};

const getSpaceWrapper = (container: HTMLElement) => container.querySelector('.ant-space') as HTMLElement;

describe('FormActions button rows wrap on narrow viewports', () => {
  it('wraps in "view" mode (Test / Export / Duplicate / Edit)', () => {
    const { container } = render(
      <FormActions
        mode="view"
        canTest
        canExport
        canDuplicate
        onSave={noop}
        onTest={noop}
        onCancel={noop}
        onToggleEdit={noop}
        onExport={noop}
        onDuplicate={noop}
        spacing={spacing}
        colors={colors}
      />
    );

    expect(getSpaceWrapper(container).style.flexWrap).toBe('wrap');
  });

  it('wraps in "view + isEditMode" mode (Cancel / Save Changes)', () => {
    const { container } = render(
      <FormActions mode="view" isEditMode onSave={noop} onCancel={noop} spacing={spacing} colors={colors} />
    );

    expect(getSpaceWrapper(container).style.flexWrap).toBe('wrap');
  });

  it('wraps in "edit" mode (Cancel / Test / Save Changes)', () => {
    const { container } = render(
      <FormActions mode="edit" canTest onSave={noop} onTest={noop} onCancel={noop} spacing={spacing} colors={colors} />
    );

    expect(getSpaceWrapper(container).style.flexWrap).toBe('wrap');
  });

  it('wraps in "create" mode (Import / Cancel / Create)', () => {
    const { container } = render(
      <FormActions
        mode="create"
        canImport
        onSave={noop}
        onCancel={noop}
        onImport={noop}
        spacing={spacing}
        colors={colors}
      />
    );

    expect(getSpaceWrapper(container).style.flexWrap).toBe('wrap');
  });
});
