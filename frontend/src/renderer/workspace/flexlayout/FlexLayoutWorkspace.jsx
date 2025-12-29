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

  // Keyboard navigation
  useEffect(() => {
    if (!model || !ready) return;

    const handleKeyDown = (event) => {
      // Check if should ignore (input focused, etc.)
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
        return;
      }

      // Cmd/Ctrl + Arrow: Navigate between tabs
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const activeTabset = model.getActiveTabset();
        if (!activeTabset) return;

        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          model.doAction(Actions.selectTab(activeTabset.getSelectedNode()?.getId()));
          // Navigate to previous tab or tabset
          navigateToDirection('left');
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          navigateToDirection('right');
        } else if (event.key === 'ArrowUp') {
          event.preventDefault();
          navigateToDirection('up');
        } else if (event.key === 'ArrowDown') {
          event.preventDefault();
          navigateToDirection('down');
        }
      }

      // Cmd/Ctrl + O: Open file
      if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
        event.preventDefault();
        openFileDialog();
      }
    };

    const navigateToDirection = (direction) => {
      // FlexLayout navigation - find adjacent tabset
      const activeTabset = model.getActiveTabset();
      if (!activeTabset) return;

      // Get all tabsets
      const tabsets = [];
      model.visitNodes((node) => {
        if (node.getType() === 'tabset') {
          tabsets.push(node);
        }
      });

      if (tabsets.length < 2) return;

      // Find current tabset index and navigate
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
  }, [model, ready]);

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
      apiClient,
      preferences
    };

    return () => {
      delete window.workspace;
    };
  }, [model, openModule, closePanel, loadLayout]);

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
