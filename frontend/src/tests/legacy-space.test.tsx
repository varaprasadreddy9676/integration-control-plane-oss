import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LegacySpace } from '../components/common/LegacySpace';

describe('LegacySpace', () => {
  it('uses Astryx Stack for common layout and preserves the requested gap', () => {
    render(
      <LegacySpace size={12} direction="vertical" aria-label="Configuration fields">
        <span>First field</span>
        <span>Second field</span>
      </LegacySpace>
    );

    const layout = screen.getByLabelText('Configuration fields');
    expect(layout).toHaveAttribute('data-direction', 'vertical');
    expect(layout).toHaveStyle({ display: 'inline-flex', gap: '12px' });
    expect(screen.getByText('First field')).toBeInTheDocument();
    expect(screen.getByText('Second field')).toBeInTheDocument();
  });

  it('keeps AntD behavior for baseline alignment that Stack does not support', () => {
    render(
      <LegacySpace align="baseline">
        <span>Label</span>
        <span>Value</span>
      </LegacySpace>
    );

    expect(screen.getByText('Label').parentElement?.parentElement).toHaveClass('ant-space');
  });

  it('keeps the provider-controlled default density when no size is specified', () => {
    render(
      <LegacySpace>
        <span>First</span>
        <span>Second</span>
      </LegacySpace>
    );

    expect(screen.getByText('First').parentElement?.parentElement).toHaveClass('ant-space');
  });
});
