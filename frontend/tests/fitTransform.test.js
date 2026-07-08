import { describe, it, expect } from 'vitest';
import { computeFitTransform } from '../src/renderer/shared/fitTransform.js';

describe('computeFitTransform', () => {
  it('fits a landscape image wider than the canvas to width and centers vertically', () => {
    // 2000x1000 image (ratio 2) into 800x800 canvas (ratio 1) -> fit to width.
    const { scale, x, y } = computeFitTransform(2000, 1000, 800, 800);
    expect(scale).toBe(0.4); // 800 / 2000
    expect(x).toBe(0);
    // displayed height = 1000 * 0.4 = 400, centered in 800 -> (800-400)/2 = 200
    expect(y).toBe(200);
  });

  it('fits a portrait image taller than the canvas to height and centers horizontally', () => {
    // 1000x2000 image (ratio 0.5) into 800x800 canvas -> fit to height.
    const { scale, x, y } = computeFitTransform(1000, 2000, 800, 800);
    expect(scale).toBe(0.4); // 800 / 2000
    // displayed width = 1000 * 0.4 = 400, centered -> (800-400)/2 = 200
    expect(x).toBe(200);
    expect(y).toBe(0);
  });

  it('upscales an image smaller than the canvas to fill one axis', () => {
    // 400x200 image (ratio 2) into 800x800 canvas -> fit to width, upscaled.
    const { scale, x, y } = computeFitTransform(400, 200, 800, 800);
    expect(scale).toBe(2); // 800 / 400
    expect(x).toBe(0);
    // displayed height = 200 * 2 = 400, centered -> 200
    expect(y).toBe(200);
  });

  it('takes the height branch when image and canvas ratios are equal', () => {
    // Equal ratios (both 2) -> imgRatio is not > canvasRatio, so height branch.
    const { scale, x, y } = computeFitTransform(1600, 800, 800, 400);
    expect(scale).toBe(0.5); // 400 / 800
    expect(x).toBe(0); // (800 - 1600*0.5)/2 = 0
    expect(y).toBe(0);
  });

  it('is independent of devicePixelRatio (works in CSS-pixel space)', () => {
    // The fit transform only depends on CSS dimensions; DPR mapping is applied
    // separately by the caller. Same CSS canvas size => same transform,
    // regardless of the physical pixel density of the display.
    const dpr1 = computeFitTransform(3000, 2000, 1200, 900);
    const dpr2 = computeFitTransform(3000, 2000, 1200, 900);
    expect(dpr1).toEqual(dpr2);
    // Sanity: 3000x2000 (ratio 1.5) into 1200x900 (ratio 1.333) -> fit to width.
    expect(dpr1.scale).toBe(0.4); // 1200 / 3000
    expect(dpr1.x).toBe(0);
    expect(dpr1.y).toBe(50); // (900 - 2000*0.4)/2 = 50
  });
});
