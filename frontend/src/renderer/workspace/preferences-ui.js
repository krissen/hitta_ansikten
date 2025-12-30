/**
 * Preferences UI Modal
 *
 * Modal dialog for editing user preferences.
 */

import { preferences } from './preferences.js';

export class PreferencesUI {
  constructor() {
    this.modal = null;
    this.tempPrefs = null; // Temporary preferences (not saved until user clicks Save)
  }

  /**
   * Show preferences modal
   */
  show() {
    // Create temporary copy of preferences
    this.tempPrefs = preferences.getAll();

    // Create modal if it doesn't exist
    if (!this.modal) {
      this.createModal();
    }

    // Populate form with current values
    this.populateForm();

    // Show modal
    this.modal.style.display = 'flex';
  }

  /**
   * Hide preferences modal (cancels without saving)
   * @param {boolean} wasSaved - true if hide was called after saving
   */
  hide(wasSaved = false) {
    if (this.modal) {
      this.modal.style.display = 'none';
      // Dispatch cancel event to restore original preferences (only if not saved)
      if (!wasSaved) {
        window.dispatchEvent(new CustomEvent('preferences-cancelled'));
      }
    }
  }

  /**
   * Create modal DOM structure
   */
  createModal() {
    // Create modal overlay
    this.modal = document.createElement('div');
    this.modal.className = 'preferences-modal';
    this.modal.style.display = 'none';

    this.modal.innerHTML = `
      <div class="preferences-overlay"></div>
      <div class="preferences-dialog">
        <div class="preferences-header">
          <h2>Preferences</h2>
          <button class="btn-close" title="Close">&times;</button>
        </div>

        <!-- Tab Navigation -->
        <div class="pref-tabs">
          <button class="pref-tab active" data-tab="general">General</button>
          <button class="pref-tab" data-tab="appearance">Appearance</button>
          <button class="pref-tab" data-tab="layout">Layout</button>
          <button class="pref-tab" data-tab="image-viewer">Image Viewer</button>
          <button class="pref-tab" data-tab="review">Review</button>
        </div>

        <div class="preferences-content">
          <!-- General Tab Panel -->
          <div class="pref-tab-panel active" data-tab="general">
            <!-- Backend Settings -->
            <div class="pref-section">
              <h3>Backend Settings</h3>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-backend-autoStart" />
                Auto-start backend server
              </label>
            </div>

            <div class="pref-field">
              <label>Server Port</label>
              <input type="number" id="pref-backend-port" min="1024" max="65535" />
              <small>Default: 5001. Requires app restart.</small>
            </div>

            <div class="pref-field">
              <label>Python Path</label>
              <input type="text" id="pref-backend-pythonPath" />
              <small>Path to Python interpreter. Requires app restart.</small>
            </div>
          </div>

          <!-- UI Settings -->
          <div class="pref-section">
            <h3>User Interface</h3>

            <div class="pref-field">
              <label>Theme</label>
              <select id="pref-ui-theme">
                <option value="light">Light</option>
                <option value="dark">Dark (future)</option>
              </select>
            </div>

            <div class="pref-field">
              <label>Default Layout</label>
              <select id="pref-ui-defaultLayout">
                <option value="standard">Standard</option>
                <option value="compact">Compact (future)</option>
                <option value="review-focused">Review-Focused (future)</option>
              </select>
            </div>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-ui-showWelcome" />
                Show welcome message on startup
              </label>
            </div>

            <div class="pref-field">
              <label>Log Level</label>
              <select id="pref-ui-logLevel">
                <option value="debug">Debug (verbose)</option>
                <option value="info">Info</option>
                <option value="warn">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
          </div>
          </div>

          <!-- Appearance Tab Panel -->
          <div class="pref-tab-panel" data-tab="appearance">
            <div class="pref-section">
              <h3>Appearance</h3>

            <div class="pref-field">
              <label>Tab Height (px)</label>
              <div class="slider-input-group">
                <input type="range" id="pref-appearance-tabsHeight-slider" min="20" max="40" step="1" />
                <input type="number" id="pref-appearance-tabsHeight" min="20" max="40" step="1" />
              </div>
              <small>Height of panel tabs.</small>
            </div>

            <div class="pref-field">
              <label>Tab Font Size (px)</label>
              <div class="slider-input-group">
                <input type="range" id="pref-appearance-tabsFontSize-slider" min="10" max="16" step="1" />
                <input type="number" id="pref-appearance-tabsFontSize" min="10" max="16" step="1" />
              </div>
              <small>Font size of tab text.</small>
            </div>

            <div class="pref-field">
              <label>Tab Padding Left (px)</label>
              <div class="slider-input-group">
                <input type="range" id="pref-appearance-tabPaddingLeft-slider" min="0" max="20" step="1" />
                <input type="number" id="pref-appearance-tabPaddingLeft" min="0" max="20" step="1" />
              </div>
              <small>Left padding inside tabs.</small>
            </div>

            <div class="pref-field">
              <label>Tab Padding Right (px)</label>
              <div class="slider-input-group">
                <input type="range" id="pref-appearance-tabPaddingRight-slider" min="0" max="20" step="1" />
                <input type="number" id="pref-appearance-tabPaddingRight" min="0" max="20" step="1" />
              </div>
              <small>Right padding inside tabs.</small>
            </div>

            <div class="pref-field">
              <label>Tab Min Gap (px)</label>
              <div class="slider-input-group">
                <input type="range" id="pref-appearance-tabMinGap-slider" min="0" max="30" step="1" />
                <input type="number" id="pref-appearance-tabMinGap" min="0" max="30" step="1" />
              </div>
              <small>Minimum space between text and close button.</small>
            </div>

            <div class="pref-section">
              <h3>Tab Colors</h3>
              <small style="display:block; margin-bottom:12px; color:#666;">
                Focused = active panel's tab. Visible = other panels' tabs. Hidden = background tabs.
              </small>

              <!-- Focused Tab (selected tab in focused panel) -->
              <div class="pref-field-row">
                <div class="pref-field-color">
                  <label>Focused Tab Background</label>
                  <input type="color" id="pref-appearance-focusedTabBackground" />
                </div>
                <div class="pref-field-color">
                  <label>Focused Tab Text</label>
                  <input type="color" id="pref-appearance-focusedTabColor" />
                </div>
              </div>

              <!-- Visible Tab (selected tab in non-focused panels) -->
              <div class="pref-field-row">
                <div class="pref-field-color">
                  <label>Visible Tab Background</label>
                  <input type="color" id="pref-appearance-visibleTabBackground" />
                </div>
                <div class="pref-field-color">
                  <label>Visible Tab Text</label>
                  <input type="color" id="pref-appearance-visibleTabColor" />
                </div>
              </div>

              <!-- Hidden Tab (unselected/background tabs) -->
              <div class="pref-field-row">
                <div class="pref-field-color">
                  <label>Hidden Tab Background</label>
                  <input type="color" id="pref-appearance-hiddenTabBackground" />
                </div>
                <div class="pref-field-color">
                  <label>Hidden Tab Text</label>
                  <input type="color" id="pref-appearance-hiddenTabColor" />
                </div>
              </div>

              <!-- Container Colors -->
              <div class="pref-field-row">
                <div class="pref-field-color">
                  <label>Tab Container Background</label>
                  <input type="color" id="pref-appearance-tabContainerBackground" />
                </div>
                <div class="pref-field-color">
                  <label>Group Border Color</label>
                  <input type="color" id="pref-appearance-groupBorderColor" />
                </div>
              </div>
            </div>
          </div>
          </div>

          <!-- Layout Tab Panel -->
          <div class="pref-tab-panel" data-tab="layout">
            <div class="pref-section">
              <h3>Default Layout Settings</h3>

              <div class="pref-field">
                <label>Default Layout Template</label>
                <select id="pref-layout-defaultTemplate">
                  <option value="review">Review Mode</option>
                  <option value="comparison">Comparison Mode</option>
                  <option value="full-image">Full Image</option>
                  <option value="stats">Statistics Mode</option>
                </select>
                <small>Layout to use when resetting or first launch.</small>
              </div>

              <div class="pref-field">
                <label>Default Grid Preset</label>
                <select id="pref-layout-defaultGridPreset">
                  <option value="50-50">50% / 50%</option>
                  <option value="60-40">60% / 40%</option>
                  <option value="70-30">70% / 30%</option>
                  <option value="30-70">30% / 70%</option>
                  <option value="40-60">40% / 60%</option>
                </select>
                <small>Default panel size ratio for new layouts.</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-layout-autoSaveLayout" />
                  Auto-save layout on changes
                </label>
                <small>Automatically save panel positions and sizes when changed.</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-layout-rememberPanelSizes" />
                  Remember panel sizes across sessions
                </label>
                <small>Restore exact panel dimensions when reopening the application.</small>
              </div>
            </div>
          </div>

          <!-- Image Viewer Tab Panel -->
          <div class="pref-tab-panel" data-tab="image-viewer">
            <div class="pref-section">
              <h3>Image Viewer</h3>

            <div class="pref-field">
              <label>Zoom Speed</label>
              <div class="slider-input-group">
                <input type="range" id="pref-imageViewer-zoomSpeed-slider" step="0.01" min="1.01" max="2.0" />
                <input type="number" id="pref-imageViewer-zoomSpeed" step="0.01" min="1.01" max="2.0" />
              </div>
              <small>Zoom multiplier per step (1.07 = 7% per step)</small>
            </div>

            <div class="pref-field">
              <label>Maximum Zoom</label>
              <div class="slider-input-group">
                <input type="range" id="pref-imageViewer-maxZoom-slider" step="1" min="1" max="50" />
                <input type="number" id="pref-imageViewer-maxZoom" step="1" min="1" max="50" />
              </div>
              <small>Maximum zoom level</small>
            </div>

            <div class="pref-field">
              <label>Minimum Zoom</label>
              <div class="slider-input-group">
                <input type="range" id="pref-imageViewer-minZoom-slider" step="0.01" min="0.01" max="1" />
                <input type="number" id="pref-imageViewer-minZoom" step="0.01" min="0.01" max="1" />
              </div>
              <small>Minimum zoom level</small>
            </div>

            <div class="pref-field">
              <label>Default Zoom Mode</label>
              <select id="pref-imageViewer-defaultZoomMode">
                <option value="auto-fit">Auto-fit (fit to window)</option>
                <option value="1:1">1:1 (actual size)</option>
              </select>
            </div>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-imageViewer-smoothPan" />
                Smooth panning animation
              </label>
            </div>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-imageViewer-showPixelGrid" />
                Show pixel grid at high zoom (future)
              </label>
            </div>
          </div>
          </div>

          <!-- Review Tab Panel -->
          <div class="pref-tab-panel" data-tab="review">
            <div class="pref-section">
              <h3>Review Module</h3>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-reviewModule-autoSaveOnComplete" />
                Auto-save when all faces reviewed
              </label>
            </div>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-reviewModule-confirmBeforeSave" />
                Ask confirmation before saving
              </label>
            </div>

            <div class="pref-field">
              <label>Action after confirming face</label>
              <select id="pref-reviewModule-defaultAction">
                <option value="next">Move to next face</option>
                <option value="stay">Stay on current face</option>
              </select>
            </div>

            <div class="pref-field">
              <label>
                <input type="checkbox" id="pref-reviewModule-showConfidenceScores" />
                Show confidence scores
              </label>
            </div>

            <div class="pref-field">
              <label>Save Mode</label>
              <select id="pref-reviewModule-saveMode">
                <option value="per-image">Per image (save all faces for each image)</option>
                <option value="per-face">Per face (save each face immediately)</option>
              </select>
              <small>How review results are written to database</small>
            </div>
          </div>
          </div>
        </div>

        <div class="preferences-footer">
          <button class="btn btn-secondary btn-reset">Reset to Defaults</button>
          <div class="preferences-actions">
            <button class="btn btn-secondary btn-cancel">Cancel</button>
            <button class="btn btn-primary btn-save">Save</button>
          </div>
        </div>
      </div>
    `;

    // Add styles
    this.addStyles();

    // Add event listeners
    this.addEventListeners();

    // Append to body
    document.body.appendChild(this.modal);
  }

