/**
 * BackendContext - React context for backend API access
 *
 * Provides centralized access to the backend API client with:
 * - HTTP methods (get, post)
 * - WebSocket connection management
 * - Connection status
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
} from 'react';
import { apiClient } from '../shared/api-client.js';
import { debug, debugError, getCategories } from '../shared/debug.js';
import { preferences } from '../workspace/preferences.js';

// Create the context
export const BackendContext = createContext(null);

/**
 * BackendProvider - Provides backend API to all children
 */
export function BackendProvider({ children }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState(null);
  const [isOffline, setIsOffline] = useState(false);

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

      const logLevel = preferences.get('ui.logLevel') || 'info';
      apiClient.setLogLevel(logLevel);

      const categories = getCategories();
      const enabledBackendCategories = Object.entries(categories)
        .filter(([_, enabled]) => enabled)
        .map(([name]) => name);
      apiClient.setLogCategories(enabledBackendCategories);
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

  // Subscribe to connection state changes
  useEffect(() => {
    const handleConnectionChange = (connected) => {
      debug('Backend', `Connection state changed: ${connected}`);
      setIsConnected(connected);
    };

    const handleOfflineChange = (offline) => {
      debug('Backend', `Offline state changed: ${offline}`);
      setIsOffline(offline);
    };

    apiClient.addConnectionListener(handleConnectionChange);
    apiClient.addOfflineListener(handleOfflineChange);
    connect();

    return () => {
      apiClient.removeConnectionListener(handleConnectionChange);
      apiClient.removeOfflineListener(handleOfflineChange);
    };
  }, [connect]);

  /**
   * HTTP API methods
   */
  const api = useMemo(
    () => ({
      get: async (path, params) => {
        try {
          return await apiClient.get(path, params);
        } catch (err) {
          debugError('Backend', `GET ${path} failed:`, err);
          throw err;
        }
      },
      post: async (path, body, options) => {
        try {
          // Forward per-call options (e.g. { timeout: 0 } for long imports) to the
          // client — the wrapper must not swallow the third argument.
          return await apiClient.post(path, body, options);
        } catch (err) {
          debugError('Backend', `POST ${path} failed:`, err);
          throw err;
        }
      },
    }),
    [],
  );

  // Context value
  const value = useMemo(
    () => ({
      api,
      isConnected,
      isConnecting,
      isOffline,
      connectionError,
      connect,
      disconnect,
      client: apiClient,
    }),
    [
      api,
      isConnected,
      isConnecting,
      isOffline,
      connectionError,
      connect,
      disconnect,
    ],
  );

  return (
    <BackendContext.Provider value={value}>{children}</BackendContext.Provider>
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
