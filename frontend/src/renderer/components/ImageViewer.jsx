/**
 * ImageViewer - Review-workflow image viewer module.
 *
 * Thin, event-driven wrapper around the presentational <CanvasImageView>. This
 * module owns everything application-specific: the image loading / NEF pipeline,
 * module-event wiring (load-image, faces-detected, active-face-changed,
 * sync-zoom, …), global keyboard shortcuts, menu-state sync, the face bounding
 * box overlay, and the file-info / loading overlays. All zoom/pan/canvas
 * mechanics live in CanvasImageView and are driven through its imperative ref.
 *
 * Features:
 * - Canvas-based rendering with zoom/pan support (via CanvasImageView)
 * - Face bounding box overlay
 * - NEF file support (via IPC conversion)
 * - Keyboard shortcuts for zoom and navigation
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useKeyboardShortcuts, useKeyHold } from '../hooks/useKeyboardShortcuts.js';
import { debug, debugError } from '../shared/debug.js';
import { toFileUrl } from '../shared/fileUrl.js';
import { ZOOM_STEP } from '../shared/canvasViewport.js';
import { apiClient } from '../shared/api-client.js';
import { preferences } from '../workspace/preferences.js';
import { CanvasImageView } from './CanvasImageView.jsx';
import { buildFaceLabel } from './review/faceLabel.js';
import { LoadingOverlay } from './shared/ProgressBar.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { t } from '../../i18n/index.js';
import './ImageViewer.css';

// Constants (will be user-configurable in Phase 4)
const ZOOM_HOLD_DELAY = 200;
const CONTINUOUS_ZOOM_FACTOR = 1.012;
const LABEL_BUFFER_RATIO = 0.005;
const LABEL_MIN_BUFFER = 10;

/**
 * ImageViewer Component
 */