  /**
   * Add CSS styles
   */
  addStyles() {
    const style = document.createElement('style');
    style.textContent = `
      .preferences-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
      }

      .preferences-overlay {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
      }

      .preferences-dialog {
        position: relative;
        background: white;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        width: 90%;
        max-width: 700px;
        max-height: 85vh;
        display: flex;
        flex-direction: column;
      }

      .preferences-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 20px 24px;
        border-bottom: 1px solid #e0e0e0;
      }

      .preferences-header h2 {
        margin: 0;
        font-size: 20px;
        font-weight: 600;
      }

      .btn-close {
        background: none;
        border: none;
        font-size: 28px;
        line-height: 1;
        cursor: pointer;
        color: #666;
        padding: 0;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 4px;
      }

      .btn-close:hover {
        background: #f0f0f0;
        color: #333;
      }

      .preferences-content {
        flex: 1;
        overflow-y: auto;
        padding: 24px;
      }

      .pref-section {
        margin-bottom: 32px;
      }

      .pref-section:last-child {
        margin-bottom: 0;
      }

      .pref-section h3 {
        margin: 0 0 16px 0;
        font-size: 16px;
        font-weight: 600;
        color: #333;
        border-bottom: 1px solid #e0e0e0;
        padding-bottom: 8px;
      }

      .pref-field {
        margin-bottom: 16px;
      }

      .pref-field:last-child {
        margin-bottom: 0;
      }

      .pref-field label {
        display: block;
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 6px;
        color: #555;
      }

      .pref-field input[type="checkbox"] {
        margin-right: 8px;
      }

      .pref-field input[type="text"],
      .pref-field input[type="number"],
      .pref-field select {
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-size: 14px;
        font-family: inherit;
      }

      .pref-field input[type="text"]:focus,
      .pref-field input[type="number"]:focus,
      .pref-field select:focus {
        outline: none;
        border-color: #2196f3;
      }

      .pref-field small {
        display: block;
        margin-top: 4px;
        font-size: 12px;
        color: #777;
      }

      .pref-field-row {
        display: flex;
        gap: 16px;
        margin-bottom: 16px;
      }

      .pref-field-color {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .pref-field-color label {
        font-size: 14px;
        font-weight: 500;
        color: #555;
      }

      .pref-field-color input[type="color"] {
        height: 40px;
        border: 1px solid #ddd;
        border-radius: 4px;
        cursor: pointer;
        padding: 2px;
      }

      .pref-field-color input[type="color"]::-webkit-color-swatch-wrapper {
        padding: 2px;
      }

      .pref-field-color input[type="color"]::-webkit-color-swatch {
        border: none;
        border-radius: 2px;
      }

      .slider-input-group {
        display: flex;
        gap: 12px;
        align-items: center;
      }

      .slider-input-group input[type="range"] {
        flex: 1;
        height: 6px;
        border-radius: 3px;
        background: #e0e0e0;
        outline: none;
        -webkit-appearance: none;
      }

      .slider-input-group input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none;
        appearance: none;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #2196f3;
        cursor: pointer;
      }

      .slider-input-group input[type="range"]::-moz-range-thumb {
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #2196f3;
        cursor: pointer;
        border: none;
      }

      .slider-input-group input[type="number"] {
        width: 80px;
        flex-shrink: 0;
      }

      .preferences-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 24px;
        border-top: 1px solid #e0e0e0;
      }

      .preferences-actions {
        display: flex;
        gap: 12px;
      }

      .btn {
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: background 0.2s;
      }

      .btn-primary {
        background: #2196f3;
        color: white;
      }

      .btn-primary:hover {
        background: #1976d2;
      }

      .btn-secondary {
        background: #f5f5f5;
        color: #333;
      }

      .btn-secondary:hover {
        background: #e0e0e0;
      }

      .btn-reset {
        color: #f44336;
      }

      .btn-reset:hover {
        background: #ffebee;
      }

      /* Tab Navigation */
      .pref-tabs {
        display: flex;
        gap: 4px;
        padding: 0 24px;
        border-bottom: 1px solid #e0e0e0;
        background: #f8f8f8;
      }

      .pref-tab {
        background: none;
        border: none;
        padding: 12px 20px;
        font-size: 14px;
        font-weight: 500;
        color: #666;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.2s, border-color 0.2s;
      }

      .pref-tab:hover {
        color: #333;
      }

      .pref-tab.active {
        color: #007acc;
        border-bottom-color: #007acc;
      }

      /* Tab Panels */
      .pref-tab-panel {
        display: none;
      }

      .pref-tab-panel.active {
        display: block;
      }
    `;
    this.modal.appendChild(style);
  }

