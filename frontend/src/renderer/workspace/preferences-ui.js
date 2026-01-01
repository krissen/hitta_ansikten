/**
 * Preferences UI Modal
 *
 * Modal dialog for editing user preferences.
 */

import { preferences } from './preferences.js';
import { getCategories, setCategories, resetCategories } from '../shared/debug.js';

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
        <div class="pref-tabs-container">
          <button class="pref-tabs-arrow pref-tabs-arrow-left" title="Previous tab">‹</button>
          <div class="pref-tabs">
            <button class="pref-tab active" data-tab="general">General</button>
            <button class="pref-tab" data-tab="appearance">Appearance</button>
            <button class="pref-tab" data-tab="layout">Layout</button>
            <button class="pref-tab" data-tab="image-viewer">Image Viewer</button>
            <button class="pref-tab" data-tab="review">Review</button>
            <button class="pref-tab" data-tab="preprocessing">Preprocessing</button>
            <button class="pref-tab" data-tab="advanced">Advanced</button>
          </div>
          <button class="pref-tabs-arrow pref-tabs-arrow-right" title="Next tab">›</button>
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

            <!-- File Queue Settings -->
            <div class="pref-section">
              <h3>File Queue</h3>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-fileQueue-autoLoadOnStartup" />
                  Auto-load from queue on startup
                </label>
                <small>Automatically load first pending file when app starts with files in queue</small>
              </div>
            </div>

            <!-- File Rename Settings -->
            <div class="pref-section">
              <h3>File Rename</h3>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-requireConfirmation" />
                  Require confirmation before rename
                </label>
                <small>Show confirmation dialog before renaming files.</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-allowAlreadyRenamed" />
                  Allow renaming already-renamed files
                </label>
                <small>Enable re-renaming of files that already have names in the filename.</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Date/Time Prefix</h3>

              <div class="pref-field">
                <label>Prefix Source</label>
                <select id="pref-rename-prefixSource">
                  <option value="filename">From filename (YYMMDD_HHMMSS pattern)</option>
                  <option value="exif">From EXIF metadata</option>
                  <option value="filedate">From file modification date</option>
                  <option value="none">No prefix (names only)</option>
                </select>
                <small>Where to get the date/time for the filename prefix. Photographer suffixes (e.g., "en" in 250612_153040en) are preserved.</small>
              </div>

              <div class="pref-field">
                <label>EXIF Fallback</label>
                <select id="pref-rename-exifFallback">
                  <option value="filedate">Use file modification date</option>
                  <option value="original">Use original filename</option>
                  <option value="skip">Skip file (don't rename)</option>
                </select>
                <small>What to do if EXIF data is missing.</small>
              </div>

              <div class="pref-field">
                <label>Date Pattern</label>
                <select id="pref-rename-datePattern">
                  <option value="%y%m%d_%H%M%S">YYMMDD_HHMMSS (250612_153040)</option>
                  <option value="%Y%m%d_%H%M%S">YYYYMMDD_HHMMSS (20250612_153040)</option>
                  <option value="%Y-%m-%d_%H-%M-%S">YYYY-MM-DD_HH-MM-SS (2025-06-12_15-30-40)</option>
                  <option value="%y%m%d-%H%M%S">YYMMDD-HHMMSS (250612-153040)</option>
                </select>
                <small>Format for the date/time prefix.</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Filename Pattern</h3>

              <div class="pref-field">
                <label>Filename Template</label>
                <select id="pref-rename-filenamePatternPreset">
                  <option value="{prefix}_{names}{ext}">{prefix}_{names}{ext} - Standard</option>
                  <option value="{date}-{time}_{names}{ext}">{date}-{time}_{names}{ext} - Dash separator</option>
                  <option value="{names}_{prefix}{ext}">{names}_{prefix}{ext} - Names first</option>
                  <option value="{original}_{names}{ext}">{original}_{names}{ext} - Keep original</option>
                  <option value="{names}{ext}">{names}{ext} - Names only</option>
                  <option value="custom">Custom...</option>
                </select>
              </div>

              <div class="pref-field" id="pref-rename-customPattern-container" style="display:none;">
                <label>Custom Template</label>
                <input type="text" id="pref-rename-filenamePattern" placeholder="{prefix}_{names}{ext}" />
                <small>Variables: {prefix}, {names}, {ext}, {original}, {date}, {time}</small>
              </div>

              <div class="pref-field">
                <label>Preview</label>
                <div id="pref-rename-preview" class="rename-preview">
                  <span class="preview-original">250612_153040en.NEF</span>
                  <span class="preview-arrow">→</span>
                  <span class="preview-result">250612_153040en_Anna,_Bert.NEF</span>
                </div>
              </div>

              <div class="pref-field">
                <label>Name Separator</label>
                <select id="pref-rename-nameSeparator">
                  <option value=",_">,_ (Anna,_Bert)</option>
                  <option value="_">_ (Anna_Bert)</option>
                  <option value="-">- (Anna-Bert)</option>
                  <option value="_och_">_och_ (Anna_och_Bert)</option>
                </select>
                <small>Separator between multiple names.</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Name Formatting</h3>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-useFirstNameOnly" checked />
                  Use first name only
                </label>
                <small>Use only first name (Anna) instead of full name (Anna_Svensson).</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-alwaysIncludeSurname" />
                  Always include surname
                </label>
                <small>Add surname even when there's no name collision.</small>
              </div>

              <div class="pref-field">
                <label>Disambiguation Style</label>
                <select id="pref-rename-disambiguationStyle">
                  <option value="initial">Initial (AnnaB, AnnaS)</option>
                  <option value="full">Full surname (Anna_Bergman, Anna_Svensson)</option>
                </select>
                <small>How to distinguish people with the same first name.</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-removeDiacritics" checked />
                  Remove diacritics
                </label>
                <small>Convert special characters (é→e, ö→o) for safer filenames.</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-rename-includeIgnoredFaces" />
                  Include ignored faces in filename
                </label>
                <small>Include faces marked as "ignored" in the filename.</small>
              </div>
            </div>
          </div>

          <!-- Preprocessing Tab Panel -->
          <div class="pref-tab-panel" data-tab="preprocessing">
            <div class="pref-section">
              <h3>Background Preprocessing</h3>
              <small style="display:block; margin-bottom:16px; color:#666;">
                Preprocess queued files in the background to speed up loading.
                Note: Name matching is NOT preprocessed - it requires the current database.
              </small>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-preprocessing-enabled" />
                  Enable background preprocessing
                </label>
                <small>Start preprocessing when files are added to queue</small>
              </div>

              <div class="pref-field">
                <label>Parallel Workers</label>
                <div class="slider-input-group">
                  <input type="range" id="pref-preprocessing-parallelWorkers-slider" min="1" max="8" step="1" />
                  <input type="number" id="pref-preprocessing-parallelWorkers" min="1" max="8" step="1" />
                </div>
                <small>Number of files to preprocess simultaneously (1-8)</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Preprocessing Steps</h3>
              <small style="display:block; margin-bottom:12px; color:#666;">
                Choose which steps to run in the background.
              </small>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-preprocessing-steps-nefConversion" />
                  NEF Conversion
                </label>
                <small>Convert RAW files (NEF, CR2, ARW) to JPG</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-preprocessing-steps-faceDetection" />
                  Face Detection
                </label>
                <small>Detect faces and bounding boxes</small>
              </div>

              <div class="pref-field">
                <label>
                  <input type="checkbox" id="pref-preprocessing-steps-thumbnails" />
                  Face Thumbnails
                </label>
                <small>Generate thumbnail images for detected faces</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Cache Settings</h3>

              <div class="pref-field">
                <label>Maximum Cache Size (MB)</label>
                <div class="slider-input-group">
                  <input type="range" id="pref-preprocessing-cache-maxSizeMB-slider" min="256" max="4096" step="256" />
                  <input type="number" id="pref-preprocessing-cache-maxSizeMB" min="256" max="4096" step="256" />
                </div>
                <small>Cache uses LRU eviction when this limit is exceeded</small>
              </div>

              <div class="pref-field" style="margin-top: 16px;">
                <div id="cache-status-display" style="margin-bottom: 12px; padding: 8px; background: #f8f8f8; border-radius: 4px; font-size: 13px;">
                  <span>Cache status: Loading...</span>
                </div>
                <button class="btn btn-secondary" type="button" id="btn-clear-cache">
                  Clear Preprocessing Cache
                </button>
              </div>
            </div>
          </div>

          <!-- Advanced Tab Panel -->
          <div class="pref-tab-panel" data-tab="advanced">
            <div class="pref-section">
              <h3>Logging</h3>

              <div class="pref-field">
                <label>Log Level</label>
                <select id="pref-ui-logLevel">
                  <option value="debug">Debug (verbose)</option>
                  <option value="info">Info</option>
                  <option value="warn">Warning</option>
                  <option value="error">Error</option>
                </select>
                <small>Minimum severity level for console output.</small>
              </div>
            </div>

            <div class="pref-section">
              <h3>Debug Categories</h3>
              <small style="display:block; margin-bottom:12px; color:#666;">
                Enable/disable debug output per category. Warnings and errors always show.
              </small>

              <div class="debug-category-grid" id="debug-categories-container">
                <!-- Populated dynamically -->
              </div>

              <div class="pref-field" style="margin-top: 16px;">
                <button class="btn btn-secondary btn-reset-debug" type="button">
                  Reset Debug Categories to Defaults
                </button>
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
      .pref-tabs-container {
        display: flex;
        align-items: stretch;
        border-bottom: 1px solid #e0e0e0;
        background: #f8f8f8;
      }

      .pref-tabs-arrow {
        background: none;
        border: none;
        padding: 0 12px;
        font-size: 20px;
        font-weight: 500;
        color: #666;
        cursor: pointer;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        transition: background 0.2s, color 0.2s;
      }

      .pref-tabs-arrow:hover {
        background: #e8e8e8;
        color: #333;
      }

      .pref-tabs-arrow:active {
        background: #ddd;
      }

      .pref-tabs {
        display: flex;
        gap: 4px;
        padding: 0 8px;
        overflow-x: auto;
        flex: 1;
        scrollbar-width: none; /* Firefox */
        -ms-overflow-style: none; /* IE/Edge */
      }

      .pref-tabs::-webkit-scrollbar {
        display: none; /* Chrome/Safari */
      }

      .pref-tab {
        background: none;
        border: none;
        padding: 12px 16px;
        font-size: 14px;
        font-weight: 500;
        color: #666;
        cursor: pointer;
        border-bottom: 2px solid transparent;
        transition: color 0.2s, border-color 0.2s;
        white-space: nowrap;
        flex-shrink: 0;
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

      /* Debug Categories Grid */
      .debug-category-grid {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        gap: 8px 16px;
      }

      .debug-category-item {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 4px;
        background: #f8f8f8;
      }

      .debug-category-item:hover {
        background: #f0f0f0;
      }

      .debug-category-item input[type="checkbox"] {
        margin: 0;
      }

      .debug-category-item label {
        margin: 0;
        font-size: 13px;
        font-weight: 400;
        color: #333;
        cursor: pointer;
      }

      .debug-category-item.enabled {
        background: #e3f2fd;
      }

      .btn-reset-debug {
        font-size: 13px;
      }

      /* Rename Preview */
      .rename-preview {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 12px;
        background: #f8f8f8;
        border: 1px solid #e0e0e0;
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, monospace;
        font-size: 13px;
      }

      .rename-preview .preview-original {
        color: #666;
      }

      .rename-preview .preview-arrow {
        color: #999;
      }

      .rename-preview .preview-result {
        color: #007acc;
        font-weight: 500;
      }
    `;
    this.modal.appendChild(style);
  }

  /**
   * Update cache status display
   */
  async updateCacheStatus() {
    const statusEl = this.modal?.querySelector('#cache-status-display');
    if (!statusEl) return;

    try {
      const { apiClient } = await import('../shared/api-client.js');
      const status = await apiClient.getCacheStatus();
      statusEl.innerHTML = `
        <span style="font-weight:500;">Cache Status:</span>
        ${status.total_entries} entries,
        ${status.total_size_mb} MB / ${status.max_size_mb} MB
        (${status.usage_percent}%)
      `;
    } catch (err) {
      statusEl.innerHTML = '<span style="color:#999;">Cache status unavailable (backend not running?)</span>';
    }
  }

  /**
   * Update rename preview based on current settings
   */
  updateRenamePreview() {
    const previewEl = this.modal?.querySelector('#pref-rename-preview .preview-result');
    if (!previewEl) return;

    // Get current pattern
    const patternPreset = this.modal.querySelector('#pref-rename-filenamePatternPreset');
    const patternInput = this.modal.querySelector('#pref-rename-filenamePattern');
    const separator = this.modal.querySelector('#pref-rename-nameSeparator')?.value || ',_';

    let pattern = patternInput?.value || '{prefix}_{names}{ext}';
    if (patternPreset?.value !== 'custom' && patternPreset?.value) {
      pattern = patternPreset.value;
    }

    // Sample values for preview
    const sampleValues = {
      prefix: '250612_153040en',
      names: ['Anna', 'Bert'].join(separator),
      ext: '.NEF',
      original: '250612_153040en',
      date: '250612',
      time: '153040'
    };

    // Build preview
    try {
      let result = pattern;
      for (const [key, value] of Object.entries(sampleValues)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
      }
      previewEl.textContent = result;
    } catch (e) {
      previewEl.textContent = '(invalid pattern)';
    }
  }

  /**
   * Switch to a specific tab
   */
  switchTab(tabName) {
    // Update tab buttons
    this.modal.querySelectorAll('.pref-tab').forEach(tab => {
      if (tab.dataset.tab === tabName) {
        tab.classList.add('active');
        // Scroll tab into view
        tab.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
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
   * Cycle to next/previous tab
   * @param {number} direction - 1 for next, -1 for previous
   */
  cycleTab(direction) {
    const tabs = Array.from(this.modal.querySelectorAll('.pref-tab'));
    const currentIndex = tabs.findIndex(tab => tab.classList.contains('active'));
    let newIndex = currentIndex + direction;

    // Wrap around
    if (newIndex < 0) newIndex = tabs.length - 1;
    if (newIndex >= tabs.length) newIndex = 0;

    this.switchTab(tabs[newIndex].dataset.tab);
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

    // Arrow navigation for tabs
    this.modal.querySelector('.pref-tabs-arrow-left').addEventListener('click', () => {
      this.cycleTab(-1);
    });
    this.modal.querySelector('.pref-tabs-arrow-right').addEventListener('click', () => {
      this.cycleTab(1);
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

    // Reset Debug Categories button
    this.modal.querySelector('.btn-reset-debug').addEventListener('click', () => {
      resetCategories();
      this.populateDebugCategories();
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
    this.setupSliderSync('preprocessing-parallelWorkers');
    this.setupSliderSync('preprocessing-cache-maxSizeMB');

    // Filename pattern preset/custom toggle
    const patternPreset = this.modal.querySelector('#pref-rename-filenamePatternPreset');
    const customContainer = this.modal.querySelector('#pref-rename-customPattern-container');
    const patternInput = this.modal.querySelector('#pref-rename-filenamePattern');

    if (patternPreset && customContainer && patternInput) {
      patternPreset.addEventListener('change', () => {
        if (patternPreset.value === 'custom') {
          customContainer.style.display = 'block';
          // Copy current pattern to input if empty
          if (!patternInput.value) {
            patternInput.value = '{prefix}_{names}{ext}';
          }
        } else {
          customContainer.style.display = 'none';
          patternInput.value = patternPreset.value;
        }
        this.updateRenamePreview();
      });

      patternInput.addEventListener('input', () => {
        this.updateRenamePreview();
      });
    }

    // Update preview when separator changes
    const separatorSelect = this.modal.querySelector('#pref-rename-nameSeparator');
    if (separatorSelect) {
      separatorSelect.addEventListener('change', () => {
        this.updateRenamePreview();
      });
    }

    // Clear cache button
    const clearCacheBtn = this.modal.querySelector('#btn-clear-cache');
    if (clearCacheBtn) {
      clearCacheBtn.addEventListener('click', async () => {
        if (confirm('Clear all cached preprocessing data?\n\nThis will remove all cached NEF conversions, face detections, and thumbnails.')) {
          try {
            clearCacheBtn.disabled = true;
            clearCacheBtn.textContent = 'Clearing...';
            const { apiClient } = await import('../shared/api-client.js');
            await apiClient.clearCache();
            this.updateCacheStatus();
            clearCacheBtn.textContent = 'Cache Cleared!';
            setTimeout(() => {
              clearCacheBtn.textContent = 'Clear Preprocessing Cache';
              clearCacheBtn.disabled = false;
            }, 2000);
          } catch (err) {
            console.error('[PreferencesUI] Failed to clear cache:', err);
            clearCacheBtn.textContent = 'Error clearing cache';
            clearCacheBtn.disabled = false;
          }
        }
      });
    }

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

    // File Queue settings
    this.setValue('fileQueue-autoLoadOnStartup', this.tempPrefs.fileQueue?.autoLoadOnStartup ?? true);

    // File Rename settings
    const rename = this.tempPrefs.rename || {};
    this.setValue('rename-requireConfirmation', rename.requireConfirmation ?? true);
    this.setValue('rename-allowAlreadyRenamed', rename.allowAlreadyRenamed ?? false);
    this.setValue('rename-prefixSource', rename.prefixSource ?? 'filename');
    this.setValue('rename-exifFallback', rename.exifFallback ?? 'filedate');
    this.setValue('rename-datePattern', rename.datePattern ?? '%y%m%d_%H%M%S');
    // Filename pattern - check if it's a preset or custom
    const pattern = rename.filenamePattern ?? '{prefix}_{names}{ext}';
    const presetSelect = this.modal.querySelector('#pref-rename-filenamePatternPreset');
    const customContainer = this.modal.querySelector('#pref-rename-customPattern-container');
    const presetOptions = Array.from(presetSelect?.options || []).map(o => o.value);

    if (presetOptions.includes(pattern)) {
      this.setValue('rename-filenamePatternPreset', pattern);
      this.setValue('rename-filenamePattern', pattern);
      if (customContainer) customContainer.style.display = 'none';
    } else {
      this.setValue('rename-filenamePatternPreset', 'custom');
      this.setValue('rename-filenamePattern', pattern);
      if (customContainer) customContainer.style.display = 'block';
    }
    this.setValue('rename-nameSeparator', rename.nameSeparator ?? ',_');
    this.setValue('rename-useFirstNameOnly', rename.useFirstNameOnly ?? true);
    this.setValue('rename-alwaysIncludeSurname', rename.alwaysIncludeSurname ?? false);
    this.setValue('rename-disambiguationStyle', rename.disambiguationStyle ?? 'initial');
    this.setValue('rename-removeDiacritics', rename.removeDiacritics ?? true);
    this.setValue('rename-includeIgnoredFaces', rename.includeIgnoredFaces ?? false);

    // Preprocessing settings
    const prep = this.tempPrefs.preprocessing || {};
    this.setValue('preprocessing-enabled', prep.enabled ?? true);
    this.setValue('preprocessing-parallelWorkers', prep.parallelWorkers ?? 2);
    this.setValue('preprocessing-parallelWorkers-slider', prep.parallelWorkers ?? 2);
    this.setValue('preprocessing-steps-nefConversion', prep.steps?.nefConversion ?? true);
    this.setValue('preprocessing-steps-faceDetection', prep.steps?.faceDetection ?? true);
    this.setValue('preprocessing-steps-thumbnails', prep.steps?.thumbnails ?? true);
    this.setValue('preprocessing-cache-maxSizeMB', prep.cache?.maxSizeMB ?? 1024);
    this.setValue('preprocessing-cache-maxSizeMB-slider', prep.cache?.maxSizeMB ?? 1024);

    // Update cache status display
    this.updateCacheStatus();

    // Layout settings
    this.setValue('layout-defaultGridPreset', this.tempPrefs.layout.defaultGridPreset);
    this.setValue('layout-defaultTemplate', this.tempPrefs.layout.defaultTemplate);
    this.setValue('layout-autoSaveLayout', this.tempPrefs.layout.autoSaveLayout);
    this.setValue('layout-rememberPanelSizes', this.tempPrefs.layout.rememberPanelSizes);

    // Debug categories (separate from preferences - stored in debug.js)
    this.populateDebugCategories();

    // Update rename preview
    this.updateRenamePreview();
  }

  /**
   * Populate debug categories checkboxes
   */
  populateDebugCategories() {
    const container = this.modal.querySelector('#debug-categories-container');
    if (!container) return;

    const categories = getCategories();
    container.innerHTML = '';

    // Group categories by type for better organization
    const groups = {
      'Core Systems': ['FlexLayout', 'Backend', 'WebSocket'],
      'Communication': ['ModuleAPI', 'ModuleEvent', 'IPC'],
      'Modules': ['FileQueue', 'ImageViewer', 'ReviewModule', 'OriginalView', 'LogViewer', 'Statistics', 'DatabaseMgmt'],
      'Subsystems': ['Preferences', 'NEFConvert', 'FaceDetection'],
      'Preprocessing': ['Preprocessing', 'Cache']
    };

    for (const [groupName, categoryNames] of Object.entries(groups)) {
      // Add group header
      const groupHeader = document.createElement('div');
      groupHeader.style.cssText = 'grid-column: 1 / -1; font-weight: 600; font-size: 12px; color: #666; margin-top: 8px; margin-bottom: 4px;';
      groupHeader.textContent = groupName;
      container.appendChild(groupHeader);

      // Add categories in this group
      for (const name of categoryNames) {
        if (!(name in categories)) continue;

        const enabled = categories[name];
        const item = document.createElement('div');
        item.className = `debug-category-item ${enabled ? 'enabled' : ''}`;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `debug-cat-${name}`;
        checkbox.checked = enabled;
        checkbox.addEventListener('change', () => {
          const newState = {};
          newState[name] = checkbox.checked;
          setCategories(newState);
          item.classList.toggle('enabled', checkbox.checked);
        });

        const label = document.createElement('label');
        label.htmlFor = `debug-cat-${name}`;
        label.textContent = name;

        item.appendChild(checkbox);
        item.appendChild(label);
        container.appendChild(item);
      }
    }
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

    // File Queue settings
    if (!this.tempPrefs.fileQueue) this.tempPrefs.fileQueue = {};
    this.tempPrefs.fileQueue.autoLoadOnStartup = this.getValue('fileQueue-autoLoadOnStartup');

    // File Rename settings
    if (!this.tempPrefs.rename) this.tempPrefs.rename = {};
    this.tempPrefs.rename.requireConfirmation = this.getValue('rename-requireConfirmation');
    this.tempPrefs.rename.allowAlreadyRenamed = this.getValue('rename-allowAlreadyRenamed');
    this.tempPrefs.rename.prefixSource = this.getValue('rename-prefixSource');
    this.tempPrefs.rename.exifFallback = this.getValue('rename-exifFallback');
    this.tempPrefs.rename.datePattern = this.getValue('rename-datePattern');
    this.tempPrefs.rename.filenamePattern = this.getValue('rename-filenamePattern');
    this.tempPrefs.rename.nameSeparator = this.getValue('rename-nameSeparator');
    this.tempPrefs.rename.useFirstNameOnly = this.getValue('rename-useFirstNameOnly');
    this.tempPrefs.rename.alwaysIncludeSurname = this.getValue('rename-alwaysIncludeSurname');
    this.tempPrefs.rename.disambiguationStyle = this.getValue('rename-disambiguationStyle');
    this.tempPrefs.rename.removeDiacritics = this.getValue('rename-removeDiacritics');
    this.tempPrefs.rename.includeIgnoredFaces = this.getValue('rename-includeIgnoredFaces');

    // Preprocessing settings
    if (!this.tempPrefs.preprocessing) this.tempPrefs.preprocessing = {};
    if (!this.tempPrefs.preprocessing.steps) this.tempPrefs.preprocessing.steps = {};
    if (!this.tempPrefs.preprocessing.cache) this.tempPrefs.preprocessing.cache = {};

    this.tempPrefs.preprocessing.enabled = this.getValue('preprocessing-enabled');
    this.tempPrefs.preprocessing.parallelWorkers = this.getValue('preprocessing-parallelWorkers');
    this.tempPrefs.preprocessing.steps.nefConversion = this.getValue('preprocessing-steps-nefConversion');
    this.tempPrefs.preprocessing.steps.faceDetection = this.getValue('preprocessing-steps-faceDetection');
    this.tempPrefs.preprocessing.steps.thumbnails = this.getValue('preprocessing-steps-thumbnails');
    this.tempPrefs.preprocessing.cache.maxSizeMB = this.getValue('preprocessing-cache-maxSizeMB');

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
