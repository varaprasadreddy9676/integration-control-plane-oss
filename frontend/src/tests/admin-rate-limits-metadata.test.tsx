import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '../app/theme-provider';
import type { AdminRateLimitItem } from '../services/api';

vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  listAdminRateLimits: vi.fn(),
}));

const record = {
  id: 'integration-1',
  name: 'Outbound claims',
  type: 'HTTP',
  direction: 'OUTBOUND',
  isActive: false,
} as AdminRateLimitItem;

describe('Admin rate limit metadata', () => {
  it('uses readable metadata and a sentence-case status without AntD chips', async () => {
    const { RateLimitIntegrationMetadata } = await import('../features/settings/AdminRateLimitsRoute');
    const { container } = render(
      <ThemeProvider>
        <RateLimitIntegrationMetadata record={record} />
      </ThemeProvider>
    );

    expect(screen.getByText('Outbound claims')).toBeInTheDocument();
    expect(screen.getByText('HTTP')).toBeInTheDocument();
    expect(screen.getByText('Outbound')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag')).toBeNull();
    expect(container.querySelector('.ant-typography')).toBeNull();
  });

  it('keeps a retry action in the stale-data warning', async () => {
    const { RateLimitRefreshNotice } = await import('../features/settings/AdminRateLimitsRoute');
    const onRetry = vi.fn();
    render(
      <ThemeProvider>
        <RateLimitRefreshNotice onRetry={onRetry} />
      </ThemeProvider>
    );

    expect(screen.getByText('Showing the most recently loaded values.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
