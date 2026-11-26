import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Icon } from '../components/common/Icon';

describe('shared icon wrapper', () => {
  it('renders the mapped icon with accessible presentation and rotation', () => {
    const { container } = render(<Icon name="ReloadOutlined" aria-hidden="true" rotate={90} />);
    const svg = container.querySelector('svg');

    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveStyle({ transform: 'rotate(90deg)' });
  });

  it('marks loading icons for the reduced-motion-aware spin treatment', () => {
    render(<Icon name="LoadingOutlined" spin aria-label="Loading" />);

    expect(screen.getByLabelText('Loading')).toHaveClass('gateway-icon--spin');
  });

  it('renders the shared aliases used by the public documentation shell', () => {
    const { container } = render(<Icon name="GithubOutlined" aria-hidden="true" />);

    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('preserves explicit legacy font-size dimensions', () => {
    const { container } = render(<Icon name="InboxOutlined" style={{ fontSize: 48 }} />);

    expect(container.querySelector('svg')).toHaveStyle({ width: '48px', height: '48px' });
  });
});
