/**
 * useCanvas - Canvas setup, resize handling, and animation loop
 *
 * Provides:
 * - Automatic canvas sizing to fit container
 * - ResizeObserver for responsive updates
 * - Animation frame management
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for canvas dimension management
 * @param {React.RefObject} containerRef - Reference to the container element
 * @returns {object} { width, height } - Current canvas dimensions
 */
export function useCanvasDimensions(containerRef) {
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!containerRef.current) return;

    const updateDimensions = () => {
      if (containerRef.current) {
        const { clientWidth, clientHeight } = containerRef.current;
        setDimensions({ width: clientWidth, height: clientHeight });
      }
    };

    // Initial size
    updateDimensions();

    // Observe resize
    const observer = new ResizeObserver(updateDimensions);
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, [containerRef]);

  return dimensions;
}

/**
 * Hook for animation loop management
 * @param {function} renderFn - Function to call each frame
 * @param {Array} deps - Dependencies that trigger re-creation of the loop
 * @returns {object} { start, stop, isRunning }
 */
export function useAnimationFrame(renderFn, deps = []) {
  const frameIdRef = useRef(null);
  const isRunningRef = useRef(false);

  const stop = useCallback(() => {
    if (frameIdRef.current) {
      cancelAnimationFrame(frameIdRef.current);
      frameIdRef.current = null;
    }
    isRunningRef.current = false;
  }, []);

  const start = useCallback(() => {
    if (isRunningRef.current) return;
    isRunningRef.current = true;

    const loop = () => {
      if (!isRunningRef.current) return;
      renderFn();
      frameIdRef.current = requestAnimationFrame(loop);
    };

    loop();
  }, [renderFn]);

  // Cleanup on unmount
  useEffect(() => {
    return () => stop();
  }, [stop]);

  // Restart when deps change
  useEffect(() => {
    if (isRunningRef.current) {
      stop();
      start();
    }
  }, deps);

  return {
    start,
    stop,
    isRunning: isRunningRef.current
  };
}

/**
 * Combined hook for canvas setup with dimensions and animation
 * @param {React.RefObject} canvasRef - Reference to the canvas element
 * @param {React.RefObject} containerRef - Reference to the container element
 * @returns {object} { dimensions, requestRender }
 */
export function useCanvas(canvasRef, containerRef) {
  const dimensions = useCanvasDimensions(containerRef);
  const needsRenderRef = useRef(false);

  // Update canvas size when dimensions change
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const dpr = window.devicePixelRatio || 1;

    // Set actual size in memory (scaled for retina)
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;

    // Set display size (css)
    canvas.style.width = `${dimensions.width}px`;
    canvas.style.height = `${dimensions.height}px`;

    // Scale context for retina
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Mark that we need a render
    needsRenderRef.current = true;
  }, [dimensions, canvasRef]);

  // Request a render (for manual render triggering)
  const requestRender = useCallback(() => {
    needsRenderRef.current = true;
  }, []);

  return {
    dimensions,
    requestRender,
    needsRender: needsRenderRef
  };
}

export default useCanvas;
