/**
 * useKeyboardShortcuts - Document-level keyboard event handling
 *
 * Provides a clean way to register keyboard shortcuts that:
 * - Automatically clean up on unmount
 * - Ignore events when inputs are focused
 * - Support modifier keys (Cmd, Ctrl, Shift, Alt)
 * - Support key hold detection for continuous actions
 */

import { useEffect, useCallback, useRef } from 'react';

/**
 * Check if keyboard event should be ignored (e.g., in input fields)
 * @param {KeyboardEvent} event
 * @returns {boolean}
 */
function shouldIgnoreEvent(event) {
  const target = event.target;
  const tagName = target.tagName.toLowerCase();

  // Ignore events in input fields
  if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
    return true;
  }

  // Ignore if target is contenteditable
  if (target.isContentEditable) {
    return true;
  }

  // Check for DevTools focus (Electron-specific)
  if (typeof window.bildvisareAPI?.isDevToolsFocused === 'function') {
    if (window.bildvisareAPI.isDevToolsFocused()) {
      return true;
    }
  }

  return false;
}

/**
 * Hook for keyboard shortcuts
 *
 * @param {object} shortcuts - Map of key to handler: { 'a': (e) => {}, 'Cmd+s': (e) => {} }
 * @param {object} options - Configuration options
 * @param {boolean} options.enabled - Whether shortcuts are active (default: true)
 * @param {boolean} options.preventDefault - Whether to prevent default (default: true)
 * @param {Array} deps - Dependencies that trigger re-registration
 */
export function useKeyboardShortcuts(shortcuts, options = {}, deps = []) {
  const { enabled = true, preventDefault = true } = options;

  useEffect(() => {
    if (!enabled) return;

    const handler = (event) => {
      if (shouldIgnoreEvent(event)) return;

      // Build key string with modifiers
      const parts = [];
      if (event.metaKey || event.ctrlKey) parts.push('Cmd');
      if (event.shiftKey) parts.push('Shift');
      if (event.altKey) parts.push('Alt');
      parts.push(event.key);

      const keyWithModifiers = parts.join('+');
      const keyOnly = event.key;

      // Try to find handler (with modifiers first, then without)
      const handlerFn = shortcuts[keyWithModifiers] || shortcuts[keyOnly];

      if (handlerFn) {
        if (preventDefault) {
          event.preventDefault();
        }
        handlerFn(event);
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [shortcuts, enabled, preventDefault, ...deps]);
}

/**
 * Hook for key hold detection (e.g., zoom on +/- hold)
 *
 * @param {string} key - The key to detect
 * @param {object} callbacks - { onStart, onHold, onEnd }
 * @param {object} options - { holdDelay: ms before hold starts, repeatInterval: ms between repeats }
 */
export function useKeyHold(key, callbacks, options = {}) {
  const { holdDelay = 200, repeatInterval = 16 } = options;

  // Use refs to store latest callbacks to avoid re-subscribing on every render
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const isHoldingRef = useRef(false);
  const holdTimeoutRef = useRef(null);
  const repeatIntervalRef = useRef(null);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (shouldIgnoreEvent(event)) return;
      if (event.key !== key) return;
      if (event.repeat) return; // Ignore OS key repeat

      event.preventDefault();

      // Call onStart immediately
      if (callbacksRef.current.onStart) {
        callbacksRef.current.onStart(event);
      }

      // Start hold detection after delay
      holdTimeoutRef.current = setTimeout(() => {
        isHoldingRef.current = true;
        if (callbacksRef.current.onHold) {
          // Call onHold immediately when hold starts
          callbacksRef.current.onHold(event);
          // Then call repeatedly
          repeatIntervalRef.current = setInterval(() => {
            if (isHoldingRef.current && callbacksRef.current.onHold) {
              callbacksRef.current.onHold(event);
            }
          }, repeatInterval);
        }
      }, holdDelay);
    };

    const handleKeyUp = (event) => {
      if (event.key !== key) return;

      // Clear timers
      if (holdTimeoutRef.current) {
        clearTimeout(holdTimeoutRef.current);
        holdTimeoutRef.current = null;
      }
      if (repeatIntervalRef.current) {
        clearInterval(repeatIntervalRef.current);
        repeatIntervalRef.current = null;
      }

      // If we weren't holding, this was a tap
      const wasHolding = isHoldingRef.current;
      isHoldingRef.current = false;

      if (callbacksRef.current.onEnd) {
        callbacksRef.current.onEnd(event, wasHolding);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('keyup', handleKeyUp);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('keyup', handleKeyUp);

      // Cleanup timers
      if (holdTimeoutRef.current) clearTimeout(holdTimeoutRef.current);
      if (repeatIntervalRef.current) clearInterval(repeatIntervalRef.current);
    };
  }, [key, holdDelay, repeatInterval]); // Only re-subscribe when key or timing options change
}

export default useKeyboardShortcuts;
