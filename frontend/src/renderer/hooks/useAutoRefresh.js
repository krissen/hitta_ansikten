/**
 * useAutoRefresh - Interval-based data refresh
 *
 * Provides automatic periodic refresh with:
 * - Enable/disable toggle
 * - Configurable interval
 * - Manual refresh trigger
 * - Automatic cleanup
 */

import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Hook for auto-refresh functionality
 *
 * @param {function} refreshFn - Async function to call on each refresh
 * @param {object} options - Configuration options
 * @param {number} options.interval - Refresh interval in milliseconds (default: 5000)
 * @param {boolean} options.initialEnabled - Whether auto-refresh starts enabled (default: true)
 * @param {boolean} options.refreshOnMount - Whether to refresh immediately on mount (default: true)
 * @returns {object} { isEnabled, setEnabled, refresh, lastRefresh }
 */
export function useAutoRefresh(refreshFn, options = {}) {
  const {
    interval = 5000,
    initialEnabled = true,
    refreshOnMount = true
  } = options;

  const [isEnabled, setEnabled] = useState(initialEnabled);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const refreshFnRef = useRef(refreshFn);

  // Keep refreshFn ref updated
  useEffect(() => {
    refreshFnRef.current = refreshFn;
  }, [refreshFn]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    if (isRefreshing) return;

    setIsRefreshing(true);
    try {
      await refreshFnRef.current();
      setLastRefresh(new Date());
    } catch (err) {
      console.error('[useAutoRefresh] Refresh failed:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // Initial refresh on mount
  useEffect(() => {
    if (refreshOnMount) {
      refresh();
    }
  }, []); // Only on mount

  // Auto-refresh interval
  useEffect(() => {
    if (!isEnabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      refresh();
    }, interval);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isEnabled, interval, refresh]);

  // Toggle function
  const toggleEnabled = useCallback(() => {
    setEnabled(prev => !prev);
  }, []);

  return {
    isEnabled,
    setEnabled,
    toggleEnabled,
    refresh,
    isRefreshing,
    lastRefresh
  };
}

/**
 * Hook for polling data with loading state
 *
 * @param {function} fetchFn - Async function that returns data
 * @param {object} options - Same as useAutoRefresh plus:
 * @param {any} options.initialData - Initial data value (default: null)
 * @returns {object} { data, error, isLoading, refresh, ... }
 */
export function usePolledData(fetchFn, options = {}) {
  const { initialData = null, ...refreshOptions } = options;

  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);

  const wrappedFetchFn = useCallback(async () => {
    try {
      const result = await fetchFn();
      setData(result);
      setError(null);
    } catch (err) {
      setError(err);
      console.error('[usePolledData] Fetch failed:', err);
    }
  }, [fetchFn]);

  const refreshState = useAutoRefresh(wrappedFetchFn, refreshOptions);

  return {
    data,
    error,
    ...refreshState
  };
}

export default useAutoRefresh;
