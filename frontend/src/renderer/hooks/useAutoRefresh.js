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
import { debug, debugError } from '../shared/debug.js';

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
  const isRefreshingRef = useRef(false);
  const lastRefreshTimeRef = useRef(0);
  const mountedRef = useRef(false);
  const initialRefreshDoneRef = useRef(false);

  // Minimum time between refreshes (debounce)
  const MIN_REFRESH_INTERVAL = 1000;

  // Keep refreshFn ref updated
  useEffect(() => {
    refreshFnRef.current = refreshFn;
  }, [refreshFn]);

  // Manual refresh function (stable - doesn't change on isRefreshing)
  const refresh = useCallback(async () => {
    // Guard against concurrent refreshes
    if (isRefreshingRef.current) return;

    // Debounce: don't refresh if we just refreshed
    const now = Date.now();
    if (now - lastRefreshTimeRef.current < MIN_REFRESH_INTERVAL) {
      debug('AutoRefresh', 'Debounced refresh (too soon)');
      return;
    }

    isRefreshingRef.current = true;
    lastRefreshTimeRef.current = now;
    setIsRefreshing(true);
    try {
      await refreshFnRef.current();
      setLastRefresh(new Date());
    } catch (err) {
      debugError('Backend', 'Refresh failed:', err);
    } finally {
      isRefreshingRef.current = false;
      setIsRefreshing(false);
    }
  }, []); // No dependencies - uses refs

  // Initial refresh on mount (runs only once)
  useEffect(() => {
    if (mountedRef.current) return; // Already mounted
    mountedRef.current = true;

    if (refreshOnMount && !initialRefreshDoneRef.current) {
      initialRefreshDoneRef.current = true;
      refresh();
    }
  }, []); // Empty deps - truly only on mount

  // Auto-refresh interval
  useEffect(() => {
    debug('AutoRefresh', `Interval effect running: isEnabled=${isEnabled}, interval=${interval}`);

    if (!isEnabled) {
      if (intervalRef.current) {
        debug('AutoRefresh', 'Clearing interval (disabled)');
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    // Clear any existing interval before creating new one
    if (intervalRef.current) {
      debug('AutoRefresh', 'Clearing existing interval before creating new');
      clearInterval(intervalRef.current);
    }

    debug('AutoRefresh', `Creating interval with ${interval}ms`);
    intervalRef.current = setInterval(() => {
      refresh();
    }, interval);

    return () => {
      if (intervalRef.current) {
        debug('AutoRefresh', 'Cleanup: clearing interval');
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
      debugError('Backend', 'Fetch failed:', err);
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
