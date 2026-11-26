import { App } from 'antd';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CallerCard } from '../features/logs/components/CallerCard';

const { copyTextToClipboard } = vi.hoisted(() => ({ copyTextToClipboard: vi.fn().mockResolvedValue(true) }));

vi.mock('../utils/clipboard', () => ({ copyTextToClipboard }));
vi.mock('../design-system/utils', () => ({
  useDesignTokens: () => ({ token: { colorTextSecondary: '#666', paddingXS: 4 } }),
}));

describe('CallerCard Astryx text', () => {
  it('keeps caller details readable and preserves request trace copying', async () => {
    const { container } = render(
      <App>
        <CallerCard
          info={{
            clientIp: '203.0.113.12',
            forwardedChain: [],
            userAgent: 'curl/8.7.1',
            agent: { label: 'curl 8.7.1', kind: 'tool' },
            host: 'gateway.example.test',
            protocol: 'https',
            port: null,
            origin: null,
            referer: null,
            contentLength: null,
            requestId: 'trace-123',
          }}
        />
      </App>
    );

    expect(screen.getByText('203.0.113.12')).toBeInTheDocument();
    expect(screen.getByText('curl 8.7.1')).toBeInTheDocument();
    expect(container.querySelectorAll('.ant-typography')).toHaveLength(0);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy load balancer trace' }));
      await Promise.resolve();
    });
    expect(copyTextToClipboard).toHaveBeenCalledWith('trace-123');
  });
});
