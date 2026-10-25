import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';

export interface View {
  x: number;
  y: number;
  z: number;
}

export interface Size {
  width: number;
  height: number;
}

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.5;
const READABLE_ZOOM = 0.7;
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The rectangle of the host (in host coordinates) that is visible in the stage. */
export const visibleRect = (view: View, size: Size) => ({
  x: -view.x / view.z,
  y: -view.y / view.z,
  width: size.width / view.z,
  height: size.height / view.z,
});

/**
 * Zoom and pan of the canvas. The view only changes when the user asks (buttons, wheel,
 * drag, minimap) or the selected step would be hidden by the inspector: then it moves by
 * the least that shows the step (spec 10), never re-centring.
 */
export function useViewport(stageRef: RefObject<HTMLDivElement>, content: Size) {
  const [view, setView] = useState<View>({ x: 40, y: 56, z: 0.82 });
  const [size, setSize] = useState<Size>({ width: 800, height: 600 });
  const dragging = useRef<{ x: number; y: number; view: View } | null>(null);
  const fitted = useRef(false);
  const { width: contentWidth, height: contentHeight } = content;

  /** Fit the whole flow, but never smaller than a readable size: a tall flow is panned, not shrunk to dots. */
  const fitTo = useCallback((box: Size, within: Size, floor = READABLE_ZOOM): View => {
    const topReserve = 64; // the top bar
    const fits = Math.min((within.width - 96) / box.width, (within.height - topReserve - 32) / box.height, 1);
    const z = clamp(Math.max(fits, floor), MIN_ZOOM, MAX_ZOOM);
    return { z, x: Math.max((within.width - box.width * z) / 2, 56), y: topReserve };
  }, []);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    const measure = () => {
      const next = { width: element.clientWidth, height: element.clientHeight };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
      if (!fitted.current && next.width > 0) {
        fitted.current = true;
        setView(fitTo({ width: contentWidth, height: contentHeight }, next));
      }
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [stageRef, contentWidth, contentHeight, fitTo]);

  const zoomTo = useCallback(
    (nextZoom: number, around?: { x: number; y: number }) => {
      setView((current) => {
        const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
        const anchor = around || { x: size.width / 2, y: size.height / 2 };
        const hostX = (anchor.x - current.x) / current.z;
        const hostY = (anchor.y - current.y) / current.z;
        return { z, x: anchor.x - hostX * z, y: anchor.y - hostY * z };
      });
    },
    [size]
  );

  // Wheel: pan; with ctrl/cmd (or a trackpad pinch) zoom around the pointer.
  useEffect(() => {
    const element = stageRef.current;
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const bounds = element.getBoundingClientRect();
        zoomTo(view.z * Math.exp(-event.deltaY * 0.01), {
          x: event.clientX - bounds.left,
          y: event.clientY - bounds.top,
        });
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [stageRef, view.z, zoomTo]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // React bubbles events out of portals (the add-a-step menu): only a press on the canvas itself drags it.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest('button, input, a, [data-no-pan]')) return;
    dragging.current = { x: event.clientX, y: event.clientY, view };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragging.current;
    if (!start) return;
    setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
  };
  const onPointerUp = () => {
    dragging.current = null;
  };

  /** Pan by the least needed so the host rectangle (padded) is inside the stage. */
  const ensureVisible = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, availableWidth: number = size.width) => {
      setView((current) => {
        const pad = 24;
        const left = rect.x * current.z + current.x;
        const right = (rect.x + rect.width) * current.z + current.x;
        const top = rect.y * current.z + current.y;
        const bottom = (rect.y + rect.height) * current.z + current.y;
        const dx = left < pad ? pad - left : right > availableWidth - pad ? availableWidth - pad - right : 0;
        const dy = top < 64 ? 64 - top : bottom > size.height - pad ? size.height - pad - bottom : 0;
        return dx === 0 && dy === 0 ? current : { ...current, x: current.x + dx, y: current.y + dy };
      });
    },
    [size]
  );

  return {
    view,
    size,
    setView,
    zoomIn: () => zoomTo(Math.round((view.z + 0.1) * 100) / 100),
    zoomOut: () => zoomTo(Math.round((view.z - 0.1) * 100) / 100),
    fit: () => setView(fitTo(content, size, MIN_ZOOM)),
    ensureVisible,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
