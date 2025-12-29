/**
 * Image Viewer Module
 *
 * Canvas-based image viewer with zoom/pan support.
 * Replaces the legacy <img> tag implementation.
 */

import { CanvasRenderer } from './canvas-renderer.js';
import { devToolsFocus } from '../../shared/devtools-focus.js';

export default {
  id: 'image-viewer',
  title: 'Image Viewer',
  defaultSize: { width: 800, height: 600 },

  /**
   * Initialize image viewer module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<object>} Object with cleanup function and renderer
   */
  async init(container, api) {
    console.log('[ImageViewer] Initializing...');

    // Create canvas renderer
    const renderer = new CanvasRenderer(container);

    // Smooth continuous zoom with key hold
    let zoomAnimationId = null;
    let zoomDelayTimeout = null;
    let zoomDirection = 0; // -1 for out, 0 for none, 1 for in
    let pendingZoomDirection = 0; // Track if we have a pending discrete zoom on keyup
    const ZOOM_HOLD_DELAY = 200; // Delay before continuous zoom starts (ms)
    const CONTINUOUS_ZOOM_FACTOR = 1.012; // Small zoom per frame for smooth animation (will be configurable in Phase 4)

    const performZoom = () => {
      if (zoomDirection !== 0) {
        // Zoom every frame with small increment for smooth animation
        const factor = zoomDirection > 0 ? CONTINUOUS_ZOOM_FACTOR : 1 / CONTINUOUS_ZOOM_FACTOR;
        renderer.zoom(factor, renderer.mousePos.x, renderer.mousePos.y);

        zoomAnimationId = requestAnimationFrame(performZoom);
      }
    };

    const startContinuousZoom = (direction) => {
      zoomDirection = direction;
      pendingZoomDirection = 0; // Cancel pending discrete zoom
      performZoom();
    };

    // Keyboard shortcuts
    const keyboardHandler = (event) => {
      // Check if keyboard event should be ignored (DevTools focused or input focused)
      if (devToolsFocus.shouldIgnoreKeyboardEvent(event)) {
        return;
      }

      // Prevent key repeat for non-zoom keys
      if (event.repeat && event.key !== '+' && event.key !== '-') {
        return;
      }

      switch (event.key) {
        case '+':
          // On keydown: prepare for either discrete or continuous zoom
          // Discrete zoom happens on keyup if released quickly
          if (!event.repeat) {
            pendingZoomDirection = 1; // Mark that we might do a discrete zoom on keyup

            // Start continuous zoom after delay
            zoomDelayTimeout = setTimeout(() => {
              startContinuousZoom(1);
            }, ZOOM_HOLD_DELAY);
          }
          event.preventDefault();
          break;

        case '-':
          // On keydown: prepare for either discrete or continuous zoom
          // Discrete zoom happens on keyup if released quickly
          if (!event.repeat) {
            pendingZoomDirection = -1; // Mark that we might do a discrete zoom on keyup

            // Start continuous zoom after delay
            zoomDelayTimeout = setTimeout(() => {
              startContinuousZoom(-1);
            }, ZOOM_HOLD_DELAY);
          }
          event.preventDefault();
          break;

        case '=':
          // Reset to 1:1 zoom (works on both US and Swedish keyboards)
          renderer.resetZoom();
          event.preventDefault();
          break;

        case '0':
          // Auto-fit mode (0 = reset view)
          renderer.autoFit();
          event.preventDefault();
          break;

        case 'b':
          // Toggle between single and all bounding boxes
          renderer.toggleSingleAll();
          event.preventDefault();
          break;

        case 'B':
          // Toggle between none and previous mode
          renderer.toggleOnOff();
          event.preventDefault();
          break;

        case 'c':
          // Enable auto-center and center on current face
          renderer.toggleAutoCenterOnFace(true);
          event.preventDefault();
          break;

        case 'C':
          // Disable auto-center on face
          renderer.toggleAutoCenterOnFace(false);
          event.preventDefault();
          break;
      }
    };

    const keyupHandler = (event) => {
      // Handle zoom key release
      if (event.key === '+' || event.key === '-') {
        // Cancel delayed start of continuous zoom
        if (zoomDelayTimeout) {
          clearTimeout(zoomDelayTimeout);
          zoomDelayTimeout = null;
        }

        // If we have a pending discrete zoom (key was released before continuous started)
        if (pendingZoomDirection !== 0) {
          // Perform single discrete zoom step
          const factor = pendingZoomDirection > 0 ? renderer.zoomStep : 1 / renderer.zoomStep;
          renderer.zoom(factor, renderer.mousePos.x, renderer.mousePos.y);
          pendingZoomDirection = 0;
        }

        // Stop ongoing continuous zoom
        zoomDirection = 0;
        if (zoomAnimationId) {
          cancelAnimationFrame(zoomAnimationId);
          zoomAnimationId = null;
        }
      }
    };

    document.addEventListener('keydown', keyboardHandler);
    document.addEventListener('keyup', keyupHandler);

    // Listen for image load requests (from other modules or main process)
    api.on('load-image', async ({ imagePath }) => {
      try {
        // Remove placeholder if it exists
        const placeholder = container.querySelector('.image-viewer-placeholder');
        if (placeholder) {
          placeholder.remove();
        }

        await renderer.loadImage(imagePath);
        console.log(`[ImageViewer] Loaded image: ${imagePath}`);

        // Emit event that image was loaded
        api.emit('image-loaded', {
          imagePath,
          dimensions: {
            width: renderer.image.width,
            height: renderer.image.height
          }
        });
      } catch (err) {
        console.error('[ImageViewer] Failed to load image:', err);
      }
    });

    // Listen for zoom sync from other modules
    api.on('sync-zoom', ({ zoomFactor, pan }) => {
      renderer.setZoomFactor(zoomFactor);
      if (pan) {
        renderer.setPan(pan.x, pan.y);
      }
    });

    // Respond to current image requests
    api.on('request-current-image', () => {
      console.log('[ImageViewer] Received request-current-image event');
      console.log('[ImageViewer] Current imagePath:', renderer.imagePath);
      console.log('[ImageViewer] Original imagePath:', renderer.originalImagePath);
      console.log('[ImageViewer] Has image:', !!renderer.image);

      if (renderer.imagePath) {
        // Use original path if available (e.g., NEF file), otherwise use loaded path
        const pathToSend = renderer.originalImagePath || renderer.imagePath;
        console.log('[ImageViewer] Responding to current-image request with:', pathToSend);
        api.emit('image-loaded', {
          imagePath: pathToSend,
          dimensions: {
            width: renderer.image.width,
            height: renderer.image.height
          }
        });
      } else {
        console.log('[ImageViewer] No image path available to respond with');
      }
    });

    // Listen for face detection results to show bounding boxes
    api.on('faces-detected', ({ faces }) => {
      console.log('[ImageViewer] Received faces-detected event, showing', faces.length, 'bounding boxes');
      renderer.setFaces(faces);
    });

    // Listen for active face changes from Review Module
    api.on('active-face-changed', ({ index }) => {
      renderer.setActiveFaceIndex(index);
    });

    // Listen for menu commands
    api.on('toggle-single-all-boxes', () => {
      renderer.toggleSingleAll();
    });

    api.on('toggle-boxes-on-off', () => {
      renderer.toggleOnOff();
    });

    api.on('zoom-in', () => {
      const factor = renderer.zoomStep;
      renderer.zoom(factor, renderer.mousePos.x, renderer.mousePos.y);
    });

    api.on('zoom-out', () => {
      const factor = 1 / renderer.zoomStep;
      renderer.zoom(factor, renderer.mousePos.x, renderer.mousePos.y);
    });

    api.on('reset-zoom', () => {
      renderer.resetZoom();
    });

    api.on('auto-fit', () => {
      renderer.autoFit();
    });

    api.on('auto-center-enable', () => {
      renderer.toggleAutoCenterOnFace(true);
    });

    api.on('auto-center-disable', () => {
      renderer.toggleAutoCenterOnFace(false);
    });

    // TODO: Load initial image if provided in params
    // For now, we'll add a placeholder message
    if (!renderer.image) {
      showPlaceholder(container);
    }

    // Return object with cleanup function and renderer reference
    return {
      cleanup: () => {
        console.log('[ImageViewer] Cleaning up...');
        document.removeEventListener('keydown', keyboardHandler);
        document.removeEventListener('keyup', keyupHandler);
        if (zoomDelayTimeout) {
          clearTimeout(zoomDelayTimeout);
        }
        if (zoomAnimationId) {
          cancelAnimationFrame(zoomAnimationId);
        }
        renderer.cleanup();
      },
      renderer // Expose renderer for state management
    };
  },

  /**
   * Get current state for persistence
   * @returns {object} Serializable state
   */
  getState() {
    // State will be managed by canvas renderer
    return {};
  },

  /**
   * Restore state from persistence
   * @param {object} state - Saved state
   */
  setState(state) {
    // State will be managed by canvas renderer
  }
};

/**
 * Show placeholder message when no image is loaded
 * @param {HTMLElement} container - Container element
 */
function showPlaceholder(container) {
  const placeholder = document.createElement('div');
  placeholder.className = 'image-viewer-placeholder';
  placeholder.style.cssText = `
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #666;
    font-size: 14px;
    pointer-events: none;
  `;
  placeholder.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 16px;">📷</div>
    <div>No image loaded</div>
    <div style="font-size: 12px; margin-top: 8px; color: #999;">
      Open an image to get started
    </div>
  `;
  container.appendChild(placeholder);
}
