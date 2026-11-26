import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { ModernTable } from '../components/common/ModernTable';

describe('ModernTable empty state', () => {
  const columns = [{ title: 'Name', dataIndex: 'name', key: 'name' }];

  it('uses the shared state panel when a route has no custom empty content', () => {
    const { container } = render(
      <ThemeProvider>
        <ModernTable columns={columns} dataSource={[]} pagination={false} />
      </ThemeProvider>
    );

    expect(screen.getByText('No records found')).toBeInTheDocument();
    expect(container.querySelector('.state-panel')).toBeInTheDocument();
    expect(container.querySelector('.ant-empty')).not.toBeInTheDocument();
  });

  it('preserves route-specific empty-state copy', () => {
    render(
      <ThemeProvider>
        <ModernTable
          columns={columns}
          dataSource={[]}
          pagination={false}
          emptyState={{ title: 'No providers yet', description: 'Create a provider to get started.' }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText('No providers yet')).toBeInTheDocument();
    expect(screen.getByText('Create a provider to get started.')).toBeInTheDocument();
  });
});
