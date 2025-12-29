/**
 * ModuleWrapper - React wrapper for vanilla JS modules
 *
 * Bridges FlexLayout's React component model with our vanilla JS modules.
 * Handles module lifecycle (init, cleanup) and ModuleAPI integration.
 */

import React, { useRef, useEffect, useState } from 'react';
import { getModule } from '../module-registry.js';
import { apiClient } from '../../shared/api-client.js';

/**
 * Module Communication API
 * Provided to each module during initialization.
 * Enables inter-module communication and workspace control.
 */
class ModuleAPI {
  constructor(panelId, moduleInstancesRef, openModuleFn, closePanelFn) {
    this.panelId = panelId;
    this.eventHandlers = new Map();
    this._moduleInstancesRef = moduleInstancesRef;
    this._openModule = openModuleFn;
    this._closePanel = closePanelFn;
  }

  // Inter-module events
  emit(eventName, data) {
    const instances = this._moduleInstancesRef.current;
    if (!instances) return;

    instances.forEach((instance, id) => {
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
    get: async (path, params) => apiClient.get(path, params),
    post: async (path, body) => apiClient.post(path, body)
  };

  ws = {
    on: (event, callback) => apiClient.onWSEvent(event, callback),
    off: (event, callback) => apiClient.offWSEvent(event, callback)
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
      if (this._openModule) this._openModule(moduleId, options);
    },
    closeModule: (panelId) => {
      if (this._closePanel) this._closePanel(panelId);
    },
    focusModule: (panelId) => {
      // Will be implemented via FlexLayout model
      console.log('[ModuleAPI] focusModule not yet implemented for FlexLayout');
    }
  };
}

/**
 * ModuleWrapper Component
 *
 * @param {object} props - Component props from FlexLayout
 * @param {string} props.node - FlexLayout node
 * @param {object} props.moduleInstances - Ref to module instances map
 * @param {function} props.openModule - Function to open new module
 * @param {function} props.closePanel - Function to close panel
 */
export function ModuleWrapper({ node, moduleInstances, openModule, closePanel }) {
  const containerRef = useRef(null);
  const [initialized, setInitialized] = useState(false);
  const cleanupRef = useRef(null);
  const apiRef = useRef(null);

  // Get module info from FlexLayout node config
  const config = node.getConfig();
  const moduleId = config?.moduleId || node.getComponent();
  const panelId = node.getId();

  useEffect(() => {
    const container = containerRef.current;
    if (!container || initialized) return;

    const module = getModule(moduleId);
    if (!module) {
      console.error(`[ModuleWrapper] Module not found: ${moduleId}`);
      return;
    }

    // Create ModuleAPI for this panel
    const api = new ModuleAPI(panelId, moduleInstances, openModule, closePanel);
    apiRef.current = api;

    // Initialize module
    const initModule = async () => {
      console.log(`[ModuleWrapper] Initializing module: ${moduleId} (panel: ${panelId})`);

      try {
        const result = await module.init(container, api);

        // Store module instance
        const instances = moduleInstances.current;
        if (instances) {
          instances.set(panelId, {
            module,
            api,
            cleanup: result?.cleanup,
            renderer: result?.renderer,
            getState: module.getState?.bind(module),
            setState: module.setState?.bind(module)
          });
        }

        // Store cleanup function
        cleanupRef.current = result?.cleanup;
        setInitialized(true);

        console.log(`[ModuleWrapper] Module initialized: ${moduleId}`);
      } catch (err) {
        console.error(`[ModuleWrapper] Failed to initialize module ${moduleId}:`, err);
      }
    };

    initModule();

    // Cleanup on unmount
    return () => {
      console.log(`[ModuleWrapper] Cleaning up module: ${moduleId}`);

      if (cleanupRef.current) {
        try {
          cleanupRef.current();
        } catch (err) {
          console.error(`[ModuleWrapper] Cleanup error for ${moduleId}:`, err);
        }
      }

      // Remove from instances map
      const instances = moduleInstances.current;
      if (instances) {
        instances.delete(panelId);
      }
    };
  }, [moduleId, panelId, initialized, moduleInstances, openModule, closePanel]);

  return (
    <div
      ref={containerRef}
      className="module-container"
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden'
      }}
    />
  );
}

export default ModuleWrapper;
