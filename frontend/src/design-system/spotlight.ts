const SPOTLIGHT_SELECTOR = '.ant-card, .dashboard-metric-tile, [data-spotlight]';

/**
 * Feeds the pointer position to the card under it (--spot-x / --spot-y), which
 * surfaces.css turns into a glow and a border highlight. One passive listener
 * for the whole app, at most one style write per frame.
 */
export function installSpotlight(): () => void {
  if (typeof window === 'undefined' || !window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    return () => undefined;
  }

  let frame = 0;
  let lastEvent: PointerEvent | null = null;

  const update = () => {
    frame = 0;
    const event = lastEvent;
    if (!event || !(event.target instanceof Element)) return;
    const card = event.target.closest<HTMLElement>(SPOTLIGHT_SELECTOR);
    if (!card) return;
    const rect = card.getBoundingClientRect();
    card.style.setProperty('--spot-x', `${event.clientX - rect.left}px`);
    card.style.setProperty('--spot-y', `${event.clientY - rect.top}px`);
  };

  const onMove = (event: PointerEvent) => {
    lastEvent = event;
    if (!frame) frame = requestAnimationFrame(update);
  };

  document.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    document.removeEventListener('pointermove', onMove);
    if (frame) cancelAnimationFrame(frame);
  };
}
