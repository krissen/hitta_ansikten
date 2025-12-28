/**
 * Workspace Initialization
 *
 * Sets up the Dockview workspace and manages module lifecycle.
 */

import { createDockview } from '../../../node_modules/dockview-core/dist/dockview-core.esm.js';
import { LayoutManager } from './layout-manager.js';
import { registerModule, getModule } from './module-registry.js';
import { apiClient } from '../shared/api-client.js';

// Import modules
import imageViewerModule from '../modules/image-viewer/index.js';

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
    // Only handle if no input is focused
    const activeElement = document.activeElement;
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
      return;
    }

    // Cmd+O (macOS) or Ctrl+O (Windows/Linux) - Open file
    if ((event.metaKey || event.ctrlKey) && event.key === 'o') {
      event.preventDefault();
      await openFileDialog();
    }
  });
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
 * Initialize workspace
 */
async function initWorkspace() {
  console.log('[Workspace] Initializing...');

  // Register modules
  registerModule(imageViewerModule);

  // Create Dockview instance
  dockview = createDockview(document.getElementById('workspace-root'), {
    className: 'bildvisare-workspace',
    createComponent: (options) => {
      return createModuleComponent(options);
    }
  });

  // Create layout manager
  layoutManager = new LayoutManager(dockview);

  // Setup auto-save on layout changes
  dockview.onDidLayoutChange(() => {
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
    apiClient // Expose API client for debugging
  };
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
        cleanup: null // Will be set after init completes
      });

      // Initialize module
      module.init(container, api).then(cleanupFn => {
        cleanup = cleanupFn;

        // Update cleanup function in stored instance
        const instance = moduleInstances.get(id);
        if (instance) {
          instance.cleanup = cleanupFn;
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
