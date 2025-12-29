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
    this.loadTemplate('review');
  }

  /**
   * Load a predefined layout template
   * @param {string} templateName - Template name: 'review', 'comparison', 'full-image', 'stats'
   */
  loadTemplate(templateName) {
    console.log(`[LayoutManager] Loading template: ${templateName}`);

    // Clear existing panels first
    const panels = [...this.dockview.panels];
    panels.forEach(panel => this.dockview.removePanel(panel));

    switch (templateName) {
      case 'review':
        // Default: Image viewer (left) + Review module (right)
        this.loadReviewTemplate();
        break;

      case 'comparison':
        // Image viewer (left) + Review module (top right) + Original view (bottom right)
        this.loadComparisonTemplate();
        break;

      case 'full-image':
        // Just image viewer (maximized)
        this.loadFullImageTemplate();
        break;

      case 'stats':
        // Image viewer (left) + Stats dashboard (top right) + Database mgmt (bottom right)
        this.loadStatsTemplate();
        break;

      default:
        console.warn(`[LayoutManager] Unknown template: ${templateName}, loading default`);
        this.loadReviewTemplate();
    }

    this.save();
  }

  /**
   * Review Mode Template
   * Image viewer (70% left) + Review module (30% right)
   */
  loadReviewTemplate() {
    const imagePanel = this.dockview.addPanel({
      id: 'image-viewer-main',
      component: 'image-viewer',
      params: { isMain: true },
      title: 'Image Viewer'
    });

    this.dockview.addPanel({
      id: 'review-module-main',
      component: 'review-module',
      position: { referencePanel: imagePanel, direction: 'right' },
      title: 'Face Review'
    });
  }

  /**
   * Comparison Mode Template
   * Image viewer (left 50%) + Review module (top right 25%) + Original view (bottom right 25%)
   */
  loadComparisonTemplate() {
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

    this.dockview.addPanel({
      id: 'original-view-main',
      component: 'original-view',
      position: { referencePanel: reviewPanel, direction: 'below' },
      title: 'Original View'
    });
  }

  /**
   * Full Image Template
   * Just image viewer (maximized)
   */
  loadFullImageTemplate() {
    this.dockview.addPanel({
      id: 'image-viewer-main',
      component: 'image-viewer',
      params: { isMain: true },
      title: 'Image Viewer'
    });
  }

  /**
   * Stats Template
   * Image viewer (left 60%) + Stats (top right 20%) + Database (bottom right 20%)
   */
  loadStatsTemplate() {
    const imagePanel = this.dockview.addPanel({
      id: 'image-viewer-main',
      component: 'image-viewer',
      params: { isMain: true },
      title: 'Image Viewer'
    });

    const statsPanel = this.dockview.addPanel({
      id: 'statistics-dashboard-main',
      component: 'statistics-dashboard',
      position: { referencePanel: imagePanel, direction: 'right' },
      title: 'Statistics'
    });

    this.dockview.addPanel({
      id: 'database-management-main',
      component: 'database-management',
      position: { referencePanel: statsPanel, direction: 'below' },
      title: 'Database'
    });
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
