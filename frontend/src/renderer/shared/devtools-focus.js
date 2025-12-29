/**
 * DevTools Focus Detection
 *
 * Tracks when DevTools has focus to prevent keyboard shortcuts
 * from interfering with console input.
 */

class DevToolsFocusManager {
  constructor() {
    this.isDevToolsFocused = false;
    this.listeners = [];

    // Listen for focus changes from main process
    if (window.bildvisareAPI) {
      window.bildvisareAPI.on('devtools-focus-changed', (focused) => {
        console.log('[DevToolsFocus] Focus changed:', focused);
        this.isDevToolsFocused = focused;
        this.notifyListeners();
      });

      // Query initial state
      window.bildvisareAPI.invoke('is-devtools-focused').then(focused => {
        this.isDevToolsFocused = focused;
        console.log('[DevToolsFocus] Initial state:', focused);
      }).catch(err => {
        console.warn('[DevToolsFocus] Failed to query initial state:', err);
      });
    } else {
      console.warn('[DevToolsFocus] bildvisareAPI not available');
    }
  }

  /**
   * Check if DevTools currently has focus
   */
  isFocused() {
    return this.isDevToolsFocused;
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
        listener(this.isDevToolsFocused);
      } catch (err) {
        console.error('[DevToolsFocus] Listener error:', err);
      }
    });
  }

  /**
   * Helper: Check if keyboard event should be ignored
   * Returns true if event should be ignored (DevTools has focus OR input is focused)
   */
  shouldIgnoreKeyboardEvent(event) {
    console.log('[DevToolsFocus] shouldIgnoreKeyboardEvent called:', {
      key: event.key,
      isDevToolsFocused: this.isDevToolsFocused,
      activeElement: document.activeElement?.tagName
    });

    // DevTools has focus - always ignore
    if (this.isDevToolsFocused) {
      console.log('[DevToolsFocus] → Ignoring (DevTools focused)');
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