export function ImageViewer() {
  // Imperative handle to the canvas viewer (zoom/pan/fit/center).
  const viewRef = useRef(null);

  // Image state
  const [image, setImage] = useState(null);
  const [imagePath, setImagePath] = useState(null);
  const [originalImagePath, setOriginalImagePath] = useState(null);

  // Face detection state
  const [faces, setFaces] = useState([]);
  const [faceBoxMode, setFaceBoxMode] = useState('all');
  const [activeFaceIndex, setActiveFaceIndex] = useState(0);
  const previousFaceBoxModeRef = useRef('all');

  // Track skipAutoDetect for re-emission on request-current-image
  const lastSkipAutoDetectRef = useRef(false);

  // Monotonic load generation. The loader's awaits (NEF conversion, decode(),
  // createImageBitmap()) widen the window where a newer load can overtake an
  // older one; each load takes a token and bails after every await if a newer
  // load has started, so a stale image is never displayed and stale
  // dimensions are never emitted.
  const loadGenerationRef = useRef(0);

  // Auto-center state (enabled by default for review workflow)
  const [autoCenterOnFace, setAutoCenterOnFace] = useState(true);

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState('');

  // File info overlay state
  const [showFileInfo, setShowFileInfo] = useState(() => preferences.get('imageViewer.showFileInfo') ?? true);
  const [queueStatus, setQueueStatus] = useState(null);

  // Cached face-box theme colors (read from CSS vars). Invalidated on theme
  // change; `themeVersion` bumps to force a repaint with the new colors.
  const themeColorsRef = useRef(null);
  const [themeVersion, setThemeVersion] = useState(0);

  // Get module API
  const emit = useEmitEvent();
  const showToast = useToast();

  // ============================================
  // Image Loading
  // ============================================

  const loadImage = useCallback(async (filepath) => {
    // Take a load token; any await below must re-check it so an overlapping
    // newer load wins (see loadGenerationRef comment above).
    const generation = ++loadGenerationRef.current;
    const isStale = () => generation !== loadGenerationRef.current;
    const supersededError = () => {
      const err = new Error(`Image load superseded by a newer load: ${filepath}`);
      err.superseded = true;
      return err;
    };

    // Clear bounding boxes immediately before loading new image
    setFaces([]);

    let loadPath = filepath;
    const originalPath = filepath;

    // Check if NEF file - use preprocessing cache/API for conversion
    if (filepath.toLowerCase().endsWith('.nef')) {
      setIsLoading(true);

      try {
        // Call preprocessing API - handles cache check and conversion in one call
        const result = await apiClient.post('/api/v1/preprocessing/nef', { file_path: filepath });
        if (isStale()) throw supersededError();

        if (result.status === 'cached') {
          debug('ImageViewer', 'Using cached JPG:', result.nef_jpg_path);
          setLoadingMessage(t('imageViewer.loadingFromCache'));
        } else if (result.status === 'completed') {
          debug('ImageViewer', 'NEF converted and cached:', result.nef_jpg_path);
          setLoadingMessage(t('imageViewer.convertingNef'));
        } else if (result.status === 'error') {
          throw new Error(result.error || 'NEF conversion failed');
        }

        loadPath = result.nef_jpg_path;
      } catch (err) {
        if (err.superseded) throw err; // newer load owns the loading state
        setIsLoading(false);
        debugError('ImageViewer', 'NEF conversion failed:', err);
        throw new Error(`Failed to convert NEF file: ${err.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();

      // Finish loading with a ready-to-paint drawable. Prefer an ImageBitmap
      // (already decoded, cheap to draw), falling back to the HTMLImageElement.
      const finalize = async () => {
        let drawable = img;
        try {
          if (typeof createImageBitmap === 'function') {
            // 'from-image' applies EXIF orientation, matching how Chromium
            // draws an HTMLImageElement (CSS image-orientation: from-image
            // default). The backend bakes EXIF orientation into face-box
            // coordinates, so both drawable types must be EXIF-oriented.
            drawable = await createImageBitmap(img, { imageOrientation: 'from-image' });
          }
        } catch (e) {
          debug('ImageViewer', 'createImageBitmap failed, using HTMLImageElement:', e);
          drawable = img;
        }

        if (isStale()) {
          // A newer load overtook this one while decoding: discard silently.
          if (drawable !== img && typeof drawable.close === 'function') drawable.close();
          reject(supersededError());
          return;
        }

        debug('ImageViewer', `Image decoded: ${img.width}x${img.height} (${(img.width * img.height / 1e6).toFixed(1)}MP)`);
        setImage(drawable);
        setImagePath(loadPath);
        setOriginalImagePath(originalPath);
        // Reset the viewer to auto-fit for the new image.
        viewRef.current?.autoFit();
        setIsLoading(false);

        resolve({ img: drawable, loadPath, originalPath });
      };

      img.onload = () => {
        // onload already guarantees the image is usable; decode() just moves the
        // decode off the first-paint critical path, so ignore its errors.
        const decoded = typeof img.decode === 'function' ? img.decode() : Promise.resolve();
        decoded.catch(() => {}).then(finalize);
      };

      img.onerror = (err) => {
        if (isStale()) {
          reject(supersededError());
          return;
        }
        setIsLoading(false);
        const errorDetails = err?.type || err?.message || 'Unknown error';
        debugError('ImageViewer', 'Failed to load image:', loadPath, '- Error:', errorDetails);
        reject(new Error(`Failed to load image: ${loadPath}`));
      };

      // Build the file:// URL via the shared helper (handles encoding of spaces,
      // #, ?, [], Windows drive paths, and already-file:// input).
      const imageSrc = toFileUrl(loadPath);

      debug('ImageViewer', 'Loading image from:', imageSrc);
      img.src = imageSrc;
    });
  }, []);

  // ============================================
  // Face Box Overlay
  // ============================================

  const drawFaceBoxes = useCallback((ctx, canvasWidth, canvasHeight, imageScale, imageX, imageY) => {
    if (faceBoxMode === 'none' || !faces || faces.length === 0 || !image) return;

    // Determine which faces to draw (with original index for numbering)
    let facesToDraw = faces.map((face, idx) => ({ face, originalIndex: idx }));
    if (faceBoxMode === 'single') {
      const activeFace = faces[activeFaceIndex];
      facesToDraw = activeFace ? [{ face: activeFace, originalIndex: activeFaceIndex }] : [];
    }

    // Font for labels
    ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    ctx.lineWidth = 3;

    // Face-box colors are read from CSS vars once and cached; the cache is
    // invalidated on theme change (see the theme-invalidation effect below),
    // keeping getComputedStyle out of the render hot path.
    if (!themeColorsRef.current) {
      const styles = getComputedStyle(document.documentElement);
      themeColorsRef.current = {
        activeHighlightColor: styles.getPropertyValue('--face-active-highlight').trim() || '#00bcd4',
        confirmedColor: styles.getPropertyValue('--face-confirmed-color').trim() || '#4caf50',
        confirmedBg: styles.getPropertyValue('--face-confirmed-bg').trim() || 'rgba(76, 175, 80, 0.9)',
        ignoredColor: styles.getPropertyValue('--face-ignored-color').trim() || '#9e9e9e',
        ignoredBg: styles.getPropertyValue('--face-ignored-bg').trim() || 'rgba(158, 158, 158, 0.9)',
        uncertainColor: styles.getPropertyValue('--face-uncertain-color').trim() || '#ffc107',
        uncertainBg: styles.getPropertyValue('--face-uncertain-bg').trim() || 'rgba(255, 193, 7, 0.9)',
        confidenceMediumColor: styles.getPropertyValue('--face-confidence-medium-color').trim() || '#2196f3',
        confidenceMediumBg: styles.getPropertyValue('--face-confidence-medium-bg').trim() || 'rgba(33, 150, 243, 0.9)',
        confidenceLowColor: styles.getPropertyValue('--face-confidence-low-color').trim() || '#ff9800',
        confidenceLowBg: styles.getPropertyValue('--face-confidence-low-bg').trim() || 'rgba(255, 152, 0, 0.9)',
        confidenceNoneColor: styles.getPropertyValue('--face-confidence-none-color').trim() || '#f44336',
        confidenceNoneBg: styles.getPropertyValue('--face-confidence-none-bg').trim() || 'rgba(244, 67, 54, 0.9)'
      };
    }
    const {
      activeHighlightColor, confirmedColor, confirmedBg, ignoredColor, ignoredBg,
      uncertainColor, uncertainBg,
      confidenceMediumColor, confidenceMediumBg,
      confidenceLowColor, confidenceLowBg,
      confidenceNoneColor, confidenceNoneBg
    } = themeColorsRef.current;

    // Calculate placements with collision avoidance
    const placedBoxes = [];
    const placements = [];

    facesToDraw.forEach(({ face, originalIndex }) => {
      const bbox = face.bounding_box;
      if (!bbox) return;

      const faceNumber = originalIndex + 1;

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

      const labelText = buildFaceLabel(face, faceNumber, t);

      if (labelText) {
        const metrics = ctx.measureText(labelText);
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
        label: labelText,
        labelPos,
        labelWidth,
        labelHeight,
        originalIndex
      });
    });

    // Draw everything
    placements.forEach(({ face, faceBox, label, labelPos, labelWidth, labelHeight, originalIndex }) => {
      const confidence = face.confidence || 0;
      const matchCase = face.match_case;
      const isActiveFace = originalIndex === activeFaceIndex;
      let strokeColor, textBgColor;

      // Prioritize confirmed status over match_case/confidence
      if (face.is_confirmed && face.is_rejected) {
        // Confirmed as ignored
        strokeColor = ignoredColor;
        textBgColor = ignoredBg;
      } else if (face.is_confirmed && !face.is_rejected) {
        // Confirmed with a name
        strokeColor = confirmedColor;
        textBgColor = confirmedBg;
      } else if (matchCase === 'ign' || matchCase === 'uncertain_ign') {
        strokeColor = ignoredColor;
        textBgColor = ignoredBg;
      } else if (matchCase === 'uncertain_name') {
        strokeColor = uncertainColor;
        textBgColor = uncertainBg;
      } else if (confidence >= 0.65) {
        strokeColor = confirmedColor;
        textBgColor = confirmedBg;
      } else if (confidence >= 0.50) {
        strokeColor = confidenceMediumColor;
        textBgColor = confidenceMediumBg;
      } else if (confidence >= 0.35) {
        strokeColor = confidenceLowColor;
        textBgColor = confidenceLowBg;
      } else {
        strokeColor = confidenceNoneColor;
        textBgColor = confidenceNoneBg;
      }

      // Draw active face highlight (outer glow)
      if (isActiveFace) {
        ctx.save();
        ctx.strokeStyle = activeHighlightColor;
        ctx.lineWidth = 2;
        ctx.shadowColor = activeHighlightColor;
        ctx.shadowBlur = 6;
        ctx.strokeRect(faceBox.x - 2, faceBox.y - 2, faceBox.width + 4, faceBox.height + 4);
        ctx.restore();
      }

      // Draw bounding box
      ctx.strokeStyle = strokeColor;
      ctx.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height);

      // Draw label
      if (label && labelPos) {
        const labelCenterX = labelPos.x + labelWidth / 2;
        const labelCenterY = labelPos.y + labelHeight / 2;
        const edgePoint = getBoxEdgeIntersection(faceBox, labelCenterX, labelCenterY);

        // Connecting line (same color as bounding box)
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(edgePoint.x, edgePoint.y);
        ctx.lineTo(labelCenterX, labelCenterY);
        ctx.stroke();

        // Label background with active highlight
        if (isActiveFace) {
          ctx.save();
          ctx.strokeStyle = activeHighlightColor;
          ctx.lineWidth = 2;
          ctx.shadowColor = activeHighlightColor;
          ctx.shadowBlur = 6;
          ctx.strokeRect(labelPos.x - 1, labelPos.y - 1, labelWidth + 2, labelHeight + 2);
          ctx.restore();
        }

        ctx.fillStyle = textBgColor;
        ctx.fillRect(labelPos.x, labelPos.y, labelWidth, labelHeight);

        // Label text
        ctx.fillStyle = 'white';
        ctx.fillText(label, labelPos.x + 4, labelPos.y + 17);

        ctx.lineWidth = 3;
      }
    });
  }, [image, faces, faceBoxMode, activeFaceIndex, themeVersion]);

  // Overlay callback handed to CanvasImageView; drawn after the image each frame.
  const drawOverlay = useCallback((ctx, { scale, x, y, canvasWidth, canvasHeight }) => {
    drawFaceBoxes(ctx, canvasWidth, canvasHeight, scale, x, y);
  }, [drawFaceBoxes]);

  // ============================================
  // Menu State Sync Helper
  // ============================================

  const updateMenuState = useCallback((id, checked) => {
    if (window.ansiktenAPI?.send) {
      window.ansiktenAPI.send('update-menu-state', { id, checked });
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
  // Reset / auto-center helpers
  // ============================================

  // 1:1 zoom, centered on the active face if there is one (else image center).
  const resetView = useCallback(() => {
    const face = faces[activeFaceIndex];
    viewRef.current?.resetZoom(face?.bounding_box || null);
  }, [faces, activeFaceIndex]);

  // Ref so module-event handlers (captured at subscription time) always call the
  // latest closure over faces/activeFaceIndex.
  const resetViewRef = useRef(resetView);
  resetViewRef.current = resetView;

  const toggleAutoCenterOnFace = useCallback((enable) => {
    const newValue = enable === undefined ? !autoCenterOnFace : enable;
    debug('ImageViewer', `Auto-center ${newValue ? 'ENABLED' : 'DISABLED'}`);
    setAutoCenterOnFace(newValue);
    // Sync menu state
    updateMenuState('auto-center', newValue);
    if (newValue) {
      const face = faces[activeFaceIndex];
      if (face?.bounding_box) viewRef.current?.centerOnRect(face.bounding_box);
    }
  }, [autoCenterOnFace, updateMenuState, faces, activeFaceIndex]);

  // ============================================
  // Keyboard Shortcuts
  // ============================================

  // Hold detection for continuous zoom with double-tap support
  // Single tap: zoom step, Hold: continuous zoom, Double-tap +: 100% zoom
  useKeyHold('+', {
    onStart: () => {},
    onHold: () => viewRef.current?.zoom(CONTINUOUS_ZOOM_FACTOR),
    onEnd: (_, wasHolding) => {
      if (!wasHolding) {
        viewRef.current?.zoom(ZOOM_STEP);
      }
    },
    onDoubleTap: () => resetView() // Double-tap + → 100% (1:1) zoom
  }, { holdDelay: ZOOM_HOLD_DELAY });

  // Single tap: zoom step, Hold: continuous zoom, Double-tap -: fit-to-window
  useKeyHold('-', {
    onStart: () => {},
    onHold: () => viewRef.current?.zoom(1 / CONTINUOUS_ZOOM_FACTOR),
    onEnd: (_, wasHolding) => {
      if (!wasHolding) {
        viewRef.current?.zoom(1 / ZOOM_STEP);
      }
    },
    onDoubleTap: () => viewRef.current?.autoFit() // Double-tap - → fit-to-window
  }, { holdDelay: ZOOM_HOLD_DELAY });

  const toggleFileInfo = useCallback((enable) => {
    const newValue = enable === undefined ? !showFileInfo : enable;
    setShowFileInfo(newValue);
    preferences.set('imageViewer.showFileInfo', newValue);
    updateMenuState('show-file-info', newValue);
  }, [showFileInfo, updateMenuState]);

  useKeyboardShortcuts({
    '=': resetView,
    '0': () => viewRef.current?.autoFit(),
    'b': toggleSingleAll,
    'B': toggleOnOff,
    'c': () => toggleAutoCenterOnFace(true),
    'C': () => toggleAutoCenterOnFace(false),
    'I': () => toggleFileInfo()
  });

  // ============================================
  // Module Events
  // ============================================

  useModuleEvent('load-image', async ({ imagePath: path, skipAutoDetect }) => {
    try {
      const { img, originalPath } = await loadImage(path);
      lastSkipAutoDetectRef.current = !!skipAutoDetect;
      debug('ImageViewer', 'Loaded image:', path, { skipAutoDetect });
      emit('image-loaded', {
        imagePath: originalPath,
        dimensions: { width: img.width, height: img.height },
        skipAutoDetect
      });
    } catch (err) {
      if (err.superseded) {
        // Expected during fast navigation: a newer load won the race.
        debug('ImageViewer', 'Image load superseded:', path);
        return;
      }
      debugError('ImageViewer', 'Failed to load image:', err);
      // Surface the failure instead of leaving the viewer silently blank.
      showToast(t('imageViewer.loadFailed', { fileName: path?.split('/').pop() || path }), 'error');
    }
  });

  useModuleEvent('clear-image', () => {
    debug('ImageViewer', 'Clearing image');
    // Invalidate any in-flight load so it cannot repopulate the cleared viewer
    loadGenerationRef.current++;
    setImage(null);
    setImagePath(null);
    setOriginalImagePath(null);
    setFaces([]);
    setActiveFaceIndex(-1);
    lastSkipAutoDetectRef.current = false;
  });

  // Listen for faces-detected events - reset activeFaceIndex to sync with ReviewModule
  // Guard: only apply if imagePath matches current image (prevents race conditions)
  useModuleEvent('faces-detected', ({ faces: newFaces, imagePath: facesImagePath }) => {
    if (facesImagePath && originalImagePath && facesImagePath !== originalImagePath) {
      debug('ImageViewer', 'Ignoring faces-detected for different image:', facesImagePath);
      return;
    }
    setFaces(newFaces || []);
    if (newFaces && newFaces.length > 0) {
      setActiveFaceIndex(0);
    }
  }, [originalImagePath]);

  // Listen for active-face-changed events
  useModuleEvent('active-face-changed', ({ index }) => {
    debug('ImageViewer', `active-face-changed: index=${index}, autoCenterOnFace=${autoCenterOnFace}`);
    setActiveFaceIndex(index);
    if (autoCenterOnFace) {
      const face = faces[index];
      if (face?.bounding_box) {
        debug('ImageViewer', 'Centering on face', index);
        viewRef.current?.centerOnRect(face.bounding_box);
      }
    }
  }, [autoCenterOnFace, faces]);

  // Listen for sync-zoom events
  useModuleEvent('sync-zoom', ({ zoomFactor: newZoom, pan: newPan }) => {
    viewRef.current?.applyTransform({ zoomFactor: newZoom, pan: newPan });
  });

  // Re-emit the current image on request (Review's late-mount recovery asks for
  // this). The deps array is REQUIRED: without it useModuleEvent subscribes once
  // at mount and the handler keeps the mount closure (imagePath = null), so a
  // later-loaded image would never be re-emitted. Re-subscribe when the loaded
  // image changes so the handler always sees the current one.
  useModuleEvent('request-current-image', () => {
    if (imagePath) {
      emit('image-loaded', {
        imagePath: originalImagePath || imagePath,
        dimensions: { width: image?.width, height: image?.height },
        skipAutoDetect: lastSkipAutoDetectRef.current
      });
    }
  }, [imagePath, originalImagePath, image]);

  // Menu command events
  useModuleEvent('toggle-single-all-boxes', toggleSingleAll); // Legacy support
  useModuleEvent('toggle-boxes-on-off', toggleOnOff); // Legacy support
  useModuleEvent('boxes-show', () => setBoxMode(previousFaceBoxModeRef.current || 'all'));
  useModuleEvent('boxes-hide', () => setBoxMode('none'));
  useModuleEvent('boxes-all', () => setBoxMode('all'));
  useModuleEvent('boxes-single', () => setBoxMode('single'));
  useModuleEvent('zoom-in', () => viewRef.current?.zoom(ZOOM_STEP));
  useModuleEvent('zoom-out', () => viewRef.current?.zoom(1 / ZOOM_STEP));
  useModuleEvent('reset-zoom', () => resetViewRef.current());
  useModuleEvent('auto-fit', () => viewRef.current?.autoFit());
  useModuleEvent('auto-center-enable', () => toggleAutoCenterOnFace(true));
  useModuleEvent('auto-center-disable', () => toggleAutoCenterOnFace(false));
  useModuleEvent('file-info-show', () => toggleFileInfo(true));
  useModuleEvent('file-info-hide', () => toggleFileInfo(false));

  useModuleEvent('queue-status', (status) => {
    setQueueStatus(status);
  });

  // ============================================
  // Sync menu state on mount
  // ============================================

  useEffect(() => {
    updateMenuState('auto-center', autoCenterOnFace);
    updateMenuState('boxes-visible', faceBoxMode !== 'none');
    updateMenuState('show-file-info', showFileInfo);
    updateMenuState('boxes-all-faces', faceBoxMode === 'all');
  }, []); // Only on mount

  // ============================================
  // Theme invalidation for cached face-box colors
  // ============================================

  // Invalidate the cached face-box colors when the theme changes. Two triggers
  // are needed: theme-manager fires a `theme-changed` event and flips the
  // `data-theme` attribute, while the ThemeEditor live preview writes inline
  // CSS vars on <html> with no event — a MutationObserver on data-theme + style
  // covers both. Bumping themeVersion changes drawOverlay's identity, forcing
  // CanvasImageView to repaint with the new colors.
  useEffect(() => {
    const invalidate = () => {
      themeColorsRef.current = null;
      setThemeVersion(v => v + 1);
    };
    window.addEventListener('theme-changed', invalidate);
    const observer = new MutationObserver(invalidate);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'style']
    });
    return () => {
      window.removeEventListener('theme-changed', invalidate);
      observer.disconnect();
    };
  }, []);

  // Free the previous ImageBitmap when the drawable is replaced or on unmount.
  // HTMLImageElement has no close(); the guard keeps the fallback path safe.
  useEffect(() => {
    return () => {
      if (image && typeof image.close === 'function') {
        image.close();
      }
    };
  }, [image]);

  // ============================================
  // Render
  // ============================================

  return (
    <div className="image-viewer" tabIndex={-1}>
      <CanvasImageView ref={viewRef} image={image} drawOverlay={drawOverlay} />
      <LoadingOverlay visible={isLoading} message={loadingMessage} />
      {!image && !isLoading && (
        <div className="image-viewer-placeholder">
          <div className="placeholder-icon">📷</div>
          <div>{t('imageViewer.noImage')}</div>
          <div className="placeholder-hint">{t('imageViewer.openHint')}</div>
        </div>
      )}
      {showFileInfo && image && (
        <div className="file-info-overlay">
          <div className="file-info-filename">
            {originalImagePath?.split('/').pop() || t('imageViewer.unknown')}
          </div>
          {queueStatus && (
            <div className="file-info-queue">
              <span className="file-info-progress-text">
                {t('imageViewer.queueProgress', { done: queueStatus.done, remaining: queueStatus.remaining })}
              </span>
              <div className="file-info-progress-bar">
                <div
                  className="file-info-progress-fill"
                  style={{ width: `${((queueStatus.done + 1) / queueStatus.total) * 100}%` }}
                />
              </div>
            </div>
          )}
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
