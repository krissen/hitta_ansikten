/**
 * ModuleAPIContext - React context for module communication
 *
 * Replaces the class-based ModuleAPI with a React context that provides:
 * - Inter-module event pub/sub (emit, on)
 * - Backend HTTP calls (http.get, http.post)
 * - IPC to main process (ipc.send, ipc.invoke)
 * - WebSocket event handling (ws.on, ws.off)
 */

import React, { createContext, useContext, useRef, useCallback, useMemo } from 'react';
import { apiClient } from '../shared/api-client.js';
import { debug } from '../shared/debug.js';

// Create the context with a default value of null
export const ModuleAPIContext = createContext(null);

/**
 * Hook to access the module API context
 */
export function useModuleAPI() {
  const context = useContext(ModuleAPIContext);
  if (!context) {
    throw new Error('useModuleAPI must be used within a ModuleAPIProvider');
  }
  return context;
}

/**
 * ModuleAPIProvider - Provides the module API to all children
 */
export function ModuleAPIProvider({ children }) {
  // Event bus for inter-module communication
  const eventBusRef = useRef(new Map());

  /**
   * Emit an event to all subscribers
   * @param {string} eventName - Event name
   * @param {any} data - Event data
   */
  const emit = useCallback((eventName, data) => {
    const handlers = eventBusRef.current.get(eventName);
    debug('ModuleAPI', `emit("${eventName}") - ${handlers ? handlers.length : 0} handlers`);
    if (!handlers || handlers.length === 0) return;

    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[ModuleAPI] Error in handler for "${eventName}":`, err);
      }
    });
  }, []);

  /**
   * Check if an event has listeners
   * @param {string} eventName - Event name
   * @returns {boolean} True if there are listeners
   */
  const hasListeners = useCallback((eventName) => {
    const handlers = eventBusRef.current.get(eventName);
    return handlers && handlers.length > 0;
  }, []);

  /**
   * Wait for listeners to be registered for an event
   * @param {string} eventName - Event name
   * @param {number} timeout - Max wait time in ms (default 5000)
   * @param {number} interval - Check interval in ms (default 50)
   * @returns {Promise<boolean>} True if listeners found, false if timeout
   */
  const waitForListeners = useCallback((eventName, timeout = 5000, interval = 50) => {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const check = () => {
        if (hasListeners(eventName)) {
          debug('ModuleAPI', `waitForListeners("${eventName}") - found listeners`);
          resolve(true);
        } else if (Date.now() - startTime > timeout) {
          debug('ModuleAPI', `waitForListeners("${eventName}") - timeout after ${timeout}ms`);
          resolve(false);
        } else {
          setTimeout(check, interval);
        }
      };
      check();
    });
  }, [hasListeners]);

  /**
   * Subscribe to an event
   * @param {string} eventName - Event name
   * @param {function} handler - Event handler
   * @returns {function} Unsubscribe function
   */
  const on = useCallback((eventName, handler) => {
    if (!eventBusRef.current.has(eventName)) {
      eventBusRef.current.set(eventName, []);
    }

    eventBusRef.current.get(eventName).push(handler);
    const count = eventBusRef.current.get(eventName).length;
    debug('ModuleAPI', `on("${eventName}") - now ${count} handlers`);

    // Return unsubscribe function
    return () => {
      const handlers = eventBusRef.current.get(eventName);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
          debug('ModuleAPI', `off("${eventName}") - now ${handlers.length} handlers`);
        }
      }
    };
  }, []);

  /**
   * HTTP methods for backend communication
   */
  const http = useMemo(() => ({
    get: async (path, params) => apiClient.get(path, params),
    post: async (path, body) => apiClient.post(path, body)
  }), []);

  /**
   * WebSocket methods
   */
  const ws = useMemo(() => ({
    on: (event, callback) => apiClient.onWSEvent(event, callback),
    off: (event, callback) => apiClient.offWSEvent(event, callback)
  }), []);

  /**
   * IPC methods for main process communication
   */
  const ipc = useMemo(() => ({
    send: (channel, ...args) => {
      if (window.bildvisareAPI) {
        window.bildvisareAPI.send(channel, ...args);
      }
    },
    invoke: async (channel, ...args) => {
      if (window.bildvisareAPI) {
        return window.bildvisareAPI.invoke(channel, ...args);
      }
      throw new Error('bildvisareAPI not available');
    }
  }), []);

  /**
   * Backend reference (for advanced usage)
   */
  const backend = useMemo(() => apiClient, []);

  // Combine all APIs into the context value
  const value = useMemo(() => ({
    emit,
    on,
    hasListeners,
    waitForListeners,
    http,
    ws,
    ipc,
    backend
  }), [emit, on, hasListeners, waitForListeners, http, ws, ipc, backend]);

  return (
    <ModuleAPIContext.Provider value={value}>
      {children}
    </ModuleAPIContext.Provider>
  );
}

export default ModuleAPIContext;
