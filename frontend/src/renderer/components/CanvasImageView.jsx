/**
 * CanvasImageView - Prop-driven, presentational canvas image viewer.
 *
 * Owns the canvas element and all viewport concerns (zoom mode, zoom factor,
 * pan, device-pixel-ratio handling, wheel/drag panning) for a single decoded
 * image. It is deliberately free of application concerns: no module events, no
 * global keyboard shortcuts, no i18n/toast, no face/overlay knowledge. Callers
 * drive it through props and an imperative ref handle.
 *
 * Props:
 * - image: decoded drawable (ImageBitmap or HTMLImageElement) or null.
 * - drawOverlay(ctx, { scale, x, y, canvasWidth, canvasHeight }): optional,
 *   invoked after the image is drawn each frame (canvas is DPR-mapped: draw in
 *   CSS-pixel space). Its identity should change whenever the overlay's visual
 *   output changes so the view repaints (e.g. include your overlay state in the
 *   useCallback deps).
 * - className: optional extra class on the container.
 * - ariaLabel: optional accessible name for the displayed photo. When provided
 *   the canvas gets role="img" + aria-label (e.g. the file's basename) so
 *   screen readers announce what is shown — the equivalent of an <img alt>.
 *   When omitted the canvas stays unnamed (hosts like ImageViewer never named
 *   their canvas; don't invent a label for them).
 *
 * Imperative handle (via ref):
 * - zoom(factor, centerX?, centerY?): multiplicative zoom; center defaults to
 *   the last known mouse position over the canvas.
 * - resetZoom(centerRect?): 1:1 zoom, centered on centerRect (image coords) or
 *   the image center when omitted.
 * - autoFit(): return to contain-fit ("auto") mode.
 * - setPan(pan): set the pan offset directly.
 * - getTransform(): current { zoomMode, zoomFactor, pan, scale, x, y }.
 * - centerOnRect(rect): pan so rect (image coords) is centered (no-op in auto
 *   mode or without an image).
 * - applyTransform({ zoomFactor?, pan? }): switch to manual mode and apply an
 *   externally-provided transform (used for zoom syncing between views).
 */

import React, {
  forwardRef,
  useRef,
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
} from 'react';
import { useCanvasDimensions } from '../hooks/useCanvas.js';
import { computeFitTransform } from '../shared/fitTransform.js';
import { ZOOM_STEP, computeZoom, centerPan } from '../shared/canvasViewport.js';
import './CanvasImageView.css';