  /**
   * Switch to a specific tab
   */
  switchTab(tabName) {
    // Update tab buttons
    this.modal.querySelectorAll('.pref-tab').forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
      } else {
        tab.classList.remove('active');
      }
    });

    // Update tab panels
    this.modal.querySelectorAll('.pref-tab-panel').forEach(panel => {
      if (panel.dataset.tab === tabName) {
        panel.classList.add('active');
      } else {
        panel.classList.remove('active');
      }
    });
  }

  /**
   * Add event listeners
   */
  addEventListeners() {
    // Tab switching
    this.modal.querySelectorAll('.pref-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const targetTab = tab.dataset.tab;
        this.switchTab(targetTab);
      });
    });

    // ESC key to cancel (same as cancel button)
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.modal && this.modal.style.display !== 'none') {
        this.hide();
      }
    });

    // Close button
    this.modal.querySelector('.btn-close').addEventListener('click', () => {
      this.hide();
    });

    // Click outside to close
    this.modal.querySelector('.preferences-overlay').addEventListener('click', () => {
      this.hide();
    });

    // Cancel button
    this.modal.querySelector('.btn-cancel').addEventListener('click', () => {
      this.hide();
    });

    // Save button
    this.modal.querySelector('.btn-save').addEventListener('click', () => {
      this.save();
    });

    // Reset button
    this.modal.querySelector('.btn-reset').addEventListener('click', () => {
      if (confirm('Reset all preferences to defaults?\n\nThis will discard your current settings.')) {
        this.reset();
      }
    });

    // Sync sliders with number inputs
    this.setupSliderSync('appearance-tabsHeight');
    this.setupSliderSync('appearance-tabsFontSize');
    this.setupSliderSync('appearance-tabPaddingLeft');
    this.setupSliderSync('appearance-tabPaddingRight');
    this.setupSliderSync('appearance-tabMinGap');
    this.setupSliderSync('imageViewer-zoomSpeed');
    this.setupSliderSync('imageViewer-maxZoom');
    this.setupSliderSync('imageViewer-minZoom');

    // Setup live preview for appearance settings
    this.setupLivePreview('appearance-tabsHeight', '--dv-tabs-height', 'px');
    this.setupLivePreview('appearance-tabsFontSize', '--dv-tabs-font-size', 'px');
    this.setupLivePreview('appearance-tabPaddingLeft', '--dv-tab-padding-left', 'px');
    this.setupLivePreview('appearance-tabPaddingRight', '--dv-tab-padding-right', 'px');
    this.setupLivePreview('appearance-tabMinGap', '--dv-tab-min-gap', 'px');

    // Setup live preview for color settings (three tab states)
    this.setupColorLivePreview('appearance-focusedTabBackground');
    this.setupColorLivePreview('appearance-focusedTabColor');
    this.setupColorLivePreview('appearance-visibleTabBackground');
    this.setupColorLivePreview('appearance-visibleTabColor');
    this.setupColorLivePreview('appearance-hiddenTabBackground');
    this.setupColorLivePreview('appearance-hiddenTabColor');
    this.setupColorLivePreview('appearance-tabContainerBackground');
    this.setupColorLivePreview('appearance-groupBorderColor', null, true);
  }

  /**
   * Setup bidirectional sync between slider and number input
   */
  setupSliderSync(id) {
    const slider = this.modal.querySelector(`#pref-${id}-slider`);
    const numberInput = this.modal.querySelector(`#pref-${id}`);

    if (!slider || !numberInput) return;

    // Slider -> number input
    slider.addEventListener('input', () => {
      numberInput.value = slider.value;
    });

    // Number input -> slider
    numberInput.addEventListener('input', () => {
      slider.value = numberInput.value;
    });
  }

  /**
   * Setup live preview for CSS variable changes
   */
  setupLivePreview(id, cssVariable, unit) {
    const slider = this.modal.querySelector(`#pref-${id}-slider`);
    const numberInput = this.modal.querySelector(`#pref-${id}`);

    if (!slider || !numberInput) return;

    const updateCSS = (value) => {
      // Update tempPrefs so Save button saves the correct value
      const path = id.replace(/-/g, '.');
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = this.tempPrefs;
      for (const key of keys) {
        if (!target[key]) target[key] = {};
        target = target[key];
      }
      target[lastKey] = parseFloat(value);

      // Dispatch event for live preview with full tempPrefs
      window.dispatchEvent(new CustomEvent('preferences-preview', {
        detail: { tempPrefs: this.tempPrefs }
      }));
    };

    // Update on slider change
    slider.addEventListener('input', () => {
      updateCSS(slider.value);
    });

    // Update on number input change
    numberInput.addEventListener('input', () => {
      updateCSS(numberInput.value);
    });
  }

  /**
   * Setup live preview for color CSS variable changes
   */
  setupColorLivePreview(id, cssVariable, isRgba = false) {
    const colorInput = this.modal.querySelector(`#pref-${id}`);

    if (!colorInput) return;

    const updateCSS = (value) => {
      let cssValue = value;

      // If this is an rgba color (groupBorderColor), convert hex to rgba
      if (isRgba) {
        const r = parseInt(value.slice(1, 3), 16);
        const g = parseInt(value.slice(3, 5), 16);
        const b = parseInt(value.slice(5, 7), 16);
        cssValue = `rgba(${r}, ${g}, ${b}, 0.2)`;
      }

      // Update tempPrefs so Save button saves the correct value
      const path = id.replace(/-/g, '.');
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = this.tempPrefs;
      for (const key of keys) {
        if (!target[key]) target[key] = {};
        target = target[key];
      }
      target[lastKey] = isRgba ? cssValue : value;

      // Dispatch event for live preview with full tempPrefs
      window.dispatchEvent(new CustomEvent('preferences-preview', {
        detail: { tempPrefs: this.tempPrefs }
      }));
    };

    // Update on color change
    colorInput.addEventListener('input', () => {
      updateCSS(colorInput.value);
    });
  }

  /**
   * Convert rgba string to hex color
   */
  rgbaToHex(rgba) {
    // Extract rgba values
    const match = rgba.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!match) return rgba; // Return as-is if not rgba

    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    return '#' + [r, g, b].map(x => {
      const hex = x.toString(16);
      return hex.length === 1 ? '0' + hex : hex;
    }).join('');
  }

  /**
   * Populate form with current preference values
   */
  populateForm() {
    // Backend settings
    this.setValue('backend-autoStart', this.tempPrefs.backend.autoStart);
    this.setValue('backend-port', this.tempPrefs.backend.port);
    this.setValue('backend-pythonPath', this.tempPrefs.backend.pythonPath);

    // UI settings
    this.setValue('ui-theme', this.tempPrefs.ui.theme);
    this.setValue('ui-defaultLayout', this.tempPrefs.ui.defaultLayout);
    this.setValue('ui-showWelcome', this.tempPrefs.ui.showWelcome);
    this.setValue('ui-logLevel', this.tempPrefs.ui.logLevel);

    // Appearance settings - sizes
    this.setValue('appearance-tabsHeight', this.tempPrefs.appearance.tabsHeight);
    this.setValue('appearance-tabsHeight-slider', this.tempPrefs.appearance.tabsHeight);
    this.setValue('appearance-tabsFontSize', this.tempPrefs.appearance.tabsFontSize);
    this.setValue('appearance-tabsFontSize-slider', this.tempPrefs.appearance.tabsFontSize);
    this.setValue('appearance-tabPaddingLeft', this.tempPrefs.appearance.tabPaddingLeft);
    this.setValue('appearance-tabPaddingLeft-slider', this.tempPrefs.appearance.tabPaddingLeft);
    this.setValue('appearance-tabPaddingRight', this.tempPrefs.appearance.tabPaddingRight);
    this.setValue('appearance-tabPaddingRight-slider', this.tempPrefs.appearance.tabPaddingRight);
    this.setValue('appearance-tabMinGap', this.tempPrefs.appearance.tabMinGap);
    this.setValue('appearance-tabMinGap-slider', this.tempPrefs.appearance.tabMinGap);

    // Appearance settings - colors (three tab states)
    this.setValue('appearance-focusedTabBackground', this.tempPrefs.appearance.focusedTabBackground);
    this.setValue('appearance-focusedTabColor', this.tempPrefs.appearance.focusedTabColor);
    this.setValue('appearance-visibleTabBackground', this.tempPrefs.appearance.visibleTabBackground);
    this.setValue('appearance-visibleTabColor', this.tempPrefs.appearance.visibleTabColor);
    this.setValue('appearance-hiddenTabBackground', this.tempPrefs.appearance.hiddenTabBackground);
    this.setValue('appearance-hiddenTabColor', this.tempPrefs.appearance.hiddenTabColor);
    this.setValue('appearance-tabContainerBackground', this.tempPrefs.appearance.tabContainerBackground);
    // Convert rgba to hex for color picker
    const borderColor = this.rgbaToHex(this.tempPrefs.appearance.groupBorderColor);
    this.setValue('appearance-groupBorderColor', borderColor);

    // Image viewer settings
    this.setValue('imageViewer-zoomSpeed', this.tempPrefs.imageViewer.zoomSpeed);
    this.setValue('imageViewer-zoomSpeed-slider', this.tempPrefs.imageViewer.zoomSpeed);
    this.setValue('imageViewer-maxZoom', this.tempPrefs.imageViewer.maxZoom);
    this.setValue('imageViewer-maxZoom-slider', this.tempPrefs.imageViewer.maxZoom);
    this.setValue('imageViewer-minZoom', this.tempPrefs.imageViewer.minZoom);
    this.setValue('imageViewer-minZoom-slider', this.tempPrefs.imageViewer.minZoom);
    this.setValue('imageViewer-defaultZoomMode', this.tempPrefs.imageViewer.defaultZoomMode);
    this.setValue('imageViewer-smoothPan', this.tempPrefs.imageViewer.smoothPan);
    this.setValue('imageViewer-showPixelGrid', this.tempPrefs.imageViewer.showPixelGrid);

    // Review module settings
    this.setValue('reviewModule-autoSaveOnComplete', this.tempPrefs.reviewModule.autoSaveOnComplete);
    this.setValue('reviewModule-confirmBeforeSave', this.tempPrefs.reviewModule.confirmBeforeSave);
    this.setValue('reviewModule-defaultAction', this.tempPrefs.reviewModule.defaultAction);
    this.setValue('reviewModule-showConfidenceScores', this.tempPrefs.reviewModule.showConfidenceScores);
    this.setValue('reviewModule-saveMode', this.tempPrefs.reviewModule.saveMode);

    // Layout settings
    this.setValue('layout-defaultGridPreset', this.tempPrefs.layout.defaultGridPreset);
    this.setValue('layout-defaultTemplate', this.tempPrefs.layout.defaultTemplate);
    this.setValue('layout-autoSaveLayout', this.tempPrefs.layout.autoSaveLayout);
    this.setValue('layout-rememberPanelSizes', this.tempPrefs.layout.rememberPanelSizes);
  }

  /**
   * Set form field value
   */
  setValue(id, value) {
    const element = this.modal.querySelector(`#pref-${id}`);
    if (!element) return;

    if (element.type === 'checkbox') {
      element.checked = value;
    } else {
      element.value = value;
    }
  }

  /**
   * Get form field value
   */
  getValue(id) {
    const element = this.modal.querySelector(`#pref-${id}`);
    if (!element) return null;

    if (element.type === 'checkbox') {
      return element.checked;
    } else if (element.type === 'number') {
      return parseFloat(element.value);
    } else {
      return element.value;
    }
  }

  /**
   * Save preferences
   */
  save() {
    // Read values from form
    this.tempPrefs.backend.autoStart = this.getValue('backend-autoStart');
    this.tempPrefs.backend.port = this.getValue('backend-port');
    this.tempPrefs.backend.pythonPath = this.getValue('backend-pythonPath');

    this.tempPrefs.ui.theme = this.getValue('ui-theme');
    this.tempPrefs.ui.defaultLayout = this.getValue('ui-defaultLayout');
    this.tempPrefs.ui.showWelcome = this.getValue('ui-showWelcome');
    this.tempPrefs.ui.logLevel = this.getValue('ui-logLevel');

    this.tempPrefs.appearance.tabsHeight = this.getValue('appearance-tabsHeight');
    this.tempPrefs.appearance.tabsFontSize = this.getValue('appearance-tabsFontSize');
    this.tempPrefs.appearance.tabPaddingLeft = this.getValue('appearance-tabPaddingLeft');
    this.tempPrefs.appearance.tabPaddingRight = this.getValue('appearance-tabPaddingRight');
    this.tempPrefs.appearance.tabMinGap = this.getValue('appearance-tabMinGap');

    // Appearance colors (three tab states)
    this.tempPrefs.appearance.focusedTabBackground = this.getValue('appearance-focusedTabBackground');
    this.tempPrefs.appearance.focusedTabColor = this.getValue('appearance-focusedTabColor');
    this.tempPrefs.appearance.visibleTabBackground = this.getValue('appearance-visibleTabBackground');
    this.tempPrefs.appearance.visibleTabColor = this.getValue('appearance-visibleTabColor');
    this.tempPrefs.appearance.hiddenTabBackground = this.getValue('appearance-hiddenTabBackground');
    this.tempPrefs.appearance.hiddenTabColor = this.getValue('appearance-hiddenTabColor');
    this.tempPrefs.appearance.tabContainerBackground = this.getValue('appearance-tabContainerBackground');

    // Convert hex to rgba for groupBorderColor (keep opacity from default)
    const hexColor = this.getValue('appearance-groupBorderColor');
    const r = parseInt(hexColor.slice(1, 3), 16);
    const g = parseInt(hexColor.slice(3, 5), 16);
    const b = parseInt(hexColor.slice(5, 7), 16);
    this.tempPrefs.appearance.groupBorderColor = `rgba(${r}, ${g}, ${b}, 0.2)`;

    this.tempPrefs.imageViewer.zoomSpeed = this.getValue('imageViewer-zoomSpeed');
    this.tempPrefs.imageViewer.maxZoom = this.getValue('imageViewer-maxZoom');
    this.tempPrefs.imageViewer.minZoom = this.getValue('imageViewer-minZoom');
    this.tempPrefs.imageViewer.defaultZoomMode = this.getValue('imageViewer-defaultZoomMode');
    this.tempPrefs.imageViewer.smoothPan = this.getValue('imageViewer-smoothPan');
    this.tempPrefs.imageViewer.showPixelGrid = this.getValue('imageViewer-showPixelGrid');

    this.tempPrefs.reviewModule.autoSaveOnComplete = this.getValue('reviewModule-autoSaveOnComplete');
    this.tempPrefs.reviewModule.confirmBeforeSave = this.getValue('reviewModule-confirmBeforeSave');
    this.tempPrefs.reviewModule.defaultAction = this.getValue('reviewModule-defaultAction');
    this.tempPrefs.reviewModule.showConfidenceScores = this.getValue('reviewModule-showConfidenceScores');
    this.tempPrefs.reviewModule.saveMode = this.getValue('reviewModule-saveMode');

    this.tempPrefs.layout.defaultGridPreset = this.getValue('layout-defaultGridPreset');
    this.tempPrefs.layout.defaultTemplate = this.getValue('layout-defaultTemplate');
    this.tempPrefs.layout.autoSaveLayout = this.getValue('layout-autoSaveLayout');
    this.tempPrefs.layout.rememberPanelSizes = this.getValue('layout-rememberPanelSizes');

    // Save to preferences manager
    preferences.setAll(this.tempPrefs);

    // Dispatch event for listeners (FlexLayout workspace)
    window.dispatchEvent(new CustomEvent('preferences-changed'));

    // Check if restart is needed (backend settings changed)
    const needsRestart = this.checkIfRestartNeeded();
    if (needsRestart) {
      alert('Preferences saved!\n\nBackend settings have changed. Please restart the application for changes to take effect.');
    } else {
      console.log('[PreferencesUI] Preferences saved successfully');
    }

    this.hide(true); // true = was saved, don't dispatch cancel event
  }

  /**
   * Reset preferences to defaults (preview only - not saved until Save is clicked)
   */
  reset() {
    // Get defaults without saving - user must click Save to persist
    this.tempPrefs = preferences.getDefaults();
    this.populateForm();

    // Manually sync sliders after populating form
    this.syncAllSliders();

    // Dispatch preview event (not preferences-changed) so Cancel can revert
    window.dispatchEvent(new CustomEvent('preferences-preview', {
      detail: { tempPrefs: this.tempPrefs }
    }));
  }

  /**
   * Sync all sliders with their number inputs
   */
  syncAllSliders() {
    const sliderIds = [
      'appearance-tabsHeight',
      'appearance-tabsFontSize',
      'appearance-tabPaddingLeft',
      'appearance-tabPaddingRight',
      'appearance-tabMinGap',
      'imageViewer-zoomSpeed',
      'imageViewer-maxZoom',
      'imageViewer-minZoom'
    ];

    sliderIds.forEach(id => {
      const numberInput = this.modal.querySelector(`#pref-${id}`);
      const slider = this.modal.querySelector(`#pref-${id}-slider`);
      if (numberInput && slider) {
        slider.value = numberInput.value;
      }
    });
  }

  /**
   * Check if restart is needed
   */
  checkIfRestartNeeded() {
    const current = preferences.getAll();
    return (
      current.backend.port !== this.tempPrefs.backend.port ||
      current.backend.pythonPath !== this.tempPrefs.backend.pythonPath
    );
  }
}

// Singleton instance
export const preferencesUI = new PreferencesUI();
