/**
 * Workspace Initialization
 *
 * Sets up the Dockview workspace and manages module lifecycle.
 */

import { createDockview } from '../../../node_modules/dockview-core/dist/dockview-core.esm.js';
import { LayoutManager } from './layout-manager.js';
import { registerModule, getModule } from './module-registry.js';
import { apiClient } from '../shared/api-client.js';
import { preferences } from './preferences.js';
import { preferencesUI } from './preferences-ui.js';

// Import modules
import imageViewerModule from '../modules/image-viewer/index.js';
import reviewModule from '../modules/review-module/index.js';
import logViewerModule from '../modules/log-viewer/index.js';
import originalViewModule from '../modules/original-view/index.js';
import statisticsDashboardModule from '../modules/statistics-dashboard/index.js';
import databaseManagementModule from '../modules/database-management/index.js';

// Global workspace state
let dockview = null;
let layoutManager = null;
const moduleInstances = new Map(); // Track module instances and cleanup functions

/**
 * Module Communication API
 *
 * Provided to each module during initialization.
 * Enables inter-module communication and workspace control.
 */
class ModuleAPI {
  constructor(panelId) {
    this.panelId = panelId;
    this.eventHandlers = new Map();
  }

  // Inter-module events
  emit(eventName, data) {
    console.log(`[ModuleAPI] ${this.panelId} emitted: ${eventName}`, data);
    // Broadcast to all modules
    moduleInstances.forEach((instance, id) => {
      if (id !== this.panelId && instance.api) {
        instance.api._triggerEvent(eventName, data);
      }
    });
  }

