/**
 * FlexLayoutWorkspace - Main workspace component using FlexLayout
 *
 * Pure React implementation - all modules are React components.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';
import { reviewLayout, getLayoutByName } from './layouts.js';
import { preferences } from '../preferences.js';
import { preferencesUI } from '../preferences-ui.js';
import { useModuleAPI } from '../../context/ModuleAPIContext.jsx';
import { debug, debugWarn, debugError } from '../../shared/debug.js';

// Import React components directly
import { ImageViewer } from '../../components/ImageViewer.jsx';
import { OriginalView } from '../../components/OriginalView.jsx';
import { LogViewer } from '../../components/LogViewer.jsx';
import { StatisticsDashboard } from '../../components/StatisticsDashboard.jsx';
import { ReviewModule } from '../../components/ReviewModule.jsx';
import { DatabaseManagement } from '../../components/DatabaseManagement.jsx';
import { FileQueueModule } from '../../components/FileQueueModule.jsx';

// Storage key for layout persistence
const STORAGE_KEY = 'bildvisare-flexlayout';

// Module component mapping
const MODULE_COMPONENTS = {
  'image-viewer': ImageViewer,
  'original-view': OriginalView,
  'log-viewer': LogViewer,
  'statistics-dashboard': StatisticsDashboard,
  'review-module': ReviewModule,
  'database-management': DatabaseManagement,
  'file-queue': FileQueueModule
};

// Module titles
const MODULE_TITLES = {
  'image-viewer': 'Image Viewer',
  'original-view': 'Original View',
  'log-viewer': 'Logs',
  'statistics-dashboard': 'Statistics Dashboard',
  'review-module': 'Face Review',
  'database-management': 'Database Management',
  'file-queue': 'File Queue'
};

// Module-specific default layout ratios
// widthRatio: proportion of row width (horizontal split)
// heightRatio: proportion when in a secondary row (vertical split)
// row: default row (1 = primary/top, 2 = secondary/bottom)
const MODULE_LAYOUT = {
  'review-module': {
    widthRatio: 0.15,     // 15% width in its row
    heightRatio: 0.70,    // Primary row gets 70% height
    row: 1
  },
  'image-viewer': {
    widthRatio: 0.85,     // 85% width in its row
    heightRatio: 0.70,    // Primary row gets 70% height
    row: 1
  },
  'original-view': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.70,    // Primary row
    row: 1
  },
  'log-viewer': {
    widthRatio: 0.50,     // 50% when sharing row with stats
    heightRatio: 0.30,    // Secondary row gets 30% height
    row: 2
  },
  'statistics-dashboard': {
    widthRatio: 0.50,     // 50% when sharing row with log
    heightRatio: 0.30,    // Secondary row gets 30% height
    row: 2
  },
  'database-management': {
    widthRatio: 0.50,     // 50% when sharing row
    heightRatio: 0.30,    // Secondary row
    row: 2
  },
  'file-queue': {
    widthRatio: 0.15,     // 15% width in sidebar
    heightRatio: 0.70,    // Primary row
    row: 1
  }
};

// Simple width ratios for backward compatibility
const MODULE_RATIOS = Object.fromEntries(
  Object.entries(MODULE_LAYOUT).map(([k, v]) => [k, v.widthRatio])
);

/**
 * Apply UI preferences to FlexLayout CSS variables
 * Maps preferences to FlexLayout's theming system
 * @param {object} overrides - Optional override values (for live preview)
 */
