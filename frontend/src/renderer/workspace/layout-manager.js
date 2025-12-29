/**
 * Layout Manager
 *
 * Manages workspace layout persistence (save/load from localStorage).
 * Handles layout versioning and migration.
 * Provides smart panel add/remove with ratio management.
 */

import { preferences } from './preferences.js';
import { getModule } from './module-registry.js';
import { layoutLog, layoutWarn, layoutError, layoutDebug } from '../shared/logger.js';

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
    } catch (err) {
      layoutError(' Failed to save layout:', err);
    }
  }

  /**
   * Load workspace layout from localStorage
   * Falls back to default layout if load fails
   */
  load() {
    const saved = localStorage.getItem(this.storageKey);

    if (!saved) {
      layoutLog(' No saved layout found, loading default');
      this.loadDefault();
      return;
    }

    try {
      const state = JSON.parse(saved);

      // Check version and migrate if needed
      if (state.version !== this.currentVersion) {
        layoutWarn(` Layout version mismatch (${state.version} vs ${this.currentVersion}), loading default`);
        this.loadDefault();
        return;
      }

      this.dockview.fromJSON(state.layout);
      this.restoreModuleStates(state.moduleStates);

      // Check if layout has any panels - if not, load default
      if (this.dockview.panels.length === 0) {
        layoutWarn(' Loaded layout has no panels, loading default');
        this.loadDefault();
        return;
      }
    } catch (err) {
      layoutError(' Failed to load layout:', err);
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
        layoutWarn(` Unknown template: ${templateName}, loading default`);
        this.loadReviewTemplate();
    }

    this.save();
  }

  /**
   * Review Mode Template
   * Review module (15% left) + Image viewer (85% right)
   */
  loadReviewTemplate() {
    const reviewPanel = this.dockview.addPanel({
      id: 'review-module-main',
      component: 'review-module',
      title: 'Face Review'
    });

    this.dockview.addPanel({
      id: 'image-viewer-main',
      component: 'image-viewer',
      params: { isMain: true },
      position: { referencePanel: reviewPanel, direction: 'right' },
      title: 'Image Viewer'
    });

    // Apply 15-85 ratio (review narrow, image wide)
    setTimeout(() => {
      this.applyGridPreset('15-85');
    }, 50);
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
          layoutWarn(` Failed to serialize state for panel ${panel.id}:`, err);
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
        } catch (err) {
          layoutWarn(` Failed to restore state for panel ${panel.id}:`, err);
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
      this.save();
    } catch (err) {
      layoutError(' Failed to import layout:', err);
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
  }

  /**
   * Apply grid preset to resize panels
   * @param {string} preset - Preset name: '50-50', '60-40', '70-30', '30-70', '40-60', '10-90', '15-85', '85-15', '90-10'
   */
  applyGridPreset(preset) {

    const groups = this.dockview.groups || [];
    if (groups.length < 2) {
      layoutWarn(' Need at least 2 groups to apply grid preset');
      return;
    }

    // Get the main container width/height
    const api = this.dockview;

    // Determine split ratios based on preset
    let ratio;
    switch (preset) {
      case '50-50':
        ratio = 0.5;
        break;
      case '60-40':
        ratio = 0.6;
        break;
      case '70-30':
        ratio = 0.7;
        break;
      case '30-70':
        ratio = 0.3;
        break;
      case '40-60':
        ratio = 0.4;
        break;
      case '10-90':
        ratio = 0.1;
        break;
      case '15-85':
        ratio = 0.15;
        break;
      case '85-15':
        ratio = 0.85;
        break;
      case '90-10':
        ratio = 0.9;
        break;
      default:
        layoutWarn(` Unknown preset: ${preset}`);
        return;
    }

    // Try to apply the ratio to the first split container
    // This is a simplified approach - Dockview's API for programmatic resizing is limited
    // We'll set the size on the first two groups if they exist
    if (groups.length >= 2) {
      const totalWidth = api.width;
      const firstGroupWidth = Math.floor(totalWidth * ratio);

      // Dockview doesn't expose direct resize methods, so we'll use the layout save/restore
      // with modified sizes. This is a workaround.
      const currentLayout = api.toJSON();

      // Modify the layout to set sizes
      if (currentLayout.grid && currentLayout.grid.root) {
        this.modifyLayoutSizes(currentLayout.grid.root, ratio);
        api.fromJSON(currentLayout);
      }

      this.save();
    }
  }

  /**
   * Recursively modify layout sizes
   * Only modifies the top-level branch (first split)
   * @param {object} node - Layout tree node
   * @param {number} ratio - Size ratio for first child (remaining distributed to others)
   */
  modifyLayoutSizes(node, ratio) {
    if (node.type === 'branch') {
      // This is a split container
      if (node.data && Array.isArray(node.data) && node.data.length >= 2) {
        const totalSize = node.data.reduce((sum, child) => sum + (child.size || 1), 0);

        if (node.data.length === 2) {
          // Two children: apply ratio directly
          node.data[0].size = Math.floor(totalSize * ratio);
          node.data[1].size = Math.floor(totalSize * (1 - ratio));
        } else {
          // N children: first gets ratio, rest share remaining equally
          const remainingRatio = 1 - ratio;
          const otherChildRatio = remainingRatio / (node.data.length - 1);

          node.data[0].size = Math.floor(totalSize * ratio);
          for (let i = 1; i < node.data.length; i++) {
            node.data[i].size = Math.floor(totalSize * otherChildRatio);
          }
        }
        // Note: We don't recursively apply to nested branches
        // as that would affect vertical splits incorrectly
      }
    }
  }

  /**
   * Find the branch that contains the groups (may be nested)
   * @param {object} node - Starting node
   * @param {number} targetCount - Expected number of children (groups)
   * @returns {object|null} The branch node containing the groups
   */
  findGroupBranch(node, targetCount) {
    if (!node) return null;

    if (node.type === 'branch' && node.data) {
      // Check if this branch has the right number of children
      if (node.data.length === targetCount) {
        return node;
      }
      // Otherwise search children
      for (const child of node.data) {
        const found = this.findGroupBranch(child, targetCount);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Get current ratios for all groups
   * Handles nested grid structures by finding the correct branch
   * @returns {number[]} Array of ratios (0-1) for each group
   */
  getCurrentRatios() {
    const layout = this.dockview.toJSON();
    if (!layout.grid || !layout.grid.root) return [];

    const groupCount = this.dockview.groups.length;
    const branch = this.findGroupBranch(layout.grid.root, groupCount);

    if (!branch || !branch.data) {
      // Fallback to root
      const root = layout.grid.root;
      if (root.type !== 'branch' || !root.data) return [];
      const totalSize = root.data.reduce((sum, child) => sum + (child.size || 1), 0);
      return root.data.map(child => (child.size || 1) / totalSize);
    }

    const totalSize = branch.data.reduce((sum, child) => sum + (child.size || 1), 0);
    return branch.data.map(child => (child.size || 1) / totalSize);
  }

  /**
   * Set ratios for all groups using direct resize API (no panel recreation)
   * @param {number[]} ratios - Array of ratios (0-1) for each group (must sum to ~1)
   */
  setRatios(ratios) {
    const groups = this.dockview.groups;

    if (groups.length < 2) {
      layoutWarn('Need at least 2 groups to set ratios');
      return;
    }

    if (ratios.length !== groups.length) {
      layoutWarn(`Ratio count mismatch: ${ratios.length} ratios vs ${groups.length} groups`);
      return;
    }

    // Get total available width
    const totalWidth = this.dockview.width;
    if (!totalWidth || totalWidth <= 0) {
      layoutWarn('Invalid dockview width');
      return;
    }

    // Resize each group using the direct API (no fromJSON recreation!)
    groups.forEach((group, i) => {
      const targetWidth = Math.floor(totalWidth * ratios[i]);
      try {
        group.api.setSize({ width: targetWidth });
        layoutDebug(`Set group ${i} width to ${targetWidth}px (ratio: ${ratios[i]})`);
      } catch (err) {
        layoutWarn(`Failed to resize group ${i}:`, err);
      }
    });

    this.save();
  }

  /**
   * Get layout configuration for a module
   * Checks preset-specific overrides first, then falls back to module defaults
   * @param {string} moduleId - Module ID
   * @param {string} presetName - Optional preset name to check
   * @returns {object} Layout configuration {row, col, ratio, rowRatio, colSpan}
   */
  getModuleLayoutConfig(moduleId, presetName = null) {
    // Check preset-specific configuration first
    if (presetName) {
      const presetConfig = preferences.get(`layouts.presets.${presetName}.modules.${moduleId}`);
      if (presetConfig) {
        return presetConfig;
      }
    }

    // Fall back to module's default layout
    const module = getModule(moduleId);
    if (module && module.defaultLayout) {
      return module.defaultLayout;
    }

    // Ultimate fallback
    return {
      row: 1,
      col: 1,
      ratio: 0.5,
      rowRatio: 1.0,
      colSpan: 1
    };
  }

  /**
   * Smart add panel with ratio management
   * Respects module's preferred ratio and adjusts existing panels proportionally
   * @param {string} moduleId - Module ID to add
   * @param {object} options - Options including referencePanel, direction, presetName
   * @returns {object} The added panel
   */
  smartAddPanel(moduleId, options = {}) {
    const module = getModule(moduleId);
    if (!module) {
      layoutError(` Module not found: ${moduleId}`);
      return null;
    }

    const layoutConfig = this.getModuleLayoutConfig(moduleId, options.presetName);
    const panelId = options.id || `${moduleId}-${Date.now()}`;

    // Capture current ratios before adding
    const currentRatios = this.getCurrentRatios();

    // Add the panel
    const panelOptions = {
      id: panelId,
      component: moduleId,
      params: { component: moduleId, ...options.params },
      title: options.title || module.title
    };

    if (options.referencePanel) {
      panelOptions.position = {
        referencePanel: options.referencePanel,
        direction: options.direction || 'right'
      };
    }

    const panel = this.dockview.addPanel(panelOptions);

    // Apply ratio from layout config
    // Wait a tick for the panel to be added, then adjust ratios
    setTimeout(() => {
      this.applyModuleRatios(layoutConfig, currentRatios, options.direction);
    }, 50);

    return panel;
  }

  /**
   * Apply module ratios after adding a panel
   * @param {object} layoutConfig - Layout config for the new module
   * @param {number[]} previousRatios - Ratios before adding
   * @param {string} direction - Direction the panel was added
   */
  applyModuleRatios(layoutConfig, previousRatios, direction) {
    const newRatio = layoutConfig.ratio || 0.5;
    const groups = this.dockview.groups;

    if (groups.length < 2) return;

    // Simple case: 2 groups, use the module's preferred ratio
    if (groups.length === 2) {
      if (direction === 'left' || direction === 'above') {
        this.setRatios([newRatio, 1 - newRatio]);
      } else {
        this.setRatios([1 - newRatio, newRatio]);
      }
      return;
    }

    // Complex case: N groups
    // The new panel takes its preferred ratio, others scale proportionally
    const layout = this.dockview.toJSON();
    if (!layout.grid || !layout.grid.root) return;

    const root = layout.grid.root;
    if (root.type !== 'branch' || !root.data) return;

    // Calculate new ratios: new panel gets its ratio, others share rest
    const remainingRatio = 1 - newRatio;
    const otherCount = root.data.length - 1;
    const otherRatio = remainingRatio / otherCount;

    const newRatios = root.data.map((_, i) => {
      // Last added panel is typically at the end
      if (i === root.data.length - 1) {
        return newRatio;
      }
      return otherRatio;
    });

    this.setRatios(newRatios);
  }

  /**
   * Smart remove panel with ratio restoration
   * Redistributes space to siblings proportionally
   * @param {string} panelId - Panel ID to remove
   */
  smartRemovePanel(panelId) {
    const panel = this.dockview.panels.find(p => p.id === panelId);
    if (!panel) {
      layoutWarn(` Panel not found: ${panelId}`);
      return;
    }

    // Capture current ratios and group info before removing
    const currentRatios = this.getCurrentRatios();
    const groups = this.dockview.groups;
    const panelGroup = panel.group;
    const groupIndex = groups.indexOf(panelGroup);

    // Remove the panel
    this.dockview.removePanel(panel);

    // If the group was removed (had only this panel), redistribute ratios
    if (this.dockview.groups.length < groups.length && currentRatios.length > 1) {
      const removedRatio = currentRatios[groupIndex] || 0;
      const newRatios = currentRatios.filter((_, i) => i !== groupIndex);

      // Redistribute the removed ratio proportionally
      const totalRemaining = newRatios.reduce((sum, r) => sum + r, 0);
      const redistributedRatios = newRatios.map(r => r + (removedRatio * r / totalRemaining));

      this.setRatios(redistributedRatios);
    }

    this.save();
  }

  /**
   * Swap panel positions and update ratios to follow modules
   * After swap, each module keeps its preferred ratio
   * @param {string} panel1Id - First panel ID
   * @param {string} panel2Id - Second panel ID
   */
  swapPanelsWithRatios(panel1Id, panel2Id) {
    const panel1 = this.dockview.panels.find(p => p.id === panel1Id);
    const panel2 = this.dockview.panels.find(p => p.id === panel2Id);

    if (!panel1 || !panel2) {
      layoutWarn(' Cannot swap: panel not found');
      return;
    }

    // Get module IDs
    const module1Id = panel1.api?.component || panel1.params?.component;
    const module2Id = panel2.api?.component || panel2.params?.component;

    // Get their preferred ratios
    const config1 = this.getModuleLayoutConfig(module1Id);
    const config2 = this.getModuleLayoutConfig(module2Id);

    // Get current positions
    const group1 = panel1.group;
    const group2 = panel2.group;
    const groups = this.dockview.groups;
    const index1 = groups.indexOf(group1);
    const index2 = groups.indexOf(group2);

    // Get current ratios
    const currentRatios = this.getCurrentRatios();

    // Swap the ratios based on module preferences
    // Module 1 goes to position 2, so position 2 gets module 1's ratio
    // Module 2 goes to position 1, so position 1 gets module 2's ratio
    const newRatios = [...currentRatios];
    newRatios[index1] = config2.ratio;
    newRatios[index2] = config1.ratio;

    // Normalize ratios to sum to 1
    const total = newRatios.reduce((sum, r) => sum + r, 0);
    const normalizedRatios = newRatios.map(r => r / total);

    // Apply new ratios after swap completes
    // Note: The actual swap is done by the caller (workspace.js)
    // This just updates the ratios
    setTimeout(() => {
      this.setRatios(normalizedRatios);
    }, 100);

    layoutLog(` Swapped ratios: ${module1Id} (${config1.ratio}) <-> ${module2Id} (${config2.ratio})`);
  }

  /**
   * Set number of columns by adding/removing empty groups
   * @param {number} count - Desired number of columns (1-5)
   */
  setColumnCount(count) {
    const targetCount = Math.max(1, Math.min(5, count));
    const currentGroups = this.dockview.groups.length;

    if (targetCount === currentGroups) return;

    if (targetCount > currentGroups) {
      // Add columns
      for (let i = currentGroups; i < targetCount; i++) {
        this.dockview.addGroup({ direction: 'right' });
      }
    } else {
      // Remove columns (from right, only if empty)
      const groups = [...this.dockview.groups].reverse();
      let removed = 0;
      for (const group of groups) {
        if (removed >= currentGroups - targetCount) break;
        if (group.panels.length === 0) {
          this.dockview.removeGroup(group);
          removed++;
        }
      }
    }

    this.save();
  }
}
