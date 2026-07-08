// fitTransform.js
// Pure geometry for fitting an image inside a canvas ("contain" fit).

/**
 * Compute the scale and top-left offset needed to draw an image fully
 * contained and centered within a canvas.
 *
 * The result is expressed in CSS-pixel space: the caller is responsible for
 * mapping CSS pixels to device pixels (e.g. via ctx.setTransform(dpr, ...)),
 * so this transform is independent of devicePixelRatio.
 *
 * @param {number} imageWidth - Intrinsic image width (px)
 * @param {number} imageHeight - Intrinsic image height (px)
 * @param {number} canvasWidth - Canvas width in CSS pixels
 * @param {number} canvasHeight - Canvas height in CSS pixels
 * @returns {{ scale: number, x: number, y: number }} Fit transform. `scale`
 *   multiplies image dimensions; `x`/`y` are the top-left draw offset.
 */
export function computeFitTransform(imageWidth, imageHeight, canvasWidth, canvasHeight) {
  const imgRatio = imageWidth / imageHeight;
  const canvasRatio = canvasWidth / canvasHeight;

  let scale, x, y;

  if (imgRatio > canvasRatio) {
    // Image is relatively wider than the canvas: fit to width, center vertically.
    scale = canvasWidth / imageWidth;
    x = 0;
    y = (canvasHeight - imageHeight * scale) / 2;
  } else {
    // Image is relatively taller (or equal ratio): fit to height, center horizontally.
    scale = canvasHeight / imageHeight;
    x = (canvasWidth - imageWidth * scale) / 2;
    y = 0;
  }

  return { scale, x, y };
}

export default computeFitTransform;
