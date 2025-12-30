/**
 * ImageViewer - React component for canvas-based image viewing
 *
 * Features:
 * - Canvas-based rendering with zoom/pan support
 * - Face bounding box overlay
 * - NEF file support (via IPC conversion)
 * - Keyboard shortcuts for zoom and navigation
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useModuleAPI, useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useKeyboardShortcuts, useKeyHold } from '../hooks/useKeyboardShortcuts.js';
import { useCanvasDimensions } from '../hooks/useCanvas.js';
import './ImageViewer.css';

// Constants (will be user-configurable in Phase 4)
const ZOOM_STEP = 1.15;
const ZOOM_HOLD_DELAY = 200;
const CONTINUOUS_ZOOM_FACTOR = 1.012;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;
const LABEL_BUFFER_RATIO = 0.005;
const LABEL_MIN_BUFFER = 10;

/**
 * ImageViewer Component
 */
export function ImageViewer() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Image state
  const [image, setImage] = useState(null);
  const [imagePath, setImagePath] = useState(null);
  const [originalImagePath, setOriginalImagePath] = useState(null);

  // Zoom/pan state
  const [zoomMode, setZoomMode] = useState('auto');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Panning state (refs for performance - avoid re-renders during pan)
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Face detection state
  const [faces, setFaces] = useState([]);
  const [faceBoxMode, setFaceBoxMode] = useState('all');
  const [activeFaceIndex, setActiveFaceIndex] = useState(0);
  const previousFaceBoxModeRef = useRef('all');

  // Auto-center state (enabled by default for review workflow)
  const [autoCenterOnFace, setAutoCenterOnFace] = useState(true);

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // Canvas dimensions
  const dimensions = useCanvasDimensions(containerRef);

  // Get module API
  const emit = useEmitEvent();

  // ============================================
  // Image Loading
  // ============================================

  const loadImage = useCallback(async (filepath) => {
    let loadPath = filepath;
    const originalPath = filepath;

    // Check if NEF file - convert to JPG first
    if (filepath.toLowerCase().endsWith('.nef')) {
      try {
        console.log('[ImageViewer] NEF file detected, converting...');
        setIsLoading(true);
        setLoadingMessage('Converting NEF file...');

        loadPath = await window.bildvisareAPI.invoke('convert-nef', filepath);
        console.log('[ImageViewer] NEF converted to:', loadPath);
      } catch (err) {
        setIsLoading(false);
        console.error('[ImageViewer] NEF conversion failed:', err);
        throw new Error(`Failed to convert NEF file: ${err.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        setImage(img);
        setImagePath(loadPath);
        setOriginalImagePath(originalPath);
        setZoomMode('auto');
        setZoomFactor(1);
        setPan({ x: 0, y: 0 });
        setIsLoading(false);
        resolve();
      };

      img.onerror = (err) => {
        setIsLoading(false);
        console.error('[ImageViewer] Failed to load image:', loadPath, err);
        reject(new Error(`Failed to load image: ${loadPath}`));
      };

      const imageSrc = loadPath.startsWith('file://') ? loadPath : 'file://' + loadPath;
      img.src = imageSrc;
    });
  }, []);

  // ============================================
  // Canvas Rendering
  // ============================================

  const render = useCallback(() => {
    if (!canvasRef.current || !image) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d', { alpha: false });
    const dpr = window.devicePixelRatio || 1;

    const canvasWidth = dimensions.width;
    const canvasHeight = dimensions.height;

    // Update canvas size
    canvas.width = canvasWidth * dpr;
    canvas.height = canvasHeight * dpr;
    ctx.scale(dpr, dpr);

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    let imageScale, imageX, imageY;

    if (zoomMode === 'auto') {
      // Auto-fit mode
      const imgRatio = image.width / image.height;
      const canvasRatio = canvasWidth / canvasHeight;

      if (imgRatio > canvasRatio) {
        imageScale = canvasWidth / image.width;
        imageX = 0;
        imageY = (canvasHeight - image.height * imageScale) / 2;
      } else {
        imageScale = canvasHeight / image.height;
        imageX = (canvasWidth - image.width * imageScale) / 2;
        imageY = 0;
      }

      ctx.drawImage(image, imageX, imageY, image.width * imageScale, image.height * imageScale);
    } else {
      // Manual zoom mode
      imageScale = zoomFactor;
      imageX = pan.x;
      imageY = pan.y;

      ctx.drawImage(image, imageX, imageY, image.width * imageScale, image.height * imageScale);
    }

    // Draw face bounding boxes
    drawFaceBoxes(ctx, canvasWidth, canvasHeight, imageScale, imageX, imageY);
  }, [image, dimensions, zoomMode, zoomFactor, pan, faces, faceBoxMode, activeFaceIndex]);

  // ============================================
  // Face Box Rendering
  // ============================================

  const drawFaceBoxes = useCallback((ctx, canvasWidth, canvasHeight, imageScale, imageX, imageY) => {
    if (faceBoxMode === 'none' || !faces || faces.length === 0 || !image) return;

    // Determine which faces to draw
    let facesToDraw = faces;
    if (faceBoxMode === 'single') {
      facesToDraw = faces[activeFaceIndex] ? [faces[activeFaceIndex]] : [];
    }

    // Font for labels
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.lineWidth = 3;

    // Calculate placements with collision avoidance
    const placedBoxes = [];
    const placements = [];

    facesToDraw.forEach(face => {
      const bbox = face.bounding_box;

      // Transform to canvas space
      const faceBox = {
        x: imageX + bbox.x * imageScale,
        y: imageY + bbox.y * imageScale,
        width: bbox.width * imageScale,
        height: bbox.height * imageScale
      };

      placedBoxes.push(faceBox);

      let labelPos = null;
      let labelWidth = 0;
      let labelHeight = 0;

      if (face.person_name) {
        const confidence = face.confidence || 0;
        const label = `${face.person_name} (${(confidence * 100).toFixed(0)}%)`;
        const metrics = ctx.measureText(label);
        labelWidth = metrics.width + 8;
        labelHeight = 24;

        labelPos = findLabelPosition(
          faceBox, labelWidth, labelHeight, placedBoxes,
          canvasWidth, canvasHeight, image.width, image.height,
          imageX, imageY, imageScale
        );

        placedBoxes.push({
          x: labelPos.x,
          y: labelPos.y,
          width: labelWidth,
          height: labelHeight
        });
      }

      placements.push({
        face,
        faceBox,
        label: face.person_name ? `${face.person_name} (${((face.confidence || 0) * 100).toFixed(0)}%)` : null,
        labelPos,
        labelWidth,
        labelHeight
      });
    });

    // Draw everything
    placements.forEach(({ face, faceBox, label, labelPos, labelWidth, labelHeight }) => {
      const confidence = face.confidence || 0;
      let strokeColor, textBgColor;

      if (confidence > 0.9) {
        strokeColor = '#4caf50';
        textBgColor = 'rgba(76, 175, 80, 0.9)';
      } else if (confidence > 0.6) {
        strokeColor = '#ff9800';
        textBgColor = 'rgba(255, 152, 0, 0.9)';
      } else {
        strokeColor = '#f44336';
        textBgColor = 'rgba(244, 67, 54, 0.9)';
      }

      // Draw bounding box
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height);

      // Draw label
      if (label && labelPos) {
        const labelCenterX = labelPos.x + labelWidth / 2;
        const labelCenterY = labelPos.y + labelHeight / 2;
        const edgePoint = getBoxEdgeIntersection(faceBox, labelCenterX, labelCenterY);

        // Connecting line
        ctx.strokeStyle = '#ffeb3b';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(edgePoint.x, edgePoint.y);
        ctx.lineTo(labelCenterX, labelCenterY);
        ctx.stroke();

        // Label background
        ctx.fillStyle = textBgColor;
        ctx.fillRect(labelPos.x, labelPos.y, labelWidth, labelHeight);

        // Label text
        ctx.fillStyle = 'white';
        ctx.fillText(label, labelPos.x + 4, labelPos.y + 17);

        ctx.lineWidth = 3;
      }
    });
  }, [image, faces, faceBoxMode, activeFaceIndex]);

  // ============================================
  // Zoom Functions
  // ============================================

  const zoom = useCallback((factor, centerX = null, centerY = null) => {
    if (!image) return;

    let newZoomFactor = zoomFactor;
    let newPan = { ...pan };
    let newZoomMode = zoomMode;

    if (zoomMode === 'auto') {
      // Switch to manual mode
      newZoomMode = 'manual';

      const canvasWidth = dimensions.width;
      const canvasHeight = dimensions.height;
      const imgRatio = image.width / image.height;
      const canvasRatio = canvasWidth / canvasHeight;

      let currentScale, currentX, currentY;

      if (imgRatio > canvasRatio) {
        currentScale = canvasWidth / image.width;
        currentX = 0;
        currentY = (canvasHeight - image.height * currentScale) / 2;
      } else {
        currentScale = canvasHeight / image.height;
        currentX = (canvasWidth - image.width * currentScale) / 2;
        currentY = 0;
      }

      newZoomFactor = currentScale;
      newPan = { x: currentX, y: currentY };
    }

    const oldZoom = newZoomFactor;
    newZoomFactor = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZoomFactor * factor));

    if (centerX !== null && centerY !== null) {
      const zoomRatio = newZoomFactor / oldZoom;
      newPan.x = centerX - (centerX - newPan.x) * zoomRatio;
      newPan.y = centerY - (centerY - newPan.y) * zoomRatio;
    }

    setZoomMode(newZoomMode);
    setZoomFactor(newZoomFactor);
    setPan(newPan);
  }, [image, zoomMode, zoomFactor, pan, dimensions]);

  const resetZoom = useCallback(() => {
    if (!image) return;

    const canvasWidth = dimensions.width;
    const canvasHeight = dimensions.height;

    setZoomMode('manual');
    setZoomFactor(1);
    setPan({
      x: (canvasWidth - image.width) / 2,
      y: (canvasHeight - image.height) / 2
    });
  }, [image, dimensions]);

  const autoFit = useCallback(() => {
    setZoomMode('auto');
    setPan({ x: 0, y: 0 });
  }, []);

  // ============================================
  // Menu State Sync Helper
  // ============================================

  const updateMenuState = useCallback((id, checked) => {
    if (window.bildvisareAPI?.send) {
      window.bildvisareAPI.send('update-menu-state', { id, checked });
    }
  }, []);

  // ============================================
  // Face Box Toggle Functions
  // ============================================

  const setBoxMode = useCallback((mode) => {
    setFaceBoxMode(mode);
    // Sync menu states
    updateMenuState('boxes-visible', mode !== 'none');
    updateMenuState('boxes-all-faces', mode === 'all');
  }, [updateMenuState]);

  const toggleSingleAll = useCallback(() => {
    setFaceBoxMode(mode => {
      const newMode = mode === 'single' ? 'all' : (mode === 'all' ? 'single' : 'all');
      // Sync menu state
      updateMenuState('boxes-all-faces', newMode === 'all');
      return newMode;
    });
  }, [updateMenuState]);

  const toggleOnOff = useCallback(() => {
    setFaceBoxMode(mode => {
      if (mode === 'none') {
        const newMode = previousFaceBoxModeRef.current || 'all';
        // Sync menu states
        updateMenuState('boxes-visible', true);
        updateMenuState('boxes-all-faces', newMode === 'all');
        return newMode;
      } else {
        previousFaceBoxModeRef.current = mode;
        // Sync menu state
        updateMenuState('boxes-visible', false);
        return 'none';
      }
    });
  }, [updateMenuState]);

  // ============================================
  // Auto-center on face
  // ============================================

  const centerOnActiveFace = useCallback((faceIndex = null) => {
    // Debug: Log why centering might be skipped
    if (!faces || faces.length === 0) {
      console.log('[ImageViewer] centerOnActiveFace: No faces');
      return;
    }
    if (zoomMode === 'auto') {
      console.log('[ImageViewer] centerOnActiveFace: Skipped (zoom mode is auto-fit, zoom in first)');
      return;
    }
    if (!image) {
      console.log('[ImageViewer] centerOnActiveFace: No image loaded');
      return;
    }

    // Use provided index or fall back to current activeFaceIndex
    const indexToUse = faceIndex !== null ? faceIndex : activeFaceIndex;
    const face = faces[indexToUse];
    if (!face) {
      console.log('[ImageViewer] centerOnActiveFace: Face not found at index', indexToUse);
      return;
    }

    const bbox = face.bounding_box;
    const faceCenterX = bbox.x + bbox.width / 2;
    const faceCenterY = bbox.y + bbox.height / 2;

    const viewportCenterX = dimensions.width / 2;
    const viewportCenterY = dimensions.height / 2;

    const newPan = {
      x: viewportCenterX - (faceCenterX * zoomFactor),
      y: viewportCenterY - (faceCenterY * zoomFactor)
    };
    console.log(`[ImageViewer] Centering on face ${indexToUse}: pan to`, newPan);
    setPan(newPan);
  }, [faces, activeFaceIndex, zoomMode, zoomFactor, dimensions, image]);

  const toggleAutoCenterOnFace = useCallback((enable) => {
    const newValue = enable === undefined ? !autoCenterOnFace : enable;
    console.log(`[ImageViewer] Auto-center ${newValue ? 'ENABLED' : 'DISABLED'}`);
    setAutoCenterOnFace(newValue);
    // Sync menu state
    updateMenuState('auto-center', newValue);
    if (newValue) {
      centerOnActiveFace();
    }
  }, [autoCenterOnFace, centerOnActiveFace, updateMenuState]);

  // ============================================
  // Event Handlers
  // ============================================

  // Mouse events for panning
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
      mousePosRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };

      if (isPanningRef.current && lastPanPointRef.current) {
        const dx = e.clientX - lastPanPointRef.current.x;
        const dy = e.clientY - lastPanPointRef.current.y;

        setPan(p => ({ x: p.x + dx, y: p.y + dy }));
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
  // Keyboard Shortcuts
  // ============================================

  // Hold detection for continuous zoom with double-tap support
  // Single tap: zoom step, Hold: continuous zoom, Double-tap +: 100% zoom
  useKeyHold('+', {
    onStart: () => {},
    onHold: () => zoom(CONTINUOUS_ZOOM_FACTOR, mousePosRef.current.x, mousePosRef.current.y),
    onEnd: (_, wasHolding) => {
      if (!wasHolding) {
        zoom(ZOOM_STEP, mousePosRef.current.x, mousePosRef.current.y);
      }
    },
    onDoubleTap: () => resetZoom() // Double-tap + → 100% (1:1) zoom
  }, { holdDelay: ZOOM_HOLD_DELAY });

  // Single tap: zoom step, Hold: continuous zoom, Double-tap -: fit-to-window
  useKeyHold('-', {
    onStart: () => {},
    onHold: () => zoom(1 / CONTINUOUS_ZOOM_FACTOR, mousePosRef.current.x, mousePosRef.current.y),
    onEnd: (_, wasHolding) => {
      if (!wasHolding) {
        zoom(1 / ZOOM_STEP, mousePosRef.current.x, mousePosRef.current.y);
      }
    },
    onDoubleTap: () => autoFit() // Double-tap - → fit-to-window
  }, { holdDelay: ZOOM_HOLD_DELAY });

  useKeyboardShortcuts({
    '=': resetZoom,
    '0': autoFit,
    'b': toggleSingleAll,
    'B': toggleOnOff,
    'c': () => toggleAutoCenterOnFace(true),
    'C': () => toggleAutoCenterOnFace(false)
  });

  // ============================================
  // Module Events
  // ============================================

  // Listen for load-image events
  useModuleEvent('load-image', async ({ imagePath: path }) => {
    try {
      await loadImage(path);
      console.log('[ImageViewer] Loaded image:', path);
      emit('image-loaded', {
        imagePath: originalImagePath || path,
        dimensions: { width: image?.width, height: image?.height }
      });
    } catch (err) {
      console.error('[ImageViewer] Failed to load image:', err);
    }
  });

  // Listen for faces-detected events
  useModuleEvent('faces-detected', ({ faces: newFaces }) => {
    setFaces(newFaces || []);
  });

  // Listen for active-face-changed events
  useModuleEvent('active-face-changed', ({ index }) => {
    console.log(`[ImageViewer] active-face-changed: index=${index}, autoCenterOnFace=${autoCenterOnFace}`);
    setActiveFaceIndex(index);
    if (autoCenterOnFace) {
      console.log('[ImageViewer] Centering on face', index);
      centerOnActiveFace(index);
    }
  }, [autoCenterOnFace, centerOnActiveFace]);

  // Listen for sync-zoom events
  useModuleEvent('sync-zoom', ({ zoomFactor: newZoom, pan: newPan }) => {
    setZoomMode('manual');
    setZoomFactor(newZoom);
    if (newPan) {
      setPan(newPan);
    }
  });

  // Listen for request-current-image
  useModuleEvent('request-current-image', () => {
    if (imagePath) {
      emit('image-loaded', {
        imagePath: originalImagePath || imagePath,
        dimensions: { width: image?.width, height: image?.height }
      });
    }
  });

  // Menu command events
  useModuleEvent('toggle-single-all-boxes', toggleSingleAll); // Legacy support
  useModuleEvent('toggle-boxes-on-off', toggleOnOff); // Legacy support
  useModuleEvent('boxes-show', () => setBoxMode(previousFaceBoxModeRef.current || 'all'));
  useModuleEvent('boxes-hide', () => setBoxMode('none'));
  useModuleEvent('boxes-all', () => setBoxMode('all'));
  useModuleEvent('boxes-single', () => setBoxMode('single'));
  useModuleEvent('zoom-in', () => zoom(ZOOM_STEP, mousePosRef.current.x, mousePosRef.current.y));
  useModuleEvent('zoom-out', () => zoom(1 / ZOOM_STEP, mousePosRef.current.x, mousePosRef.current.y));
  useModuleEvent('reset-zoom', resetZoom);
  useModuleEvent('auto-fit', autoFit);
  useModuleEvent('auto-center-enable', () => toggleAutoCenterOnFace(true));
  useModuleEvent('auto-center-disable', () => toggleAutoCenterOnFace(false));

  // ============================================
  // Sync menu state on mount
  // ============================================

  useEffect(() => {
    // Sync initial state to menu
    updateMenuState('auto-center', autoCenterOnFace);
    updateMenuState('boxes-visible', faceBoxMode !== 'none');
    updateMenuState('boxes-all-faces', faceBoxMode === 'all');
  }, []); // Only on mount

  // ============================================
  // Render on state change
  // ============================================

  useEffect(() => {
    render();
  }, [render]);

  // ============================================
  // Render
  // ============================================

  return (
    <div ref={containerRef} className="image-viewer">
      <canvas
        ref={canvasRef}
        style={{ cursor: zoomMode === 'manual' ? 'grab' : 'default' }}
      />
      {isLoading && (
        <div className="image-viewer-loading">
          <div className="loading-spinner">⏳</div>
          <div>{loadingMessage}</div>
        </div>
      )}
      {!image && !isLoading && (
        <div className="image-viewer-placeholder">
          <div className="placeholder-icon">📷</div>
          <div>No image loaded</div>
          <div className="placeholder-hint">Open an image to get started</div>
        </div>
      )}
    </div>
  );
}

// ============================================
// Utility Functions
// ============================================

function boxesOverlap(box1, box2, buffer = 20) {
  const l1 = box1.x - buffer;
  const r1 = box1.x + box1.width + buffer;
  const t1 = box1.y - buffer;
  const b1 = box1.y + box1.height + buffer;

  const l2 = box2.x - buffer;
  const r2 = box2.x + box2.width + buffer;
  const t2 = box2.y - buffer;
  const b2 = box2.y + box2.height + buffer;

  return !(r1 <= l2 || l1 >= r2 || b1 <= t2 || t1 >= b2);
}

function getBoxEdgeIntersection(box, externalX, externalY) {
  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  const dx = externalX - centerX;
  const dy = externalY - centerY;

  if (dx === 0 && dy === 0) {
    return { x: centerX, y: centerY };
  }

  const intersections = [];

  // Top edge
  if (dy < 0) {
    const t = (box.y - centerY) / dy;
    const x = centerX + t * dx;
    if (x >= box.x && x <= box.x + box.width) {
      intersections.push({ x, y: box.y, dist: Math.abs(t) });
    }
  }

  // Bottom edge
  if (dy > 0) {
    const t = (box.y + box.height - centerY) / dy;
    const x = centerX + t * dx;
    if (x >= box.x && x <= box.x + box.width) {
      intersections.push({ x, y: box.y + box.height, dist: Math.abs(t) });
    }
  }

  // Left edge
  if (dx < 0) {
    const t = (box.x - centerX) / dx;
    const y = centerY + t * dy;
    if (y >= box.y && y <= box.y + box.height) {
      intersections.push({ x: box.x, y, dist: Math.abs(t) });
    }
  }

  // Right edge
  if (dx > 0) {
    const t = (box.x + box.width - centerX) / dx;
    const y = centerY + t * dy;
    if (y >= box.y && y <= box.y + box.height) {
      intersections.push({ x: box.x + box.width, y, dist: Math.abs(t) });
    }
  }

  if (intersections.length > 0) {
    intersections.sort((a, b) => a.dist - b.dist);
    return { x: intersections[0].x, y: intersections[0].y };
  }

  return { x: centerX, y: centerY };
}

function findLabelPosition(faceBox, labelWidth, labelHeight, placedBoxes, canvasWidth, canvasHeight, imageWidth, imageHeight, imageX, imageY, imageScale) {
  const displayedWidth = imageWidth * imageScale;
  const buffer = Math.max(LABEL_MIN_BUFFER, Math.floor(displayedWidth * LABEL_BUFFER_RATIO));

  const faceCenterX = faceBox.x + faceBox.width / 2;
  const faceCenterY = faceBox.y + faceBox.height / 2;

  const imageBounds = {
    left: imageX,
    top: imageY,
    right: imageX + imageWidth * imageScale,
    bottom: imageY + imageHeight * imageScale
  };

  const maxRadius = Math.max(canvasWidth, canvasHeight) * 2;
  const startRadius = Math.max(faceBox.width, faceBox.height) / 2 + 20;

  let bestOutside = null;

  for (let radius = startRadius; radius < maxRadius; radius += 25) {
    for (let angle = 0; angle < 360; angle += 15) {
      const radians = (angle * Math.PI) / 180;
      const labelX = Math.floor(faceCenterX + radius * Math.cos(radians) - labelWidth / 2);
      const labelY = Math.floor(faceCenterY + radius * Math.sin(radians) - labelHeight / 2);

      const labelBox = { x: labelX, y: labelY, width: labelWidth, height: labelHeight };

      let collision = false;
      for (const box of placedBoxes) {
        if (boxesOverlap(labelBox, box, buffer)) {
          collision = true;
          break;
        }
      }

      if (!collision) {
        const withinBounds = (
          labelX >= imageBounds.left &&
          labelY >= imageBounds.top &&
          labelX + labelWidth <= imageBounds.right &&
          labelY + labelHeight <= imageBounds.bottom
        );

        if (withinBounds) {
          return { x: labelX, y: labelY, outsideImage: false };
        } else if (!bestOutside) {
          bestOutside = { x: labelX, y: labelY, outsideImage: true };
        }
      }
    }
  }

  if (bestOutside) {
    return bestOutside;
  }

  return {
    x: faceBox.x,
    y: faceBox.y - labelHeight - 10,
    outsideImage: true
  };
}

export default ImageViewer;
