import { describe, expect, it } from 'vitest';
import { boxView } from '../features/stages/canvas/useViewport';

const size = { width: 800, height: 600 };
const centreOf = (view: { x: number; y: number; z: number }, box: { x: number; y: number; width: number; height: number }) => ({
  x: view.x + (box.x + box.width / 2) * view.z,
  y: view.y + box.y * view.z,
});

describe('bringing part of the flow into view', () => {
  it('centres the box sideways and puts its top below the top bar', () => {
    const box = { x: 1000, y: 200, width: 400, height: 300 };
    const view = boxView(box, size);
    expect(centreOf(view, box).x).toBeCloseTo(400);
    expect(centreOf(view, box).y).toBeCloseTo(64);
  });

  it('shows a small box at a comfortable size, never larger than life', () => {
    expect(boxView({ x: 0, y: 0, width: 100, height: 100 }, size).z).toBe(1);
  });

  it('shrinks to fit a box that is too big, but never below a readable size', () => {
    const big = boxView({ x: 0, y: 0, width: 1200, height: 900 }, size).z;
    expect(big).toBeLessThan(0.7);
    expect(boxView({ x: 0, y: 0, width: 4000, height: 3000 }, size).z).toBe(0.5);
  });
});