export const CanvasImageView = forwardRef(function CanvasImageView(
  { image, drawOverlay, className, ariaLabel },
  ref,
) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Zoom/pan state
  const [zoomMode, setZoomMode] = useState('auto');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Panning state (refs for performance - avoid re-renders during pan)
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Canvas dimensions (CSS pixels)
  const dimensions = useCanvasDimensions(containerRef);

  // Device pixel ratio — tracked in state so a monitor move (DPR change) both
  // resizes the backing store and repaints.
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);

  // ============================================
  // Zoom / pan operations
  // ============================================

  const zoom = useCallback(
    (factor, centerX, centerY) => {
      if (!image) return;

      // Default the focal point to the last known mouse position over the canvas,
      // matching wheel/keyboard zoom behavior.
      const cx = centerX === undefined ? mousePosRef.current.x : centerX;
      const cy = centerY === undefined ? mousePosRef.current.y : centerY;

      // Establish the current effective transform. In auto-fit mode the effective
      // scale/offset come from the contain-fit; switching to manual pins them so
      // the zoom is continuous.
      let baseZoom = zoomFactor;
      let basePan = pan;
      if (zoomMode === 'auto') {
        const fit = computeFitTransform(
          image.width,
          image.height,
          dimensions.width,
          dimensions.height,
        );
        baseZoom = fit.scale;
        basePan = { x: fit.x, y: fit.y };
      }

      const next = computeZoom(
        { zoomFactor: baseZoom, pan: basePan },
        factor,
        cx,
        cy,
      );
      setZoomMode('manual');
      setZoomFactor(next.zoomFactor);
      setPan(next.pan);
    },
    [image, zoomMode, zoomFactor, pan, dimensions],
  );

  const resetZoom = useCallback(
    (centerRect = null) => {
      if (!image) return;

      setZoomMode('manual');
      setZoomFactor(1);

      if (centerRect) {
        setPan(centerPan(centerRect, 1, dimensions.width, dimensions.height));
      } else {
        setPan({
          x: (dimensions.width - image.width) / 2,
          y: (dimensions.height - image.height) / 2,
        });
      }
    },
    [image, dimensions],
  );

  const autoFit = useCallback(() => {
    // Also reset the manual zoom factor: it is never read while in auto mode,
    // but leaving a stale value behind would make the state (and any future
    // reader) lie about the viewer's baseline.
    setZoomMode('auto');
    setZoomFactor(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const centerOnRect = useCallback(
    (rect) => {
      // Centering only applies in manual mode (auto-fit always centers the image).
      if (!image || zoomMode === 'auto' || !rect) return;
      setPan(centerPan(rect, zoomFactor, dimensions.width, dimensions.height));
    },
    [image, zoomMode, zoomFactor, dimensions],
  );

  const applyTransform = useCallback(
    ({ zoomFactor: nextZoom, pan: nextPan } = {}) => {
      setZoomMode('manual');
      if (nextZoom !== undefined && nextZoom !== null) setZoomFactor(nextZoom);
      if (nextPan) setPan(nextPan);
    },
    [],
  );

  const setPanExternal = useCallback((nextPan) => {
    setPan(nextPan);
  }, []);

  const getTransform = useCallback(() => {
    if (zoomMode === 'auto' && image) {
      const fit = computeFitTransform(
        image.width,
        image.height,
        dimensions.width,
        dimensions.height,
      );
      return {
        zoomMode,
        zoomFactor: fit.scale,
        pan: { x: fit.x, y: fit.y },
        scale: fit.scale,
        x: fit.x,
        y: fit.y,
      };
    }
    return {
      zoomMode,
      zoomFactor,
      pan: { ...pan },
      scale: zoomFactor,
      x: pan.x,
      y: pan.y,
    };
  }, [zoomMode, zoomFactor, pan, image, dimensions]);

  useImperativeHandle(
    ref,
    () => ({
      zoom,
      resetZoom,
      autoFit,
      setPan: setPanExternal,
      getTransform,
      centerOnRect,
      applyTransform,
    }),
    [
      zoom,
      resetZoom,
      autoFit,
      setPanExternal,
      getTransform,
      centerOnRect,
      applyTransform,
    ],
  );

  // ============================================
  // Rendering
  // ============================================

  const render = useCallback(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d'); // Allow transparency for themed background

    const canvasWidth = dimensions.width;
    const canvasHeight = dimensions.height;

    // Map CSS pixels to device pixels. setTransform replaces the whole matrix,
    // so this both applies the DPR scale and resets any prior transform without
    // reallocating the backing store (the resize effect owns canvas.width/height).
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    // Clear-then-bail: when the image goes away (decode error, source cleared)
    // the canvas must go transparent instead of retaining the last-painted
    // frame — the absolutely-positioned canvas paints above the host's static
    // loading/error/empty overlays, so a stale frame would hide them and keep
    // showing the previous photo.
    if (!image) return;

    let scale, x, y;
    if (zoomMode === 'auto') {
      const fit = computeFitTransform(
        image.width,
        image.height,
        canvasWidth,
        canvasHeight,
      );
      scale = fit.scale;
      x = fit.x;
      y = fit.y;
    } else {
      scale = zoomFactor;
      x = pan.x;
      y = pan.y;
    }

    ctx.drawImage(image, x, y, image.width * scale, image.height * scale);

    if (drawOverlay) {
      drawOverlay(ctx, { scale, x, y, canvasWidth, canvasHeight });
    }
  }, [image, dimensions, dpr, zoomMode, zoomFactor, pan, drawOverlay]);

  // ============================================
  // Canvas resize (backing store) — split from the draw path
  // ============================================

  // Own the canvas backing store. Reassigning canvas.width/height reallocates
  // and clears it, so this must run ONLY when the size actually changes
  // (dimensions or DPR) — never on pan/zoom. It must also run BEFORE the draw
  // effect below (effects run in declaration order): on a resize/DPR change the
  // reallocation clears the canvas, and the draw effect then repaints it — the
  // reverse order would paint first and end up with a blank canvas.
  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    canvas.width = dimensions.width * dpr;
    canvas.height = dimensions.height * dpr;
  }, [dimensions, dpr]);

  // Draw whenever the render closure changes (image/transform/dimensions/overlay).
  // Repaints after a resize too, since `render` also depends on [dimensions, dpr].
  useEffect(() => {
    render();
  }, [render]);

  // ============================================
  // Pointer events (pan + wheel zoom)
  // ============================================

  useEffect(() => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;

    const handleMouseDown = (e) => {
      if (e.button === 0 && zoomMode === 'manual') {
        isPanningRef.current = true;
        lastPanPointRef.current = { x: e.clientX, y: e.clientY };
        canvas.style.cursor = 'grabbing';
      }
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      mousePosRef.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      };

      if (isPanningRef.current && lastPanPointRef.current) {
        const dx = e.clientX - lastPanPointRef.current.x;
        const dy = e.clientY - lastPanPointRef.current.y;

        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        lastPanPointRef.current = { x: e.clientX, y: e.clientY };
      }
    };

    const handleMouseUp = () => {
      isPanningRef.current = false;
      lastPanPointRef.current = null;
      canvas.style.cursor = zoomMode === 'manual' ? 'grab' : 'default';
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      zoom(delta, mousePosRef.current.x, mousePosRef.current.y);
    };

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
    };
  }, [zoomMode, zoom]);

  // ============================================
  // DPR tracking
  // ============================================

  // Track DPR changes (e.g. dragging the window between monitors of different
  // pixel density). matchMedia fires once per change, so re-arm on each event.
  useEffect(() => {
    let mql;
    const listener = () => {
      const next = window.devicePixelRatio || 1;
      setDpr(next);
      arm(); // re-arm against the new DPR
    };
    const arm = () => {
      if (mql) mql.removeEventListener('change', listener);
      mql = window.matchMedia(
        `(resolution: ${window.devicePixelRatio || 1}dppx)`,
      );
      mql.addEventListener('change', listener);
    };
    arm();
    return () => {
      if (mql) mql.removeEventListener('change', listener);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={
        className ? `canvas-image-view ${className}` : 'canvas-image-view'
      }
    >
      <canvas
        ref={canvasRef}
        role={ariaLabel ? 'img' : undefined}
        aria-label={ariaLabel || undefined}
        style={{ cursor: zoomMode === 'manual' ? 'grab' : 'default' }}
      />
    </div>
  );
});

export default CanvasImageView;
