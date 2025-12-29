/**
 * DevTools Focus Detection
 *
 * Tracks when DevTools has focus to prevent keyboard shortcuts
 * from interfering with console input.
 */

class DevToolsFocusManager {
  constructor() {
    this.isDevToolsOpen = false;  // Track if DevTools is OPEN (not just focused)
    this.listeners = [];

    // Listen for DevTools open/close state from main process
    if (window.bildvisareAPI) {
      window.bildvisareAPI.on('devtools-state-changed', (isOpen) => {
        console.log('[DevToolsFocus] DevTools state changed - open:', isOpen);
        this.isDevToolsOpen = isOpen;
        this.notifyListeners();
      });
    } else {
      console.warn('[DevToolsFocus] bildvisareAPI not available');
    }
  }

  /**
   * Check if DevTools is currently open
   */
  isOpen() {
    return this.isDevToolsOpen;
  }

  /**
   * Register listener for focus changes
   */
  onChange(callback) {
    this.listeners.push(callback);
  }

  /**
   * Unregister listener
   */
  offChange(callback) {
    const index = this.listeners.indexOf(callback);
    if (index > -1) {
      this.listeners.splice(index, 1);
    }
  }

  notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.isDevToolsOpen);
      } catch (err) {
        console.error('[DevToolsFocus] Listener error:', err);
      }
    });
  }

  /**
   * Helper: Check if keyboard event should be ignored
   * Returns true if event should be ignored (DevTools is open OR input is focused)
   */
  shouldIgnoreKeyboardEvent(event) {
    // DevTools is open - always ignore to prevent interference
    if (this.isDevToolsOpen) {
      console.log('[DevToolsFocus] → Ignoring keyboard shortcut (DevTools is open):', event.key);
      return true;
    }

    // Regular input focus checks
    const activeElement = document.activeElement;
    if (activeElement) {
      if (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') {
        return true;
      }
      if (activeElement.isContentEditable || activeElement.getAttribute('contenteditable') === 'true') {
        return true;
      }
    }

    if (event.target) {
      if (event.target.isContentEditable || event.target.getAttribute('contenteditable') === 'true') {
        return true;
      }
    }

    return false;
  }
}

// Singleton instance
export const devToolsFocus = new DevToolsFocusManager();
