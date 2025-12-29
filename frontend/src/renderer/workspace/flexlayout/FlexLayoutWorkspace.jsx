/**
 * FlexLayoutWorkspace - Main workspace component using FlexLayout
 *
 * Replaces Dockview with FlexLayout for better layout capabilities:
 * - Native full-width spanning rows
 * - Floating windows support (future)
 * - Popout windows support (future)
 * - Tab maximization
 */

import React, { useRef, useEffect, useCallback, useState } from 'react';
import { Layout, Model, Actions } from 'flexlayout-react';
import { ModuleWrapper } from './ModuleWrapper.jsx';
import { reviewLayout, getLayoutByName } from './layouts.js';
import { registerModule, getModule } from '../module-registry.js';
import { apiClient } from '../../shared/api-client.js';
import { preferences } from '../preferences.js';

// Import modules
import imageViewerModule from '../../modules/image-viewer/index.js';
import reviewModule from '../../modules/review-module/index.js';
import logViewerModule from '../../modules/log-viewer/index.js';
import originalViewModule from '../../modules/original-view/index.js';
import statisticsDashboardModule from '../../modules/statistics-dashboard/index.js';
import databaseManagementModule from '../../modules/database-management/index.js';

// Storage key for layout persistence
const STORAGE_KEY = 'bildvisare-flexlayout';

/**
 * FlexLayoutWorkspace Component
 */
