import { describe, it, expect } from 'vitest';
import {
  MIN_ZOOM,
  MAX_ZOOM,
  clampZoom,
  computeZoom,
  centerPan
} from '../src/renderer/shared/canvasViewport.js';

describe('clampZoom', () => {
  it('leaves an in-range value unchanged', () => {
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('clamps below the minimum and above the maximum', () => {
    expect(clampZoom(MIN_ZOOM / 2)).toBe(MIN_ZOOM);
    expect(clampZoom(MAX_ZOOM * 10)).toBe(MAX_ZOOM);
  });

  it('honors explicit bounds', () => {
    expect(clampZoom(5, 0.5, 3)).toBe(3);
    expect(clampZoom(0.1, 0.5, 3)).toBe(0.5);
    expect(clampZoom(1, 0.5, 3)).toBe(1);
  });
});

describe('computeZoom', () => {
  it('scales without touching pan when no focal point is given', () => {
    const state = { zoomFactor: 2, pan: { x: 10, y: 20 } };
    const next = computeZoom(state, 1.5);
    expect(next.zoomFactor).toBe(3);
    expect(next.pan).toEqual({ x: 10, y: 20 });
    // Input is not mutated.
    expect(state.pan).toEqual({ x: 10, y: 20 });
  });

  it('keeps the focal point fixed on screen when zooming', () => {
    // At zoom 1, pan {0,0}: image point at screen (100,100) is image (100,100).
    // Zooming 2x around screen (100,100) must keep that screen point fixed.
    const state = { zoomFactor: 1, pan: { x: 0, y: 0 } };
    const next = computeZoom(state, 2, 100, 100);
    expect(next.zoomFactor).toBe(2);
    // pan = center - (center - pan) * ratio = 100 - (100 - 0) * 2 = -100
    expect(next.pan).toEqual({ x: -100, y: -100 });
    // The image point that was under the cursor stays under the cursor:
    // screenX = pan.x + imageX * zoom; imageX = (100 - 0)/1 = 100 originally,
    // new screenX = -100 + 100 * 2 = 100. Fixed. ✓
  });

  it('clamps the zoom factor to the allowed range', () => {
    const state = { zoomFactor: MAX_ZOOM, pan: { x: 0, y: 0 } };
    const next = computeZoom(state, 5, 0, 0);
    expect(next.zoomFactor).toBe(MAX_ZOOM);
  });

  it('does not recenter when only one coordinate is provided', () => {
    const state = { zoomFactor: 1, pan: { x: 5, y: 5 } };
    const next = computeZoom(state, 2, 100, null);
    expect(next.pan).toEqual({ x: 5, y: 5 });
  });
});

describe('centerPan', () => {
  it('centers a rectangle at the viewport center at 1:1 zoom', () => {
    // rect centered at image (100, 50); viewport 800x600 => center (400,300).
    const pan = centerPan({ x: 50, y: 25, width: 100, height: 50 }, 1, 800, 600);
    // rect center = (100, 50); pan = 400 - 100*1 = 300, 300 - 50*1 = 250
    expect(pan).toEqual({ x: 300, y: 250 });
  });

  it('accounts for the zoom factor', () => {
    const pan = centerPan({ x: 0, y: 0, width: 200, height: 200 }, 2, 800, 600);
    // rect center = (100, 100); pan = 400 - 100*2 = 200, 300 - 100*2 = 100
    expect(pan).toEqual({ x: 200, y: 100 });
  });
});
