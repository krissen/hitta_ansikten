/**
 * Preferences Manager
 *
 * Manages user preferences with localStorage persistence.
 * Supports dot notation for nested access (e.g., 'backend.port').
 */

import { debug, debugWarn, debugError } from '../shared/debug.js';

export class PreferencesManager {
  constructor() {
    this.storageKey = 'bildvisare-preferences';
    this.version = 1;

    // Default preferences structure
    this.defaults = {
      version: this.version,
      backend: {
        autoStart: true,
        port: 5001, // Changed from 5000 to avoid macOS Control Center conflict
        pythonPath: '/Users/krisniem/.local/share/miniforge3/envs/hitta_ansikten/bin/python3'
      },
      ui: {
        theme: 'light', // 'light' | 'dark'
        defaultLayout: 'standard', // 'standard' | 'compact' | 'review-focused'
        showWelcome: true, // Show welcome message on first launch
        logLevel: 'info' // 'debug' | 'info' | 'warn' | 'error'
      },
      debug: {
        enabled: false, // Enable debug logging
        logToFile: false // Also write logs to file (requires enabled=true)
      },
      appearance: {
        // Sizes and spacing
        tabsHeight: 28, // Tab height in pixels (20-40)
        tabsFontSize: 13, // Tab font size in pixels (10-16)
        tabPaddingLeft: 8, // Left padding in tab (0-20)
        tabPaddingRight: 6, // Right padding in tab (0-20)
        tabMinGap: 10, // Minimum gap between text and close button (0-30)
        tabMinWidth: 0, // Minimum tab width override (0 = auto based on content)

        // Tab colors - three states:
        // 1. Focused: selected tab in the focused panel (keyboard focus)
        // 2. Visible: selected tab in non-focused panels
        // 3. Hidden: unselected tabs (behind other tabs in same panel)
        focusedTabBackground: '#ffffff',
        focusedTabColor: '#1a1a1a',
        visibleTabBackground: '#e8e8e8',
        visibleTabColor: '#555555',
        hiddenTabBackground: '#d8d8d8',
        hiddenTabColor: '#999999',
        tabContainerBackground: '#d0d0d0',
        groupBorderColor: 'rgba(128, 128, 128, 0.2)'
      },
      imageViewer: {
        zoomSpeed: 1.07, // Zoom factor per step
        maxZoom: 10, // Maximum zoom level
        minZoom: 0.1, // Minimum zoom level
        defaultZoomMode: 'auto-fit', // 'auto-fit' | '1:1'
        smoothPan: true, // Smooth panning animation
        showPixelGrid: false // Show pixel grid at high zoom levels (future)
      },
      reviewModule: {
        autoSaveOnComplete: true, // Auto-save when all faces reviewed
        confirmBeforeSave: false, // Ask confirmation before saving
        defaultAction: 'next', // 'next' | 'stay' after confirming face
        showConfidenceScores: true,
        saveMode: 'per-image' // 'per-face' | 'per-image' - how to write review results
      },
      fileQueue: {
        autoLoadOnStartup: true // Auto-load first file from queue on startup/reload
      },
      preprocessing: {
        enabled: true,              // Master switch for background preprocessing
        steps: {
          nefConversion: true,      // Convert NEF to JPG in background
          faceDetection: true,      // Detect faces in background
          thumbnails: true          // Generate face thumbnails in background
        },
        parallelWorkers: 2,         // Number of parallel preprocessing jobs (1-8)
        cache: {
          maxSizeMB: 1024           // Max cache size in MB (default 1GB)
        }
      },
      layout: {
        defaultGridPreset: '70-30', // Default grid split ratio: '50-50', '60-40', '70-30', '30-70', '40-60'
        defaultTemplate: 'review', // Default layout template: 'review', 'comparison', 'full-image', 'stats'
        autoSaveLayout: true, // Auto-save layout on changes
        rememberPanelSizes: true // Remember panel sizes across sessions
      },
      // Preset-specific layout configurations
      // Each preset can override module positions and ratios
      layouts: {
        presets: {
          review: {
            // Review mode: sidebar + main viewer
            modules: {
              'review-module': { row: 1, col: 1, ratio: 0.15, rowRatio: 1.0 },
              'image-viewer': { row: 1, col: 2, ratio: 0.85, rowRatio: 1.0 }
            }
          },
          comparison: {
            // Comparison mode: three-column
            modules: {
              'review-module': { row: 1, col: 1, ratio: 0.15, rowRatio: 1.0 },
              'image-viewer': { row: 1, col: 2, ratio: 0.50, rowRatio: 1.0 },
              'original-view': { row: 1, col: 3, ratio: 0.35, rowRatio: 1.0 }
            }
          },
          'full-image': {
            // Full image mode: maximized viewer
            modules: {
              'image-viewer': { row: 1, col: 1, ratio: 1.0, rowRatio: 1.0 }
            }
          },
          stats: {
            // Stats mode: viewer + stats panels
            modules: {
              'image-viewer': { row: 1, col: 1, ratio: 0.6, rowRatio: 0.7 },
              'statistics-dashboard': { row: 1, col: 2, ratio: 0.4, rowRatio: 0.7 },
              'database-management': { row: 2, col: 1, colSpan: 'full', ratio: 1.0, rowRatio: 0.3 }
            }
          },
          'review-with-logs': {
            // Review mode with log viewer at bottom
            modules: {
              'review-module': { row: 1, col: 1, ratio: 0.15, rowRatio: 0.75 },
              'image-viewer': { row: 1, col: 2, ratio: 0.85, rowRatio: 0.75 },
              'log-viewer': { row: 2, col: 1, colSpan: 'full', ratio: 1.0, rowRatio: 0.25 }
            }
          }
        }
      }
    };

    // Current preferences (loaded from localStorage or defaults)
    this.preferences = null;

    // Load preferences on initialization
    this.load();
  }

