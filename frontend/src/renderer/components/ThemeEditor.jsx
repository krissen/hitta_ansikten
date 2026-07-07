/**
 * ThemeEditor Component
 *
 * Visual editor for CSS theme variables with:
 * - Color pickers for all color variables
 * - Sliders for numeric values (spacing, radius)
 * - Live preview
 * - Preset management (save/load/export/import)
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { themeManager } from '../theme-manager.js';
import { preferences } from '../workspace/preferences.js';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { t } from '../../i18n/index.js';
import { Button, IconButton } from './shared/index.js';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import './ThemeEditor.css';

/**
 * Activate a role="button" element on Enter/Space (house a11y pattern for
 * clickable non-buttons; see docs/dev/accessibility.md §2).
 */
function activateOnKey(handler) {
  return (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler();
    }
  };
}

// Storage keys
const PRESET_BINDINGS_KEY = 'theme-preset-bindings';
const CUSTOM_PRESETS_KEY = 'theme-custom-presets';

// Define editable variables grouped by category
// `label` values are i18n keys resolved with t() at render time; the group keys
// (e.g. 'Theme Mode') stay English identifiers and carry a `titleKey` for display.
const VARIABLE_GROUPS = {
  'Theme Mode': {
    type: 'mode',
    titleKey: 'themeEditor.categories.themeMode',
    variables: [] // Special handling for theme mode selector
  },
  'Tab Appearance': {
    type: 'tabs',
    titleKey: 'themeEditor.categories.tabAppearance',
    variables: [
      { name: 'tabsHeight', label: 'themeEditor.vars.tabs.height', min: 20, max: 40, unit: 'px', pref: 'appearance.tabsHeight' },
      { name: 'tabsFontSize', label: 'themeEditor.vars.tabs.fontSize', min: 10, max: 18, unit: 'px', pref: 'appearance.tabsFontSize' },
      { name: 'tabPaddingLeft', label: 'themeEditor.vars.tabs.paddingLeft', min: 0, max: 20, unit: 'px', pref: 'appearance.tabPaddingLeft' },
      { name: 'tabPaddingRight', label: 'themeEditor.vars.tabs.paddingRight', min: 0, max: 20, unit: 'px', pref: 'appearance.tabPaddingRight' },
      { name: 'tabMinGap', label: 'themeEditor.vars.tabs.minGap', min: 0, max: 30, unit: 'px', pref: 'appearance.tabMinGap' },
      { name: 'tabMinWidth', label: 'themeEditor.vars.tabs.minWidth', min: 0, max: 200, unit: 'px', pref: 'appearance.tabMinWidth' }
    ]
  },
  'Backgrounds': {
    type: 'color',
    titleKey: 'themeEditor.categories.backgrounds',
    variables: [
      { name: '--bg-primary', label: 'themeEditor.vars.bg.primary' },
      { name: '--bg-secondary', label: 'themeEditor.vars.bg.secondary' },
      { name: '--bg-tertiary', label: 'themeEditor.vars.bg.tertiary' },
      { name: '--bg-elevated', label: 'themeEditor.vars.bg.elevated' },
      { name: '--bg-hover', label: 'themeEditor.vars.bg.hover' },
      { name: '--bg-active', label: 'themeEditor.vars.bg.active' }
    ]
  },
  'Text Colors': {
    type: 'color',
    titleKey: 'themeEditor.categories.textColors',
    variables: [
      { name: '--text-primary', label: 'themeEditor.vars.text.primary' },
      { name: '--text-secondary', label: 'themeEditor.vars.text.secondary' },
      { name: '--text-tertiary', label: 'themeEditor.vars.text.tertiary' },
      { name: '--text-inverse', label: 'themeEditor.vars.text.inverse' },
      { name: '--text-on-accent', label: 'themeEditor.vars.text.onAccent' }
    ]
  },
  'Borders': {
    type: 'color',
    titleKey: 'themeEditor.categories.borders',
    variables: [
      { name: '--border-subtle', label: 'themeEditor.vars.border.subtle' },
      { name: '--border-medium', label: 'themeEditor.vars.border.medium' },
      { name: '--border-strong', label: 'themeEditor.vars.border.strong' }
    ]
  },
  'Accent Colors': {
    type: 'color',
    titleKey: 'themeEditor.categories.accentColors',
    variables: [
      { name: '--accent-primary', label: 'themeEditor.vars.accent.primary' },
      { name: '--accent-primary-hover', label: 'themeEditor.vars.accent.primaryHover' },
      { name: '--accent-secondary', label: 'themeEditor.vars.accent.secondary' },
      { name: '--accent-secondary-hover', label: 'themeEditor.vars.accent.secondaryHover' }
    ]
  },
  'Semantic Colors': {
    type: 'color',
    titleKey: 'themeEditor.categories.semanticColors',
    variables: [
      { name: '--color-success', label: 'themeEditor.vars.semantic.success' },
      { name: '--color-success-bg', label: 'themeEditor.vars.semantic.successBg' },
      { name: '--color-warning', label: 'themeEditor.vars.semantic.warning' },
      { name: '--color-warning-bg', label: 'themeEditor.vars.semantic.warningBg' },
      { name: '--color-error', label: 'themeEditor.vars.semantic.error' },
      { name: '--color-error-bg', label: 'themeEditor.vars.semantic.errorBg' },
      { name: '--color-info', label: 'themeEditor.vars.semantic.info' },
      { name: '--color-info-bg', label: 'themeEditor.vars.semantic.infoBg' },
      { name: '--color-success-text', label: 'themeEditor.vars.semantic.successText' },
      { name: '--color-warning-text', label: 'themeEditor.vars.semantic.warningText' },
      { name: '--color-error-text', label: 'themeEditor.vars.semantic.errorText' }
    ]
  },
  'Overlay Colors': {
    type: 'color',
    titleKey: 'themeEditor.categories.overlayColors',
    variables: [
      { name: '--overlay-bg', label: 'themeEditor.vars.overlay.bg' },
      { name: '--overlay-text', label: 'themeEditor.vars.overlay.text' }
    ]
  },
  'Spacing': {
    type: 'number',
    unit: 'px',
    titleKey: 'themeEditor.categories.spacing',
    variables: [
      { name: '--space-xs', label: 'themeEditor.sizes.extraSmall', min: 0, max: 16 },
      { name: '--space-sm', label: 'themeEditor.sizes.small', min: 0, max: 24 },
      { name: '--space-md', label: 'themeEditor.sizes.medium', min: 0, max: 32 },
      { name: '--space-lg', label: 'themeEditor.sizes.large', min: 0, max: 48 },
      { name: '--space-xl', label: 'themeEditor.sizes.extraLarge', min: 0, max: 64 },
      { name: '--space-2xl', label: 'themeEditor.sizes.xxLarge', min: 0, max: 96 }
    ]
  },
  'Border Radius': {
    type: 'number',
    unit: 'px',
    titleKey: 'themeEditor.categories.borderRadius',
    variables: [
      { name: '--radius-sm', label: 'themeEditor.sizes.small', min: 0, max: 16 },
      { name: '--radius-md', label: 'themeEditor.sizes.medium', min: 0, max: 24 },
      { name: '--radius-lg', label: 'themeEditor.sizes.large', min: 0, max: 32 },
      { name: '--radius-xl', label: 'themeEditor.sizes.extraLarge', min: 0, max: 48 }
    ]
  },
  'Opacity': {
    type: 'number',
    unit: '',
    titleKey: 'themeEditor.categories.opacity',
    variables: [
      { name: '--toast-opacity', label: 'themeEditor.vars.opacity.toast', min: 0.5, max: 1.0, step: 0.01 },
      { name: '--overlay-opacity', label: 'themeEditor.vars.opacity.overlay', min: 0.5, max: 1.0, step: 0.01 }
    ]
  }
};

