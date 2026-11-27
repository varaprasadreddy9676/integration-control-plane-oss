import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IntegrationSections } from '../features/integrations/routes/integrationDetail/components/IntegrationSections';

const items = [
  { key: 'configuration', label: 'Basic Info', children: <div>Configuration form</div> },
  { key: 'payload', label: 'Payload', children: <div>Payload form</div> },
  { key: 'authentication', label: 'Authentication', disabled: true, children: <div>Authentication form</div> },
  { key: 'reliability', label: 'Reliability', children: <div>Reliability form</div> },
];

const ControlledSections = ({ onChange = vi.fn() }: { onChange?: (keys: string[]) => void }) => {
  const [activePanels, setActivePanels] = useState(['configuration']);
  return (
    <IntegrationSections
      activePanels={activePanels}
      onChange={(keys) => {
        onChange(keys);
        setActivePanels(keys);
      }}
      items={items}
    />
  );
};

describe('IntegrationSections keyboard navigation', () => {
  it('supports arrow wrapping, Home/End, skipping disabled tabs, and roving tabindex', () => {
    const onChange = vi.fn();
    render(<ControlledSections onChange={onChange} />);

    const firstTab = screen.getByRole('tab', { name: 'Basic Info' });
    const secondTab = screen.getByRole('tab', { name: 'Payload' });
    const disabledTab = screen.getByRole('tab', { name: 'Authentication' });
    const fourthTab = screen.getByRole('tab', { name: 'Reliability' });

    const expectRovingTabIndex = (selectedTab: HTMLElement) => {
      for (const tab of [firstTab, secondTab, disabledTab, fourthTab]) {
        expect(tab).toHaveAttribute('tabindex', tab === selectedTab ? '0' : '-1');
      }
    };

    expect(disabledTab).toHaveAttribute('aria-disabled', 'true');
    expect(disabledTab).toHaveAttribute('disabled');
    expect(disabledTab).toBeDisabled();
    expectRovingTabIndex(firstTab);

    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(['payload']);
    expect(document.activeElement?.id).toBe('integration-section-payload-tab');
    expectRovingTabIndex(secondTab);

    // Skips disabled third tab when moving down to fourth enabled tab
    fireEvent.keyDown(secondTab, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(['reliability']);
    expect(document.activeElement?.id).toBe('integration-section-reliability-tab');
    expectRovingTabIndex(fourthTab);

    // ArrowDown on the last enabled tab wraps to the first
    fireEvent.keyDown(fourthTab, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith(['configuration']);
    expect(document.activeElement?.id).toBe('integration-section-configuration-tab');
    expectRovingTabIndex(firstTab);

    // ArrowUp on the first enabled tab wraps to the last
    fireEvent.keyDown(firstTab, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(['reliability']);
    expect(document.activeElement?.id).toBe('integration-section-reliability-tab');
    expectRovingTabIndex(fourthTab);

    // Skips disabled third tab when moving up to second enabled tab
    fireEvent.keyDown(fourthTab, { key: 'ArrowUp' });
    expect(onChange).toHaveBeenLastCalledWith(['payload']);
    expect(document.activeElement?.id).toBe('integration-section-payload-tab');
    expectRovingTabIndex(secondTab);

    // End jumps to the last enabled tab
    fireEvent.keyDown(secondTab, { key: 'End' });
    expect(onChange).toHaveBeenLastCalledWith(['reliability']);
    expect(document.activeElement?.id).toBe('integration-section-reliability-tab');
    expectRovingTabIndex(fourthTab);

    // Home jumps to the first enabled tab
    fireEvent.keyDown(fourthTab, { key: 'Home' });
    expect(onChange).toHaveBeenLastCalledWith(['configuration']);
    expect(document.activeElement?.id).toBe('integration-section-configuration-tab');
    expectRovingTabIndex(firstTab);
  });
});
