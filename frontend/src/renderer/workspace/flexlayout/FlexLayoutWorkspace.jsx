/**
 * FlexLayoutWorkspace - Main workspace component using FlexLayout
 *
 * Pure React implementation - all modules are React components.
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Layout, Model, Actions } from 'flexlayout-react';
import { reviewLayout, getLayoutByName } from './layouts.js';
import { preferences } from '../preferences.js';
import { useModuleAPI } from '../../context/ModuleAPIContext.jsx';

// Import React components directly
import { ImageViewer } from '../../components/ImageViewer.jsx';
import { OriginalView } from '../../components/OriginalView.jsx';
import { LogViewer } from '../../components/LogViewer.jsx';
import { StatisticsDashboard } from '../../components/StatisticsDashboard.jsx';
import { ReviewModule } from '../../components/ReviewModule.jsx';
import { DatabaseManagement } from '../../components/DatabaseManagement.jsx';

// Storage key for layout persistence
const STORAGE_KEY = 'bildvisare-flexlayout';

// Module component mapping
const MODULE_COMPONENTS = {
  'image-viewer': ImageViewer,
  'original-view': OriginalView,
  'log-viewer': LogViewer,
  'statistics-dashboard': StatisticsDashboard,
  'review-module': ReviewModule,
  'database-management': DatabaseManagement
};

// Module titles
const MODULE_TITLES = {
  'image-viewer': 'Image Viewer',
  'original-view': 'Original View',
  'log-viewer': 'Backend Logs',
  'statistics-dashboard': 'Statistics Dashboard',
  'review-module': 'Face Review',
  'database-management': 'Database Management'
};

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
        console.log('[FlexLayoutWorkspace] Loading saved layout');
        layoutConfig = JSON.parse(saved);
      }
    } catch (err) {
      console.warn('[FlexLayoutWorkspace] Failed to load saved layout:', err);
    }

    // Fall back to default layout
    if (!layoutConfig) {
      const defaultLayout = preferences.get('workspace.defaultLayout') || 'review';
      console.log('[FlexLayoutWorkspace] Using default layout:', defaultLayout);
      layoutConfig = getLayoutByName(defaultLayout);
    }

    // Create model from config
    try {
      const newModel = Model.fromJson(layoutConfig);
      setModel(newModel);
      setReady(true);
      console.log('[FlexLayoutWorkspace] Model created');
    } catch (err) {
      console.error('[FlexLayoutWorkspace] Failed to create model:', err);
      // Fall back to default
      setModel(Model.fromJson(reviewLayout));
      setReady(true);
    }
  }, []);

  // Save layout on model change
  const handleModelChange = useCallback((newModel) => {
    try {
      const json = newModel.toJson();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
    } catch (err) {
      console.warn('[FlexLayoutWorkspace] Failed to save layout:', err);
    }
  }, []);

  // Open a new module tab
  const openModule = useCallback((moduleId, options = {}) => {
    if (!model || !layoutRef.current) return;

    const ModuleComponent = MODULE_COMPONENTS[moduleId];
    if (!ModuleComponent) {
      console.error(`[FlexLayoutWorkspace] Module not found: ${moduleId}`);
      return;
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
      model.doAction(Actions.addNode(tabJson, activeTabset.getId(), 'center', -1));
    }

    console.log(`[FlexLayoutWorkspace] Opened module: ${moduleId}`);
  }, [model]);

  // Close a panel by ID
  const closePanel = useCallback((panelId) => {
    if (!model) return;

    const node = model.getNodeById(panelId);
    if (node) {
      model.doAction(Actions.deleteTab(panelId));
      console.log(`[FlexLayoutWorkspace] Closed panel: ${panelId}`);
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

    // Find the DOM element for this tabset
    const tabsetId = tabset.getId();
    const element = document.querySelector(`[data-layout-path*="${tabsetId}"]`);
    if (!element) return { x: 0, y: 0 };

    const rect = element.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      rect
    };
  }, []);

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
    if (!activeTabset) return;

    // Get the active tab to use as reference
    const activeTab = activeTabset.getSelectedNode();
    if (!activeTab) return;

    // FlexLayout's addNode with 'right' or 'bottom' location creates new tabset
    const location = direction === 'column' ? 'right' : 'bottom';

    // Create a placeholder tab in the new tabset
    const placeholderTab = {
      type: 'tab',
      name: 'Image Viewer',
      component: 'image-viewer',
      config: { moduleId: 'image-viewer' }
    };

    model.doAction(Actions.addNode(placeholderTab, activeTabset.getId(), location, -1));
    console.log(`[FlexLayoutWorkspace] Added new ${direction}`);
  }, [model]);

  // Remove empty tabset
  const removeEmptyTabset = useCallback(() => {
    const activeTabset = model.getActiveTabset();
    if (!activeTabset) return false;

    const children = activeTabset.getChildren();
    if (children.length === 0) {
      console.log('[FlexLayoutWorkspace] Cannot remove empty tabset directly');
      return false;
    }

    if (children.length === 1) {
      // Remove the single tab, which may remove the tabset
      const tabId = children[0].getId();
      model.doAction(Actions.deleteTab(tabId));
      console.log(`[FlexLayoutWorkspace] Removed last tab from tabset`);
      return true;
    }

    console.log(`[FlexLayoutWorkspace] Tabset has ${children.length} tabs, not removing`);
    return false;
  }, [model]);

  // Load a preset layout
  const loadLayout = useCallback((layoutName) => {
    console.log(`[FlexLayoutWorkspace] Loading layout: ${layoutName}`);
    const layoutConfig = getLayoutByName(layoutName);
    try {
      const newModel = Model.fromJson(layoutConfig);
      setModel(newModel);
    } catch (err) {
      console.error('[FlexLayoutWorkspace] Failed to load layout:', err);
    }
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!model || !ready) return;

    const handleKeyDown = (event) => {
      // Check if should ignore (input focused, etc.)
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      // Cmd+Shift+R / Ctrl+Shift+R - Hard reload
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'r') {
        event.preventDefault();
        window.location.reload(true);
        return;
      }

      // Cmd+R / Ctrl+R - Reload
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r' && !event.shiftKey) {
        event.preventDefault();
        window.location.reload();
        return;
      }

      // Cmd+Shift+]/[ - Add/remove column
      if ((event.metaKey || event.ctrlKey) && event.shiftKey) {
        if (event.key === ']') {
          event.preventDefault();
          addTabset('column');
          return;
        }
        if (event.key === '[') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
        // Cmd+Shift+}/{ - Add/remove row
        if (event.key === '}') {
          event.preventDefault();
          addTabset('row');
          return;
        }
        if (event.key === '{') {
          event.preventDefault();
          removeEmptyTabset();
          return;
        }
      }

      // Cmd/Ctrl + Arrow: Navigate between tabsets
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const activeTabset = model.getActiveTabset();
        if (!activeTabset) return;

        const navigate = (direction) => {
          event.preventDefault();
          const targetTabset = findTabsetInDirection(activeTabset, direction);

          if (targetTabset) {
            const selectedNode = targetTabset.getSelectedNode();
            if (selectedNode) {
              model.doAction(Actions.selectTab(selectedNode.getId()));
            }
          } else {
            // Fallback: cycle through all tabsets
            const tabsets = [];
            model.visitNodes((node) => {
              if (node.getType() === 'tabset') {
                tabsets.push(node);
              }
            });

            if (tabsets.length < 2) return;

            const currentIndex = tabsets.findIndex(ts => ts.getId() === activeTabset.getId());
            let nextIndex;

            if (direction === 'left' || direction === 'up') {
              nextIndex = (currentIndex - 1 + tabsets.length) % tabsets.length;
            } else {
              nextIndex = (currentIndex + 1) % tabsets.length;
            }

            const nextTabset = tabsets[nextIndex];
            const selectedNode = nextTabset.getSelectedNode();
            if (selectedNode) {
              model.doAction(Actions.selectTab(selectedNode.getId()));
            }
          }
        };

        if (event.key === 'ArrowLeft') navigate('left');
        else if (event.key === 'ArrowRight') navigate('right');
        else if (event.key === 'ArrowUp') navigate('up');
        else if (event.key === 'ArrowDown') navigate('down');
        return;
      }

      // Cmd/Ctrl + O: Open file
      if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
        event.preventDefault();
        openFileDialog();
      }
    };

    const openFileDialog = async () => {
      try {
        const filePath = await window.bildvisareAPI?.invoke('open-file-dialog');
        if (!filePath) return;

        console.log(`[FlexLayoutWorkspace] Opening file: ${filePath}`);
        // Emit load-image event via module API
        moduleAPI.emit('load-image', { imagePath: filePath });
      } catch (err) {
        console.error('[FlexLayoutWorkspace] Failed to open file:', err);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [model, ready, findTabsetInDirection, addTabset, removeEmptyTabset, moduleAPI]);

  // Setup IPC listeners
  useEffect(() => {
    if (!ready || !window.bildvisareAPI) return;

    // Listen for initial file path
    const handleInitialFile = (filePath) => {
      console.log('[FlexLayoutWorkspace] Received initial file:', filePath);
      moduleAPI.emit('load-image', { imagePath: filePath });
    };

    // Listen for menu commands
    const handleMenuCommand = async (command) => {
      console.log('[FlexLayoutWorkspace] Menu command:', command);

      switch (command) {
        // File commands
        case 'open-file': {
          const filePath = await window.bildvisareAPI?.invoke('open-file-dialog');
          if (filePath) {
            moduleAPI.emit('load-image', { imagePath: filePath });
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

        // View commands - broadcast to modules
        default:
          moduleAPI.emit(command, {});
      }
    };

    window.bildvisareAPI.on('load-initial-file', handleInitialFile);
    window.bildvisareAPI.on('menu-command', handleMenuCommand);

    return () => {
      // Cleanup if needed
    };
  }, [ready, loadLayout, addTabset, removeEmptyTabset, openModule, moduleAPI]);

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
      moduleAPI,
      preferences
    };

    return () => {
      delete window.workspace;
    };
  }, [model, openModule, closePanel, loadLayout, addTabset, removeEmptyTabset, moduleAPI]);

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
