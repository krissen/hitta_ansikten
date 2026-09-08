/**
 * useOperationStatus - Shared loading/error/success state management
 *
 * Consolidates the common pattern of:
 * - isLoading state
 * - status { type, message } state
 * - showSuccess/showError helpers with auto-clear
 *
 * Used by: DatabaseManagement, RefineFacesModule, and other components
 * that need operation feedback.
 */

import { useState, useCallback, useRef, useEffect } from 'react';

/**
 * Hook for managing operation status (loading, success, error states)
 *
 * @param {object} options - Configuration options
 * @param {number} options.successTimeout - Auto-clear success messages after ms (default: 5000)
 * @param {boolean} options.autoClearError - Whether to auto-clear errors (default: false)
 * @param {number} options.errorTimeout - Auto-clear error messages after ms (default: 10000)
 * @returns {object} Status state and helpers
 */
export function useOperationStatus(options = {}) {
  const {
    successTimeout = 5000,
    autoClearError = false,
    errorTimeout = 10000,
  } = options;

  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState({ type: '', message: '' });
  const timeoutRef = useRef(null);

  // Clear any pending timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  /**
   * Clear current status
   */
  const clearStatus = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    setStatus({ type: '', message: '' });
  }, []);

  /**
   * Show success message (auto-clears after timeout)
   */
  const showSuccess = useCallback(
    (message) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setStatus({ type: 'success', message });
      timeoutRef.current = setTimeout(() => {
        setStatus({ type: '', message: '' });
        timeoutRef.current = null;
      }, successTimeout);
    },
    [successTimeout],
  );

  /**
   * Show error message (optionally auto-clears)
   */
  const showError = useCallback(
    (message) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setStatus({ type: 'error', message });
      if (autoClearError) {
        timeoutRef.current = setTimeout(() => {
          setStatus({ type: '', message: '' });
          timeoutRef.current = null;
        }, errorTimeout);
      }
    },
    [autoClearError, errorTimeout],
  );

  /**
   * Show info message (auto-clears after timeout)
   */
  const showInfo = useCallback(
    (message) => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      setStatus({ type: 'info', message });
      timeoutRef.current = setTimeout(() => {
        setStatus({ type: '', message: '' });
        timeoutRef.current = null;
      }, successTimeout);
    },
    [successTimeout],
  );

  /**
   * Start loading state
   */
  const startLoading = useCallback(() => {
    setIsLoading(true);
    clearStatus();
  }, [clearStatus]);

  /**
   * Stop loading state
   */
  const stopLoading = useCallback(() => {
    setIsLoading(false);
  }, []);

  return {
    // State
    isLoading,
    status,
    hasStatus: status.type !== '',
    isSuccess: status.type === 'success',
    isError: status.type === 'error',
    isInfo: status.type === 'info',

    // Setters (for advanced use cases)
    setIsLoading,
    setStatus,

    // Helpers
    showSuccess,
    showError,
    showInfo,
    clearStatus,
    startLoading,
    stopLoading,
  };
}

/**
 * Hook for wrapping async operations with automatic loading/error handling
 *
 * @param {function} asyncFn - Async function to wrap
 * @param {object} statusHook - Return value from useOperationStatus
 * @param {object} options - Configuration options
 * @param {function} options.onSuccess - Callback on success (receives result)
 * @param {function} options.onError - Callback on error (receives error)
 * @param {string} options.successMessage - Message to show on success
 * @param {string} options.errorPrefix - Prefix for error messages
 * @returns {function} Wrapped async function
 */
export function useAsyncOperation(asyncFn, statusHook, options = {}) {
  const {
    onSuccess,
    onError,
    successMessage,
    errorPrefix = 'Operation failed: ',
  } = options;

  const { startLoading, stopLoading, showSuccess, showError } = statusHook;

  return useCallback(
    async (...args) => {
      startLoading();
      try {
        const result = await asyncFn(...args);
        if (successMessage) {
          showSuccess(successMessage);
        }
        if (onSuccess) {
          onSuccess(result);
        }
        return result;
      } catch (err) {
        const message = errorPrefix + (err.message || 'Unknown error');
        showError(message);
        if (onError) {
          onError(err);
        }
        throw err;
      } finally {
        stopLoading();
      }
    },
    [
      asyncFn,
      startLoading,
      stopLoading,
      showSuccess,
      showError,
      successMessage,
      errorPrefix,
      onSuccess,
      onError,
    ],
  );
}

export default useOperationStatus;
