import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RetainedTabs, type RetainedTabItem } from '../components/common/RetainedTabs';

const createItems = (): RetainedTabItem[] => [
  { key: 'request', label: 'Request', children: <input aria-label="request value" defaultValue="kept" /> },
  { key: 'response', label: 'Response', children: <div>Response payload</div> },
];

describe('RetainedTabs', () => {
  it('links selected tabs to panels and retains visited panel content', () => {
    const { container } = render(
      <RetainedTabs items={createItems()} initialKey="request" ariaLabel="Delivery details" idPrefix="delivery-1" />
    );

    const requestTab = screen.getByRole('tab', { name: 'Request' });
    const responseTab = screen.getByRole('tab', { name: 'Response' });
    expect(requestTab).toHaveAttribute('aria-controls', 'delivery-1-panel-request');
    fireEvent.click(responseTab);

    expect(responseTab).toHaveAttribute('aria-selected', 'true');
    expect(container.querySelector('#delivery-1-panel-response')).toBeVisible();
    fireEvent.click(requestTab);
    expect(screen.getByRole('textbox', { name: 'request value' })).toHaveValue('kept');
    expect(container.querySelector('#delivery-1-panel-response')).toHaveTextContent('Response payload');
  });

  it('falls back when the selected dynamic tab disappears', () => {
    const items = createItems();
    const { rerender } = render(
      <RetainedTabs items={items} initialKey="request" ariaLabel="Delivery details" idPrefix="delivery-2" />
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Response' }));

    rerender(
      <RetainedTabs items={[items[0]]} initialKey="request" ariaLabel="Delivery details" idPrefix="delivery-2" />
    );
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('tab', { name: 'Response' })).not.toBeInTheDocument();
  });

  it('keeps disabled steps unselectable', () => {
    const items = [
      ...createItems(),
      { key: 'review', label: 'Review', children: <div>Review content</div>, disabled: true },
    ];
    render(<RetainedTabs items={items} initialKey="request" ariaLabel="Delivery details" idPrefix="delivery-3" />);

    const reviewTab = screen.getByRole('tab', { name: 'Review' });
    fireEvent.click(reviewTab);
    expect(reviewTab).toHaveAttribute('aria-disabled', 'true');
    expect(reviewTab).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');
  });
});