// Built-in presets (name -> base theme)
const BUILTIN_PRESETS = {
  'Terminal Beige': 'light',
  'CRT Phosphor': 'dark'
};

// Get all available preset names (builtin + custom)
function getAllPresetNames(customPresets) {
  return [...Object.keys(BUILTIN_PRESETS), ...Object.keys(customPresets)];
}

/**
 * Get current value of a CSS variable
 */
function getCSSVariable(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Set a CSS variable value
 */
function setCSSVariable(name, value) {
  document.documentElement.style.setProperty(name, value);
}

/**
 * Convert RGB to Hex
 */
function rgbToHex(rgb) {
  if (!rgb || rgb.startsWith('#')) return rgb;
  const match = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
  if (!match) return rgb;
  const [, r, g, b] = match;
  return '#' + [r, g, b].map(x => {
    const hex = parseInt(x).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

/**
 * Parse numeric CSS value
 */
function parseNumericValue(value) {
  const match = value.match(/^([\d.]+)(px|rem|em|%)?$/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * ThemeEditor Component
 */
export function ThemeEditor({ api }) {
  const confirm = useConfirm();
  const showToast = useToast();
  // Guards against a second activation while a confirm dialog is already open.
  const confirmBusyRef = useRef(false);
  const [activeGroup, setActiveGroup] = useState('Theme Mode');
  const [values, setValues] = useState({});
  const [tabValues, setTabValues] = useState({});
  const [customPresets, setCustomPresets] = useState({});
  const [presetName, setPresetName] = useState('');
  const [themeMode, setThemeMode] = useState(themeManager.getPreference());
  const [presetBindings, setPresetBindings] = useState({
    light: 'Terminal Beige',
    dark: 'CRT Phosphor'
  });

  // Load current values on mount
  useEffect(() => {
    loadCurrentValues();
    loadTabValues();
    loadCustomPresets();
    loadPresetBindings();

    // Listen for theme changes
    const handleThemeChange = (e) => {
      setThemeMode(themeManager.getPreference());
      // Small delay to let CSS variables update
      setTimeout(loadCurrentValues, 50);
    };

    window.addEventListener('theme-changed', handleThemeChange);
    return () => window.removeEventListener('theme-changed', handleThemeChange);
  }, []);

  const loadCurrentValues = useCallback(() => {
    const newValues = {};
    Object.values(VARIABLE_GROUPS).forEach(group => {
      if (group.type === 'color' || group.type === 'number') {
        group.variables.forEach(v => {
          const raw = getCSSVariable(v.name);
          if (group.type === 'color') {
            newValues[v.name] = rgbToHex(raw) || raw;
          } else {
            newValues[v.name] = parseNumericValue(raw);
          }
        });
      }
    });
    setValues(newValues);
    debug('ThemeEditor', 'Loaded CSS values:', Object.keys(newValues).length);
  }, []);

  const loadTabValues = useCallback(() => {
    const tabGroup = VARIABLE_GROUPS['Tab Appearance'];
    const newTabValues = {};
    tabGroup.variables.forEach(v => {
      newTabValues[v.name] = preferences.get(v.pref) ?? 0;
    });
    setTabValues(newTabValues);
    debug('ThemeEditor', 'Loaded tab values:', newTabValues);
  }, []);

  const loadCustomPresets = useCallback(() => {
    try {
      const saved = localStorage.getItem(CUSTOM_PRESETS_KEY);
      if (saved) {
        setCustomPresets(JSON.parse(saved));
      }
    } catch (err) {
      debugWarn('ThemeEditor', 'Failed to load custom presets:', err);
    }
  }, []);

  const loadPresetBindings = useCallback(() => {
    try {
      const saved = localStorage.getItem(PRESET_BINDINGS_KEY);
      if (saved) {
        setPresetBindings(JSON.parse(saved));
      }
    } catch (err) {
      debugWarn('ThemeEditor', 'Failed to load preset bindings:', err);
    }
  }, []);

  const handleValueChange = useCallback((name, value, type, unit = '') => {
    const cssValue = type === 'number' ? `${value}${unit}` : value;
    setCSSVariable(name, cssValue);
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleTabValueChange = useCallback((name, value, prefPath) => {
    preferences.set(prefPath, parseInt(value, 10));
    setTabValues(prev => ({ ...prev, [name]: parseInt(value, 10) }));
    // Trigger UI update
    window.dispatchEvent(new CustomEvent('preferences-changed'));
  }, []);

  const handleThemeModeChange = useCallback((mode) => {
    themeManager.setPreference(mode);
    setThemeMode(mode);
  }, []);

  const handlePresetBindingChange = useCallback((themeType, presetName) => {
    const newBindings = { ...presetBindings, [themeType]: presetName };
    setPresetBindings(newBindings);
    localStorage.setItem(PRESET_BINDINGS_KEY, JSON.stringify(newBindings));
    debug('ThemeEditor', `Bound ${themeType} to preset:`, presetName);
  }, [presetBindings]);

  const savePreset = useCallback(() => {
    if (!presetName.trim()) return;

    const preset = { ...values };
    const newPresets = { ...customPresets, [presetName.trim()]: preset };
    setCustomPresets(newPresets);
    localStorage.setItem('theme-custom-presets', JSON.stringify(newPresets));
    setPresetName('');
    debug('ThemeEditor', 'Saved preset:', presetName);
  }, [presetName, values, customPresets]);

  const loadPreset = useCallback((name) => {
    if (BUILTIN_PRESETS[name]) {
      // Built-in preset - switch theme mode
      themeManager.setPreference(BUILTIN_PRESETS[name]);
      // Clear any custom overrides
      Object.keys(values).forEach(v => {
        document.documentElement.style.removeProperty(v);
      });
      setTimeout(loadCurrentValues, 50);
    } else if (customPresets[name]) {
      // Custom preset - apply all values
      const preset = customPresets[name];
      Object.entries(preset).forEach(([varName, value]) => {
        const group = Object.values(VARIABLE_GROUPS).find(g =>
          g.variables.some(v => v.name === varName)
        );
        if (group) {
          const unit = group.unit || '';
          setCSSVariable(varName, group.type === 'number' ? `${value}${unit}` : value);
        }
      });
      setValues(preset);
    }
    debug('ThemeEditor', 'Loaded preset:', name);
  }, [customPresets, values, loadCurrentValues]);

  const deletePreset = useCallback(async (name) => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const ok = await confirm({
        title: t('themeEditor.dialogs.deletePreset.title'),
        message: t('themeEditor.dialogs.deletePreset.message', { name }),
        confirmLabel: t('themeEditor.dialogs.deletePreset.confirm'),
        variant: 'danger'
      });
      if (!ok) return;
      // Read the latest presets at apply time so a stale closure can't resurrect
      // a preset deleted meanwhile.
      setCustomPresets(prev => {
        const newPresets = { ...prev };
        delete newPresets[name];
        localStorage.setItem('theme-custom-presets', JSON.stringify(newPresets));
        return newPresets;
      });
      debug('ThemeEditor', 'Deleted preset:', name);
    } finally {
      confirmBusyRef.current = false;
    }
  }, [confirm]);

  const exportPresets = useCallback(() => {
    const data = {
      version: 1,
      presets: customPresets,
      currentValues: values
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'theme-presets.json';
    a.click();
    URL.revokeObjectURL(url);
    debug('ThemeEditor', 'Exported presets');
  }, [customPresets, values]);

  const importPresets = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target.result);
          if (data.presets) {
            const merged = { ...customPresets, ...data.presets };
            setCustomPresets(merged);
            localStorage.setItem('theme-custom-presets', JSON.stringify(merged));
          }
          debug('ThemeEditor', 'Imported presets');
        } catch (err) {
          debugError('ThemeEditor', 'Failed to import presets:', err);
          showToast(t('themeEditor.toasts.importError'), { type: 'error' });
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [customPresets, showToast]);

  const resetToDefault = useCallback(async () => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const ok = await confirm({
        title: t('themeEditor.dialogs.reset.title'),
        message: t('themeEditor.dialogs.reset.message'),
        confirmLabel: t('themeEditor.dialogs.reset.confirm'),
        variant: 'danger'
      });
      if (!ok) return;
      // Remove all custom CSS variable overrides
      Object.keys(values).forEach(v => {
        document.documentElement.style.removeProperty(v);
      });
      setTimeout(loadCurrentValues, 50);
      debug('ThemeEditor', 'Reset to defaults');
    } finally {
      confirmBusyRef.current = false;
    }
  }, [confirm, values, loadCurrentValues]);

  const allPresetNames = getAllPresetNames(customPresets);

  const renderGroup = (groupName, group) => {
    if (groupName === 'Theme Mode') {
      return (
        <div className="theme-mode-section">
          <div className="form-field theme-mode-selector">
            <label className="form-label">{t('themeEditor.labels.currentTheme')}</label>
            <select
              className="form-select"
              value={themeMode}
              onChange={(e) => handleThemeModeChange(e.target.value)}
            >
              <option value="light">{t('themeEditor.themeModeOptions.light')}</option>
              <option value="dark">{t('themeEditor.themeModeOptions.dark')}</option>
              <option value="system">{t('themeEditor.themeModeOptions.system')}</option>
            </select>
            <p className="hint-text">
              {themeMode === 'system'
                ? t('themeEditor.hints.followingSystem', { theme: t(`themeEditor.themeModeOptions.${themeManager.getCurrentTheme()}`) })
                : t('themeEditor.hints.usingTheme', { theme: t(`themeEditor.themeModeOptions.${themeMode}`) })}
            </p>
          </div>

          <div className="section-card preset-bindings">
            <h4 className="section-title">{t('themeEditor.labels.presetBindings')}</h4>
            <p className="hint-text">
              {t('themeEditor.hints.presetBindings')}
            </p>
            <div className="binding-row">
              <label className="form-label">{t('themeEditor.labels.lightModePreset')}</label>
              <select
                className="form-select"
                value={presetBindings.light}
                onChange={(e) => handlePresetBindingChange('light', e.target.value)}
              >
                {allPresetNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
            <div className="binding-row">
              <label className="form-label">{t('themeEditor.labels.darkModePreset')}</label>
              <select
                className="form-select"
                value={presetBindings.dark}
                onChange={(e) => handlePresetBindingChange('dark', e.target.value)}
              >
                {allPresetNames.map(name => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      );
    }

    if (group.type === 'tabs') {
      return (
        <div className="variable-grid">
          {group.variables.map(v => {
            const value = tabValues[v.name] ?? 0;
            return (
              <div key={v.name} className="variable-item number-item">
                <label>{t(v.label)}</label>
                <div className="number-input-wrapper">
                  <input
                    type="range"
                    min={v.min}
                    max={v.max}
                    value={value}
                    onChange={(e) => handleTabValueChange(v.name, e.target.value, v.pref)}
                  />
                  <input
                    type="number"
                    min={v.min}
                    max={v.max}
                    value={value}
                    onChange={(e) => handleTabValueChange(v.name, e.target.value, v.pref)}
                    className="number-text-input"
                  />
                  <span className="unit">{v.unit}</span>
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    return (
      <div className="variable-grid">
        {group.variables.map(v => {
          const value = values[v.name];
          if (value === undefined) return null;

          if (group.type === 'color') {
            return (
              <div key={v.name} className="variable-item color-item">
                <label>{t(v.label)}</label>
                <div className="color-input-wrapper">
                  <input
                    type="color"
                    value={value.startsWith('#') ? value : '#888888'}
                    onChange={(e) => handleValueChange(v.name, e.target.value, 'color')}
                  />
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => handleValueChange(v.name, e.target.value, 'color')}
                    className="color-text-input"
                  />
                </div>
                <span className="variable-name">{v.name}</span>
              </div>
            );
          }

          if (group.type === 'number') {
            return (
              <div key={v.name} className="variable-item number-item">
                <label>{t(v.label)}</label>
                <div className="number-input-wrapper">
                  <input
                    type="range"
                    min={v.min || 0}
                    max={v.max || 100}
                    step={v.step || 1}
                    value={value}
                    onChange={(e) => handleValueChange(v.name, e.target.value, 'number', group.unit)}
                  />
                  <input
                    type="number"
                    min={v.min || 0}
                    max={v.max || 100}
                    step={v.step || 1}
                    value={value}
                    onChange={(e) => handleValueChange(v.name, e.target.value, 'number', group.unit)}
                    className="number-text-input"
                  />
                  <span className="unit">{group.unit}</span>
                </div>
                <span className="variable-name">{v.name}</span>
              </div>
            );
          }

          return null;
        })}
      </div>
    );
  };

  return (
    <div className="module-container has-sidebar theme-editor">
      <div className="module-sidebar">
        <h3 className="sidebar-title">{t('themeEditor.sidebar.categories')}</h3>
        <ul className="item-list">
          {Object.keys(VARIABLE_GROUPS).map(name => {
            const active = activeGroup === name;
            return (
              <li
                key={name}
                className={`list-item-nav ${active ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => setActiveGroup(name)}
                onKeyDown={activateOnKey(() => setActiveGroup(name))}
              >
                {t(VARIABLE_GROUPS[name].titleKey)}
              </li>
            );
          })}
        </ul>

        <h3 className="sidebar-title">{t('themeEditor.sidebar.presets')}</h3>
        <ul className="item-list preset-list">
          {Object.keys(BUILTIN_PRESETS).map(name => (
            <li
              key={name}
              className="list-item-nav"
              role="button"
              tabIndex={0}
              onClick={() => loadPreset(name)}
              onKeyDown={activateOnKey(() => loadPreset(name))}
            >
              {name}
            </li>
          ))}
          {Object.keys(customPresets).map(name => (
            <li key={name} className="list-item-nav custom-preset">
              <span
                className="custom-preset__name"
                role="button"
                tabIndex={0}
                onClick={() => loadPreset(name)}
                onKeyDown={activateOnKey(() => loadPreset(name))}
              >
                {name}
              </span>
              <IconButton
                icon="close"
                variant="danger"
                size="sm"
                label={t('themeEditor.deleteTitle')}
                onClick={() => deletePreset(name)}
              />
            </li>
          ))}
        </ul>

        <div className="sidebar-actions">
          <div className="save-preset">
            <input
              type="text"
              className="form-input"
              placeholder={t('themeEditor.presetNamePlaceholder')}
              aria-label={t('themeEditor.presetNamePlaceholder')}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <Button variant="primary" onClick={savePreset} disabled={!presetName.trim()}>{t('common.save')}</Button>
          </div>
          <div className="preset-buttons">
            <Button variant="secondary" onClick={exportPresets}>{t('themeEditor.buttons.export')}</Button>
            <Button variant="secondary" onClick={importPresets}>{t('themeEditor.buttons.import')}</Button>
            <Button variant="secondary" onClick={resetToDefault}>{t('common.reset')}</Button>
          </div>
        </div>
      </div>

      <div className="module-content">
        <h2 className="content-title">{t(VARIABLE_GROUPS[activeGroup].titleKey)}</h2>
        {renderGroup(activeGroup, VARIABLE_GROUPS[activeGroup])}
      </div>
    </div>
  );
}
