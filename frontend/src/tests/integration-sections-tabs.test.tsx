import { describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntegrationSections } from '../features/integrations/routes/integrationDetail/components/IntegrationSections';

const items = [
  { key: 'configuration', label: 'Basic Info', children: <div>Configuration form</div> },
  { key: 'authentication', label: 'Authentication', disabled: true, children: <div>Authentication form</div> },
  { key: 'reliability', label: 'Reliability', children: <div>Reliability form</div> },
];

const ControlledSections = ({ onChange = vi.fn() }: { onChange?: (keys: string[]) => void }) => {
  const [activePanels, setActivePanels] = useState(['configuration']);
  return <IntegrationSections activePanels={activePanels} onChange={(keys) => { onChange(keys); setActivePanels(keys); }} items={items} />;
};

describe('IntegrationSections', () => {
  it('associates selected tabs with their panels and retains visited form panels', () => {
    const onChange = vi.fn();
    const { container } = render(<ControlledSections onChange={onChange} />);

    const configurationTab = screen.getByRole('tab', { name: 'Basic Info' });
    const configurationPanel = container.querySelector('#integration-section-configuration-panel')!;
    expect(configurationTab).toHaveAttribute('aria-selected', 'true');
    expect(configurationTab).toHaveAttribute('aria-controls', configurationPanel.id);
    expect(screen.queryByText('Reliability form')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Reliability' }));
    expect(onChange).toHaveBeenCalledWith(['reliability']);
    expect(container.querySelector('#integration-section-reliability-panel')).toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: 'Basic Info' }));
    expect(container.querySelector('#integration-section-reliability-panel')).not.toBeVisible();
    expect(container.querySelector('#integration-section-configuration-panel')).toBeVisible();
  });

  it('keeps incomplete sections disabled and falls back when the selected section disappears', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <IntegrationSections activePanels={['authentication']} onChange={onChange} items={items} />,
    );

    expect(screen.getByRole('tab', { name: 'Authentication' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tab', { name: 'Basic Info' })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <IntegrationSections
        activePanels={['reliability']}
        onChange={onChange}
        items={items.filter((item) => item.key !== 'reliability')}
      />,
    );
    expect(screen.getByRole('tab', { name: 'Basic Info' })).toHaveAttribute('aria-selected', 'true');
  });
});