export function FlexLayoutWorkspace() {
  const layoutRef = useRef(null);
  const moduleInstancesRef = useRef(new Map());
  const [model, setModel] = useState(null);
  const [ready, setReady] = useState(false);

  // Register all modules on mount
  useEffect(() => {
    console.log('[FlexLayoutWorkspace] Registering modules...');
    registerModule(imageViewerModule);
    registerModule(reviewModule);
    registerModule(logViewerModule);
    registerModule(originalViewModule);
    registerModule(statisticsDashboardModule);
    registerModule(databaseManagementModule);
    console.log('[FlexLayoutWorkspace] Modules registered');
  }, []);

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
      console.log('[FlexLayoutWorkspace] Model created');
    } catch (err) {
      console.error('[FlexLayoutWorkspace] Failed to create model:', err);
      // Fall back to default
      setModel(Model.fromJson(reviewLayout));
    }
  }, []);

  // Connect WebSocket when ready
  useEffect(() => {
    if (!model) return;

    const connectWS = async () => {
      try {
        await apiClient.connectWebSocket();
        console.log('[FlexLayoutWorkspace] WebSocket connected');
      } catch (err) {
        console.error('[FlexLayoutWorkspace] Failed to connect WebSocket:', err);
      }
      setReady(true);
    };

    connectWS();
  }, [model]);

  // Save layout on model change
  const handleModelChange = useCallback((newModel) => {
    try {
      const json = newModel.toJson();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(json));
      console.log('[FlexLayoutWorkspace] Layout saved');
    } catch (err) {
      console.warn('[FlexLayoutWorkspace] Failed to save layout:', err);
    }
  }, []);

  // Open a new module tab
  const openModule = useCallback((moduleId, options = {}) => {
    if (!model || !layoutRef.current) return;

    const module = getModule(moduleId);
    if (!module) {
      console.error(`[FlexLayoutWorkspace] Module not found: ${moduleId}`);
      return;
    }

    const tabJson = {
      type: 'tab',
      name: module.title || moduleId,
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
    const module = getModule(component);

    if (!module) {
      return (
        <div style={{ padding: 20, color: '#666' }}>
          Unknown module: {component}
        </div>
      );
    }

    return (
      <ModuleWrapper
        node={node}
        moduleInstances={moduleInstancesRef}
        openModule={openModule}
        closePanel={closePanel}
      />
    );
  }, [openModule, closePanel]);

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
      name: 'New Tab',
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
      // Empty tabset - can't directly delete, but FlexLayout handles this
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
        // Cmd+Shift+}/{ - Add/remove row (Shift+] is }, Shift+[ is {)
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

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          navigateToDirection('left');
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          navigateToDirection('right');
          return;
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          navigateToDirection('up');
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          navigateToDirection('down');
          return;
        }
      }

      // Cmd/Ctrl + O: Open file
      if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
        event.preventDefault();
        openFileDialog();
      }
    };

    const navigateToDirection = (direction) => {
      const activeTabset = model.getActiveTabset();
      if (!activeTabset) return;

      // Try position-based navigation first
      const targetTabset = findTabsetInDirection(activeTabset, direction);

      if (targetTabset) {
        const selectedNode = targetTabset.getSelectedNode();
        if (selectedNode) {
          model.doAction(Actions.selectTab(selectedNode.getId()));
          console.log(`[FlexLayoutWorkspace] Navigated ${direction} to ${selectedNode.getId()}`);
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

        switch (direction) {
          case 'left':
          case 'up':
            nextIndex = (currentIndex - 1 + tabsets.length) % tabsets.length;
            break;
          case 'right':
          case 'down':
            nextIndex = (currentIndex + 1) % tabsets.length;
            break;
          default:
            return;
        }

        const nextTabset = tabsets[nextIndex];
        const selectedNode = nextTabset.getSelectedNode();
        if (selectedNode) {
          model.doAction(Actions.selectTab(selectedNode.getId()));
        }
      }
    };

    const openFileDialog = async () => {
      try {
        const filePath = await window.bildvisareAPI?.invoke('open-file-dialog');
        if (!filePath) return;

        console.log(`[FlexLayoutWorkspace] Opening file: ${filePath}`);

        // Find image viewer and trigger load
        const instances = moduleInstancesRef.current;
        for (const [id, instance] of instances) {
          if (instance.module.id === 'image-viewer') {
            instance.api._triggerEvent('load-image', { imagePath: filePath });
            break;
          }
        }
      } catch (err) {
        console.error('[FlexLayoutWorkspace] Failed to open file:', err);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [model, ready, findTabsetInDirection, addTabset, removeEmptyTabset]);

  // Setup IPC listeners
  useEffect(() => {
    if (!ready || !window.bildvisareAPI) return;

    // Listen for initial file path
    const handleInitialFile = (filePath) => {
      console.log('[FlexLayoutWorkspace] Received initial file:', filePath);
      const instances = moduleInstancesRef.current;
      for (const [id, instance] of instances) {
        if (instance.module.id === 'image-viewer') {
          instance.api._triggerEvent('load-image', { imagePath: filePath });
          break;
        }
      }
    };

    // Listen for menu commands
    const handleMenuCommand = async (command) => {
      console.log('[FlexLayoutWorkspace] Menu command:', command);

      switch (command) {
        case 'open-file':
          const filePath = await window.bildvisareAPI?.invoke('open-file-dialog');
          if (filePath) {
            const instances = moduleInstancesRef.current;
            for (const [id, instance] of instances) {
              if (instance.module.id === 'image-viewer') {
                instance.api._triggerEvent('load-image', { imagePath: filePath });
                break;
              }
            }
          }
          break;

        case 'layout-review':
          loadLayout('review');
          break;

        case 'layout-review-with-logs':
          loadLayout('review-with-logs');
          break;

        case 'layout-comparison':
          loadLayout('comparison');
          break;

        case 'layout-full-review':
          loadLayout('full-review');
          break;

        case 'layout-database':
          loadLayout('database');
          break;

        default:
          // Broadcast to modules
          const instances = moduleInstancesRef.current;
          instances.forEach((instance) => {
            instance.api._triggerEvent(command, {});
          });
      }
    };

    window.bildvisareAPI.on('load-initial-file', handleInitialFile);
    window.bildvisareAPI.on('menu-command', handleMenuCommand);

    return () => {
      // Cleanup if needed
    };
  }, [ready]);

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

  // Expose workspace API globally for debugging
  useEffect(() => {
    if (!model) return;

    window.workspace = {
      model,
      layoutRef,
      moduleInstances: moduleInstancesRef.current,
      openModule,
      closePanel,
      loadLayout,
      addColumn: () => addTabset('column'),
      addRow: () => addTabset('row'),
      removeTabset: removeEmptyTabset,
      apiClient,
      preferences
    };

    return () => {
      delete window.workspace;
    };
  }, [model, openModule, closePanel, loadLayout, addTabset, removeEmptyTabset]);

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
