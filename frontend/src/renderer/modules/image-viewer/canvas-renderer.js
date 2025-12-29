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
    this.imagePath = null; // Path to loaded image (may be converted JPG)
    this.originalImagePath = null; // Original path (e.g., NEF file before conversion)

    // Zoom/pan state
    this.zoomMode = 'auto'; // 'auto' | 'manual'
    this.zoomFactor = 1;
    this.minZoom = 0.01; // Allow zooming out to 1% (was 0.1 = 10%)
    this.maxZoom = 10;
    this.zoomStep = 1.15; // 15% zoom per step (will be user-configurable in Phase 4)

    this.pan = { x: 0, y: 0 };
    this.isPanning = false;
    this.lastPanPoint = null;

    // Mouse tracking for zoom-to-cursor
    this.mousePos = { x: 0, y: 0 };

    // Face detection overlays
    this.faces = []; // Array of {bounding_box, person_name, confidence}
    this.faceBoxMode = 'all'; // 'none' | 'single' | 'all'
    this.activeFaceIndex = 0; // Index of active face for 'single' mode
    this.previousFaceBoxMode = 'all'; // For toggling between modes

    // Label collision avoidance settings (will be user-configurable in Phase 4)
    this.labelBufferRatio = 0.005; // Buffer as % of image width (0.5%)
    this.labelMinBuffer = 10; // Minimum buffer in pixels

    // Auto-center on active face (will be user-configurable in Phase 4)
    this.autoCenterOnFace = false; // Auto-center viewport when active face changes

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
    // Store original path
    const originalPath = filepath;
    let loadPath = filepath;

    // Check if NEF file - convert to JPG first
    if (filepath.toLowerCase().endsWith('.nef')) {
      try {
        console.log('[CanvasRenderer] NEF file detected, converting...');
        this.showLoadingOverlay('Converting NEF file...');
        const jpgPath = await window.bildvisareAPI.invoke('convert-nef', filepath);
        console.log('[CanvasRenderer] NEF converted to:', jpgPath);
        this.hideLoadingOverlay();
        loadPath = jpgPath; // Use converted JPG for loading
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
        this.imagePath = loadPath; // Path to loaded image (converted JPG if NEF)
        this.originalImagePath = originalPath; // Original path (NEF if converted)

        // Reset to auto-fit mode
        this.zoomMode = 'auto';
        this.zoomFactor = 1;
        this.pan = { x: 0, y: 0 };

        this.render();
        resolve();
      };

      img.onerror = (err) => {
        console.error('[CanvasRenderer] Failed to load image:', loadPath, err);
        reject(new Error(`Failed to load image: ${loadPath}`));
      };

      // Handle file:// protocol
      const imageSrc = loadPath.startsWith('file://') ? loadPath : 'file://' + loadPath;
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

    // Draw face bounding boxes on top
    this.drawFaceBoxes();
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

    // Draw face bounding boxes on top
    this.drawFaceBoxes();
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
      pan: { ...this.pan },
      faces: this.faces ? [...this.faces] : [],
      faceBoxMode: this.faceBoxMode,
      activeFaceIndex: this.activeFaceIndex
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
    this.faces = state.faces || [];
    this.faceBoxMode = state.faceBoxMode || 'all';
    this.activeFaceIndex = state.activeFaceIndex || 0;

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
   * Set detected faces for overlay display
   * @param {Array} faces - Array of face objects with bounding_box, person_name, confidence
   */
  setFaces(faces) {
    this.faces = faces || [];
    this.render(); // Re-render to show boxes
  }

  /**
   * Toggle face bounding boxes on/off
   */
  /**
   * Toggle between single and all bounding boxes (lowercase 'b')
   */
  toggleSingleAll() {
    if (this.faceBoxMode === 'single') {
      this.faceBoxMode = 'all';
    } else if (this.faceBoxMode === 'all') {
      this.faceBoxMode = 'single';
    } else {
      // If currently 'none', switch to 'all'
      this.faceBoxMode = 'all';
    }
    console.log(`[CanvasRenderer] Face box mode: ${this.faceBoxMode}`);
    this.render();
  }

  /**
   * Toggle between none and previous mode (uppercase 'B')
   */
  toggleOnOff() {
    if (this.faceBoxMode === 'none') {
      // Restore to previous mode (default to 'all')
      this.faceBoxMode = this.previousFaceBoxMode || 'all';
    } else {
      // Save current mode and switch to 'none'
      this.previousFaceBoxMode = this.faceBoxMode;
      this.faceBoxMode = 'none';
    }
    console.log(`[CanvasRenderer] Face box mode: ${this.faceBoxMode}`);
    this.render();
  }

  /**
   * Center viewport on active face
   * Only works in manual zoom mode (not auto-fit)
   */
  centerOnActiveFace() {
    // Only center if we have faces and are in manual zoom mode
    if (!this.faces || this.faces.length === 0 || this.zoomMode === 'auto') {
      console.log('[CanvasRenderer] Cannot center: no faces or in auto-fit mode');
      return;
    }

    const face = this.faces[this.activeFaceIndex];
    if (!face) {
      console.log('[CanvasRenderer] Cannot center: no face at active index');
      return;
    }

    const bbox = face.bounding_box;

    // Calculate face center in image coordinates
    const faceCenterX = bbox.x + bbox.width / 2;
    const faceCenterY = bbox.y + bbox.height / 2;

    // Get canvas dimensions
    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

    // Calculate viewport center in canvas coordinates
    const viewportCenterX = canvasWidth / 2;
    const viewportCenterY = canvasHeight / 2;

    // Calculate required pan to center face
    // pan.x/y represents top-left corner of the image in canvas coordinates
    // We want: faceCenterX * zoomFactor + pan.x = viewportCenterX
    this.pan.x = viewportCenterX - (faceCenterX * this.zoomFactor);
    this.pan.y = viewportCenterY - (faceCenterY * this.zoomFactor);

    console.log(`[CanvasRenderer] Centered on face ${this.activeFaceIndex + 1}`);
    this.render();
  }

  /**
   * Toggle auto-center on face feature
   * @param {boolean} enable - True to enable, false to disable, undefined to toggle
   */
  toggleAutoCenterOnFace(enable) {
    if (enable === undefined) {
      this.autoCenterOnFace = !this.autoCenterOnFace;
    } else {
      this.autoCenterOnFace = enable;
    }

    console.log(`[CanvasRenderer] Auto-center on face: ${this.autoCenterOnFace ? 'enabled' : 'disabled'}`);

    // If enabling, center immediately
    if (this.autoCenterOnFace) {
      this.centerOnActiveFace();
    }
  }

  /**
   * Set active face index for 'single' mode
   * If auto-center is enabled, centers viewport on new face
   */
  setActiveFaceIndex(index) {
    this.activeFaceIndex = index;

    // Auto-center on new face if enabled
    if (this.autoCenterOnFace) {
      this.centerOnActiveFace();
    }

    if (this.faceBoxMode === 'single') {
      this.render();
    }
  }

  /**
   * Draw face bounding boxes on the canvas
   */
  /**
   * Check if two boxes overlap with buffer zone
   * @param {Object} box1 - {x, y, width, height}
   * @param {Object} box2 - {x, y, width, height}
   * @param {number} buffer - Buffer zone in pixels
   * @returns {boolean} True if boxes overlap
   */
  boxesOverlap(box1, box2, buffer = 20) {
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

  /**
   * Calculate intersection point of line from box center to external point with box edge
   * @param {Object} box - {x, y, width, height}
   * @param {number} externalX - External point x
   * @param {number} externalY - External point y
   * @returns {Object} {x, y} intersection point on box edge
   */
  getBoxEdgeIntersection(box, externalX, externalY) {
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;

    // Direction vector from center to external point
    const dx = externalX - centerX;
    const dy = externalY - centerY;

    // Avoid division by zero
    if (dx === 0 && dy === 0) {
      return { x: centerX, y: centerY };
    }

    // Calculate intersection with each edge
    const intersections = [];

    // Top edge (y = box.y)
    if (dy < 0) {
      const t = (box.y - centerY) / dy;
      const x = centerX + t * dx;
      if (x >= box.x && x <= box.x + box.width) {
        intersections.push({ x, y: box.y, dist: Math.abs(t) });
      }
    }

    // Bottom edge (y = box.y + box.height)
    if (dy > 0) {
      const t = (box.y + box.height - centerY) / dy;
      const x = centerX + t * dx;
      if (x >= box.x && x <= box.x + box.width) {
        intersections.push({ x, y: box.y + box.height, dist: Math.abs(t) });
      }
    }

    // Left edge (x = box.x)
    if (dx < 0) {
      const t = (box.x - centerX) / dx;
      const y = centerY + t * dy;
      if (y >= box.y && y <= box.y + box.height) {
        intersections.push({ x: box.x, y, dist: Math.abs(t) });
      }
    }

    // Right edge (x = box.x + box.width)
    if (dx > 0) {
      const t = (box.x + box.width - centerX) / dx;
      const y = centerY + t * dy;
      if (y >= box.y && y <= box.y + box.height) {
        intersections.push({ x: box.x + box.width, y, dist: Math.abs(t) });
      }
    }

    // Return the closest intersection (should typically be only one)
    if (intersections.length > 0) {
      intersections.sort((a, b) => a.dist - b.dist);
      return { x: intersections[0].x, y: intersections[0].y };
    }

    // Fallback to center (shouldn't happen)
    return { x: centerX, y: centerY };
  }

  /**
   * Find optimal label position avoiding collisions
   * @param {Object} faceBox - Face bounding box in canvas coords {x, y, width, height}
   * @param {number} labelWidth - Label width
   * @param {number} labelHeight - Label height
   * @param {Array} placedBoxes - Array of already placed boxes
   * @param {number} canvasWidth - Canvas width
   * @param {number} canvasHeight - Canvas height
   * @param {number} imageWidth - Original image width for scaling buffer
   * @returns {Object} {x, y} position for label
   */
  findLabelPosition(faceBox, labelWidth, labelHeight, placedBoxes, canvasWidth, canvasHeight, imageWidth, imageHeight, imageX, imageY, imageScale) {
    // Scale buffer based on DISPLAYED image size (not original)
    // Buffer is in canvas coordinates, so must use scaled size
    // Uses configurable ratio (default: 0.5% of displayed width)
    // Examples: 0.5% of 1000px displayed = 5px buffer, 0.5% of 2000px = 10px
    const displayedWidth = imageWidth * imageScale;
    const buffer = Math.max(
      this.labelMinBuffer,
      Math.floor(displayedWidth * this.labelBufferRatio)
    );

    const faceCenterX = faceBox.x + faceBox.width / 2;
    const faceCenterY = faceBox.y + faceBox.height / 2;

    // Calculate image bounds in canvas coordinates
    const imageBounds = {
      left: imageX,
      top: imageY,
      right: imageX + imageWidth * imageScale,
      bottom: imageY + imageHeight * imageScale
    };

    // Try circular search pattern - increasing radius from face center
    const maxRadius = Math.max(canvasWidth, canvasHeight) * 2;
    const startRadius = Math.max(faceBox.width, faceBox.height) / 2 + 20;

    let bestPosition = null;
    let bestOutside = null; // Track best position outside image as fallback

    for (let radius = startRadius; radius < maxRadius; radius += 25) {
      // Try angles from 0° to 360° in 15° steps
      for (let angle = 0; angle < 360; angle += 15) {
        const radians = (angle * Math.PI) / 180;
        const labelX = Math.floor(faceCenterX + radius * Math.cos(radians) - labelWidth / 2);
        const labelY = Math.floor(faceCenterY + radius * Math.sin(radians) - labelHeight / 2);

        const labelBox = {
          x: labelX,
          y: labelY,
          width: labelWidth,
          height: labelHeight
        };

        // Check for collision with all placed boxes
        let collision = false;
        for (const box of placedBoxes) {
          if (this.boxesOverlap(labelBox, box, buffer)) {
            collision = true;
            break;
          }
        }

        if (!collision) {
          // Check if label is within image bounds
          const withinBounds = (
            labelX >= imageBounds.left &&
            labelY >= imageBounds.top &&
            labelX + labelWidth <= imageBounds.right &&
            labelY + labelHeight <= imageBounds.bottom
          );

          if (withinBounds) {
            // Prefer positions within image bounds
            return { x: labelX, y: labelY, outsideImage: false };
          } else if (!bestOutside) {
            // Track first valid position outside image as fallback
            bestOutside = { x: labelX, y: labelY, outsideImage: true };
          }
        }
      }
    }

    // Return best outside position if found, otherwise fallback to above face
    if (bestOutside) {
      return bestOutside;
    }

    return {
      x: faceBox.x,
      y: faceBox.y - labelHeight - 10,
      outsideImage: true
    };
  }

  drawFaceBoxes() {
    // Check mode - return early if 'none' or no faces
    if (this.faceBoxMode === 'none' || !this.faces || this.faces.length === 0) {
      return;
    }

    if (!this.image) {
      return;
    }

    const canvasWidth = this.canvas.width / (window.devicePixelRatio || 1);
    const canvasHeight = this.canvas.height / (window.devicePixelRatio || 1);

    // Calculate image position and scale
    let imageScale, imageX, imageY;

    if (this.zoomMode === 'auto') {
      // Auto-fit mode
      const imgRatio = this.image.width / this.image.height;
      const canvasRatio = canvasWidth / canvasHeight;

      if (imgRatio > canvasRatio) {
        // Image is wider than canvas
        imageScale = canvasWidth / this.image.width;
        imageX = 0;
        imageY = (canvasHeight - this.image.height * imageScale) / 2;
      } else {
        // Image is taller than canvas
        imageScale = canvasHeight / this.image.height;
        imageX = (canvasWidth - this.image.width * imageScale) / 2;
        imageY = 0;
      }
    } else {
      // Manual zoom mode
      imageScale = this.zoomFactor;
      imageX = this.pan.x;
      imageY = this.pan.y;
    }

    // Determine which faces to draw based on mode
    let facesToDraw = this.faces;
    if (this.faceBoxMode === 'single') {
      // Only draw the active face
      facesToDraw = this.faces[this.activeFaceIndex] ? [this.faces[this.activeFaceIndex]] : [];
    }

    // First pass: calculate all label positions with collision avoidance
    this.ctx.font = '16px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    const placedBoxes = [];
    const placements = [];

    facesToDraw.forEach(face => {
      const bbox = face.bounding_box;

      // Transform bounding box coordinates to canvas space
      const faceX = imageX + bbox.x * imageScale;
      const faceY = imageY + bbox.y * imageScale;
      const faceWidth = bbox.width * imageScale;
      const faceHeight = bbox.height * imageScale;

      const faceBox = {
        x: faceX,
        y: faceY,
        width: faceWidth,
        height: faceHeight
      };

      // Add face box to placed boxes
      placedBoxes.push(faceBox);

      // Calculate label dimensions
      let labelPos = null;
      let labelWidth = 0;
      let labelHeight = 0;

      if (face.person_name) {
        const confidence = face.confidence || 0;
        const label = `${face.person_name} (${(confidence * 100).toFixed(0)}%)`;
        const metrics = this.ctx.measureText(label);
        labelWidth = metrics.width + 8; // padding
        labelHeight = 24; // text height + padding

        // Find optimal position avoiding collisions
        labelPos = this.findLabelPosition(
          faceBox,
          labelWidth,
          labelHeight,
          placedBoxes,
          canvasWidth,
          canvasHeight,
          this.image.width, // Original image width for buffer scaling
          this.image.height, // Original image height
          imageX, // Image position in canvas
          imageY,
          imageScale // Image scale factor
        );

        // Add label box to placed boxes for future collision checks
        placedBoxes.push({
          x: labelPos.x,
          y: labelPos.y,
          width: labelWidth,
          height: labelHeight
        });
      }

      // Store placement info
      placements.push({
        face: face,
        faceBox: faceBox,
        label: face.person_name ? `${face.person_name} (${((face.confidence || 0) * 100).toFixed(0)}%)` : null,
        labelPos: labelPos,
        labelWidth: labelWidth,
        labelHeight: labelHeight
      });
    });

    // TODO Phase 4: Extended bounds for auto-fit
    // When labels extend outside image in auto-fit mode, we should:
    // 1. Calculate bounding box of all elements (image + labels)
    // 2. Recalculate scale/position to fit everything
    // 3. Redraw with adjusted viewport
    // This requires a two-pass algorithm and is deferred to Phase 4
    // Current behavior: labels may extend outside visible area in auto-fit mode

    // Second pass: draw everything
    this.ctx.lineWidth = 3;

    placements.forEach(placement => {
      const { face, faceBox, label, labelPos, labelWidth, labelHeight } = placement;

      // Choose color based on confidence
      const confidence = face.confidence || 0;
      let strokeColor, textBgColor;

      if (confidence > 0.9) {
        strokeColor = '#4caf50'; // Green for high confidence
        textBgColor = 'rgba(76, 175, 80, 0.9)';
      } else if (confidence > 0.6) {
        strokeColor = '#ff9800'; // Orange for medium confidence
        textBgColor = 'rgba(255, 152, 0, 0.9)';
      } else {
        strokeColor = '#f44336'; // Red for low confidence
        textBgColor = 'rgba(244, 67, 54, 0.9)';
      }

      // Draw bounding box
      this.ctx.strokeStyle = strokeColor;
      this.ctx.strokeRect(faceBox.x, faceBox.y, faceBox.width, faceBox.height);

      // Draw label if person has a name
      if (label && labelPos) {
        // Draw connecting line from face BOX EDGE to label center (not face center - avoid obscuring face)
        const labelCenterX = labelPos.x + labelWidth / 2;
        const labelCenterY = labelPos.y + labelHeight / 2;

        // Calculate where line intersects face box edge
        const edgePoint = this.getBoxEdgeIntersection(faceBox, labelCenterX, labelCenterY);

        this.ctx.strokeStyle = '#ffeb3b'; // Yellow line
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        this.ctx.moveTo(edgePoint.x, edgePoint.y); // Start from box edge, not center
        this.ctx.lineTo(labelCenterX, labelCenterY);
        this.ctx.stroke();

        // Draw label background
        this.ctx.fillStyle = textBgColor;
        this.ctx.fillRect(labelPos.x, labelPos.y, labelWidth, labelHeight);

        // Draw label text
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(label, labelPos.x + 4, labelPos.y + 17);

        // Reset line width
        this.ctx.lineWidth = 3;
      }
    });
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
