/**
 * Preferences Manager
 *
 * Manages user preferences with localStorage persistence.
 * Supports dot notation for nested access (e.g., 'backend.port').
 */

import { debug, debugError } from '../shared/debug.js';

/**
 * Default external editor for "open the original in an editor".
 * Lightroom Classic (not the CC/cloud variant) is the only one that supports
 * MIDI control surfaces.
 */
export const DEFAULT_EXTERNAL_EDITOR = 'Adobe Lightroom Classic';

export class PreferencesManager {
  constructor() {
    this.storageKey = 'ansikten-preferences';
    this.version = 2;

    // Default preferences structure
    this.defaults = {
      version: this.version,
      backend: {
        autoStart: true,
        port: 5001, // Changed from 5000 to avoid macOS Control Center conflict
        pythonPath: ''  // Empty = auto-detect (backend/.venv or ANSIKTEN_PYTHON)
      },
      ui: {
        theme: 'system', // 'dark' | 'light' | 'system'
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
        tabMinWidth: 0 // Minimum tab width override (0 = auto based on content)
        // Note: Tab colors now follow theme (theme.css)
      },
      imageViewer: {
        zoomSpeed: 1.07, // Zoom factor per step
        maxZoom: 10, // Maximum zoom level
        minZoom: 0.1, // Minimum zoom level
        defaultZoomMode: 'auto-fit', // 'auto-fit' | '1:1'
        smoothPan: true, // Smooth panning animation
        showPixelGrid: false, // Show pixel grid at high zoom levels (future)
        showFileInfo: true // Show filename and queue progress overlay
      },
      reviewModule: {
        autoSaveOnComplete: true, // Auto-save when all faces reviewed
        confirmBeforeSave: false, // Ask confirmation before saving
        defaultAction: 'next', // 'next' | 'stay' after confirming face
        showConfidenceScores: true,
        saveMode: 'per-image', // 'per-face' | 'per-image' - how to write review results
        maxAlternatives: 5 // Number of match alternatives to show (1-9)
      },
      fileQueue: {
        autoLoadOnStartup: true,
        autoRemoveMissing: true,
        insertMode: 'alphabetical'  // 'bottom' | 'alphabetical' - how new files are inserted
      },
      rename: {
        renameSidecars: true,       // Also rename associated sidecar files (XMP, etc)
        sidecarExtensions: ['xmp']  // Extensions to look for (case insensitive)
      },
      renameNef: {
        recursive: false            // EXIF rename: also descend into subfolders (default off)
      },
      culling: {
        autoAdvanceAfterRename: true // Move to the next file after a rename in Gallra spelare
      },
      paths: {
        // Root searched recursively to resolve the original NEF for a developed
        // JPEG in culling ("Öppna i extern editor"). ~/ is expanded in the main process.
        rawRoot: '~/Pictures/nerladdat',
        // App the resolved NEF is handed to (macOS `open -a`). An application
        // name or a path to an .app; ~/ is expanded in the main process.
        externalEditor: DEFAULT_EXTERNAL_EDITOR
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
        },
        // Rolling window settings - controls how many files stay preprocessed ahead
        rollingWindow: {
          maxReadyItems: 15,        // Max preprocessed items to keep "ready"
          minQueueBuffer: 10,       // Pause preprocessing when this many items are ready
          resumeThreshold: 5        // Resume after this many items are "done" (reviewed)
        },
        // Notification settings for preprocessing status
        notifications: {
          showStatusIndicator: true,  // Show status indicator in File Queue footer
          showToastOnPause: true,     // Show toast when preprocessing pauses
          showToastOnResume: false    // Show toast when preprocessing resumes
        }
      },
      workspace: {
        showWorkflowBar: true, // Show the persistent pipeline navigation row above the layout
        workflowBarAutoHide: true // Slide the navigation row away when idle (reveal on hover/step change)
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
      },
      dashboard: {
        showAttemptStats: true,       // Show detection statistics table
        showTopFaces: true,           // Show top faces grid
        showRecentImages: true,       // Show recent processed images
        showRecentLogs: false,        // Show recent log lines (disabled by default - use LogViewer)
        logLineCount: 5,              // Number of log lines to show (3-10)
        refreshInterval: 5000,        // Auto-refresh interval in ms (2000/5000/10000/30000)
        autoRefresh: true             // Auto-refresh on startup
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
      // A payload with no version at all predates versioning: treat it as older
      // than anything, so it migrates rather than counting as "newer".
      const storedVersion = Number.isFinite(parsed.version) ? parsed.version : 0;

      // Version migration — only FORWARDS. A payload from a newer build (the
      // user ran a later version and rolled back) must be left alone: stamping
      // it down to this version while its newer keys stay put would make the
      // next newer build re-run its own migration step on already-migrated
      // data, which is the double-application this write exists to prevent.
      if (storedVersion < this.version) {
        debug('Preferences', `Migrating from v${parsed.version} to v${this.version}`);
        const migrated = this.migrate(parsed);
        this.preferences = this.mergeWithDefaults(migrated);
        // Persist the migrated STORED payload — not the merged tree. Writing
        // the merge would freeze today's defaults into this install's storage,
        // and a later change to a default would then never reach it. The
        // defaults keep being supplied in memory by mergeWithDefaults, exactly
        // as before. Persisting at all is what makes the migration run once per
        // install rather than on every launch; the write swallows its own
        // errors, so a read-only or full backend degrades to the old behaviour
        // (migrated in memory, retried next start) instead of failing load.
        this.persistStored(migrated);
      } else {
        // Current, or newer than this build understands. Merge with defaults to
        // handle new keys; nothing is written.
        this.preferences = this.mergeWithDefaults(parsed);
      }

      debug('Preferences', 'Loaded preferences from localStorage');
    } catch (err) {
      debugError('Preferences', 'Failed to load preferences, using defaults:', err);
      this.preferences = JSON.parse(JSON.stringify(this.defaults));
    }
  }

