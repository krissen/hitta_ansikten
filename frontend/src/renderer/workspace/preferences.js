/**
 * Preferences Manager
 *
 * Manages user preferences with localStorage persistence.
 * Supports dot notation for nested access (e.g., 'backend.port').
 */

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
        showConfidenceScores: true
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
        console.log('[Preferences] No saved preferences, using defaults');
        this.preferences = JSON.parse(JSON.stringify(this.defaults));
        return;
      }

      const parsed = JSON.parse(stored);

      // Version migration
      if (parsed.version !== this.version) {
        console.log(`[Preferences] Migrating from v${parsed.version} to v${this.version}`);
        this.preferences = this.migrate(parsed);
      } else {
        // Merge with defaults to handle new keys
        this.preferences = this.mergeWithDefaults(parsed);
      }

      console.log('[Preferences] Loaded preferences from localStorage');
    } catch (err) {
      console.error('[Preferences] Failed to load preferences, using defaults:', err);
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
      console.log('[Preferences] Saved preferences to localStorage');
      return true;
    } catch (err) {
      console.error('[Preferences] Failed to save preferences:', err);
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
    console.log('[Preferences] Resetting to defaults');
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

    console.log('[Preferences] No migration needed, merging with defaults');
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
      console.log('[Preferences] Imported preferences');
      return true;
    } catch (err) {
      console.error('[Preferences] Failed to import preferences:', err);
      return false;
    }
  }
}

// Singleton instance
export const preferences = new PreferencesManager();
