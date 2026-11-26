import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { NodePalette } from '../features/flowBuilder/components/NodePalette';

describe('Flow Builder node palette', () => {
  it('renders the available nodes and adds a selected node', async () => {
    const user = userEvent.setup();
    const onAddNode = vi.fn();

    render(
      <ThemeProvider>
        <NodePalette mode="INBOUND" onAddNode={onAddNode} />
      </ThemeProvider>
    );

    expect(screen.getByRole('heading', { name: 'Node Palette' })).toBeInTheDocument();
    expect(screen.getByText('Inbound Auth')).toBeInTheDocument();
    expect(screen.getByText('Transform')).toBeInTheDocument();

    await user.click(screen.getByText('Transform'));

    expect(onAddNode).toHaveBeenCalledWith('transform');
  });
});
