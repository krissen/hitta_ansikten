/**
 * Original View Module
 *
 * Displays original NEF file side-by-side with processed image.
 * - Reuses cached preview JPG from backend
 * - Syncs zoom/pan with main Image Viewer
 * - Toggle sync with 'X' key
 */

import { CanvasRenderer } from '../image-viewer/canvas-renderer.js';

export default {
  id: 'original-view',
  title: 'Original View',
  defaultSize: { width: 800, height: 600 },

  /**
   * Initialize Original View Module
   * @param {HTMLElement} container - Module container
   * @param {object} api - Module API
   * @returns {Promise<Function>} Cleanup function
   */
  async init(container, api) {
    console.log('[OriginalView] Initializing...');

    // Module state
    let currentNefPath = null;
    let isSynced = true; // Sync zoom/pan with main viewer

    // Create canvas renderer
    const renderer = new CanvasRenderer(container);

    // Add sync status indicator
    const syncIndicator = document.createElement('div');
    syncIndicator.style.cssText = `
      position: absolute;
      top: 10px;
      right: 10px;
      padding: 6px 12px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      border-radius: 4px;
      font-size: 12px;
      font-family: system-ui;
      z-index: 10;
      pointer-events: none;
    `;
    syncIndicator.textContent = '🔗 Synced';
    container.appendChild(syncIndicator);

    /**
     * Update sync indicator
     */
    function updateSyncIndicator() {
      if (isSynced) {
        syncIndicator.textContent = '🔗 Synced';
        syncIndicator.style.background = 'rgba(76, 175, 80, 0.8)';
      } else {
        syncIndicator.textContent = '🔓 Detached';
        syncIndicator.style.background = 'rgba(244, 67, 54, 0.8)';
      }
    }

    /**
     * Load original NEF file
     */
    async function loadOriginal(imagePath) {
      // Check if this is a NEF file (either original or converted)
      const isNef = imagePath.toLowerCase().endsWith('.nef') ||
                    imagePath.includes('_converted.jpg');

      if (!isNef) {
        console.log('[OriginalView] Not a NEF file, skipping original view');
        showPlaceholder('Not a NEF file');
        return;
      }

      // Determine original NEF path
      let nefPath = imagePath;
      if (imagePath.includes('_converted.jpg')) {
        // Extract original NEF path from converted JPG path
        // /tmp/filename_converted.jpg -> need to find original NEF
        // This is tricky - we'd need to store the mapping somewhere
        // For now, just show a message
        console.log('[OriginalView] Converted JPG detected, but original path unknown');
        showPlaceholder('Original NEF path unknown');
        return;
      }

      currentNefPath = nefPath;

      try {
        console.log(`[OriginalView] Loading original: ${nefPath}`);
        showPlaceholder('Loading original...');

        // Request backend to convert NEF (will use cache if available)
        const jpgPath = await api.ipc.invoke('convert-nef', nefPath);

        // Load converted JPG into canvas
        await renderer.loadImage(jpgPath);

        // Remove placeholder after successful load
        const placeholder = container.querySelector('.original-placeholder');
        if (placeholder) placeholder.remove();

        console.log('[OriginalView] Original loaded successfully');

      } catch (err) {
        console.error('[OriginalView] Failed to load original:', err);
        showPlaceholder(`Error: ${err.message}`);
      }
    }

    /**
     * Show placeholder message
     */
    function showPlaceholder(message) {
      const existing = container.querySelector('.original-placeholder');
      if (existing) existing.remove();

      const placeholder = document.createElement('div');
      placeholder.className = 'original-placeholder';
      placeholder.style.cssText = `
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        text-align: center;
        color: #666;
        font-size: 14px;
        pointer-events: none;
        font-family: system-ui;
      `;
      placeholder.innerHTML = `
        <div style="font-size: 48px; margin-bottom: 16px;">📷</div>
        <div>${message}</div>
      `;
      container.appendChild(placeholder);
    }

    // Listen for image-loaded events from main Image Viewer
    api.on('image-loaded', ({ imagePath }) => {
      console.log('[OriginalView] Image loaded event received:', imagePath);
      console.log('[OriginalView] Image path type:', typeof imagePath, 'Is NEF:', imagePath?.toLowerCase().endsWith('.nef'));
      loadOriginal(imagePath);
    });

    // Listen for sync-view events (zoom/pan changes from main viewer)
    api.on('sync-view', ({ zoomFactor, pan }) => {
      if (!isSynced) return;

      console.log('[OriginalView] Syncing view:', { zoomFactor, pan });
      renderer.setZoomFactor(zoomFactor);
      renderer.setPan(pan.x, pan.y);
    });

    // Keyboard shortcuts
    const keyboardHandler = (event) => {
      // Only handle if this module is focused or no input is focused
      const activeElement = document.activeElement;
      if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
        return;
      }

      switch (event.key) {
        case 'x':
        case 'X':
          // Toggle sync mode
          isSynced = !isSynced;
          updateSyncIndicator();
          console.log(`[OriginalView] Sync mode: ${isSynced ? 'enabled' : 'disabled'}`);
          event.preventDefault();
          break;
      }
    };

    document.addEventListener('keydown', keyboardHandler);

    // Initial state
    updateSyncIndicator();

    // Check if there's already an image loaded in another module
    // Request current image path from Image Viewer
    console.log('[OriginalView] Requesting current image from Image Viewer...');
    api.emit('request-current-image', {});

    // Show initial placeholder (will be removed when image loads)
    showPlaceholder('Waiting for NEF file...');

    // Debug: Also try direct approach after a delay to ensure Image Viewer is ready
    setTimeout(() => {
      if (!currentNefPath) {
        console.log('[OriginalView] No image loaded yet, retrying request...');
        api.emit('request-current-image', {});
      }
    }, 500);

    console.log('[OriginalView] Initialized successfully');

    // Cleanup function
    return () => {
      console.log('[OriginalView] Cleaning up...');
      document.removeEventListener('keydown', keyboardHandler);
      renderer.cleanup();
    };
  },

  /**
   * Get module state for persistence
   */
  getState() {
    return {};
  },

  /**
   * Restore module state
   */
  setState(state) {
    // State restoration logic
  }
};
