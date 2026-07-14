// canvasViewport.js
// Pure viewport math for the canvas image viewer: zoom clamping, zoom-around-a
// point, and centering a rectangle in the viewport. All functions are in
// CSS-pixel space (DPR mapping is applied separately by the canvas transform)
// and free of React/DOM so they can be unit-tested directly.

// Zoom bounds and the discrete zoom step shared by wheel and keyboard zooming.
export const MIN_ZOOM = 0.01;
export const MAX_ZOOM = 10;
export const ZOOM_STEP = 1.15;

/**
 * Clamp a zoom factor to the allowed range.
 * @param {number} value
 * @param {number} [min=MIN_ZOOM]
 * @param {number} [max=MAX_ZOOM]
 * @returns {number}
 */
export function clampZoom(value, min = MIN_ZOOM, max = MAX_ZOOM) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Apply a multiplicative zoom around an optional focal point, keeping that
 * point fixed on screen. Returns the next zoom factor and pan offset; the
 * inputs are not mutated.
 *
 * @param {{ zoomFactor: number, pan: {x: number, y: number} }} state
 * @param {number} factor - Multiplier applied to the current zoom factor.
 * @param {number|null} [centerX] - Focal point x (canvas CSS px). When null or
 *   undefined the pan is left unchanged (pure scale).
 * @param {number|null} [centerY] - Focal point y (canvas CSS px).
 * @param {{ min?: number, max?: number }} [bounds]
 * @returns {{ zoomFactor: number, pan: {x: number, y: number} }}
 */
export function computeZoom(state, factor, centerX = null, centerY = null, bounds = {}) {
  const { min = MIN_ZOOM, max = MAX_ZOOM } = bounds;
  const oldZoom = state.zoomFactor;
  const newZoom = clampZoom(oldZoom * factor, min, max);

  let pan = { ...state.pan };
  if (centerX !== null && centerY !== null) {
    const ratio = newZoom / oldZoom;
    pan = {
      x: centerX - (centerX - state.pan.x) * ratio,
      y: centerY - (centerY - state.pan.y) * ratio
    };
  }

  return { zoomFactor: newZoom, pan };
}

/**
 * Compute the pan offset that centers a rectangle (in image coordinates) at the
 * viewport center for a given zoom factor.
 *
 * @param {{ x: number, y: number, width: number, height: number }} rect
 * @param {number} zoomFactor
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {{ x: number, y: number }}
 */
export function centerPan(rect, zoomFactor, viewportWidth, viewportHeight) {
  const centerX = rect.x + rect.width / 2;
  const centerY = rect.y + rect.height / 2;
  return {
    x: viewportWidth / 2 - centerX * zoomFactor,
    y: viewportHeight / 2 - centerY * zoomFactor
  };
}
