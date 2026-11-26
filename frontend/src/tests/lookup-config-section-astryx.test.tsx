import { App } from 'antd';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { LookupConfigSection } from '../features/integrations/components/LookupConfigSection';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { types: ['SERVICE_CODE'] } }),
}));
vi.mock('../design-system/utils', () => ({
  cssVar: {
    legacy: { primary: { 600: '#2563eb' }, neutral: { 300: '#d1d5db' } },
    bg: { subtle: '#f8fafc' },
    text: { muted: '#64748b', primary: '#111827' },
    table: { codeBg: '#f1f5f9' },
  },
  useDesignTokens: () => ({ spacing: new Proxy({}, { get: () => '8px' }) }),
}));

describe('LookupConfigSection typography', () => {
  it('uses the shared heading and text while preserving the add-mapping action', () => {
    const onChange = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <App>
          <LookupConfigSection value={[]} onChange={onChange} />
        </App>
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'Code Mappings (Lookups)' })).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-typography')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Add Mapping' }));
    expect(onChange).toHaveBeenCalledWith([
      {
        type: '',
        sourceField: '',
        targetField: '',
        unmappedBehavior: 'PASSTHROUGH',
        defaultValue: undefined,
      },
    ]);
  });
});
