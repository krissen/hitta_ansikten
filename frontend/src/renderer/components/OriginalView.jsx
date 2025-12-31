/**
 * OriginalView - React component for viewing original NEF files
 *
 * Features:
 * - Displays original NEF file alongside processed image
 * - Syncs zoom/pan with main Image Viewer
 * - Toggle sync with 'X' key
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts.js';
import { useCanvasDimensions } from '../hooks/useCanvas.js';
import { useBackend } from '../context/BackendContext.jsx';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import './OriginalView.css';

// Constants
const ZOOM_STEP = 1.15;
const MIN_ZOOM = 0.01;
const MAX_ZOOM = 10;

/**
 * OriginalView Component
 */
export function OriginalView() {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const { api } = useBackend();

  // Image state
  const [image, setImage] = useState(null);
  const [currentNefPath, setCurrentNefPath] = useState(null);

  // Zoom/pan state
  const [zoomMode, setZoomMode] = useState('auto');
  const [zoomFactor, setZoomFactor] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  // Sync state
  const [isSynced, setIsSynced] = useState(true);

  // Panning state
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef(null);
  const mousePosRef = useRef({ x: 0, y: 0 });

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [placeholder, setPlaceholder] = useState('Waiting for NEF file...');

  // Canvas dimensions
  const dimensions = useCanvasDimensions(containerRef);

  // Get module API
  const emit = useEmitEvent();

  // ============================================
  // Image Loading
  // ============================================

  const loadOriginal = useCallback(async (imagePath) => {
    // Check if this is a NEF file
    const isNef = imagePath.toLowerCase().endsWith('.nef') ||
                  imagePath.includes('_converted.jpg');

    if (!isNef) {
      debug('OriginalView', 'Not a NEF file, skipping');
      setImage(null);
      setPlaceholder('Not a NEF file');
      return;
    }

    // Determine original NEF path
    let nefPath = imagePath;
    if (imagePath.includes('_converted.jpg')) {
      debug('OriginalView', 'Converted JPG detected, original path unknown');
      setPlaceholder('Original NEF path unknown');
      return;
    }

    setCurrentNefPath(nefPath);
    setIsLoading(true);
    setPlaceholder('Loading original...');

    try {
      debug('OriginalView', `Loading original: ${nefPath}`);

      // Use preprocessing API (with caching)
      const result = await api.post('/api/preprocessing/nef', { file_path: nefPath });

      if (result.status === 'error') {
        throw new Error(result.error || 'NEF conversion failed');
      }

      const jpgPath = result.nef_jpg_path;
      debug('OriginalView', result.status === 'cached' ? 'Using cached conversion' : 'NEF converted');

      // Load the image
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (err) => reject(new Error('Failed to load image'));
        const imageSrc = jpgPath.startsWith('file://') ? jpgPath : 'file://' + jpgPath;
        img.src = imageSrc;
      });

      setImage(img);
      setZoomMode('auto');
      setZoomFactor(1);
      setPan({ x: 0, y: 0 });
      setIsLoading(false);
      setPlaceholder(null);

      debug('OriginalView', 'Original loaded successfully');
    } catch (err) {
      debugError('OriginalView', 'Failed to load original:', err);
      setIsLoading(false);
      setPlaceholder(`Error: ${err.message}`);
    }
  }, [api]);

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
    ctx.fillStyle = '#2a2a2a';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

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
      ctx.drawImage(image, pan.x, pan.y, image.width * zoomFactor, image.height * zoomFactor);
    }
  }, [image, dimensions, zoomMode, zoomFactor, pan]);

  // ============================================
  // Zoom Functions
  // ============================================

  const zoom = useCallback((factor, centerX = null, centerY = null) => {
    if (!image) return;

    let newZoomFactor = zoomFactor;
    let newPan = { ...pan };
    let newZoomMode = zoomMode;

    if (zoomMode === 'auto') {
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

  // ============================================
  // Sync Toggle
  // ============================================

  const toggleSync = useCallback(() => {
    setIsSynced(prev => !prev);
  }, []);

  // ============================================
  // Mouse Events for Panning
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

  useKeyboardShortcuts({
    'x': toggleSync,
    'X': toggleSync
  });

  // ============================================
  // Module Events
  // ============================================

  // Listen for image-loaded events from Image Viewer
  useModuleEvent('image-loaded', ({ imagePath }) => {
    debug('OriginalView', 'Image loaded event received:', imagePath);
    loadOriginal(imagePath);
  });

  // Listen for sync-view events
  useModuleEvent('sync-view', ({ zoomFactor: newZoom, pan: newPan }) => {
    if (!isSynced) return;

    setZoomMode('manual');
    setZoomFactor(newZoom);
    if (newPan) {
      setPan(newPan);
    }
  });

  // Request current image on mount
  useEffect(() => {
    debug('OriginalView', 'Requesting current image...');
    emit('request-current-image', {});

    // Retry after a delay
    const timeout = setTimeout(() => {
      if (!currentNefPath) {
        emit('request-current-image', {});
      }
    }, 500);

    return () => clearTimeout(timeout);
  }, [emit, currentNefPath]);

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
    <div ref={containerRef} className="original-view">
      <canvas
        ref={canvasRef}
        style={{ cursor: zoomMode === 'manual' ? 'grab' : 'default' }}
      />

      {/* Sync indicator */}
      <div className={`sync-indicator ${isSynced ? 'synced' : 'detached'}`}>
        {isSynced ? '🔗 Synced' : '🔓 Detached'}
      </div>

      {/* Loading/placeholder */}
      {(isLoading || placeholder) && !image && (
        <div className="original-view-placeholder">
          <div className="placeholder-icon">📷</div>
          <div>{isLoading ? 'Loading original...' : placeholder}</div>
        </div>
      )}
    </div>
  );
}

export default OriginalView;
