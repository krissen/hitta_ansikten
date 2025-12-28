/**
 * Canvas Renderer
 *
 * Canvas-based image rendering with zoom and pan support.
 * Replaces the legacy <img> tag approach.
 */

export class CanvasRenderer {
  constructor(container) {
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { alpha: false });

    // Image state
    this.image = null;
    this.imagePath = null;

    // Zoom/pan state
    this.zoomMode = 'auto'; // 'auto' | 'manual'
    this.zoomFactor = 1;
    this.minZoom = 0.1;
    this.maxZoom = 10;
    this.zoomStep = 1.15; // 15% zoom per step (will be user-configurable in Phase 4)

    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.lastPanPoint = null;

    // Mouse tracking for zoom-to-cursor
    this.mousePos = { x: 0, y: 0 };

    // Setup canvas
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.canvas.style.display = 'block';
    this.canvas.style.cursor = 'grab';

    this.container.appendChild(this.canvas);

    // Event listeners
    this.setupEventListeners();

    // Initial resize
    this.resizeCanvas();
  }

  /**
   * Setup event listeners for zoom/pan
   */
  setupEventListeners() {
    // Resize observer
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCanvas();
    });
    this.resizeObserver.observe(this.container);

    // Mouse events for pan
    this.canvas.addEventListener('mousedown', (e) => {
      if (e.button === 0 && this.zoomMode === 'manual') { // Left click only
        this.isPanning = true;
        this.lastPanPoint = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
      }
    });

    this.canvas.addEventListener('mousemove', (e) => {
      // Update mouse position for zoom-to-cursor
      const rect = this.canvas.getBoundingClientRect();
      this.mousePos = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      };

      // Handle panning
      if (this.isPanning && this.lastPanPoint) {
        const dx = e.clientX - this.lastPanPoint.x;
        const dy = e.clientY - this.lastPanPoint.y;

        this.pan.x += dx;
        this.pan.y += dy;

        this.lastPanPoint = { x: e.clientX, y: e.clientY };
        this.render();
      }
    });

    this.canvas.addEventListener('mouseup', () => {
      this.isPanning = false;
      this.lastPanPoint = null;
      this.canvas.style.cursor = this.zoomMode === 'manual' ? 'grab' : 'default';
    });

    this.canvas.addEventListener('mouseleave', () => {
      this.isPanning = false;
      this.lastPanPoint = null;
      this.canvas.style.cursor = this.zoomMode === 'manual' ? 'grab' : 'default';
    });

    // Wheel zoom
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 1 / this.zoomStep : this.zoomStep;
      this.zoom(delta, this.mousePos.x, this.mousePos.y);
    }, { passive: false });
  }

  /**
   * Resize canvas to match container
   */
  resizeCanvas() {
    const rect = this.container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    this.ctx.scale(dpr, dpr);

    this.render();
  }

  /**
   * Load and display an image
   * @param {string} filepath - Path to image file
   * @returns {Promise<void>}
   */
  async loadImage(filepath) {
    // Check if NEF file - convert to JPG first
    if (filepath.toLowerCase().endsWith('.nef')) {
      try {
        console.log('[CanvasRenderer] NEF file detected, converting...');
        this.showLoadingOverlay('Converting NEF file...');
        const jpgPath = await window.bildvisareAPI.invoke('convert-nef', filepath);
        console.log('[CanvasRenderer] NEF converted to:', jpgPath);
        this.hideLoadingOverlay();
        filepath = jpgPath; // Use converted JPG
      } catch (err) {
        this.hideLoadingOverlay();
        console.error('[CanvasRenderer] NEF conversion failed:', err);
        throw new Error(`Failed to convert NEF file: ${err.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        this.image = img;
        this.imagePath = filepath;

        // Reset to auto-fit mode
        this.zoomMode = 'auto';
        this.zoomFactor = 1;
        this.pan = { x: 0, y: 0 };

        this.render();
        resolve();
      };

      img.onerror = (err) => {
        console.error('[CanvasRenderer] Failed to load image:', filepath, err);
        reject(new Error(`Failed to load image: ${filepath}`));
      };

      // Handle file:// protocol
      const imageSrc = filepath.startsWith('file://') ? filepath : 'file://' + filepath;
      img.src = imageSrc;
    });
  }

  /**
   * Render image to canvas
   */
  render() {
    if (!this.image) return;

    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

    // Clear canvas
    this.ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    if (this.zoomMode === 'auto') {
      // Auto-fit mode: scale image to fit canvas
      this.renderAutoFit(canvasWidth, canvasHeight);
    } else {
      // Manual zoom mode: use zoom factor and pan
      this.renderManual(canvasWidth, canvasHeight);
    }
  }

  /**
   * Render in auto-fit mode
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  renderAutoFit(canvasWidth, canvasHeight) {
    const imgRatio = this.image.width / this.image.height;
    const canvasRatio = canvasWidth / canvasHeight;

    let drawWidth, drawHeight, drawX, drawY;

    if (imgRatio > canvasRatio) {
      // Image is wider than canvas
      drawWidth = canvasWidth;
      drawHeight = canvasWidth / imgRatio;
      drawX = 0;
      drawY = (canvasHeight - drawHeight) / 2;
    } else {
      // Image is taller than canvas
      drawHeight = canvasHeight;
      drawWidth = canvasHeight * imgRatio;
      drawX = (canvasWidth - drawWidth) / 2;
      drawY = 0;
    }

    this.ctx.drawImage(this.image, drawX, drawY, drawWidth, drawHeight);
  }

  /**
   * Render in manual zoom mode
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   */
  renderManual(canvasWidth, canvasHeight) {
    const scaledWidth = this.image.width * this.zoomFactor;
    const scaledHeight = this.image.height * this.zoomFactor;

    // Use pan position directly for correct zoom-to-cursor behavior
    // Don't force centering - let user pan freely
    const drawX = this.pan.x;
    const drawY = this.pan.y;

    this.ctx.drawImage(
      this.image,
      drawX,
      drawY,
      scaledWidth,
      scaledHeight
    );
  }

  /**
   * Zoom by a factor, optionally centered on a point
   * @param {number} factor - Zoom factor (e.g., 1.07 for zoom in)
   * @param {number} centerX - X coordinate to zoom towards
   * @param {number} centerY - Y coordinate to zoom towards
   */
  zoom(factor, centerX = null, centerY = null) {
    // Don't zoom if no image is loaded
    if (!this.image) {
      return;
    }

    if (this.zoomMode === 'auto') {
      // Switch to manual mode on first zoom
      // Calculate current auto-fit scale and position to maintain visual continuity
      this.zoomMode = 'manual';

      const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
      const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

      const imgRatio = this.image.width / this.image.height;
      const canvasRatio = canvasWidth / canvasHeight;

      // Calculate the current auto-fit zoom factor and position
      let currentScale, currentX, currentY;

      if (imgRatio > canvasRatio) {
        // Image is wider - scaled to fit width
        currentScale = canvasWidth / this.image.width;
        currentX = 0;
        currentY = (canvasHeight - this.image.height * currentScale) / 2;
      } else {
        // Image is taller - scaled to fit height
        currentScale = canvasHeight / this.image.height;
        currentX = (canvasWidth - this.image.width * currentScale) / 2;
        currentY = 0;
      }

      // Use current auto-fit scale and position as starting point
      this.zoomFactor = currentScale;
      this.pan.x = currentX;
      this.pan.y = currentY;
    }

    const oldZoom = this.zoomFactor;
    this.zoomFactor = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoomFactor * factor));

    // Zoom towards cursor if coordinates provided
    if (centerX !== null && centerY !== null) {
      const zoomRatio = this.zoomFactor / oldZoom;
      this.pan.x = centerX - (centerX - this.pan.x) * zoomRatio;
      this.pan.y = centerY - (centerY - this.pan.y) * zoomRatio;
    }

    this.render();
  }

  /**
   * Set zoom factor directly
   * @param {number} factor - Zoom factor
   */
  setZoomFactor(factor) {
    this.zoomMode = 'manual';
    this.zoomFactor = Math.max(this.minZoom, Math.min(this.maxZoom, factor));
    this.render();
  }

  /**
   * Reset to 1:1 zoom
   */
  resetZoom() {
    this.zoomMode = 'manual';
    this.zoomFactor = 1;

    // Center image
    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

    this.pan.x = (canvasWidth - this.image.width) / 2;
    this.pan.y = (canvasHeight - this.image.height) / 2;

    this.render();
  }

  /**
   * Switch to auto-fit mode
   */
  autoFit() {
    this.zoomMode = 'auto';
    this.pan = { x: 0, y: 0 };
    this.render();
  }

  /**
   * Set pan position
   * @param {number} x - X offset
   * @param {number} y - Y offset
   */
  setPan(x, y) {
    this.pan.x = x;
    this.pan.y = y;
    this.render();
  }

  /**
   * Get current state for serialization
   * @returns {object} State object
   */
  getState() {
    return {
      imagePath: this.imagePath,
      zoomMode: this.zoomMode,
      zoomFactor: this.zoomFactor,
      pan: { ...this.pan }
    };
  }

  /**
   * Restore state from serialized data
   * @param {object} state - State object
   */
  async setState(state) {
    if (state.imagePath && state.imagePath !== this.imagePath) {
      await this.loadImage(state.imagePath);
    }

    this.zoomMode = state.zoomMode || 'auto';
    this.zoomFactor = state.zoomFactor || 1;
    this.pan = state.pan || { x: 0, y: 0 };

    this.render();
  }

  /**
   * Show loading overlay
   * @param {string} message - Loading message
   */
  showLoadingOverlay(message) {
    // Remove existing overlay if present
    this.hideLoadingOverlay();

    const overlay = document.createElement('div');
    overlay.className = 'canvas-loading-overlay';
    overlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 16px;
      z-index: 1000;
    `;
    overlay.innerHTML = `
      <div style="text-align: center;">
        <div style="font-size: 32px; margin-bottom: 16px;">⏳</div>
        <div>${message}</div>
      </div>
    `;

    this.container.appendChild(overlay);
  }

  /**
   * Hide loading overlay
   */
  hideLoadingOverlay() {
    const overlay = this.container.querySelector('.canvas-loading-overlay');
    if (overlay) {
      overlay.remove();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }

    this.canvas.remove();
  }
}
