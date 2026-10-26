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
/** Zoom steps of the - and + buttons (each press is a visible step, not a sliver). */
const ZOOM_STEPS = [0.25, 0.35, 0.5, 0.6, 0.7, 0.85, 1, 1.25, 1.5];
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** The rectangle of the host (in host coordinates) that is visible in the stage. */
export const visibleRect = (view: View, size: Size) => ({
  x: -view.x / view.z,
  y: -view.y / view.z,
  width: size.width / view.z,
  height: size.height / view.z,
});

/** The view that shows `box` (flow coordinates) centred, as large as is readable (never below 50%, never past 100%). */
export const boxView = (box: { x: number; y: number; width: number; height: number }, size: Size): View => {
  const topReserve = 64; // the top bar
  const fits = Math.min((size.width - 96) / box.width, (size.height - topReserve - 32) / box.height, 1);
  const z = clamp(Math.max(fits, 0.5), MIN_ZOOM, 1);
  return { z, x: size.width / 2 - (box.x + box.width / 2) * z, y: topReserve - box.y * z };
};

const nextStep = (z: number, direction: 1 | -1) => {
  const rounded = Math.round(z * 100) / 100;
  if (direction === 1) return ZOOM_STEPS.find((step) => step > rounded + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_STEPS].reverse().find((step) => step < rounded - 0.001) ?? MIN_ZOOM;
};

/**
 * Zoom and pan of the canvas. The view only changes when the user asks (buttons, wheel,
 * drag, pinch, minimap) or the selected step would be hidden by the inspector: then it
 * moves by the least that shows the step (spec 10), never re-centring.
 *
 * Moves the user makes with a button, Fit, the minimap or a selection are animated
 * (`smooth`); dragging, the wheel and a pinch follow the hand with no delay.
 */
export function useViewport(stageRef: RefObject<HTMLDivElement>, content: Size) {
  const [view, setViewState] = useState<View>({ x: 40, y: 56, z: 0.82 });
  const [smooth, setSmooth] = useState(false);
  const [size, setSize] = useState<Size>({ width: 800, height: 600 });
  const dragging = useRef<{ x: number; y: number; view: View } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; view: View } | null>(null);
  const fitted = useRef(false);
  const { width: contentWidth, height: contentHeight } = content;

  // The stage element can be replaced (full screen renders the canvas somewhere else): follow it, so
  // the measuring and the wheel always belong to the element on screen.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (stageRef.current !== element) setElement(stageRef.current);
  });

  /** Move with the hand: no animation. */
  const setView = useCallback((next: View | ((current: View) => View)) => {
    setSmooth(false);
    setViewState(next);
  }, []);
  /** Move for the user: animated. */
  const glideTo = useCallback((next: View | ((current: View) => View)) => {
    setSmooth(true);
    setViewState(next);
  }, []);

  /** Fit the whole flow, but never smaller than a readable size: a tall flow is panned, not shrunk to dots. */
  const fitTo = useCallback((box: Size, within: Size, floor = READABLE_ZOOM): View => {
    const topReserve = 64; // the top bar
    const fits = Math.min((within.width - 96) / box.width, (within.height - topReserve - 32) / box.height, 1);
    const z = clamp(Math.max(fits, floor), MIN_ZOOM, MAX_ZOOM);
    return { z, x: Math.max((within.width - box.width * z) / 2, 56), y: topReserve };
  }, []);

  useEffect(() => {
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
  }, [element, contentWidth, contentHeight, fitTo, setView]);

  /** Zoom to `nextZoom` keeping the point under `around` (stage coordinates) where it is. */
  const zoomView = useCallback(
    (current: View, nextZoom: number, around?: { x: number; y: number }): View => {
      const z = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      const anchor = around || { x: size.width / 2, y: size.height / 2 };
      const hostX = (anchor.x - current.x) / current.z;
      const hostY = (anchor.y - current.y) / current.z;
      return { z, x: anchor.x - hostX * z, y: anchor.y - hostY * z };
    },
    [size]
  );

  // Wheel: pan; with ctrl/cmd (or a trackpad pinch) zoom around the pointer.
  useEffect(() => {
    if (!element) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const bounds = element.getBoundingClientRect();
        const around = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        setView((current) => zoomView(current, current.z * Math.exp(-event.deltaY * 0.01), around));
      } else {
        setView((current) => ({ ...current, x: current.x - event.deltaX, y: current.y - event.deltaY }));
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [element, setView, zoomView]);

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    // React bubbles events out of portals (the add-a-step menu): only a press on the canvas itself drags it.
    if (!event.currentTarget.contains(event.target as Node)) return;
    if ((event.target as HTMLElement).closest('button, input, a, [data-no-pan]')) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, view };
      dragging.current = null;
    } else {
      dragging.current = { x: event.clientX, y: event.clientY, view };
    }
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const bounds = event.currentTarget.getBoundingClientRect();
      const around = { x: (a.x + b.x) / 2 - bounds.left, y: (a.y + b.y) / 2 - bounds.top };
      const start = pinch.current;
      setView(zoomView(start.view, start.view.z * (Math.hypot(a.x - b.x, a.y - b.y) / start.distance), around));
      return;
    }
    const start = dragging.current;
    if (!start) return;
    setView({ ...start.view, x: start.view.x + event.clientX - start.x, y: start.view.y + event.clientY - start.y });
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    dragging.current = null;
    // One finger stays down after a pinch: carry on dragging from where it is.
    const [rest] = [...pointers.current.values()];
    if (rest) dragging.current = { x: rest.x, y: rest.y, view };
  };

  /** Pan by the least needed so the host rectangle (padded) is inside the stage. */
  const ensureVisible = useCallback(
    (rect: { x: number; y: number; width: number; height: number }, availableWidth: number = size.width, availableHeight: number = size.height) => {
      glideTo((current) => {
        const pad = 24;
        const left = rect.x * current.z + current.x;
        const right = (rect.x + rect.width) * current.z + current.x;
        const top = rect.y * current.z + current.y;
        const bottom = (rect.y + rect.height) * current.z + current.y;
        const dx = left < pad ? pad - left : right > availableWidth - pad ? availableWidth - pad - right : 0;
        const dy = top < 64 ? 64 - top : bottom > availableHeight - pad ? availableHeight - pad - bottom : 0;
        return dx === 0 && dy === 0 ? current : { ...current, x: current.x + dx, y: current.y + dy };
      });
    },
    [size, glideTo]
  );

  return {
    view,
    smooth,
    size,
    /** Move with the hand (dragging the minimap): no animation. */
    setView,
    /** Move to a view the user chose (the minimap): animated. */
    jumpTo: glideTo,
    zoomIn: () => glideTo((current) => zoomView(current, nextStep(current.z, 1))),
    zoomOut: () => glideTo((current) => zoomView(current, nextStep(current.z, -1))),
    fit: () => glideTo(fitTo(content, size, MIN_ZOOM)),
    /** Bring a part of the flow into view (the path a delivery took). */
    showBox: (box: { x: number; y: number; width: number; height: number }) => glideTo(boxView(box, size)),
    ensureVisible,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
