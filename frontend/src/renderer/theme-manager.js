/**
 * Theme Manager for hitta_ansikten workspace
 *
 * Manages light/dark/system theme preference with:
 * - Tri-state preference: 'light', 'dark', or 'system'
 * - System-sync via matchMedia when preference is 'system'
 * - LocalStorage persistence
 * - Event dispatch for theme changes
 *
 * Usage:
 *   import { themeManager } from './theme-manager.js';
 *   themeManager.setPreference('dark');
 *   themeManager.toggleManualTheme();
 *   themeManager.followSystem();
 */

class ThemeManager {
  constructor() {
    this.storageKey = 'theme-preference';
    this.systemQuery = window.matchMedia('(prefers-color-scheme: dark)');
    this.preference = localStorage.getItem(this.storageKey) || 'dark'; // Default to dark
    this.currentTheme = null;

    // Apply initial theme based on stored preference or default
    this.applyFromPreference({ persist: false });

    // Keep UI in sync with system changes when preference === 'system'
    this.systemQuery.addEventListener('change', (event) => {
      if (this.preference === 'system') {
        this.applyTheme(event.matches ? 'dark' : 'light', { persist: false });
      }
    });
  }

  /**
   * Get the current system theme (based on OS preference)
   * @returns {'light' | 'dark'}
   */
  getSystemTheme() {
    return this.systemQuery.matches ? 'dark' : 'light';
  }

  /**
   * Get the current preference setting
   * @returns {'light' | 'dark' | 'system'}
   */
  getPreference() {
    return this.preference;
  }

  /**
   * Get the currently active theme
   * @returns {'light' | 'dark'}
   */
  getCurrentTheme() {
    return this.currentTheme;
  }

  /**
   * Apply theme based on current preference
   * @param {Object} options - { persist: boolean }
   */
  applyFromPreference(options = { persist: true }) {
    const theme = this.preference === 'system'
      ? this.getSystemTheme()
      : this.preference;
    this.applyTheme(theme, options);
  }

  /**
   * Apply a specific theme to the document
   * @param {'light' | 'dark'} theme - The theme to apply
   * @param {Object} options - { persist: boolean }
   */
  applyTheme(theme, options = { persist: true }) {
    if (!document.documentElement) return;

    document.documentElement.setAttribute('data-theme', theme);
    this.currentTheme = theme;

    if (options.persist) {
      localStorage.setItem(this.storageKey, this.preference);
    }

    // Dispatch event for modules that need to react to theme changes
    window.dispatchEvent(new CustomEvent('theme-changed', {
      detail: {
        theme,
        preference: this.preference
      }
    }));
  }

  /**
   * Set the theme preference (persists to localStorage)
   * @param {'light' | 'dark' | 'system'} preference
   */
  setPreference(preference) {
    if (!['light', 'dark', 'system'].includes(preference)) {
      console.warn(`Invalid theme preference: ${preference}`);
      return;
    }

    this.preference = preference;
    localStorage.setItem(this.storageKey, preference);
    this.applyFromPreference();
  }

  /**
   * Preview a theme preference without persisting to localStorage.
   * Used for live preview in preferences dialog.
   * @param {'light' | 'dark' | 'system'} preference
   */
  previewPreference(preference) {
    if (!['light', 'dark', 'system'].includes(preference)) {
      console.warn(`Invalid theme preference: ${preference}`);
      return;
    }

    // Temporarily set preference for resolving 'system'
    const originalPreference = this.preference;
    this.preference = preference;

    const theme = preference === 'system'
      ? this.getSystemTheme()
      : preference;

    // Apply visually but don't persist
    this.applyTheme(theme, { persist: false });

    // Keep the preview preference active (don't restore original)
    // This allows multiple preview changes to work correctly
  }

  /**
   * Restore the theme from localStorage (cancel preview)
   */
  cancelPreview() {
    this.preference = localStorage.getItem(this.storageKey) || 'dark';
    this.applyFromPreference({ persist: false });
  }

  /**
   * Toggle between light and dark (sets preference to the opposite theme)
   */
  toggleManualTheme() {
    const next = this.currentTheme === 'light' ? 'dark' : 'light';
    this.setPreference(next);
  }

  /**
   * Set preference to follow system theme
   */
  followSystem() {
    this.setPreference('system');
  }

  /**
   * Check if currently following system theme
   * @returns {boolean}
   */
  isFollowingSystem() {
    return this.preference === 'system';
  }
}

// Export singleton instance
export const themeManager = new ThemeManager();

// Also export the class for testing
export { ThemeManager };