function applyUIPreferences(overrides = null) {
  const layoutEl = document.querySelector('.flexlayout__layout');
  if (!layoutEl) {
    debug('FlexLayout', 'Layout element not found, will retry');
    return false;
  }

  // Helper to get value from overrides or preferences
  const getValue = (path, defaultVal) => {
    if (overrides && overrides.appearance) {
      const key = path.split('.').pop();
      if (overrides.appearance[key] !== undefined) {
        return overrides.appearance[key];
      }
    }
    return preferences.get(path) || defaultVal;
  };

  // Size preferences
  const tabsHeight = getValue('appearance.tabsHeight', 28);
  const tabsFontSize = getValue('appearance.tabsFontSize', 13);
  const tabPaddingLeft = getValue('appearance.tabPaddingLeft', 8);
  const tabPaddingRight = getValue('appearance.tabPaddingRight', 6);
  const tabMinGap = getValue('appearance.tabMinGap', 5);

  // Color preferences - three tab states:
  // 1. Focused: selected tab in the focused panel (keyboard focus)
  // 2. Visible: selected tab in non-focused panels
  // 3. Hidden: unselected tabs (behind other tabs)
  const focusedTabBackground = getValue('appearance.focusedTabBackground', '#ffffff');
  const focusedTabColor = getValue('appearance.focusedTabColor', '#1a1a1a');
  const visibleTabBackground = getValue('appearance.visibleTabBackground', '#e8e8e8');
  const visibleTabColor = getValue('appearance.visibleTabColor', '#555555');
  const hiddenTabBackground = getValue('appearance.hiddenTabBackground', '#d8d8d8');
  const hiddenTabColor = getValue('appearance.hiddenTabColor', '#999999');
  const tabContainerBackground = getValue('appearance.tabContainerBackground', '#d0d0d0');
  const groupBorderColor = getValue('appearance.groupBorderColor', 'rgba(128, 128, 128, 0.2)');

  // Apply to FlexLayout CSS variables (base styles)
  layoutEl.style.setProperty('--font-size', `${tabsFontSize}px`);
  layoutEl.style.setProperty('--color-text', focusedTabColor);
  layoutEl.style.setProperty('--color-background', focusedTabBackground);
  layoutEl.style.setProperty('--color-tabset-background', tabContainerBackground);
  layoutEl.style.setProperty('--color-splitter', groupBorderColor);
  layoutEl.style.setProperty('--color-tabset-divider-line', groupBorderColor);

  // Apply tab button styling via direct CSS injection
  // We need specific selectors for the three tab states
  let styleEl = document.getElementById('flexlayout-preferences-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'flexlayout-preferences-style';
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    /* Base tab button styling */
    .flexlayout__tab_button {
      padding: 4px ${tabPaddingRight}px 4px ${tabPaddingLeft}px !important;
      height: ${tabsHeight}px !important;
      box-sizing: border-box !important;
      font-size: ${tabsFontSize}px !important;
      gap: ${tabMinGap}px !important;
    }
    .flexlayout__tabset_tabbar_outer {
      font-size: ${tabsFontSize}px !important;
      min-height: ${tabsHeight + 4}px !important;
    }
    .flexlayout__tabset_tabbar_outer_top,
    .flexlayout__tabset_tabbar_outer_bottom {
      background-color: ${tabContainerBackground} !important;
    }
    .flexlayout__tabset-header {
      background-color: ${tabContainerBackground} !important;
    }

    /* VISIBLE: Default style for all selected tabs (in non-focused panels) */
    .flexlayout__tab_button--selected {
      background-color: ${visibleTabBackground} !important;
      color: ${visibleTabColor} !important;
    }

    /* FOCUSED: Override for tabs in the active/focused panel (higher specificity wins) */
    .flexlayout__tabset-selected .flexlayout__tab_button--selected {
      background-color: ${focusedTabBackground} !important;
      color: ${focusedTabColor} !important;
    }

    /* HIDDEN: Unselected/background tabs (behind other tabs in same panel) */
    .flexlayout__tab_button--unselected {
      background-color: ${hiddenTabBackground} !important;
      color: ${hiddenTabColor} !important;
    }
  `;

  debug('FlexLayout', 'Applied UI preferences');
  return true;
}

/**
 * FlexLayoutWorkspace Component
 */
export function FlexLayoutWorkspace() {
  const layoutRef = useRef(null);
  const [model, setModel] = useState(null);
  const [ready, setReady] = useState(false);
  const moduleAPI = useModuleAPI();

  // Initialize model
  useEffect(() => {
    // Try to load saved layout
    let layoutConfig;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        debug('FlexLayout', 'Loading saved layout');
        layoutConfig = JSON.parse(saved);
      }
    } catch (err) {
      debugWarn('FlexLayout', 'Failed to load saved layout:', err);
    }

    // Fall back to default layout
    if (!layoutConfig) {
      const defaultLayout = preferences.get('workspace.defaultLayout') || 'review';
      debug('FlexLayout', 'Using default layout:', defaultLayout);
      layoutConfig = getLayoutByName(defaultLayout);
    }

    // Ensure critical global settings are always applied
    // (saved layouts may not have newer settings)
    const criticalSettings = {
      tabEnableRenderOnDemand: false,  // Keep all tabs mounted for event handling
      splitterSize: 4,                  // Consistent splitter appearance
      tabSetMinWidth: 100,              // Prevent panels from becoming too small
      tabSetMinHeight: 100,
    };
    layoutConfig.global = { ...layoutConfig.global, ...criticalSettings };

    // Create model from config
    try {
      const newModel = Model.fromJson(layoutConfig);
      setModel(newModel);
      setReady(true);
      debug('FlexLayout', 'Model created');
    } catch (err) {
      debugError('FlexLayout', 'Failed to create model:', err);
      // Fall back to default
      setModel(Model.fromJson(reviewLayout));
      setReady(true);
    }
  }, []);

  // Apply UI preferences when ready (and re-apply when preferences change)
  useEffect(() => {
    if (!ready) return;

    // Apply preferences (may need retry if layout element not yet mounted)
    const tryApply = () => {
      if (!applyUIPreferences()) {
        setTimeout(tryApply, 100);
      }
    };
    tryApply();

    // Listen for preference changes (saved) - read from actual preferences
    const handlePrefChange = () => applyUIPreferences();
    window.addEventListener('preferences-changed', handlePrefChange);

    // Listen for live preview - use tempPrefs from event
    const handlePreview = (e) => {
      if (e.detail && e.detail.tempPrefs) {
        applyUIPreferences(e.detail.tempPrefs);
      }
    };
    window.addEventListener('preferences-preview', handlePreview);

    // Listen for cancel - restore from actual saved preferences
    const handleCancel = () => applyUIPreferences();
    window.addEventListener('preferences-cancelled', handleCancel);

    return () => {
      window.removeEventListener('preferences-changed', handlePrefChange);
      window.removeEventListener('preferences-preview', handlePreview);
      window.removeEventListener('preferences-cancelled', handleCancel);
    };
  }, [ready]);

  // Save layout on model change
  const handleModelChange = useCallback((newModel) => {
    try {
      const json = newModel.toJson();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
    } catch (err) {
      debugWarn('FlexLayout', 'Failed to save layout:', err);
    }
  }, []);

  // Modules that are singletons (only one instance allowed, switch to existing)
  // These modules show content related to "the current file" or global state
  const SINGLETON_MODULES = new Set([
    'image-viewer',    // Shows current file being reviewed
    'review-module',   // Shows faces for current file
    'file-queue',      // Only one queue exists
    'original-view'    // Shows original of current file
  ]);

  // Open a module tab
  // - Singleton modules: reuses existing if found (unless forceNew is true)
  // - Non-singleton modules: always creates new instance
  const openModule = useCallback((moduleId, options = {}) => {
    if (!model || !layoutRef.current) return;

    const ModuleComponent = MODULE_COMPONENTS[moduleId];
    if (!ModuleComponent) {
      debugError('FlexLayout', `Module not found: ${moduleId}`);
      return;
    }

    // Check if module is a singleton and already exists
    const isSingleton = SINGLETON_MODULES.has(moduleId);
    if (isSingleton && !options.forceNew) {
      let existingTab = null;
      model.visitNodes(node => {
        if (node.getComponent?.() === moduleId && node.getType() === 'tab') {
          existingTab = node;
        }
      });

      if (existingTab) {
        // Select the existing tab instead of creating a new one
        model.doAction(Actions.selectTab(existingTab.getId()));
        debug('FlexLayout', `Focused existing singleton module: ${moduleId}`);
        return;
      }
    }

    const tabJson = {
      type: 'tab',
      name: MODULE_TITLES[moduleId] || moduleId,
      component: moduleId,
      config: { moduleId }
    };

    // Find target tabset or use active one
    const activeTabset = model.getActiveTabset();
    if (activeTabset) {
      model.doAction(Actions.addNode(tabJson, activeTabset.getId(), DockLocation.CENTER, -1));
    }

    debug('FlexLayout', `Opened new module: ${moduleId}${isSingleton ? ' (singleton)' : ''}`);
  }, [model]);

  // Close a panel by ID
  const closePanel = useCallback((panelId) => {
    if (!model) return;

    const node = model.getNodeById(panelId);
    if (node) {
      model.doAction(Actions.deleteTab(panelId));
      debug('FlexLayout', `Closed panel: ${panelId}`);
    }
  }, [model]);

  // Factory function for FlexLayout
  const factory = useCallback((node) => {
    const component = node.getComponent();
    const ModuleComponent = MODULE_COMPONENTS[component];

    if (!ModuleComponent) {
      return (
        <div style={{ padding: 20, color: '#666' }}>
          Unknown module: {component}
        </div>
      );
    }

    return <ModuleComponent />;
  }, []);

  // Get tabset position in layout (using bounding rect)
  const getTabsetPosition = useCallback((tabset) => {
    if (!layoutRef.current) return { x: 0, y: 0 };

    const tabsetId = tabset.getId();

    // FlexLayout uses class-based selectors, find the tabset container
    // The tabset header contains a unique identifier we can use
    const allTabsets = document.querySelectorAll('.flexlayout__tabset');

    for (const element of allTabsets) {
      // Check if this element corresponds to our tabset by matching tab IDs
      const tabButtons = element.querySelectorAll('.flexlayout__tab_button');
      for (const btn of tabButtons) {
        const btnId = btn.getAttribute('data-layout-path');
        if (btnId && btnId.includes(tabsetId)) {
          const rect = element.getBoundingClientRect();
          return {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            rect
          };
        }
      }
    }

    // Fallback: try to find by iterating through layout structure
    const allElements = document.querySelectorAll('.flexlayout__tabset');
    if (allElements.length > 0) {
      // Get tabsets from model and match by index
      const tabsets = [];
      model.visitNodes((node) => {
        if (node.getType() === 'tabset') {
          tabsets.push(node);
        }
      });

      const tabsetIndex = tabsets.findIndex(ts => ts.getId() === tabsetId);
      if (tabsetIndex >= 0 && tabsetIndex < allElements.length) {
        const element = allElements[tabsetIndex];
        const rect = element.getBoundingClientRect();
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          rect
        };
      }
    }

    return { x: 0, y: 0 };
  }, [model]);

  // Find tabset in direction based on position
  const findTabsetInDirection = useCallback((fromTabset, direction) => {
    const tabsets = [];
    model.visitNodes((node) => {
      if (node.getType() === 'tabset') {
        tabsets.push(node);
      }
    });

    if (tabsets.length < 2) return null;

    const fromPos = getTabsetPosition(fromTabset);

    // Filter tabsets in the specified direction
    const candidates = tabsets.filter(ts => {
      if (ts.getId() === fromTabset.getId()) return false;
      const pos = getTabsetPosition(ts);

      switch (direction) {
        case 'left':
          return pos.x < fromPos.x;
        case 'right':
          return pos.x > fromPos.x;
        case 'up':
          return pos.y < fromPos.y;
        case 'down':
          return pos.y > fromPos.y;
        default:
          return false;
      }
    });

    if (candidates.length === 0) return null;

    // Sort by distance and return nearest
    candidates.sort((a, b) => {
      const posA = getTabsetPosition(a);
      const posB = getTabsetPosition(b);
      const distA = Math.sqrt(Math.pow(posA.x - fromPos.x, 2) + Math.pow(posA.y - fromPos.y, 2));
      const distB = Math.sqrt(Math.pow(posB.x - fromPos.x, 2) + Math.pow(posB.y - fromPos.y, 2));
      return distA - distB;
    });

    return candidates[0];
  }, [model, getTabsetPosition]);

  // Add a new tabset (column or row)
  const addTabset = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) {
      debug('FlexLayout', 'No active tabset for adding', direction);
      return;
    }

    // FlexLayout's addNode with RIGHT or BOTTOM location creates new tabset
    const location = direction === 'column' ? DockLocation.RIGHT : DockLocation.BOTTOM;

    // Create a placeholder tab in the new tabset
    const placeholderTab = {
      type: 'tab',
      name: 'Image Viewer',
      component: 'image-viewer',
      config: { moduleId: 'image-viewer' }
    };

    model.doAction(Actions.addNode(placeholderTab, activeTabset.getId(), location, -1));
    debug('FlexLayout', `Added new ${direction}`);
  }, [model]);

  // Remove empty tabset
  const removeEmptyTabset = useCallback(() => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return false;

    const children = activeTabset.getChildren();
    if (children.length === 0) {
      debug('FlexLayout', 'Cannot remove empty tabset directly');
      return false;
    }

    if (children.length === 1) {
      // Remove the single tab, which may remove the tabset
      const tabId = children[0].getId();
      model.doAction(Actions.deleteTab(tabId));
      debug('FlexLayout', 'Removed last tab from tabset');
      return true;
    }

    debug('FlexLayout', `Tabset has ${children.length} tabs, not removing`);
    return false;
  }, [model]);

  // Load a preset layout
  const loadLayout = useCallback((layoutName) => {
    debug('FlexLayout', `Loading layout: ${layoutName}`);
    const layoutConfig = getLayoutByName(layoutName);
    try {
      const newModel = Model.fromJson(layoutConfig);
      setModel(newModel);
    } catch (err) {
      debugError('FlexLayout', 'Failed to load layout:', err);
    }
  }, []);

  // Helper: Get DockLocation from direction string
  const getDockLocation = useCallback((direction) => {
    switch (direction) {
      case 'left': return DockLocation.LEFT;
      case 'right': return DockLocation.RIGHT;
      case 'above':
      case 'up': return DockLocation.TOP;
      case 'below':
      case 'down': return DockLocation.BOTTOM;
      default: return DockLocation.RIGHT;
    }
  }, []);

  // Apply module-based ratios to all tabsets
  // Handles both width ratios (horizontal) and height ratios (vertical)
  const applyModuleBasedRatios = useCallback(() => {
    const root = model.getRoot();
    if (!root) return;

    // Helper: Get module layout config
    const getModuleLayout = (moduleId) => MODULE_LAYOUT[moduleId] || { widthRatio: 0.5, heightRatio: 0.5, row: 1 };

    // Helper: Apply width ratios to tabsets in a row
    const applyWidthRatios = (children) => {
      const tabsetsWithModules = [];
      children.forEach(child => {
        if (child.getType() === 'tabset') {
          const selectedTab = child.getSelectedNode();
          if (selectedTab) {
            const moduleId = selectedTab.getComponent();
            const layout = getModuleLayout(moduleId);
            tabsetsWithModules.push({ node: child, moduleId, ratio: layout.widthRatio });
          }
        }
      });

      if (tabsetsWithModules.length < 2) return;

      // Normalize ratios
      const totalRatio = tabsetsWithModules.reduce((sum, t) => sum + t.ratio, 0);
      tabsetsWithModules.forEach(t => {
        const weight = Math.round((t.ratio / totalRatio) * 100);
        model.doAction(Actions.updateNodeAttributes(t.node.getId(), { weight }));
        debug('FlexLayout', `Set ${t.moduleId} width weight to ${weight}`);
      });
    };

    // Helper: Apply height ratios to rows
    const applyHeightRatios = (rows) => {
      if (rows.length < 2) return;

      // Determine height ratio for each row based on its modules
      const rowHeights = rows.map(row => {
        // Find modules in this row
        let heightRatio = 0.5; // default
        row.getChildren().forEach(child => {
          if (child.getType() === 'tabset') {
            const selectedTab = child.getSelectedNode();
            if (selectedTab) {
              const moduleId = selectedTab.getComponent();
              const layout = getModuleLayout(moduleId);
              heightRatio = layout.heightRatio;
            }
          }
        });
        return { node: row, heightRatio };
      });

      // Apply height weights
      const totalHeight = rowHeights.reduce((sum, r) => sum + r.heightRatio, 0);
      rowHeights.forEach(r => {
        const weight = Math.round((r.heightRatio / totalHeight) * 100);
        model.doAction(Actions.updateNodeAttributes(r.node.getId(), { weight }));
        debug('FlexLayout', `Set row height weight to ${weight}`);
      });
    };

    // Process root children
    const children = root.getChildren();
    const rows = children.filter(c => c.getType() === 'row');
    const tabsets = children.filter(c => c.getType() === 'tabset');

    if (rows.length > 0) {
      // Vertical layout: multiple rows
      applyHeightRatios(rows);
      // Apply width ratios within each row
      rows.forEach(row => applyWidthRatios(row.getChildren()));
    } else if (tabsets.length > 0) {
      // Horizontal layout: just tabsets in root
      applyWidthRatios(tabsets);
    }

    debug('FlexLayout', 'Applied module-based ratios');
  }, [model]);

  // Swap active panel with panel in specified direction (Cmd+Arrow)
  // Moves the active tab past the target tabset, then applies module-based ratios
  const swapActivePanel = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) {
      debug('FlexLayout', 'No active tabset');
      return;
    }

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) {
      debug('FlexLayout', 'No active tab to swap');
      return;
    }

    // Find target tabset in direction
    const targetTabset = findTabsetInDirection(activeTabset, direction);
    if (!targetTabset) {
      debug('FlexLayout', 'No tabset found in direction:', direction);
      return;
    }

    // Move active tab past the target (in the direction pressed)
    // This creates: pressing Right on [A][B] -> [B][A]
    const dockLocation = getDockLocation(direction);
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      dockLocation,
      -1,
      true
    ));

    // After the move, apply module-based ratios
    // Each module gets its default width ratio regardless of position
    setTimeout(() => {
      applyModuleBasedRatios();
    }, 50);

    debug('FlexLayout', 'Swapped panel', direction);
  }, [model, findTabsetInDirection, getDockLocation, applyModuleBasedRatios]);

  // Move active panel to new tabset in direction (Cmd+Alt+Arrow)
  const moveToNewTabset = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return;

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) return;

    // Move to root in the specified direction (creates new tabset)
    const rootNode = model.getRoot();
    const dockLocation = getDockLocation(direction);
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      rootNode.getId(),
      dockLocation,
      -1,
      true
    ));

    // Apply module-based ratios after the move
    setTimeout(() => {
      applyModuleBasedRatios();
    }, 50);

    debug('FlexLayout', 'Moved panel to new tabset', direction);
  }, [model, getDockLocation, applyModuleBasedRatios]);

  // Group active panel as tab with panel in direction (Cmd+Shift+Arrow)
  const groupAsTab = useCallback((direction) => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return;

    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) return;

    // Find target tabset in direction
    const targetTabset = findTabsetInDirection(activeTabset, direction);
    if (!targetTabset) {
      debug('FlexLayout', 'No tabset found in direction:', direction);
      return;
    }

    // Move to target tabset as a tab (CENTER location = same tabset)
    model.doAction(Actions.moveNode(
      activeTab.getId(),
      targetTabset.getId(),
      DockLocation.CENTER,
      -1,
      true
    ));
    debug('FlexLayout', 'Grouped panel as tab in direction', direction);
  }, [model, findTabsetInDirection]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!model || !ready) return;

    const handleKeyDown = (event) => {
      // Check if should ignore (input focused, etc.)
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      const isMod = event.metaKey || event.ctrlKey;

      // Cmd+Shift+R / Ctrl+Shift+R - Hard reload
      if (isMod && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        window.location.reload(true);
        return;
      }

      // Cmd+R / Ctrl+R - Reload
      if (isMod && event.key.toLowerCase() === 'r' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        window.location.reload();
        return;
      }

      // === Arrow key combinations ===
      const arrowKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
      if (isMod && arrowKeys.includes(event.key)) {
        const dirMap = {
          'ArrowLeft': 'left',
          'ArrowRight': 'right',
          'ArrowUp': 'above',
          'ArrowDown': 'below'
        };
        const direction = dirMap[event.key];

        // Cmd+Shift+Arrow: Group as tab with panel in direction
        if (event.shiftKey && !event.altKey) {
          event.preventDefault();
          groupAsTab(direction);
          return;
        }

        // Cmd+Alt+Arrow: Move panel to new column/row
        if (event.altKey && !event.shiftKey) {
          event.preventDefault();
          moveToNewTabset(direction);
          return;
        }

        // Cmd+Arrow (no modifiers): Swap/move panel positions
        if (!event.shiftKey && !event.altKey) {
          event.preventDefault();
          swapActivePanel(direction);
          return;
        }
      }

      // === Bracket key combinations ===
      if (isMod && event.shiftKey) {
        // Cmd+Shift+] - Add column to the right
        if (event.key === ']') {
          event.preventDefault();
          addTabset('column');
          return;
        }
        // Cmd+Shift+[ - Remove active tabset (if possible)
        if (event.key === '[') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
        // Cmd+Shift+} - Add row below
        if (event.key === '}') {
          event.preventDefault();
          addTabset('row');
          return;
        }
        // Cmd+Shift+{ - Remove active tabset (if possible)
        if (event.key === '{') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
      }

      // Cmd+Alt+1-5: Set column count (future enhancement)
      // FlexLayout doesn't have direct column count control like Dockview
      // Would need to restructure the entire layout

      // Cmd+O: Open file
      if (isMod && event.key === 'o' && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        openFileDialog();
        return;
      }
    };

    const openFileDialog = async () => {
      try {
        // Use multi-file dialog (same as + button in FileQueue)
        const filePaths = await window.bildvisareAPI?.invoke('open-multi-file-dialog');
        if (!filePaths || filePaths.length === 0) return;

        debug('FlexLayout', `Opening ${filePaths.length} file(s)`);
        // Add to queue - FileQueue will handle loading the first file
        if (window.fileQueue?.add) {
          window.fileQueue.add(filePaths);
          // Start queue if it wasn't running
          setTimeout(() => window.fileQueue.start?.(), 100);
        } else {
          // Fallback: emit for single file
          moduleAPI.emit('load-image', { imagePath: filePaths[0] });
        }
      } catch (err) {
        debugError('FlexLayout', 'Failed to open file:', err);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [model, ready, swapActivePanel, moveToNewTabset, groupAsTab, addTabset, removeEmptyTabset, moduleAPI]);

  // Setup IPC listeners
  useEffect(() => {
    if (!ready || !window.bildvisareAPI) return;

    // Request initial file path (if app was launched with a file argument)
    const loadInitialFile = async () => {
      try {
        const filePath = await window.bildvisareAPI.invoke('get-initial-file');
        if (filePath) {
          debug('FlexLayout', 'Loading initial file:', filePath);
          moduleAPI.emit('load-image', { imagePath: filePath });
        }
      } catch (err) {
        debugError('FlexLayout', 'Failed to get initial file:', err);
      }
    };
    loadInitialFile();

    // Listen for menu commands
    const handleMenuCommand = async (command) => {
      debug('FlexLayout', 'Menu command:', command);

      switch (command) {
        // File commands
        case 'open-file': {
          // Use multi-file dialog (same as Cmd+O and + button)
          const filePaths = await window.bildvisareAPI?.invoke('open-multi-file-dialog');
          if (filePaths && filePaths.length > 0) {
            if (window.fileQueue?.add) {
              window.fileQueue.add(filePaths);
              setTimeout(() => window.fileQueue.start?.(), 100);
            } else {
              moduleAPI.emit('load-image', { imagePath: filePaths[0] });
            }
          }
          break;
        }

        // Layout template commands
        case 'layout-template-review':
        case 'layout-review':
          loadLayout('review');
          break;
        case 'layout-template-comparison':
        case 'layout-comparison':
          loadLayout('comparison');
          break;
        case 'layout-template-full-image':
          loadLayout('review');
          break;
        case 'layout-template-stats':
        case 'layout-database':
          loadLayout('database');
          break;
        case 'layout-review-with-logs':
          loadLayout('review-with-logs');
          break;
        case 'layout-full-review':
          loadLayout('full-review');
          break;
        case 'reset-layout':
          loadLayout('review');
          break;

        // Layout manipulation commands
        case 'layout-add-column':
          addTabset('column');
          break;
        case 'layout-remove-column':
          removeEmptyTabset();
          break;
        case 'layout-add-row':
          addTabset('row');
          break;
        case 'layout-remove-row':
          removeEmptyTabset();
          break;

        // Move to new column/row commands (Cmd+Alt+Arrow via menu)
        case 'layout-move-new-left':
          moveToNewTabset('left');
          break;
        case 'layout-move-new-right':
          moveToNewTabset('right');
          break;
        case 'layout-move-new-above':
          moveToNewTabset('above');
          break;
        case 'layout-move-new-below':
          moveToNewTabset('below');
          break;

        // Open module commands
        case 'open-original-view':
          openModule('original-view');
          break;
        case 'open-log-viewer':
          openModule('log-viewer');
          break;
        case 'open-review-module':
          openModule('review-module');
          break;
        case 'open-statistics-dashboard':
          openModule('statistics-dashboard');
          break;
        case 'open-database-management':
          openModule('database-management');
          break;
        case 'open-file-queue':
          openModule('file-queue');
          break;
        case 'layout-queue-review':
          loadLayout('queue-review');
          break;

        case 'open-preferences':
          preferencesUI.show();
          break;

        // View commands - broadcast to modules
        default:
          moduleAPI.emit(command, {});
      }
    };

    window.bildvisareAPI.on('menu-command', handleMenuCommand);

    return () => {
      // Cleanup if needed
    };
  }, [ready, loadLayout, addTabset, removeEmptyTabset, openModule, moduleAPI, moveToNewTabset]);

  // Expose workspace API globally for debugging
  useEffect(() => {
    if (!model) return;

    window.workspace = {
      model,
      layoutRef,
      openModule,
      closePanel,
      loadLayout,
      addColumn: () => addTabset('column'),
      addRow: () => addTabset('row'),
      removeTabset: removeEmptyTabset,
      swapPanel: swapActivePanel,
      moveToNew: moveToNewTabset,
      groupAsTab: groupAsTab,
      applyModuleRatios: applyModuleBasedRatios,
      moduleAPI,
      preferences
    };

    return () => {
      delete window.workspace;
    };
  }, [model, openModule, closePanel, loadLayout, addTabset, removeEmptyTabset, swapActivePanel, moveToNewTabset, groupAsTab, applyModuleBasedRatios, moduleAPI]);

  // NOTE: Auto-load from queue is handled by FileQueueModule, not here

  if (!model) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#666'
      }}>
        Loading workspace...
      </div>
    );
  }

  return (
    <Layout
      ref={layoutRef}
      model={model}
      factory={factory}
      onModelChange={handleModelChange}
    />
  );
}

export default FlexLayoutWorkspace;
