/**
 * BackendContext - React context for backend API access
 *
 * Provides centralized access to the backend API client with:
 * - HTTP methods (get, post)
 * - WebSocket connection management
 * - Connection status
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { apiClient } from '../shared/api-client.js';
import { debug, debugWarn, debugError } from '../shared/debug.js';

// Create the context
export const BackendContext = createContext(null);

/**
 * BackendProvider - Provides backend API to all children
 */
export function BackendProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);

  /**
   * Connect to the backend WebSocket
   */
  const connect = useCallback(async () => {
    if (isConnecting || isConnected) return;

    setIsConnecting(true);
    setConnectionError(null);

    try {
      await apiClient.connectWebSocket();
      setIsConnected(true);
      debug('Backend', 'Connected to backend');
    } catch (err) {
      debugError('Backend', 'Connection failed:', err);
      setConnectionError(err);
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [isConnecting, isConnected]);

  /**
   * Disconnect from the backend
   */
  const disconnect = useCallback(() => {
    apiClient.disconnectWebSocket();
    setIsConnected(false);
    debug('Backend', 'Disconnected from backend');
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();

    // Cleanup on unmount (optional, depends on use case)
    // return () => disconnect();
  }, []);

  /**
   * HTTP API methods
   */
  const api = useMemo(() => ({
    get: async (path, params) => {
      try {
        return await apiClient.get(path, params);
      } catch (err) {
        debugError('Backend', `GET ${path} failed:`, err);
        throw err;
      }
    },
    post: async (path, body) => {
      try {
        return await apiClient.post(path, body);
      } catch (err) {
        debugError('Backend', `POST ${path} failed:`, err);
        throw err;
      }
    }
  }), []);

  // Context value
  const value = useMemo(() => ({
    api,
    isConnected,
    isConnecting,
    connectionError,
    connect,
    disconnect,
    // Direct apiClient access for advanced usage
    client: apiClient
  }), [api, isConnected, isConnecting, connectionError, connect, disconnect]);

  return (
    <BackendContext.Provider value={value}>
      {children}
    </BackendContext.Provider>
  );
}

/**
 * Hook to access the backend context
 */
export function useBackend() {
  const context = useContext(BackendContext);

  if (!context) {
    throw new Error('useBackend must be used within a BackendProvider');
  }

  return context;
}

export default BackendContext;
