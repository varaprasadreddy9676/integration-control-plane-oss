import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { LegacyButton } from '../components/common/LegacyButton';

describe('LegacyButton', () => {
  it('maps legacy primary, size, loading, and click behavior to the Astryx button', () => {
    const onClick = vi.fn();
    render(
      <ThemeProvider>
        <LegacyButton type="primary" size="small" loading onClick={onClick}>
          Save changes
        </LegacyButton>
      </ThemeProvider>
    );

    const button = screen.getByRole('button', { name: 'Save changes' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button.className).toContain('legacy-button-compat');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('preserves form submission semantics and names icon-only actions accessibly', () => {
    const onClick = vi.fn();
    render(
      <ThemeProvider>
        <LegacyButton htmlType="submit" aria-label="Refresh results" icon={<span aria-hidden="true">R</span>} onClick={onClick} />
      </ThemeProvider>
    );

    const button = screen.getByRole('button', { name: 'Refresh results' });
    expect(button).toHaveAttribute('type', 'submit');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
