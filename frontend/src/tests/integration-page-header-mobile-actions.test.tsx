import { Form } from 'antd';
import { render, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { spacing } from '../design-system/tokens/spacing';
import { IntegrationPageHeader } from '../features/integrations/routes/integrationDetail/components/IntegrationPageHeader';

describe('IntegrationPageHeader mobile actions', () => {
  it('keeps primary actions visible and groups secondary actions behind a named menu', () => {
    const { container } = render(
      <ThemeProvider>
        <MemoryRouter>
          <Form>
            <IntegrationPageHeader
              isCreate={false}
              isEditMode={false}
              isMultiAction={false}
              isActiveValue
              isSaving={false}
              spacing={spacing}
              colors={{ success: { 600: 'var(--color-success-600)' }, warning: { 600: 'var(--color-warning-600)' } } as any}
              onSave={vi.fn()}
              onTest={vi.fn()}
              onCancelEdit={vi.fn()}
              onEnterEditMode={vi.fn()}
              onDuplicate={vi.fn()}
              onExport={vi.fn()}
              onImport={vi.fn()}
              extraActions={<button type="button">Reveal credentials</button>}
            />
          </Form>
        </MemoryRouter>
      </ThemeProvider>
    );

    const actions = within(container).getByRole('region', { name: 'Integration actions' });
    expect(container.querySelector('.integration-page-header-primary-actions')).toHaveClass(
      'integration-page-header-primary-actions'
    );
    for (const name of ['Test Event Rule', 'Edit Integration', 'Reveal credentials', 'More integration actions']) {
      expect(within(actions).getByRole('button', { name })).toBeInTheDocument();
    }
    expect(within(actions).queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument();
    expect(container.querySelector('.ant-typography')).toBeNull();
  });
});
