/**
 * ThemeEditor Component
 *
 * Visual editor for CSS theme variables with:
 * - Color pickers for all color variables
 * - Sliders for numeric values (spacing, radius)
 * - Live preview
 * - Preset management (save/load/export/import)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { themeManager } from '../theme-manager.js';
import { preferences } from '../workspace/preferences.js';
import { debug } from '../shared/debug.js';
import './ThemeEditor.css';

// Storage keys
const PRESET_BINDINGS_KEY = 'theme-preset-bindings';
const CUSTOM_PRESETS_KEY = 'theme-custom-presets';

// Define editable variables grouped by category
const VARIABLE_GROUPS = {
  'Theme Mode': {
    type: 'mode',
    variables: [] // Special handling for theme mode selector
  },
  'Tab Appearance': {
    type: 'tabs',
    variables: [
      { name: 'tabsHeight', label: 'Tab Height', min: 20, max: 40, unit: 'px', pref: 'appearance.tabsHeight' },
      { name: 'tabsFontSize', label: 'Font Size', min: 10, max: 18, unit: 'px', pref: 'appearance.tabsFontSize' },
      { name: 'tabPaddingLeft', label: 'Left Padding', min: 0, max: 20, unit: 'px', pref: 'appearance.tabPaddingLeft' },
      { name: 'tabPaddingRight', label: 'Right Padding', min: 0, max: 20, unit: 'px', pref: 'appearance.tabPaddingRight' },
      { name: 'tabMinGap', label: 'Min Gap', min: 0, max: 30, unit: 'px', pref: 'appearance.tabMinGap' },
      { name: 'tabMinWidth', label: 'Min Width (0=auto)', min: 0, max: 200, unit: 'px', pref: 'appearance.tabMinWidth' }
    ]
  },
  'Backgrounds': {
    type: 'color',
    variables: [
      { name: '--bg-primary', label: 'Primary Background' },
      { name: '--bg-secondary', label: 'Secondary Background' },
      { name: '--bg-tertiary', label: 'Tertiary Background' },
      { name: '--bg-elevated', label: 'Elevated (Cards)' },
      { name: '--bg-hover', label: 'Hover State' },
      { name: '--bg-active', label: 'Active State' }
    ]
  },
  'Text Colors': {
    type: 'color',
    variables: [
      { name: '--text-primary', label: 'Primary Text' },
      { name: '--text-secondary', label: 'Secondary Text' },
      { name: '--text-tertiary', label: 'Tertiary Text' },
      { name: '--text-inverse', label: 'Inverse Text' },
      { name: '--text-on-accent', label: 'Text on Accent' }
    ]
  },
  'Borders': {
    type: 'color',
    variables: [
      { name: '--border-subtle', label: 'Subtle Border' },
      { name: '--border-medium', label: 'Medium Border' },
      { name: '--border-strong', label: 'Strong Border' }
    ]
  },
  'Accent Colors': {
    type: 'color',
    variables: [
      { name: '--accent-primary', label: 'Primary Accent' },
      { name: '--accent-primary-hover', label: 'Primary Hover' },
      { name: '--accent-secondary', label: 'Secondary Accent' },
      { name: '--accent-secondary-hover', label: 'Secondary Hover' }
    ]
  },
  'Semantic Colors': {
    type: 'color',
    variables: [
      { name: '--color-success', label: 'Success' },
      { name: '--color-success-bg', label: 'Success Background' },
      { name: '--color-warning', label: 'Warning' },
      { name: '--color-warning-bg', label: 'Warning Background' },
      { name: '--color-error', label: 'Error' },
      { name: '--color-error-bg', label: 'Error Background' },
      { name: '--color-info', label: 'Info' },
      { name: '--color-info-bg', label: 'Info Background' }
    ]
  },
  'Overlay Colors': {
    type: 'color',
    variables: [
      { name: '--overlay-bg', label: 'Overlay Background' },
      { name: '--overlay-text', label: 'Overlay Text' }
    ]
  },
  'Spacing': {
    type: 'number',
    unit: 'px',
    variables: [
      { name: '--space-xs', label: 'Extra Small', min: 0, max: 16 },
      { name: '--space-sm', label: 'Small', min: 0, max: 24 },
      { name: '--space-md', label: 'Medium', min: 0, max: 32 },
      { name: '--space-lg', label: 'Large', min: 0, max: 48 },
      { name: '--space-xl', label: 'Extra Large', min: 0, max: 64 },
      { name: '--space-2xl', label: '2X Large', min: 0, max: 96 }
    ]
  },
  'Border Radius': {
    type: 'number',
    unit: 'px',
    variables: [
      { name: '--radius-sm', label: 'Small', min: 0, max: 16 },
      { name: '--radius-md', label: 'Medium', min: 0, max: 24 },
      { name: '--radius-lg', label: 'Large', min: 0, max: 32 },
      { name: '--radius-xl', label: 'Extra Large', min: 0, max: 48 }
    ]
  },
  'Opacity': {
    type: 'number',
    unit: '',
    variables: [
      { name: '--toast-opacity', label: 'Toast Opacity', min: 0.5, max: 1.0, step: 0.01 },
      { name: '--overlay-opacity', label: 'Overlay Opacity', min: 0.5, max: 1.0, step: 0.01 }
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
      console.warn('Failed to load custom presets:', err);
    }
  }, []);

  const loadPresetBindings = useCallback(() => {
    try {
      const saved = localStorage.getItem(PRESET_BINDINGS_KEY);
      if (saved) {
        setPresetBindings(JSON.parse(saved));
      }
    } catch (err) {
      console.warn('Failed to load preset bindings:', err);
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

  const deletePreset = useCallback((name) => {
    const newPresets = { ...customPresets };
    delete newPresets[name];
    setCustomPresets(newPresets);
    localStorage.setItem('theme-custom-presets', JSON.stringify(newPresets));
    debug('ThemeEditor', 'Deleted preset:', name);
  }, [customPresets]);

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
          console.error('Failed to import presets:', err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [customPresets]);

  const resetToDefault = useCallback(() => {
    // Remove all custom CSS variable overrides
    Object.keys(values).forEach(v => {
      document.documentElement.style.removeProperty(v);
    });
    setTimeout(loadCurrentValues, 50);
    debug('ThemeEditor', 'Reset to defaults');
  }, [values, loadCurrentValues]);

  const allPresetNames = getAllPresetNames(customPresets);

  const renderGroup = (groupName, group) => {
    if (groupName === 'Theme Mode') {
      return (
        <div className="theme-mode-section">
          <div className="form-field theme-mode-selector">
            <label className="form-label">Current Theme:</label>
            <select
              className="form-select"
              value={themeMode}
              onChange={(e) => handleThemeModeChange(e.target.value)}
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">Follow System</option>
            </select>
            <p className="hint-text">
              {themeMode === 'system'
                ? `Following system (currently ${themeManager.getCurrentTheme()})`
                : `Using ${themeMode} theme`}
            </p>
          </div>

          <div className="section-card preset-bindings">
            <h4 className="section-title">Preset Bindings</h4>
            <p className="hint-text">
              Choose which preset to use for each theme mode
            </p>
            <div className="binding-row">
              <label className="form-label">Light mode preset:</label>
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
              <label className="form-label">Dark mode preset:</label>
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
                <label>{v.label}</label>
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
                <label>{v.label}</label>
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
                <label>{v.label}</label>
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
        <h3 className="sidebar-title">Categories</h3>
        <ul className="item-list">
          {Object.keys(VARIABLE_GROUPS).map(name => (
            <li
              key={name}
              className={`list-item-nav ${activeGroup === name ? 'active' : ''}`}
              onClick={() => setActiveGroup(name)}
            >
              {name}
            </li>
          ))}
        </ul>

        <h3 className="sidebar-title">Presets</h3>
        <ul className="item-list preset-list">
          {Object.keys(BUILTIN_PRESETS).map(name => (
            <li key={name} className="list-item-nav" onClick={() => loadPreset(name)}>
              {name}
            </li>
          ))}
          {Object.keys(customPresets).map(name => (
            <li key={name} className="list-item-nav custom-preset">
              <span onClick={() => loadPreset(name)}>{name}</span>
              <button onClick={() => deletePreset(name)} title="Delete">×</button>
            </li>
          ))}
        </ul>

        <div className="sidebar-actions">
          <div className="save-preset">
            <input
              type="text"
              className="form-input"
              placeholder="Preset name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button className="btn-secondary" onClick={savePreset} disabled={!presetName.trim()}>Save</button>
          </div>
          <div className="preset-buttons">
            <button className="btn-secondary" onClick={exportPresets}>Export</button>
            <button className="btn-secondary" onClick={importPresets}>Import</button>
            <button className="btn-secondary" onClick={resetToDefault}>Reset</button>
          </div>
        </div>
      </div>

      <div className="module-content">
        <h2 className="content-title">{activeGroup}</h2>
        {renderGroup(activeGroup, VARIABLE_GROUPS[activeGroup])}
      </div>
    </div>
  );
}
