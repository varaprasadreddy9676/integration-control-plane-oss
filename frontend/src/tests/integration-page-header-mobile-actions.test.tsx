import { Form } from 'antd';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { spacing } from '../design-system/tokens/spacing';
import { IntegrationPageHeader } from '../features/integrations/routes/integrationDetail/components/IntegrationPageHeader';

describe('IntegrationPageHeader mobile actions', () => {
  it('wraps secondary actions and primary actions within the available width', () => {
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

    const actionGroups = container.querySelector('.integration-page-header-actions');
    expect(actionGroups).not.toBeNull();
    expect(actionGroups).toHaveStyle({ display: 'flex', flexWrap: 'wrap', maxWidth: '100%' });
    expect(container.querySelector('.integration-page-header-primary-actions')).toHaveClass(
      'integration-page-header-primary-actions'
    );
    expect(actionGroups?.textContent).toContain('Test Event Rule');
    expect(actionGroups?.textContent).toContain('Edit Integration');
    expect(actionGroups?.textContent).toContain('Reveal credentials');
    expect(container.querySelector('.ant-typography')).toBeNull();
  });
});
