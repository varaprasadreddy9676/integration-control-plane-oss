import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { markMorphSource, withViewTransition } from '../design-system/view-transition';
import { scrambleReveal } from '../design-system/delight';
import { useNavigateWithParams } from '../utils/navigation';

// Independent of whether this TypeScript's DOM types already declare the API.
const doc = document as unknown as { startViewTransition?: unknown };

const fakeTransition = () => ({
  ready: Promise.resolve(),
  finished: Promise.resolve(),
  updateCallbackDone: Promise.resolve(),
});

afterEach(() => {
  delete doc.startViewTransition;
  vi.restoreAllMocks();
});

describe('withViewTransition', () => {
  it('just runs the update where the API is missing', () => {
    const update = vi.fn();
    withViewTransition(update);
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('runs the update inside a view transition and names the morph source only for the old frame', async () => {
    const source = document.createElement('a');
    let nameDuringCapture = '';
    doc.startViewTransition = vi.fn((callback: () => Promise<void>) => {
      nameDuringCapture = source.style.viewTransitionName;
      void callback();
      return fakeTransition();
    });
    const update = vi.fn();

    markMorphSource(source);
    withViewTransition(update);

    expect(nameDuringCapture).toBe('entity-title');
    expect(update).toHaveBeenCalledTimes(1);
    expect(source.style.viewTransitionName).toBe('');
  });

  it('skips the transition for users who prefer reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList
    );
    const start = vi.fn();
    doc.startViewTransition = start;
    const update = vi.fn();
    withViewTransition(update);
    expect(start).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('useNavigateWithParams transitions', () => {
  const Harness = ({ to }: { to: string }) => {
    const navigate = useNavigateWithParams();
    const location = useLocation();
    return (
      <button type="button" onClick={() => navigate(to)}>
        {location.pathname + location.search}
      </button>
    );
  };

  const renderAt = (to: string) =>
    render(
      <MemoryRouter initialEntries={['/integrations']}>
        <Routes>
          <Route path="*" element={<Harness to={to} />} />
        </Routes>
      </MemoryRouter>
    );

  it('animates a move to another page', () => {
    const start = vi.fn((callback: () => void) => {
      callback();
      return fakeTransition();
    });
    doc.startViewTransition = start;
    const { getByRole } = renderAt('/integrations/abc');
    fireEvent.click(getByRole('button'));
    expect(start).toHaveBeenCalledTimes(1);
    expect(getByRole('button').textContent).toContain('/integrations/abc');
  });

  it('keeps a query-only change (filters, tabs) instant', () => {
    const start = vi.fn();
    doc.startViewTransition = start;
    const { getByRole } = renderAt('/integrations?tab=inbound');
    fireEvent.click(getByRole('button'));
    expect(start).not.toHaveBeenCalled();
    expect(getByRole('button').textContent).toContain('tab=inbound');
  });
});

describe('scrambleReveal', () => {
  it('always ends on the exact value', () => {
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const seen: string[] = [];
    scrambleReveal('mdcs_pat_abc123', (text) => seen.push(text), 100);
    for (const t of [30, 60, 100]) {
      now = t;
      frames.shift()?.(t);
    }
    expect(seen[0]).toHaveLength('mdcs_pat_abc123'.length);
    expect(seen.at(-1)).toBe('mdcs_pat_abc123');
  });

  it('shows the value immediately for reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) => ({ matches: query.includes('reduce'), media: query }) as MediaQueryList
    );
    const onFrame = vi.fn();
    scrambleReveal('secret', onFrame);
    expect(onFrame).toHaveBeenCalledWith('secret');
  });
});