  /**
   * Load preferences from localStorage
   * Falls back to defaults if not found or corrupted
   */
  load() {
    try {
      const stored = localStorage.getItem(this.storageKey);

      if (!stored) {
        debug('Preferences', 'No saved preferences, using defaults');
        this.preferences = JSON.parse(JSON.stringify(this.defaults));
        return;
      }

      const parsed = JSON.parse(stored);

      // Version migration
      if (parsed.version !== this.version) {
        debug('Preferences', `Migrating from v${parsed.version} to v${this.version}`);
        this.preferences = this.migrate(parsed);
      } else {
        // Merge with defaults to handle new keys
        this.preferences = this.mergeWithDefaults(parsed);
      }

      debug('Preferences', 'Loaded preferences from localStorage');
    } catch (err) {
      debugError('Preferences', 'Failed to load preferences, using defaults:', err);
      this.preferences = JSON.parse(JSON.stringify(this.defaults));
    }
  }

  /**
   * Save preferences to localStorage
   */
  save() {
    try {
      this.preferences.version = this.version;
      localStorage.setItem(this.storageKey, JSON.stringify(this.preferences));
      debug('Preferences', 'Saved preferences to localStorage');
      return true;
    } catch (err) {
      debugError('Preferences', 'Failed to save preferences:', err);
      return false;
    }
  }

  /**
   * Get preference value using dot notation
   * @param {string} path - Dot notation path (e.g., 'backend.port')
   * @returns {*} Value at path, or undefined if not found
   */
  get(path) {
    const keys = path.split('.');
    let value = this.preferences;

    for (const key of keys) {
      if (value === null || value === undefined) {
        return undefined;
      }
      value = value[key];
    }

    return value;
  }

  /**
   * Set preference value using dot notation
   * @param {string} path - Dot notation path (e.g., 'backend.port')
   * @param {*} value - Value to set
   * @returns {boolean} Success status
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.preferences;

    // Navigate to parent object
    for (const key of keys) {
      if (!(key in target)) {
        target[key] = {};
      }
      target = target[key];
    }

    // Set value
    target[lastKey] = value;

    // Auto-save
    return this.save();
  }

  /**
   * Reset preferences to defaults
   */
  reset() {
    debug('Preferences', 'Resetting to defaults');
    this.preferences = JSON.parse(JSON.stringify(this.defaults));
    this.save();
  }

  /**
   * Get all preferences
   * @returns {object} Current preferences
   */
  getAll() {
    return JSON.parse(JSON.stringify(this.preferences));
  }

  /**
   * Get default preferences (without modifying current preferences)
   * @returns {object} Default preferences
   */
  getDefaults() {
    return JSON.parse(JSON.stringify(this.defaults));
  }

  /**
   * Set multiple preferences at once
   * @param {object} prefs - Partial preferences object
   */
  setAll(prefs) {
    this.preferences = this.mergeWithDefaults(prefs);
    this.save();
  }

  /**
   * Merge saved preferences with defaults (handles new keys)
   * @param {object} saved - Saved preferences
   * @returns {object} Merged preferences
   */
  mergeWithDefaults(saved) {
    const merged = JSON.parse(JSON.stringify(this.defaults));

    const merge = (target, source) => {
      for (const key in source) {
        if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!target[key]) target[key] = {};
          merge(target[key], source[key]);
        } else {
          target[key] = source[key];
        }
      }
    };

    merge(merged, saved);
    return merged;
  }

  /**
   * Migrate preferences from old version to new version
   * @param {object} old - Old preferences
   * @returns {object} Migrated preferences
   */
  migrate(old) {
    // Currently only v1 exists, but this is where migration logic would go
    // Example: if (old.version === 0) { /* migrate v0 -> v1 */ }

    debug('Preferences', 'No migration needed, merging with defaults');
    return this.mergeWithDefaults(old);
  }

  /**
   * Export preferences as JSON string
   * @returns {string} JSON string
   */
  export() {
    return JSON.stringify(this.preferences, null, 2);
  }

  /**
   * Import preferences from JSON string
   * @param {string} json - JSON string
   * @returns {boolean} Success status
   */
  import(json) {
    try {
      const imported = JSON.parse(json);
      this.preferences = this.mergeWithDefaults(imported);
      this.save();
      debug('Preferences', 'Imported preferences');
      return true;
    } catch (err) {
      debugError('Preferences', 'Failed to import preferences:', err);
      return false;
    }
  }
}

// Singleton instance
export const preferences = new PreferencesManager();
