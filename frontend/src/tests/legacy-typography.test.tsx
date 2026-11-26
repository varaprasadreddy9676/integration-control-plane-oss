import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Typography } from '../components/common/LegacyTypography';

describe('Astryx-backed typography compatibility', () => {
  it('renders semantic text and maps secondary copy to the supporting tone', () => {
    render(<Typography.Text type="secondary">Updated just now</Typography.Text>);

    const text = screen.getByText('Updated just now');
    expect(text).toHaveClass('astryx-text');
    expect(text).toHaveAttribute('data-type', 'supporting');
  });

  it('supports expandable paragraph content', () => {
    render(
      <Typography.Paragraph ellipsis={{ rows: 2, expandable: true }}>
        A long diagnostic message that the user can expand when they need its full details.
      </Typography.Paragraph>
    );

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByRole('button', { name: 'Less' })).toBeInTheDocument();
  });

  it('preserves heading levels', () => {
    render(<Typography.Title level={5}>Request details</Typography.Title>);
    expect(screen.getByRole('heading', { name: 'Request details', level: 5 })).toBeInTheDocument();
  });
});
