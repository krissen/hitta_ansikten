/**
 * Workspace Initialization
 *
 * Sets up the Dockview workspace and manages module lifecycle.
 */

import { createDockview } from '../../../node_modules/dockview-core/dist/dockview-core.esm.js';
import { LayoutManager } from './layout-manager.js';
import { LayoutStateTracker } from './layout-state.js';
import { findGroupInDirection, navigateInDirection, addColumn, addRow, removeActiveGroup } from './grid-helpers.js';
import { registerModule, getModule } from './module-registry.js';
import { apiClient } from '../shared/api-client.js';
import { preferences } from './preferences.js';
import { preferencesUI } from './preferences-ui.js';
import { devToolsFocus } from '../shared/devtools-focus.js';
import { workspaceLog, workspaceWarn, workspaceError, workspaceDebug } from '../shared/logger.js';

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
let layoutStateTracker = null;
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
          workspaceError(`Error in event handler for ${eventName}:`, err);
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

    // Detect Cmd+Option+I (open DevTools) and immediately disable shortcuts
    // This prevents race condition where keyboard events arrive before IPC message
    if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'i') {
      devToolsFocus.isDevToolsOpen = true;
      return;
    }

    // Check if keyboard event should be ignored (DevTools focused or input focused)
    if (devToolsFocus.shouldIgnoreKeyboardEvent(event)) {
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
      // Cmd+Shift+] - Add column to the right
      if (event.key === ']') {
        event.preventDefault();
        layoutStateTracker.captureState(dockview);
        addColumn(dockview);
        layoutManager.save();
        return;
      }
      // Cmd+Shift+[ - Remove active column (if empty)
      if (event.key === '[') {
        event.preventDefault();
        layoutStateTracker.captureState(dockview);
        if (removeActiveGroup(dockview)) {
          layoutManager.save();
        }
        return;
      }
      // Cmd+Shift+} - Add row below (Shift+])
      if (event.key === '}') {
        event.preventDefault();
        layoutStateTracker.captureState(dockview);
        addRow(dockview);
        layoutManager.save();
        return;
      }
      // Cmd+Shift+{ - Remove active row (if empty) (Shift+[)
      if (event.key === '{') {
        event.preventDefault();
        layoutStateTracker.captureState(dockview);
        if (removeActiveGroup(dockview)) {
          layoutManager.save();
        }
        return;
      }
    }

    // Cmd+Option+Arrow keys - Move panel to new column/row (create if needed, remove empty)
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        moveToNewGroup('above');
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        moveToNewGroup('below');
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        moveToNewGroup('left');
        return;
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        moveToNewGroup('right');
        return;
      }
    }

    // Cmd+Alt+1-5 - Set column count
    if ((event.metaKey || event.ctrlKey) && event.altKey && !event.shiftKey) {
      const num = parseInt(event.key);
      if (num >= 1 && num <= 5) {
        event.preventDefault();
        layoutManager.setColumnCount(num);
        return;
      }
    }

    // Cmd+Arrow keys - Move active panel in grid (swap)
    if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
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
    workspaceWarn('No active panel to group');
    return;
  }

  const activeGroup = dockview.activeGroup;
  if (!activeGroup) {
    workspaceWarn('No active group');
    return;
  }

  workspaceLog(`Grouping panel ${activePanel.id} with panel ${direction}`);

  // Use directional navigation to find target group
  const targetGroup = findGroupInDirection(dockview, activeGroup, direction);

  if (!targetGroup) {
    workspaceWarn(`No group found ${direction}`);
    return;
  }

  // Get first panel in target group as reference
  const referencePanel = targetGroup.activePanel || targetGroup.panels[0];

  if (!referencePanel) {
    workspaceWarn('No reference panel found in target group');
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
        workspaceLog(`Saved instance state for panel ${activePanel.id}`);
      } catch (err) {
        workspaceWarn(`Failed to save instance state for panel ${activePanel.id}:`, err);
      }
    } else if (moduleInstance.renderer && typeof moduleInstance.renderer.getState === 'function') {
      try {
        savedState = moduleInstance.renderer.getState();
        workspaceLog(`Saved renderer state for panel ${activePanel.id}`);
      } catch (err) {
        workspaceWarn(`Failed to save renderer state for panel ${activePanel.id}:`, err);
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

  // Restore module state with retry mechanism (waits for async init to complete)
  if (savedState && newPanel) {
    restoreModuleStateWithRetry(newPanel.id, savedState, 5, 100);
  }

  workspaceLog(`Panel ${panelParams.id} grouped as tab`);
}

/**
 * Move active panel in the specified direction (swap positions)
 * @param {string} direction - 'above', 'below', 'left', 'right'
 */
function moveActivePanel(direction) {
  const activePanel = dockview.activePanel;
  if (!activePanel) {
    workspaceWarn('No active panel to move');
    return;
  }

  const activeGroup = dockview.activeGroup;
  if (!activeGroup) {
    workspaceWarn('No active group');
    return;
  }

  workspaceLog(`Moving panel ${activePanel.id} ${direction}`);

  // Use directional navigation to find target group
  const targetGroup = findGroupInDirection(dockview, activeGroup, direction);

  if (!targetGroup) {
    workspaceWarn(`No group found ${direction}`);
    return;
  }

  // Get first panel in target group as reference
  const referencePanel = targetGroup.activePanel || targetGroup.panels[0];

  if (!referencePanel) {
    workspaceWarn('No reference panel found in target group');
    return;
  }

  // Get module ID for panel params
  const activeModuleId = activePanel.api?.component || activePanel.params?.component;

  // Capture layout state before modification
  layoutStateTracker.captureState(dockview);

  // Save module state before removing
  let savedState = null;
  const moduleInstance = moduleInstances.get(activePanel.id);
  if (moduleInstance) {
    if (moduleInstance.getState && typeof moduleInstance.getState === 'function') {
      try {
        savedState = moduleInstance.getState();
      } catch (err) {
        workspaceWarn(`Failed to save state:`, err);
      }
    } else if (moduleInstance.renderer && typeof moduleInstance.renderer.getState === 'function') {
      try {
        savedState = moduleInstance.renderer.getState();
      } catch (err) {
        workspaceWarn(`Failed to save renderer state:`, err);
      }
    }
  }

  // Remove the panel from its current position
  const panelParams = {
    id: activePanel.id,
    component: activeModuleId,
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

  // Restore module state with retry mechanism (waits for async init to complete)
  if (savedState && newPanel) {
    restoreModuleStateWithRetry(newPanel.id, savedState, 5, 100);
  }

  // Apply ratios based on module defaults (uses direct resize API, no panel recreation)
  setTimeout(() => {
    applyModuleBasedRatios();
  }, 50);

  workspaceLog(`Panel ${panelParams.id} moved ${direction}`);
}

/**
 * Restore module state with retry mechanism
 * Waits for async init to complete and renderer to be available
 * @param {string} panelId - Panel ID
 * @param {object} savedState - State to restore
 * @param {number} maxRetries - Maximum number of retries
 * @param {number} delay - Delay between retries in ms
 * @param {number} attempt - Current attempt number (internal)
 */
function restoreModuleStateWithRetry(panelId, savedState, maxRetries = 5, delay = 100, attempt = 0) {
  const newModuleInstance = moduleInstances.get(panelId);

  if (!newModuleInstance) {
    if (attempt < maxRetries) {
      setTimeout(() => restoreModuleStateWithRetry(panelId, savedState, maxRetries, delay, attempt + 1), delay);
    } else {
      workspaceWarn(`Failed to restore state for ${panelId}: module instance not found after ${maxRetries} retries`);
    }
    return;
  }

  // Try instance-level setState first
  if (newModuleInstance.setState && typeof newModuleInstance.setState === 'function') {
    try {
      newModuleInstance.setState(savedState);
      workspaceDebug(`Restored state via instance.setState for ${panelId}`);
      return;
    } catch (err) {
      workspaceWarn(`Failed to restore state via instance.setState for ${panelId}:`, err);
    }
  }

  // Try renderer setState (e.g., for image-viewer)
  if (newModuleInstance.renderer && typeof newModuleInstance.renderer.setState === 'function') {
    try {
      newModuleInstance.renderer.setState(savedState);
      // Remove placeholder if exists
      const placeholder = newModuleInstance.container?.querySelector('.image-viewer-placeholder');
      if (placeholder) placeholder.remove();
      workspaceDebug(`Restored state via renderer.setState for ${panelId}`);
      return;
    } catch (err) {
      workspaceWarn(`Failed to restore state via renderer.setState for ${panelId}:`, err);
    }
  }

  // Renderer not available yet - retry
  if (attempt < maxRetries) {
    workspaceDebug(`Renderer not available for ${panelId}, retry ${attempt + 1}/${maxRetries}`);
    setTimeout(() => restoreModuleStateWithRetry(panelId, savedState, maxRetries, delay, attempt + 1), delay);
  } else {
    workspaceWarn(`Failed to restore state for ${panelId}: no setState method found after ${maxRetries} retries`);
  }
}

/**
 * Apply ratios based on the modules currently in each group position
 * Scans all groups and sets ratios based on each group's primary module
 */
function applyModuleBasedRatios() {
  const groups = dockview.groups;
  if (groups.length < 2) return;

  const ratios = [];

  for (const group of groups) {
    // Get the active panel or first panel in the group
    const panel = group.activePanel || group.panels[0];
    if (panel) {
      const moduleId = panel.api?.component || panel.params?.component;
      const config = layoutManager.getModuleLayoutConfig(moduleId);
      ratios.push(config?.ratio || 0.5);
      workspaceLog(`Group has module ${moduleId} with ratio ${config?.ratio}`);
    } else {
      // Empty group - give it default ratio
      ratios.push(0.5);
    }
  }

  // Normalize ratios to sum to 1
  const total = ratios.reduce((sum, r) => sum + r, 0);
  const normalizedRatios = ratios.map(r => r / total);

  workspaceLog(`Applying module-based ratios:`, normalizedRatios);
  layoutManager.setRatios(normalizedRatios);
}

/**
 * Move active panel to a new group in the specified direction
 * Creates a new group if none exists, removes empty source group after move
 * @param {string} direction - 'above', 'below', 'left', 'right'
 */
function moveToNewGroup(direction) {
  const activePanel = dockview.activePanel;
  if (!activePanel) {
    workspaceWarn('No active panel to move');
    return;
  }

  const sourceGroup = dockview.activeGroup;
  if (!sourceGroup) {
    workspaceWarn('No active group');
    return;
  }

  workspaceLog(`Moving panel ${activePanel.id} to new group ${direction}`);

  // Capture layout state before modification
  layoutStateTracker.captureState(dockview);

  // Save module state before removing
  let savedState = null;
  const moduleInstance = moduleInstances.get(activePanel.id);
  if (moduleInstance) {
    if (moduleInstance.getState && typeof moduleInstance.getState === 'function') {
      try {
        savedState = moduleInstance.getState();
      } catch (err) {
        workspaceWarn(`Failed to save state:`, err);
      }
    } else if (moduleInstance.renderer && typeof moduleInstance.renderer.getState === 'function') {
      try {
        savedState = moduleInstance.renderer.getState();
      } catch (err) {
        workspaceWarn(`Failed to save renderer state:`, err);
      }
    }
  }

  // Check how many panels are in the source group
  const sourcePanelCount = sourceGroup.panels.length;

  // Store panel info before removing
  const panelParams = {
    id: activePanel.id,
    component: activePanel.api?.component || activePanel.params?.component,
    params: activePanel.params,
    title: activePanel.title
  };

  // Remove the panel from its current group
  dockview.removePanel(activePanel);

  // Create new group in the specified direction
  // Use the source group as reference (it still exists if it had other panels)
  const referenceGroup = sourcePanelCount > 1 ? sourceGroup : dockview.activeGroup || dockview.groups[0];

  if (!referenceGroup) {
    workspaceWarn('No reference group available');
    return;
  }

  // Add panel to new group in the specified direction
  const newPanel = dockview.addPanel({
    ...panelParams,
    position: {
      referenceGroup: referenceGroup,
      direction: direction
    }
  });

  // If source group is now empty (had only this panel), it should auto-remove
  // Dockview typically removes empty groups automatically, but let's verify
  if (sourcePanelCount === 1) {
    // The source group should have been removed when we removed its only panel
    workspaceLog(`Source group was emptied and should be auto-removed`);
  }

  // Restore module state with retry mechanism (waits for async init to complete)
  if (savedState && newPanel) {
    restoreModuleStateWithRetry(newPanel.id, savedState, 5, 100);
  }

  layoutManager.save();
  workspaceLog(`Panel ${panelParams.id} moved to new group ${direction}`);
}

/**
 * Open file dialog and load selected image
 */
async function openFileDialog() {
  try {
    const filePath = await window.bildvisareAPI.invoke('open-file-dialog');

    if (!filePath) {
      workspaceLog('File dialog canceled');
      return;
    }

    workspaceLog(`Opening file: ${filePath}`);

    // Find image viewer module and trigger load-image event
    const imageViewerInstance = Array.from(moduleInstances.values()).find(
      instance => instance.module.id === 'image-viewer'
    );

    if (imageViewerInstance) {
      // Directly trigger the event on the image viewer's API
      imageViewerInstance.api._triggerEvent('load-image', { imagePath: filePath });
    } else {
      workspaceWarn('No image viewer module found');
    }
  } catch (err) {
    workspaceError('Failed to open file:', err);
  }
}

/**
 * Apply UI preferences to CSS variables
 */
function applyUIPreferences() {
  workspaceDebug('applyUIPreferences() called');

  // Find the workspace root element
  const workspaceRoot = document.querySelector('.bildvisare-workspace');
  if (!workspaceRoot) {
    workspaceError('Could not find .bildvisare-workspace element!');
    return;
  }

  // Sizes and spacing
  const tabsHeight = preferences.get('appearance.tabsHeight') || 28;
  const tabsFontSize = preferences.get('appearance.tabsFontSize') || 13;
  const tabPaddingLeft = preferences.get('appearance.tabPaddingLeft') || 8;
  const tabPaddingRight = preferences.get('appearance.tabPaddingRight') || 6;
  const tabMinGap = preferences.get('appearance.tabMinGap') || 10;

  workspaceDebug('Setting size CSS variables on .bildvisare-workspace...');
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

  workspaceDebug('Color values from preferences:', {
    activeTabBackground, inactiveTabBackground, activeTabColor, inactiveTabColor,
    tabContainerBackground, groupBorderColor
  });

  workspaceDebug('Setting color CSS variables on .bildvisare-workspace...');
  workspaceRoot.style.setProperty('--dv-active-tab-background', activeTabBackground);
  workspaceRoot.style.setProperty('--dv-inactive-tab-background', inactiveTabBackground);
  workspaceRoot.style.setProperty('--dv-active-tab-color', activeTabColor);
  workspaceRoot.style.setProperty('--dv-inactive-tab-color', inactiveTabColor);
  workspaceRoot.style.setProperty('--dv-tab-container-background', tabContainerBackground);
  workspaceRoot.style.setProperty('--dv-group-border-color', groupBorderColor);

  // Verify variables were set
  workspaceDebug('Verifying CSS variables were set on workspace element:');
  workspaceDebug('  --dv-active-tab-background:', workspaceRoot.style.getPropertyValue('--dv-active-tab-background'));
  workspaceDebug('  --dv-inactive-tab-background:', workspaceRoot.style.getPropertyValue('--dv-inactive-tab-background'));
  workspaceDebug('  --dv-active-tab-color:', workspaceRoot.style.getPropertyValue('--dv-active-tab-color'));

  workspaceDebug('Applied appearance preferences:', {
    tabsHeight, tabsFontSize, tabPaddingLeft, tabPaddingRight, tabMinGap,
    activeTabBackground, inactiveTabBackground, activeTabColor, inactiveTabColor,
    tabContainerBackground, groupBorderColor
  });
}

/**
 * Initialize workspace
 */
async function initWorkspace() {
  workspaceLog('Initializing...');

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

  // Create layout manager and state tracker
  layoutManager = new LayoutManager(dockview);
  layoutStateTracker = new LayoutStateTracker();

  // Setup auto-save on layout changes
  dockview.onDidLayoutChange(() => {
    // Log final layout result
    const panels = dockview.panels || [];
    const groups = dockview.groups || [];

    workspaceDebug('Layout changed - Final result:', {
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
    workspaceLog('WebSocket connected');
  } catch (err) {
    workspaceError('Failed to connect WebSocket:', err);
    // Continue anyway - modules can still use HTTP API
  }

  workspaceLog('Initialized successfully');

  // Make workspace globally accessible for debugging
  window.workspace = {
    dockview,
    layoutManager,
    layoutStateTracker,
    openModule,
    closePanel,
    getModuleInstances: () => moduleInstances,
    apiClient, // Expose API client for debugging
    preferences, // Expose preferences for debugging and module access
    preferencesUI, // Expose preferences UI for debugging
    applyUIPreferences, // Expose for reapplying after preference changes
    // Layout helpers
    addColumn: () => addColumn(dockview),
    addRow: () => addRow(dockview),
    removeActiveGroup: (force) => removeActiveGroup(dockview, force),
    navigateInDirection: (direction) => navigateInDirection(dockview, direction),
    moveToNewGroup: (direction) => moveToNewGroup(direction)
  };

  // Listen for initial file path from main process
  if (window.bildvisareAPI) {
    window.bildvisareAPI.on('load-initial-file', (filePath) => {
      workspaceLog('Received initial file path:', filePath);

      // Find image viewer module and trigger load
      const imageViewerInstance = Array.from(moduleInstances.values()).find(
        instance => instance.module.id === 'image-viewer'
      );

      if (imageViewerInstance) {
        imageViewerInstance.api._triggerEvent('load-image', { imagePath: filePath });
        workspaceLog('Triggered load-image event for initial file');
      } else {
        workspaceWarn('No image viewer module found for initial file load');
      }
    });

    // Listen for menu commands
    window.bildvisareAPI.on('menu-command', async (command) => {
      workspaceDebug('Menu command:', command);

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

        case 'layout-add-column':
          layoutStateTracker.captureState(dockview);
          addColumn(dockview);
          layoutManager.save();
          break;

        case 'layout-remove-column':
          layoutStateTracker.captureState(dockview);
          if (removeActiveGroup(dockview)) {
            layoutManager.save();
          }
          break;

        case 'layout-add-row':
          layoutStateTracker.captureState(dockview);
          addRow(dockview);
          layoutManager.save();
          break;

        case 'layout-remove-row':
          layoutStateTracker.captureState(dockview);
          if (removeActiveGroup(dockview)) {
            layoutManager.save();
          }
          break;

        case 'layout-move-new-left':
          moveToNewGroup('left');
          break;

        case 'layout-move-new-right':
          moveToNewGroup('right');
          break;

        case 'layout-move-new-above':
          moveToNewGroup('above');
          break;

        case 'layout-move-new-below':
          moveToNewGroup('below');
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
          workspaceWarn('Unknown menu command:', command);
      }
    });
  }
}

/**
 * Reload face database from backend
 */
async function reloadDatabase() {
  try {
    workspaceLog('Reloading database...');

    const response = await apiClient.post('/reload-database', {});

    if (response.status === 'success') {
      workspaceLog(`Database reloaded: ${response.people_count} people, ${response.ignored_count} ignored`);
      alert(`Database reloaded successfully!\n\n${response.people_count} people\n${response.ignored_count} ignored faces\n${response.cache_cleared} cached results cleared`);
    }
  } catch (err) {
    workspaceError('Failed to reload database:', err);
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
    workspaceLog('Layout exported successfully');
  } catch (err) {
    workspaceError('Failed to export layout:', err);
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
      workspaceLog('Layout imported successfully');
      alert('Layout imported successfully!');
    } catch (err) {
      workspaceError('Failed to import layout:', err);
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

Layout:
  Cmd+Arrow      Navigate to adjacent panel
  Cmd+Opt+Arrow  Move panel to new column/row
  Cmd+Opt+1-5    Set number of columns (1-5)
  Cmd+Shift+]    Add column
  Cmd+Shift+[    Remove column
  Cmd+Shift+}    Add row
  Cmd+Shift+{    Remove row

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

  workspaceLog(`Creating component for module: ${name}`);

  const module = getModule(name);
  if (!module) {
    workspaceError(`Module not found: ${name}`);
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
      workspaceLog(`Initializing module: ${name} (panel: ${id})`);

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

        workspaceLog(`Module ${name} initialized`);
      }).catch(err => {
        workspaceError(`Failed to initialize module ${name}:`, err);
        container.innerHTML = `<div style="padding: 20px; color: red;">Error loading module: ${err.message}</div>`;
      });
    },

    // Dispose method called by Dockview
    dispose: () => {
      workspaceLog(`Disposing module: ${id}`);
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
    workspaceError(`Cannot open module: ${moduleId} not found`);
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

  workspaceLog(`Opened module: ${moduleId} (panel: ${panelId})`);
}

/**
 * Close a panel
 * @param {string} panelId - Panel ID to close
 */
function closePanel(panelId) {
  const panel = dockview.panels.find(p => p.id === panelId);
  if (panel) {
    panel.api.close();
    workspaceLog(`Closed panel: ${panelId}`);
  }
}

// Initialize workspace when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initWorkspace);
} else {
  initWorkspace();
}
