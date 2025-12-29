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
   * Hide preferences modal
   */
  hide() {
    if (this.modal) {
      this.modal.style.display = 'none';
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

        <div class="preferences-content">
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

          <!-- Appearance Settings -->
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
          </div>

          <!-- Image Viewer Settings -->
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

          <!-- Review Module Settings -->
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
    `;
    this.modal.appendChild(style);
  }

  /**
   * Add event listeners
   */
  addEventListeners() {
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
      document.documentElement.style.setProperty(cssVariable, `${value}${unit}`);

      // Also update tempPrefs so Save button saves the correct value
      const path = id.replace(/-/g, '.');
      const keys = path.split('.');
      const lastKey = keys.pop();
      let target = this.tempPrefs;
      for (const key of keys) {
        if (!target[key]) target[key] = {};
        target = target[key];
      }
      target[lastKey] = parseFloat(value);
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

    // Save to preferences manager
    preferences.setAll(this.tempPrefs);

    // Apply UI preferences immediately
    if (window.workspace && window.workspace.applyUIPreferences) {
      window.workspace.applyUIPreferences();
    }

    // Check if restart is needed (backend settings changed)
    const needsRestart = this.checkIfRestartNeeded();
    if (needsRestart) {
      alert('Preferences saved!\n\nBackend settings have changed. Please restart the application for changes to take effect.');
    } else {
      console.log('[PreferencesUI] Preferences saved successfully');
    }

    this.hide();
  }

  /**
   * Reset preferences to defaults
   */
  reset() {
    preferences.reset();
    this.tempPrefs = preferences.getAll();
    this.populateForm();

    // Manually sync sliders after populating form
    this.syncAllSliders();

    // Apply appearance preferences immediately
    if (window.workspace && window.workspace.applyUIPreferences) {
      window.workspace.applyUIPreferences();
    }
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