  on(eventName, callback) {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, []);
    }
    this.eventHandlers.get(eventName).push(callback);
  }

  off(eventName, callback) {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      const index = handlers.indexOf(callback);
      if (index > -1) handlers.splice(index, 1);
    }
  }

  // Internal: trigger event on this module
  _triggerEvent(eventName, data) {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[ModuleAPI] Error in event handler for ${eventName}:`, err);
        }
      });
    }
  }

  // Backend communication via API client
  http = {
    get: async (path, params) => {
      return apiClient.get(path, params);
    },
    post: async (path, body) => {
      return apiClient.post(path, body);
    }
  };

  ws = {
    on: (event, callback) => {
      apiClient.onWSEvent(event, callback);
    },
    off: (event, callback) => {
      apiClient.offWSEvent(event, callback);
    }
  };

  // Direct access to API client for convenience
  backend = apiClient;

  // IPC to main process
  ipc = {
    send: (channel, ...args) => {
      if (window.bildvisareAPI) {
        window.bildvisareAPI.send(channel, ...args);
      }
    },
    invoke: async (channel, ...args) => {
      if (window.bildvisareAPI) {
        return window.bildvisareAPI.invoke(channel, ...args);
      }
    }
  };

  // Workspace control
  workspace = {
    openModule: (moduleId, options = {}) => {
      openModule(moduleId, options);
    },
    closeModule: (panelId) => {
      closePanel(panelId);
    },
    focusModule: (panelId) => {
      const panel = dockview.panels.find(p => p.id === panelId);
      if (panel) panel.api.setActive();
    }
  };
}

/**
 * Setup global keyboard shortcuts for workspace
 */
function setupWorkspaceKeyboardShortcuts() {
  document.addEventListener('keydown', async (event) => {
    // Cmd+Shift+R / Ctrl+Shift+R - Hard reload (clear cache) - check first
    if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      window.location.reload(true);
      return;
    }

    // Cmd+R / Ctrl+R - Reload window (allow in inputs for this one)
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r' && !event.shiftKey) {
      event.preventDefault();
      window.location.reload();
      return;
    }

    // Only handle remaining shortcuts if no input is focused
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    // Ignore events that don't originate from our workspace
    // This prevents DevTools console from triggering shortcuts
    const workspaceRoot = document.getElementById('workspace-root');
    if (!event.target || !workspaceRoot || !workspaceRoot.contains(event.target)) {
      return;
    }

    // Cmd+Shift+Arrow keys - Group active panel as tab
    if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        groupActivePanel('above');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        groupActivePanel('below');
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        groupActivePanel('left');
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        groupActivePanel('right');
        return;
      }
    }

    // Cmd+Arrow keys - Move active panel in grid (swap)
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveActivePanel('above');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveActivePanel('below');
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveActivePanel('left');
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveActivePanel('right');
        return;
      }
    }

    // Cmd+O (macOS) or Ctrl+O (Windows/Linux) - Open file
    if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
      event.preventDefault();
      await openFileDialog();
    }
  });
}

/**
 * Group active panel as tab with panel in specified direction
 * @param {string} direction - 'above', 'below', 'left', 'right'
 */
function groupActivePanel(direction) {
  const activePanel = dockview.activePanel;
  if (!activePanel) {
    console.warn('[Workspace] No active panel to group');
    return;
  }

  console.log(`[Workspace] Grouping panel ${activePanel.id} with panel ${direction}`);

  // Get all panels to find a reference panel in the target direction
  const panels = dockview.panels;

  // Simple heuristic: find first panel that's not the active one
  // TODO: In future, could find panel that's actually in the specified direction
  const referencePanel = panels.find(p => p.id !== activePanel.id);

  if (!referencePanel) {
    console.warn('[Workspace] No reference panel found');
    return;
  }

  // Save module state before removing
  let savedState = null;
  const moduleInstance = moduleInstances.get(activePanel.id);
  if (moduleInstance) {
    // Try instance-level getState first (from init return), then renderer, then module
    if (moduleInstance.getState && typeof moduleInstance.getState === 'function') {
      try {
        savedState = moduleInstance.getState();
        console.log(`[Workspace] Saved instance state for panel ${activePanel.id}`);
      } catch (err) {
        console.warn(`[Workspace] Failed to save instance state for panel ${activePanel.id}:`, err);
      }
    } else if (moduleInstance.renderer && typeof moduleInstance.renderer.getState === 'function') {
      try {
        savedState = moduleInstance.renderer.getState();
        console.log(`[Workspace] Saved renderer state for panel ${activePanel.id}`);
      } catch (err) {
        console.warn(`[Workspace] Failed to save renderer state for panel ${activePanel.id}:`, err);
      }
    }
  }

  // Remove the panel from its current position
  const panelParams = {
    id: activePanel.id,
    component: activePanel.api?.component || activePanel.params?.component,
    params: activePanel.params,
    title: activePanel.title
  };

  dockview.removePanel(activePanel);

  // Re-add as tab in reference panel's group using 'center' direction
  const newPanel = dockview.addPanel({
    ...panelParams,
    position: {
      referencePanel: referencePanel,
      direction: 'within' // Add as tab in same group
    }
  });

  // Restore module state
  if (savedState && newPanel) {
    setTimeout(() => {
      const newModuleInstance = moduleInstances.get(newPanel.id);
      if (newModuleInstance) {
        // Try instance-level setState first
        if (newModuleInstance.setState && typeof newModuleInstance.setState === 'function') {
          try {
            newModuleInstance.setState(savedState);
            console.log(`[Workspace] Restored instance state for panel ${newPanel.id}`);
          } catch (err) {
            console.warn(`[Workspace] Failed to restore instance state for panel ${newPanel.id}:`, err);
          }
        } else if (newModuleInstance.renderer && typeof newModuleInstance.renderer.setState === 'function') {
          try {
            newModuleInstance.renderer.setState(savedState);
            console.log(`[Workspace] Restored renderer state for panel ${newPanel.id}`);

            // Remove placeholder if it exists (for image-viewer)
            const placeholder = newModuleInstance.container.querySelector('.image-viewer-placeholder');
            if (placeholder) {
              placeholder.remove();
            }
          } catch (err) {
            console.warn(`[Workspace] Failed to restore renderer state for panel ${newPanel.id}:`, err);
          }
        }
      }
    }, 100);
  }

  console.log(`[Workspace] Panel ${panelParams.id} grouped as tab`);
}

/**
 * Move active panel in the specified direction (swap positions)
 * @param {string} direction - 'above', 'below', 'left', 'right'
 */
function moveActivePanel(direction) {
  const activePanel = dockview.activePanel;
  if (!activePanel) {
    console.warn('[Workspace] No active panel to move');
    return;
  }

  console.log(`[Workspace] Moving panel ${activePanel.id} ${direction}`);

  // Get all panels to find a reference panel in the target direction
  const panels = dockview.panels;

  // Simple heuristic: find first panel that's not the active one
  const referencePanel = panels.find(p => p.id !== activePanel.id);

  if (!referencePanel) {
    console.warn('[Workspace] No reference panel found');
    return;
  }

  // Save module state before removing
  let savedState = null;
  const moduleInstance = moduleInstances.get(activePanel.id);
  if (moduleInstance) {
    // Try instance-level getState first (from init return), then renderer, then module
    if (moduleInstance.getState && typeof moduleInstance.getState === 'function') {
      try {
        savedState = moduleInstance.getState();
        console.log(`[Workspace] Saved instance state for panel ${activePanel.id}:`, savedState);
      } catch (err) {
        console.warn(`[Workspace] Failed to save instance state for panel ${activePanel.id}:`, err);
      }
    } else if (moduleInstance.renderer && typeof moduleInstance.renderer.getState === 'function') {
      try {
        savedState = moduleInstance.renderer.getState();
        console.log(`[Workspace] Saved renderer state for panel ${activePanel.id}:`, savedState);
      } catch (err) {
        console.warn(`[Workspace] Failed to save renderer state for panel ${activePanel.id}:`, err);
      }
    } else if (moduleInstance.module && typeof moduleInstance.module.getState === 'function') {
      try {
        savedState = moduleInstance.module.getState();
        console.log(`[Workspace] Saved module state for panel ${activePanel.id}:`, savedState);
      } catch (err) {
        console.warn(`[Workspace] Failed to save module state for panel ${activePanel.id}:`, err);
      }
    } else {
      console.warn(`[Workspace] No getState() method found for panel ${activePanel.id}`);
    }
  }

  // Remove the panel from its current position
  const panelParams = {
    id: activePanel.id,
    component: activePanel.api?.component || activePanel.params?.component,
    params: activePanel.params,
    title: activePanel.title
  };

  dockview.removePanel(activePanel);

  // Re-add in new position
  const newPanel = dockview.addPanel({
    ...panelParams,
    position: {
      referencePanel: referencePanel,
      direction: direction
    }
  });

  // Restore module state after a brief delay to let the module initialize
  if (savedState && newPanel) {
    setTimeout(() => {
      const newModuleInstance = moduleInstances.get(newPanel.id);
      if (newModuleInstance) {
        // Try instance-level setState first (from init return), then renderer, then module
        if (newModuleInstance.setState && typeof newModuleInstance.setState === 'function') {
          try {
            newModuleInstance.setState(savedState);
            console.log(`[Workspace] Restored instance state for panel ${newPanel.id}`);
          } catch (err) {
            console.warn(`[Workspace] Failed to restore instance state for panel ${newPanel.id}:`, err);
          }
        } else if (newModuleInstance.renderer && typeof newModuleInstance.renderer.setState === 'function') {
          try {
            newModuleInstance.renderer.setState(savedState);
            console.log(`[Workspace] Restored renderer state for panel ${newPanel.id}`);

            // Remove placeholder if it exists (for image-viewer)
            const placeholder = newModuleInstance.container.querySelector('.image-viewer-placeholder');
            if (placeholder) {
              placeholder.remove();
              console.log(`[Workspace] Removed placeholder after state restoration`);
            }
          } catch (err) {
            console.warn(`[Workspace] Failed to restore renderer state for panel ${newPanel.id}:`, err);
          }
        } else if (newModuleInstance.module && typeof newModuleInstance.module.setState === 'function') {
          try {
            newModuleInstance.module.setState(savedState);
            console.log(`[Workspace] Restored module state for panel ${newPanel.id}`);
          } catch (err) {
            console.warn(`[Workspace] Failed to restore module state for panel ${newPanel.id}:`, err);
          }
        }
      }
    }, 100);
  }

  console.log(`[Workspace] Panel ${panelParams.id} moved ${direction}`);
}

/**
 * Open file dialog and load selected image
 */
async function openFileDialog() {
  try {
    const filePath = await window.bildvisareAPI.invoke('open-file-dialog');

    if (!filePath) {
      console.log('[Workspace] File dialog canceled');
      return;
    }

    console.log(`[Workspace] Opening file: ${filePath}`);

    // Find image viewer module and trigger load-image event
    const imageViewerInstance = Array.from(moduleInstances.values()).find(
      instance => instance.module.id === 'image-viewer'
    );

    if (imageViewerInstance) {
      // Directly trigger the event on the image viewer's API
      imageViewerInstance.api._triggerEvent('load-image', { imagePath: filePath });
    } else {
      console.warn('[Workspace] No image viewer module found');
    }
  } catch (err) {
    console.error('[Workspace] Failed to open file:', err);
  }
}

/**
 * Apply UI preferences to CSS variables
 */
function applyUIPreferences() {
  console.log('[Workspace] applyUIPreferences() called');

  // Find the workspace root element
  const workspaceRoot = document.querySelector('.bildvisare-workspace');
  if (!workspaceRoot) {
    console.error('[Workspace] Could not find .bildvisare-workspace element!');
    return;
  }

  // Sizes and spacing
  const tabsHeight = preferences.get('appearance.tabsHeight') || 28;
  const tabsFontSize = preferences.get('appearance.tabsFontSize') || 13;
  const tabPaddingLeft = preferences.get('appearance.tabPaddingLeft') || 8;
  const tabPaddingRight = preferences.get('appearance.tabPaddingRight') || 6;
  const tabMinGap = preferences.get('appearance.tabMinGap') || 10;

  console.log('[Workspace] Setting size CSS variables on .bildvisare-workspace...');
  workspaceRoot.style.setProperty('--dv-tabs-height', `${tabsHeight}px`);
  workspaceRoot.style.setProperty('--dv-tabs-font-size', `${tabsFontSize}px`);
  workspaceRoot.style.setProperty('--dv-tab-padding-left', `${tabPaddingLeft}px`);
  workspaceRoot.style.setProperty('--dv-tab-padding-right', `${tabPaddingRight}px`);
  workspaceRoot.style.setProperty('--dv-tab-min-gap', `${tabMinGap}px`);

  // Colors
  const activeTabBackground = preferences.get('appearance.activeTabBackground') || '#f5f5f5';
  const inactiveTabBackground = preferences.get('appearance.inactiveTabBackground') || '#e0e0e0';
  const activeTabColor = preferences.get('appearance.activeTabColor') || '#1a1a1a';
  const inactiveTabColor = preferences.get('appearance.inactiveTabColor') || '#888888';
  const tabContainerBackground = preferences.get('appearance.tabContainerBackground') || '#d0d0d0';
  const groupBorderColor = preferences.get('appearance.groupBorderColor') || 'rgba(128, 128, 128, 0.2)';

  console.log('[Workspace] Color values from preferences:', {
    activeTabBackground, inactiveTabBackground, activeTabColor, inactiveTabColor,
    tabContainerBackground, groupBorderColor
  });

  console.log('[Workspace] Setting color CSS variables on .bildvisare-workspace...');
  workspaceRoot.style.setProperty('--dv-active-tab-background', activeTabBackground);
  workspaceRoot.style.setProperty('--dv-inactive-tab-background', inactiveTabBackground);
  workspaceRoot.style.setProperty('--dv-active-tab-color', activeTabColor);
  workspaceRoot.style.setProperty('--dv-inactive-tab-color', inactiveTabColor);
  workspaceRoot.style.setProperty('--dv-tab-container-background', tabContainerBackground);
  workspaceRoot.style.setProperty('--dv-group-border-color', groupBorderColor);

  // Verify variables were set
  console.log('[Workspace] Verifying CSS variables were set on workspace element:');
  console.log('  --dv-active-tab-background:', workspaceRoot.style.getPropertyValue('--dv-active-tab-background'));
  console.log('  --dv-inactive-tab-background:', workspaceRoot.style.getPropertyValue('--dv-inactive-tab-background'));
  console.log('  --dv-active-tab-color:', workspaceRoot.style.getPropertyValue('--dv-active-tab-color'));

  console.log(`[Workspace] Applied appearance preferences:`, {
    tabsHeight, tabsFontSize, tabPaddingLeft, tabPaddingRight, tabMinGap,
    activeTabBackground, inactiveTabBackground, activeTabColor, inactiveTabColor,
    tabContainerBackground, groupBorderColor
  });
}

/**
 * Initialize workspace
 */
async function initWorkspace() {
  console.log('[Workspace] Initializing...');

  // Register modules
  registerModule(imageViewerModule);
  registerModule(reviewModule);
  registerModule(logViewerModule);
  registerModule(originalViewModule);
  registerModule(statisticsDashboardModule);
  registerModule(databaseManagementModule);

  // Create Dockview instance
  dockview = createDockview(document.getElementById('workspace-root'), {
    className: 'bildvisare-workspace',
    createComponent: (options) => {
      return createModuleComponent(options);
    }
  });

  // Apply UI preferences to CSS
  applyUIPreferences();

  // Create layout manager
  layoutManager = new LayoutManager(dockview);

  // Setup auto-save on layout changes
  dockview.onDidLayoutChange(() => {
    // Log final layout result
    const panels = dockview.panels || [];
    const groups = dockview.groups || [];

    console.log('[Workspace] Layout changed - Final result:', {
      panels: panels.length,
      groups: groups.length,
      panelList: panels.map(p => p.id),
      groupSizes: groups.map((g, i) => ({
        group: i,
        panels: g.panels?.length || 0,
        width: g.api?.width,
        height: g.api?.height
      }))
    });

    layoutManager.save();
  });

  // Load saved layout or default
  layoutManager.load();

  // Setup keyboard shortcuts for workspace
  setupWorkspaceKeyboardShortcuts();

  // Connect to backend WebSocket
  try {
    await apiClient.connectWebSocket();
    console.log('[Workspace] WebSocket connected');
  } catch (err) {
    console.error('[Workspace] Failed to connect WebSocket:', err);
    // Continue anyway - modules can still use HTTP API
  }

  console.log('[Workspace] Initialized successfully');

  // Make workspace globally accessible for debugging
  window.workspace = {
    dockview,
    layoutManager,
    openModule,
    closePanel,
    getModuleInstances: () => moduleInstances,
    apiClient, // Expose API client for debugging
    preferences, // Expose preferences for debugging and module access
    preferencesUI, // Expose preferences UI for debugging
    applyUIPreferences // Expose for reapplying after preference changes
  };

  // Listen for initial file path from main process
  if (window.bildvisareAPI) {
    window.bildvisareAPI.on('load-initial-file', (filePath) => {
      console.log('[Workspace] Received initial file path:', filePath);

      // Find image viewer module and trigger load
      const imageViewerInstance = Array.from(moduleInstances.values()).find(
        instance => instance.module.id === 'image-viewer'
      );

      if (imageViewerInstance) {
        imageViewerInstance.api._triggerEvent('load-image', { imagePath: filePath });
        console.log('[Workspace] Triggered load-image event for initial file');
      } else {
        console.warn('[Workspace] No image viewer module found for initial file load');
      }
    });

    // Listen for menu commands
    window.bildvisareAPI.on('menu-command', async (command) => {
      console.log('[Workspace] Menu command:', command);

      switch (command) {
        case 'open-file':
          await openFileDialog();
          break;

        case 'reload-database':
          await reloadDatabase();
          break;

        case 'save-all-changes':
          // Broadcast to Review Module
          moduleInstances.forEach((instance) => {
            if (instance.module.id === 'review-module') {
              instance.api._triggerEvent('save-all-changes', {});
            }
          });
          break;

        case 'discard-changes':
          // Broadcast to Review Module
          moduleInstances.forEach((instance) => {
            if (instance.module.id === 'review-module') {
              instance.api._triggerEvent('discard-changes', {});
            }
          });
          break;

        case 'toggle-single-all-boxes':
          // Broadcast to all modules
          moduleInstances.forEach((instance) => {
            instance.api._triggerEvent('toggle-single-all-boxes', {});
          });
          break;

        case 'toggle-boxes-on-off':
          // Broadcast to all modules
          moduleInstances.forEach((instance) => {
            instance.api._triggerEvent('toggle-boxes-on-off', {});
          });
          break;

        case 'zoom-in':
        case 'zoom-out':
        case 'reset-zoom':
        case 'auto-fit':
        case 'auto-center-enable':
        case 'auto-center-disable':
          // Broadcast to all modules (image viewer will handle)
          moduleInstances.forEach((instance) => {
            instance.api._triggerEvent(command, {});
          });
          break;

        case 'open-original-view':
          // Smart positioning: place below Image Viewer if Review is open
          const imageViewerPanel = dockview.panels.find(p => p.id === 'image-viewer-main');
          const reviewPanel = dockview.panels.find(p => p.id === 'review-module-main');

          if (imageViewerPanel && reviewPanel) {
            // Both panels exist - place Original View below Image Viewer
            openModule('original-view', {
              title: 'Original View',
              position: {
                referencePanel: imageViewerPanel,
                direction: 'below'
              }
            });
          } else if (imageViewerPanel) {
            // Only Image Viewer exists - place to the right
            openModule('original-view', {
              title: 'Original View',
              position: {
                referencePanel: imageViewerPanel,
                direction: 'right'
              }
            });
          } else {
            // No reference panel - add freely
            openModule('original-view', { title: 'Original View' });
          }
          break;

        case 'open-log-viewer':
          openModule('log-viewer', { title: 'Log Viewer' });
          break;

        case 'open-review-module':
          // Open Review Module to the right of Image Viewer if it exists
          const imageViewerPanelForReview = dockview.panels.find(p => p.id === 'image-viewer-main');
          if (imageViewerPanelForReview) {
            openModule('review-module', {
              title: 'Review Module',
              position: {
                referencePanel: imageViewerPanelForReview,
                direction: 'right'
              }
            });
          } else {
            openModule('review-module', { title: 'Review Module' });
          }
          break;

        case 'layout-template-review':
          layoutManager.loadTemplate('review');
          break;

        case 'layout-template-comparison':
          layoutManager.loadTemplate('comparison');
          break;

        case 'layout-template-full-image':
          layoutManager.loadTemplate('full-image');
          break;

        case 'layout-template-stats':
          layoutManager.loadTemplate('stats');
          break;

        case 'grid-preset-50-50':
          layoutManager.applyGridPreset('50-50');
          break;

        case 'grid-preset-60-40':
          layoutManager.applyGridPreset('60-40');
          break;

        case 'grid-preset-70-30':
          layoutManager.applyGridPreset('70-30');
          break;

        case 'grid-preset-30-70':
          layoutManager.applyGridPreset('30-70');
          break;

        case 'grid-preset-40-60':
          layoutManager.applyGridPreset('40-60');
          break;

        case 'reset-layout':
          if (confirm('Reset workspace layout to default?\n\nThis will close all panels and restore the default layout.')) {
            layoutManager.reset();
          }
          break;

        case 'export-layout':
          exportLayoutToFile();
          break;

        case 'import-layout':
          importLayoutFromFile();
          break;

        case 'show-keyboard-shortcuts':
          showKeyboardShortcuts();
          break;

        case 'open-statistics-dashboard':
          openModule('statistics-dashboard', { title: 'Statistics Dashboard' });
          break;

        case 'open-database-management':
          openModule('database-management', { title: 'Database Management' });
          break;

        case 'open-preferences':
          preferencesUI.show();
          break;

        default:
          console.warn('[Workspace] Unknown menu command:', command);
      }
    });
  }
}

/**
 * Reload face database from backend
 */
async function reloadDatabase() {
  try {
    console.log('[Workspace] Reloading database...');

    const response = await apiClient.post('/reload-database', {});

    if (response.status === 'success') {
      console.log(`[Workspace] Database reloaded: ${response.people_count} people, ${response.ignored_count} ignored`);
      alert(`Database reloaded successfully!\n\n${response.people_count} people\n${response.ignored_count} ignored faces\n${response.cache_cleared} cached results cleared`);
    }
  } catch (err) {
    console.error('[Workspace] Failed to reload database:', err);
    alert('Failed to reload database. Check console for details.');
  }
}

/**
 * Export layout to JSON file
 */
function exportLayoutToFile() {
  try {
    const layoutJSON = layoutManager.exportLayout();
    const blob = new Blob([layoutJSON], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = `bildvisare-layout-${Date.now()}.json`;
    link.click();

    URL.revokeObjectURL(url);
    console.log('[Workspace] Layout exported successfully');
  } catch (err) {
    console.error('[Workspace] Failed to export layout:', err);
    alert('Failed to export layout. Check console for details.');
  }
}

/**
 * Import layout from JSON file
 */
function importLayoutFromFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';

  input.onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    try {
      const text = await file.text();
      layoutManager.importLayout(text);
      console.log('[Workspace] Layout imported successfully');
      alert('Layout imported successfully!');
    } catch (err) {
      console.error('[Workspace] Failed to import layout:', err);
      alert('Failed to import layout. Check console for details.');
    }
  };

  input.click();
}

/**
 * Show keyboard shortcuts help dialog
 */
function showKeyboardShortcuts() {
  const shortcuts = `
Keyboard Shortcuts

File:
  Cmd+O          Open Image
  Cmd+R          Reload Database

View:
  b              Toggle Single/All Bounding Boxes
  Shift+B        Toggle Bounding Boxes On/Off
  Cmd++          Zoom In
  Cmd+-          Zoom Out
  Cmd+=          Reset Zoom (1:1)
  Cmd+0          Auto-Fit
  Cmd+Shift+O    Open Original View
  Cmd+L          Open Log Viewer

Image Viewer:
  +/-            Zoom (hold for continuous)
  =              Reset to 1:1
  0              Auto-fit

Review Module:
  Tab/↓          Next face
  Shift+Tab/↑    Previous face
  1-9            Jump to face number
  Enter/A        Confirm identity
  I              Ignore face
  Esc            Cancel input

Window:
  Cmd+Shift+L    Reset Layout
  Cmd+W          Close Window
  Cmd+Q          Quit

Developer:
  Cmd+Option+I   Toggle DevTools
  Cmd+Shift+R    Reload Window
  `.trim();

  alert(shortcuts);
}

/**
 * Create a module component for Dockview
 * @param {object} options - Panel options
 * @returns {object} IContentRenderer object
 */
function createModuleComponent(options) {
  const { id, name } = options;

  console.log(`[Workspace] Creating component for module: ${name}`);

  const module = getModule(name);
  if (!module) {
    console.error(`[Workspace] Module not found: ${name}`);
    return createErrorComponent(`Module not found: ${name}`);
  }

  // Create container
  const container = document.createElement('div');
  container.className = 'module-container';
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  // Track cleanup function
  let cleanup = null;

  // Return IContentRenderer interface
  return {
    element: container,

    // Init method called by Dockview
    init: (parameters) => {
      console.log(`[Workspace] Initializing module: ${name} (panel: ${id})`);

      // Create module API
      const api = new ModuleAPI(id);

      // Store module instance immediately (before async init)
      moduleInstances.set(id, {
        module,
        api,
        container,
        cleanup: null, // Will be set after init completes
        renderer: null, // Will be set if module exposes renderer
        getState: null, // Will be set if module exposes getState
        setState: null // Will be set if module exposes setState
      });

      // Initialize module
      module.init(container, api).then(result => {
        // Handle both old format (function) and new format (object with cleanup + extras)
        if (typeof result === 'function') {
          // Old format: just a cleanup function
          cleanup = result;
        } else if (result && typeof result === 'object') {
          // New format: object with cleanup and optionally renderer/state accessors
          cleanup = result.cleanup;

          // Update stored instance with references if available
          const instance = moduleInstances.get(id);
          if (instance) {
            if (result.renderer) {
              instance.renderer = result.renderer;
            }
            if (result.getState && typeof result.getState === 'function') {
              instance.getState = result.getState;
            }
            if (result.setState && typeof result.setState === 'function') {
              instance.setState = result.setState;
            }
          }
        }

        // Update cleanup function in stored instance
        const instance = moduleInstances.get(id);
        if (instance) {
          instance.cleanup = cleanup;
        }

        console.log(`[Workspace] Module ${name} initialized`);
      }).catch(err => {
        console.error(`[Workspace] Failed to initialize module ${name}:`, err);
        container.innerHTML = `<div style="padding: 20px; color: red;">Error loading module: ${err.message}</div>`;
      });
    },

    // Dispose method called by Dockview
    dispose: () => {
      console.log(`[Workspace] Disposing module: ${id}`);
      if (cleanup && typeof cleanup === 'function') {
        cleanup();
      }
      moduleInstances.delete(id);
    }
  };
}

/**
 * Create error component
 * @param {string} message - Error message
 * @returns {object} IContentRenderer object
 */
function createErrorComponent(message) {
  const container = document.createElement('div');
  container.style.padding = '20px';
  container.style.color = 'red';
  container.textContent = message;

  return {
    element: container,
    init: () => {},
    dispose: () => {}
  };
}

/**
 * Open a new module panel
 * @param {string} moduleId - Module ID to open
 * @param {object} options - Panel options
 */
function openModule(moduleId, options = {}) {
  const module = getModule(moduleId);
  if (!module) {
    console.error(`[Workspace] Cannot open module: ${moduleId} not found`);
    return;
  }

  const panelId = options.id || `${moduleId}-${Date.now()}`;

  dockview.addPanel({
    id: panelId,
    component: moduleId,
    params: { component: moduleId, ...options.params },
    title: options.title || module.title,
    ...options
  });

  console.log(`[Workspace] Opened module: ${moduleId} (panel: ${panelId})`);
}

/**
 * Close a panel
 * @param {string} panelId - Panel ID to close
 */
function closePanel(panelId) {
  const panel = dockview.panels.find(p => p.id === panelId);
  if (panel) {
    panel.api.close();
    console.log(`[Workspace] Closed panel: ${panelId}`);
  }
}

// Initialize workspace when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWorkspace);
} else {
  initWorkspace();
}