  /**
   * Write a payload to localStorage as-is.
   *
   * The single write path: it never adds or removes keys, so the caller decides
   * what lands on disk. Errors are logged and swallowed — load() calls this from
   * the constructor, where a throw would take the singleton with it.
   * @param {object} payload - Exactly what should be stored
   * @returns {boolean} Success status
   */
  persistStored(payload) {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(payload));
      debug('Preferences', 'Wrote preferences to localStorage');
      return true;
    } catch (err) {
      debugError('Preferences', 'Failed to save preferences:', err);
      return false;
    }
  }

  /**
   * Save preferences to localStorage
   *
   * Writes the full in-memory tree, defaults included — the shape every
   * user-initiated write has always had. Note that it stamps `this.version`
   * unconditionally: on an install whose stored payload came from a NEWER build,
   * the first user-initiated save still writes this version's number over it.
   * load() no longer does that on its own (see the migration branch there), but
   * closing the gap for the user-write path means teaching save() the difference
   * between "this build owns the payload" and "a newer build does", which is a
   * larger change than this seam. Logged in ROADMAP.md.
   */
  save() {
    this.preferences.version = this.version;
    return this.persistStored(this.preferences);
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
   * Migrate a STORED payload from an older version to the current one.
   *
   * In and out is storage shape, not the merged tree: the result is what load()
   * writes back, and writing the merge would freeze today's defaults into this
   * install. A value this method does not touch keeps coming from the defaults
   * in memory, where a later change to a default still reaches it.
   * @param {object} old - The stored payload, at some older version
   * @returns {object} The stored payload, at the current version
   */
  migrate(old) {
    // v1 -> v2 added `paths.externalEditor`. v1 had no such key and no UI that
    // could set one, so there is no stored value to rewrite — existing installs
    // get Lightroom Classic from the defaults in memory. No per-version step is
    // needed yet; this is where one goes when a future version has to reshape or
    // rename a value that is actually on disk.
    //
    // load() persists the result, so a step added here runs once per install
    // rather than on every launch. It should still be idempotent: if the write
    // fails (read-only or full storage) the install stays at its old version and
    // the step is repeated on the next start.
    debug('Preferences', 'No per-version step needed, stamping the new version');
    return { ...old, version: this.version };
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
