/**
 * useModuleEvent - Inter-module event pub/sub
 *
 * Provides hooks for module-to-module communication via the ModuleAPIContext.
 * This replaces the old vanilla JS ModuleAPI event system.
 */

import { useEffect, useCallback, useContext } from 'react';
import { ModuleAPIContext } from '../context/ModuleAPIContext.jsx';
import { debug } from '../shared/debug.js';

/**
 * Hook to access the module API context
 * @returns {object} { emit, on, http, ipc }
 */
export function useModuleAPI() {
  const context = useContext(ModuleAPIContext);

  if (!context) {
    throw new Error('useModuleAPI must be used within a ModuleAPIProvider');
  }

  return context;
}

/**
 * Hook to subscribe to a module event
 *
 * @param {string} eventName - Event name to subscribe to
 * @param {function} handler - Handler function
 * @param {Array} deps - Dependencies for the handler
 */
export function useModuleEvent(eventName, handler, deps = []) {
  const { on } = useModuleAPI();

  useEffect(() => {
    if (!eventName || !handler) return;

    debug('ModuleEvent', `Subscribing to "${eventName}"`);

    // on() returns an unsubscribe function
    const unsubscribe = on(eventName, handler);

    return () => {
      debug('ModuleEvent', `Unsubscribing from "${eventName}"`);
      unsubscribe();
    };
  }, [eventName, on, ...deps]);
}

/**
 * Hook to emit module events
 *
 * @returns {function} emit(eventName, data) function
 */
export function useEmitEvent() {
  const { emit } = useModuleAPI();
  return emit;
}

/**
 * Hook for multiple event subscriptions
 *
 * @param {object} eventHandlers - Map of event names to handlers
 * @param {Array} deps - Dependencies
 */
export function useModuleEvents(eventHandlers, deps = []) {
  const { on } = useModuleAPI();

  useEffect(() => {
    if (!eventHandlers) return;

    // Subscribe to all events, collect unsubscribe functions
    const unsubscribes = Object.entries(eventHandlers).map(([event, handler]) => {
      return on(event, handler);
    });

    // Cleanup: unsubscribe all
    return () => {
      unsubscribes.forEach(unsub => unsub());
    };
  }, [on, ...deps]);
}

/**
 * Hook for HTTP calls to the backend
 *
 * @returns {object} { get, post }
 */
export function useBackendHttp() {
  const { http } = useModuleAPI();
  return http;
}

/**
 * Hook for IPC calls to the main process
 *
 * @returns {object} { send, invoke }
 */
export function useIPC() {
  const { ipc } = useModuleAPI();
  return ipc;
}

export default useModuleEvent;
