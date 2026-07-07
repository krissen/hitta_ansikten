/**
 * UI preferences wiring for the FlexLayout workspace.
 *
 * applyUIPreferences maps the user's appearance preferences onto FlexLayout's
 * CSS variables and an injected <style> block. useUIPreferences installs the
 * effect that applies them on mount and re-applies on preference change /
 * live-preview / cancel events.
 */

import { useEffect } from 'react';
import { preferences } from '../preferences.js';
import { debug } from '../../shared/debug.js';

/**
 * Apply UI preferences to FlexLayout CSS variables
 * Maps preferences to FlexLayout's theming system
 * @param {object} overrides - Optional override values (for live preview)
 */
export function applyUIPreferences(overrides = null) {
  const layoutEl = document.querySelector('.flexlayout__layout');
  if (!layoutEl) {
    debug('FlexLayout', 'Layout element not found, will retry');
    return false;
  }

  // Helper to get value from overrides or preferences
  const getValue = (path, defaultVal) => {
    if (overrides && overrides.appearance) {
      const key = path.split('.').pop();
      if (overrides.appearance[key] !== undefined) {
        return overrides.appearance[key];
      }
    }
    return preferences.get(path) || defaultVal;
  };

  // Size preferences (colors now come from theme.css)
  const tabsHeight = getValue('appearance.tabsHeight', 28);
  const tabsFontSize = getValue('appearance.tabsFontSize', 13);
  const tabPaddingLeft = getValue('appearance.tabPaddingLeft', 8);
  const tabPaddingRight = getValue('appearance.tabPaddingRight', 6);
  const tabMinGap = getValue('appearance.tabMinGap', 5);

  // Apply font size to FlexLayout CSS variable
  layoutEl.style.setProperty('--font-size', `${tabsFontSize}px`);

  // Apply tab sizing via direct CSS injection (colors come from theme)
  let styleEl = document.getElementById('flexlayout-preferences-style');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'flexlayout-preferences-style';
    document.head.appendChild(styleEl);
  }

  styleEl.textContent = `
    /* Tab sizing preferences (colors from theme.css) */
    .flexlayout__tab_button {
      padding: 4px ${tabPaddingRight}px 4px ${tabPaddingLeft}px !important;
      height: ${tabsHeight}px !important;
      box-sizing: border-box !important;
      font-size: ${tabsFontSize}px !important;
      gap: ${tabMinGap}px !important;
    }
    .flexlayout__tabset_tabbar_outer {
      font-size: ${tabsFontSize}px !important;
      min-height: ${tabsHeight + 4}px !important;
    }
  `;

  debug('FlexLayout', 'Applied UI preferences');
  return true;
}

/**
 * Install the effect that applies UI preferences once the workspace is ready
 * and re-applies them on preference change / live-preview / cancel events.
 * @param {boolean} ready - whether the layout model has been created
 */
export function useUIPreferences(ready) {
  useEffect(() => {
    if (!ready) return;

    // Apply preferences (may need retry if layout element not yet mounted)
    const tryApply = () => {
      if (!applyUIPreferences()) {
        setTimeout(tryApply, 100);
      }
    };
    tryApply();

    // Listen for preference changes (saved) - read from actual preferences
    const handlePrefChange = () => applyUIPreferences();
    window.addEventListener('preferences-changed', handlePrefChange);

    // Listen for live preview - use tempPrefs from event
    const handlePreview = (e) => {
      if (e.detail && e.detail.tempPrefs) {
        applyUIPreferences(e.detail.tempPrefs);
      }
    };
    window.addEventListener('preferences-preview', handlePreview);

    // Listen for cancel - restore from actual saved preferences
    const handleCancel = () => applyUIPreferences();
    window.addEventListener('preferences-cancelled', handleCancel);

    return () => {
      window.removeEventListener('preferences-changed', handlePrefChange);
      window.removeEventListener('preferences-preview', handlePreview);
      window.removeEventListener('preferences-cancelled', handleCancel);
    };
  }, [ready]);
}
