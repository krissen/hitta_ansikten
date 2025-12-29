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
    if (!handlers) return;

    handlers.forEach(handler => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[ModuleAPI] Error in handler for "${eventName}":`, err);
      }
    });
  }, []);

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

    // Return unsubscribe function
    return () => {
      const handlers = eventBusRef.current.get(eventName);
      if (handlers) {
        const index = handlers.indexOf(handler);
        if (index > -1) {
          handlers.splice(index, 1);
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
    http,
    ws,
    ipc,
    backend
  }), [emit, on, http, ws, ipc, backend]);

  return (
    <ModuleAPIContext.Provider value={value}>
      {children}
    </ModuleAPIContext.Provider>
  );
}

export default ModuleAPIContext;
