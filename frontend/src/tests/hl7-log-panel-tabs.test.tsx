import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Hl7LogPanel } from '../features/logs/components/Hl7LogPanel';

vi.mock('antd', async (importOriginal) => {
  const antd = await importOriginal<typeof import('antd')>();
  return { ...antd, message: { success: vi.fn(), error: vi.fn() } };
});

vi.mock('../design-system/utils', () => ({
  useDesignTokens: () => ({
    spacing: { 1: '4px', 2: '8px', 5: '20px' },
    token: {
      colorTextBase: '#111827',
      colorText: '#111827',
      borderRadiusLG: 4,
      colorBorderSecondary: '#d1d5db',
    },
  }),
  withAlpha: (color: string) => color,
}));

vi.mock('../features/logs/components/DeliveryDebugTimeline', () => ({ DeliveryDebugTimeline: () => null }));
vi.mock('../features/logs/components/ReplayPayloadModal', () => ({ ReplayPayloadModal: () => null }));
vi.mock('../components/common/LegacyButton', () => ({
  Button: ({ children, icon, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode }) => (
    <button {...props}>{icon}{children}</button>
  ),
}));
vi.mock('../components/common/ModernTable', () => ({
  ModernTable: ({ dataSource }: { dataSource: Array<{ field: string; value: string }> }) => (
    <div>{dataSource.map((row) => <div key={row.field}>{row.field}: {row.value}</div>)}</div>
  ),
}));
vi.mock('../components/common/StatePanel', () => ({ StatePanel: ({ title }: { title: string }) => <div>{title}</div> }));
vi.mock('../utils/clipboard', () => ({ copyTextToClipboard: vi.fn() }));

const request = 'MSH|^~\\&|SENDER|HOSP|TARGET|HOSP|202301011200||ADT^A01|MSG123|P|2.5\rPID|1||12345^^^MRN||DOE^JANE';
const ack = 'MSH|^~\\&|TARGET|HOSP|SENDER|HOSP|202301011201||ACK|ACK123|P|2.5\rMSA|AA|MSG123|Accepted';

describe('HL7 log detail tabs', () => {
  it('switches between request fields and ACK fields with linked visible panels', () => {
    render(
      <Hl7LogPanel
        httpMethod="HL7_MLLP"
        requestPayload={request}
        responseBody={ack}
        metadata={{ hl7: { accepted: true } }}
      />
    );

    const requestTab = screen.getByRole('tab', { name: 'Request HL7' });
    const requestPanel = document.getElementById('hl7-request-panel');
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
    expect(requestTab).toHaveAttribute('aria-controls', 'hl7-request-panel');
    expect(requestPanel).toBeVisible();
    expect(requestPanel).toHaveTextContent('MSG123');

    const fieldsTab = screen.getByRole('tab', { name: /Request Fields/ });
    fireEvent.click(fieldsTab);
    expect(fieldsTab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('hl7-request-fields-panel')).toBeVisible();
    expect(screen.getByText('PID-3: 12345^^^MRN')).toBeVisible();
    expect(requestPanel).not.toBeVisible();

    const ackFieldsTab = screen.getByRole('tab', { name: /ACK Fields/ });
    fireEvent.click(ackFieldsTab);
    expect(ackFieldsTab).toHaveAttribute('aria-selected', 'true');
    expect(document.getElementById('hl7-ack-fields-panel')).toBeVisible();
    expect(screen.getByText('MSA-1: AA')).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText(/Search MSH-10/), { target: { value: 'no-match' } });
    expect(screen.queryByRole('tab', { name: /ACK Fields/ })).not.toBeInTheDocument();
    expect(requestTab).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps hook order stable when the same panel receives an HL7 payload later', () => {
    const { rerender } = render(<Hl7LogPanel httpMethod="POST" requestPayload={{ event: 'visit.created' }} />);
    expect(screen.queryByRole('tablist', { name: 'HL7 delivery details' })).not.toBeInTheDocument();

    rerender(<Hl7LogPanel httpMethod="HL7_MLLP" requestPayload={request} />);
    expect(screen.getByRole('tab', { name: 'Request HL7' })).toHaveAttribute('aria-selected', 'true');
  });
});
