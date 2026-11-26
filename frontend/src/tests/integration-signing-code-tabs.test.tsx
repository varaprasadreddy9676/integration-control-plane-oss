import { fireEvent, render, screen } from '@testing-library/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from '../app/theme-provider';
import { IntegrationSigningSection } from '../features/integrations/components/IntegrationSigningSection';

const { watchValues } = vi.hoisted(() => ({ watchValues: {} as Record<string, unknown> }));

vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  return {
    ...antd,
    Form: Object.assign(antd.Form, { useWatch: (field: string) => watchValues[field] }),
    Modal: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? <div role="dialog">{children}</div> : null,
    message: { useMessage: () => [{ success: vi.fn(), error: vi.fn() }, null] },
  };
});

vi.mock('../components/common/LegacyButton', () => ({
  Button: ({
    children,
    icon,
    block: _block,
    danger: _danger,
    size: _size,
    type: _type,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    icon?: ReactNode;
    block?: boolean;
    danger?: boolean;
    size?: string;
  }) => (
    <button {...props}>
      {icon}
      {children}
    </button>
  ),
}));

describe('Integration signing verification code tabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(watchValues).forEach((key) => delete watchValues[key]);
  });

  it('switches language and exposes the matching code panel', () => {
    const { container } = render(
      <ThemeProvider>
        <IntegrationSigningSection
          form={{}}
          isCreate
          showConfigAlways
          hideToggle
          spacing={{ 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px' }}
          colors={{
            primary: { 600: '#2563eb' },
            success: { 100: '#dcfce7', 300: '#86efac', 600: '#16a34a' },
            warning: { 600: '#d97706' },
            error: { 600: '#dc2626' },
          }}
          token={{ borderRadius: 4, colorBorder: '#d1d5db', colorTextSecondary: '#6b7280' }}
        />
      </ThemeProvider>
    );

    expect(container.querySelector('.ant-tag, .ant-alert')).not.toBeInTheDocument();
    expect(screen.getByText(/A signing secret will be generated when you save/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('View Code Examples'));

    const javascriptTab = screen.getByRole('tab', { name: 'Node.js' });
    const goTab = screen.getByRole('tab', { name: 'Go' });
    const javascriptPanel = document.getElementById('verification-code-javascript');
    const goPanel = document.getElementById('verification-code-go');

    expect(javascriptTab).toHaveAttribute('aria-selected', 'true');
    expect(javascriptPanel).toBeVisible();
    expect(goPanel).not.toBeVisible();
    expect(javascriptPanel).toHaveTextContent('verifyIntegration');

    fireEvent.click(goTab);

    expect(goTab).toHaveAttribute('aria-selected', 'true');
    expect(goPanel).toBeVisible();
    expect(goPanel).toHaveTextContent('func VerifyIntegration');
    expect(javascriptPanel).not.toBeVisible();
  });

  it('keeps active and primary secret states visible without AntD chips or alerts', () => {
    watchValues.enableSigning = true;
    watchValues.signingSecret = 'whsec_primary';
    watchValues.signingSecrets = ['whsec_primary', 'whsec_previous'];
    const { container } = render(
      <ThemeProvider>
        <IntegrationSigningSection
          form={{}}
          isCreate={false}
          showConfigAlways
          hideToggle
          spacing={{ 1: '4px', 2: '8px', 3: '12px', 4: '16px', 5: '20px', 6: '24px' }}
          colors={{
            primary: { 600: '#2563eb' },
            success: { 100: '#dcfce7', 300: '#86efac', 600: '#16a34a' },
            warning: { 600: '#d97706' },
            error: { 600: '#dc2626' },
          }}
          token={{ borderRadius: 4, colorBorder: '#d1d5db', colorTextSecondary: '#6b7280' }}
        />
      </ThemeProvider>
    );

    expect(screen.getByText('Active', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('Primary', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('2 active secrets')).toBeInTheDocument();
    expect(screen.getByText('Multiple signing secrets are active')).toBeInTheDocument();
    expect(container.querySelector('.ant-tag, .ant-alert')).not.toBeInTheDocument();
  });
});
