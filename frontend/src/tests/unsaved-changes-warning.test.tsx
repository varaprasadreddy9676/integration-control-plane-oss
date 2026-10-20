import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUnsavedChangesWarning } from '../hooks/useUnsavedChangesWarning';

/**
 * The config editors (integration, inbound, scheduled job) are long forms.
 * Before this hook existed, a refresh or a closed tab threw the whole edit away
 * without a word — so what matters here is that the listener is registered only
 * while there is something to lose, and always torn down afterwards.
 */
describe('useUnsavedChangesWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const fireUnload = () => {
    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);
    return event;
  };

  it('does not intercept the page unload when there is nothing unsaved', () => {
    renderHook(() => useUnsavedChangesWarning(false));

    expect(fireUnload().defaultPrevented).toBe(false);
  });

  it('asks the predicate at unload time rather than trusting a stale flag', () => {
    // Regression: these forms write back into themselves while rendering, so a
    // flag set from onValuesChange latched on and the prompt fired even right
    // after the user discarded their edits.
    let dirty = true;
    renderHook(() => useUnsavedChangesWarning(() => dirty));

    expect(fireUnload().defaultPrevented).toBe(true);

    dirty = false;
    expect(fireUnload().defaultPrevented).toBe(false);
  });

  it('prompts the browser before unloading while edits are unsaved', () => {
    renderHook(() => useUnsavedChangesWarning(true));

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    // A cancelled beforeunload is what makes the browser show its own
    // "leave site?" prompt.
    expect(event.defaultPrevented).toBe(true);
  });

  it('stops prompting once the form reports itself saved', () => {
    const { rerender } = renderHook(({ dirty }) => useUnsavedChangesWarning(dirty), {
      initialProps: { dirty: true },
    });

    rerender({ dirty: false });

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('removes its listener on unmount so an unrelated screen is unaffected', () => {
    const { unmount } = renderHook(() => useUnsavedChangesWarning(true));

    unmount();

    const event = new Event('beforeunload', { cancelable: true }) as BeforeUnloadEvent;
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });
});
