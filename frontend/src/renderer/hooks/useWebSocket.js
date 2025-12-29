/**
 * useWebSocket - WebSocket subscription management
 *
 * Provides clean WebSocket event handling with automatic cleanup.
 * Uses the existing apiClient for backend communication.
 */

import { useEffect, useCallback } from 'react';
import { apiClient } from '../shared/api-client.js';

/**
 * Hook for subscribing to WebSocket events
 *
 * @param {string} event - Event name to subscribe to
 * @param {function} callback - Handler function for the event
 * @param {Array} deps - Dependencies that trigger re-subscription
 */
export function useWebSocket(event, callback, deps = []) {
  useEffect(() => {
    if (!event || !callback) return;

    apiClient.onWSEvent(event, callback);

    return () => {
      apiClient.offWSEvent(event, callback);
    };
  }, [event, callback, ...deps]);
}

/**
 * Hook for multiple WebSocket event subscriptions
 *
 * @param {object} eventHandlers - Map of event names to handlers
 * @param {Array} deps - Dependencies that trigger re-subscription
 */
export function useWebSocketEvents(eventHandlers, deps = []) {
  useEffect(() => {
    if (!eventHandlers) return;

    // Subscribe to all events
    Object.entries(eventHandlers).forEach(([event, handler]) => {
      apiClient.onWSEvent(event, handler);
    });

    // Cleanup: unsubscribe from all events
    return () => {
      Object.entries(eventHandlers).forEach(([event, handler]) => {
        apiClient.offWSEvent(event, handler);
      });
    };
  }, [...deps]);
}

/**
 * Hook to ensure WebSocket is connected
 * Automatically connects on mount if not already connected
 *
 * @returns {object} { isConnected, connect, disconnect }
 */
export function useWebSocketConnection() {
  useEffect(() => {
    // Connect on mount if not already connected
    if (!apiClient.isConnected()) {
      apiClient.connectWebSocket().catch(err => {
        console.error('[useWebSocketConnection] Failed to connect:', err);
      });
    }

    // Note: We don't disconnect on unmount because other components may still need it
  }, []);

  const connect = useCallback(async () => {
    try {
      await apiClient.connectWebSocket();
      return true;
    } catch (err) {
      console.error('[useWebSocketConnection] Connect failed:', err);
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    apiClient.disconnectWebSocket();
  }, []);

  return {
    isConnected: apiClient.isConnected(),
    connect,
    disconnect
  };
}

export default useWebSocket;
