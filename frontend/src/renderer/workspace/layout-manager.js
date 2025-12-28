/**
 * Layout Manager
 *
 * Manages workspace layout persistence (save/load from localStorage).
 * Handles layout versioning and migration.
 */

export class LayoutManager {
  constructor(dockview) {
    this.dockview = dockview;
    this.storageKey = 'bildvisare-workspace-layout';
    this.currentVersion = 1;
  }

  /**
   * Save current workspace layout to localStorage
   */
  save() {
    try {
      const layout = this.dockview.toJSON();
      const state = {
        version: this.currentVersion,
        timestamp: Date.now(),
        layout,
        moduleStates: this.serializeModuleStates()
      };

      localStorage.setItem(this.storageKey, JSON.stringify(state));
      console.log('[LayoutManager] Saved workspace layout');
    } catch (err) {
      console.error('[LayoutManager] Failed to save layout:', err);
    }
  }

  /**
   * Load workspace layout from localStorage
   * Falls back to default layout if load fails
   */
  load() {
    const saved = localStorage.getItem(this.storageKey);

    if (!saved) {
      console.log('[LayoutManager] No saved layout found, loading default');
      this.loadDefault();
      return;
    }

    try {
      const state = JSON.parse(saved);

      // Check version and migrate if needed
      if (state.version !== this.currentVersion) {
        console.warn(`[LayoutManager] Layout version mismatch (${state.version} vs ${this.currentVersion}), loading default`);
        this.loadDefault();
        return;
      }

      this.dockview.fromJSON(state.layout);
      this.restoreModuleStates(state.moduleStates);

      // Check if layout has any panels - if not, load default
      if (this.dockview.panels.length === 0) {
        console.warn('[LayoutManager] Loaded layout has no panels, loading default');
        this.loadDefault();
        return;
      }

      console.log('[LayoutManager] Loaded workspace layout');
    } catch (err) {
      console.error('[LayoutManager] Failed to load layout:', err);
      this.loadDefault();
    }
  }

  /**
   * Load default workspace layout
   * Image viewer (left) + Review module (right)
   */
  loadDefault() {
    console.log('[LayoutManager] Loading default layout');

    // Create default layout: Image viewer (left) + Review module (right)
    const imagePanel = this.dockview.addPanel({
      id: 'image-viewer-main',
      component: 'image-viewer',
      params: { isMain: true },
      title: 'Image Viewer'
    });

    const reviewPanel = this.dockview.addPanel({
      id: 'review-module-main',
      component: 'review-module',
      position: { referencePanel: imagePanel, direction: 'right' },
      title: 'Face Review'
    });

    // Save default layout
    this.save();
  }

  /**
   * Serialize all module states
   * @returns {object} Map of panel IDs to module states
   */
  serializeModuleStates() {
    const states = {};

    // Get all panels from dockview
    const panels = this.dockview.panels || [];

    panels.forEach(panel => {
      // Check if panel has a module with getState()
      if (panel.api && panel.api.module && typeof panel.api.module.getState === 'function') {
        try {
          states[panel.id] = panel.api.module.getState();
        } catch (err) {
          console.warn(`[LayoutManager] Failed to serialize state for panel ${panel.id}:`, err);
        }
      }
    });

    return states;
  }

  /**
   * Restore module states from saved data
   * @param {object} states - Map of panel IDs to module states
   */
  restoreModuleStates(states) {
    if (!states) return;

    const panels = this.dockview.panels || [];

    panels.forEach(panel => {
      const state = states[panel.id];
      if (state && panel.api && panel.api.module && typeof panel.api.module.setState === 'function') {
        try {
          panel.api.module.setState(state);
          console.log(`[LayoutManager] Restored state for panel ${panel.id}`);
        } catch (err) {
          console.warn(`[LayoutManager] Failed to restore state for panel ${panel.id}:`, err);
        }
      }
    });
  }

  /**
   * Export layout to JSON file
   * @returns {string} JSON string of current layout
   */
  exportLayout() {
    const layout = this.dockview.toJSON();
    const state = {
      version: this.currentVersion,
      timestamp: Date.now(),
      layout,
      moduleStates: this.serializeModuleStates()
    };

    return JSON.stringify(state, null, 2);
  }

  /**
   * Import layout from JSON string
   * @param {string} jsonString - JSON string of layout
   */
  importLayout(jsonString) {
    try {
      const state = JSON.parse(jsonString);
      this.dockview.fromJSON(state.layout);
      this.restoreModuleStates(state.moduleStates);
      this.save(); // Save imported layout
      console.log('[LayoutManager] Imported layout successfully');
    } catch (err) {
      console.error('[LayoutManager] Failed to import layout:', err);
      throw err;
    }
  }

  /**
   * Reset to default layout
   */
  reset() {
    // Clear all existing panels first
    const panels = [...this.dockview.panels]; // Create copy to avoid mutation during iteration
    panels.forEach(panel => {
      this.dockview.removePanel(panel);
    });

    localStorage.removeItem(this.storageKey);
    this.loadDefault();
    console.log('[LayoutManager] Reset to default layout');
  }
}
