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
import { debug } from '../shared/debug.js';
import './ThemeEditor.css';

// Define editable variables grouped by category
const VARIABLE_GROUPS = {
  'Theme Mode': {
    type: 'mode',
    variables: [] // Special handling for theme mode selector
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
  }
};

// Default presets
const DEFAULT_PRESETS = {
  'Terminal Beige (Light)': 'light',
  'CRT Phosphor (Dark)': 'dark'
};

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
  const [customPresets, setCustomPresets] = useState({});
  const [presetName, setPresetName] = useState('');
  const [themeMode, setThemeMode] = useState(themeManager.getPreference());

  // Load current values on mount
  useEffect(() => {
    loadCurrentValues();
    loadCustomPresets();

    // Listen for theme changes
    const handleThemeChange = () => {
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
      group.variables.forEach(v => {
        const raw = getCSSVariable(v.name);
        if (group.type === 'color') {
          newValues[v.name] = rgbToHex(raw) || raw;
        } else {
          newValues[v.name] = parseNumericValue(raw);
        }
      });
    });
    setValues(newValues);
    debug('ThemeEditor', 'Loaded values:', Object.keys(newValues).length);
  }, []);

  const loadCustomPresets = useCallback(() => {
    try {
      const saved = localStorage.getItem('theme-custom-presets');
      if (saved) {
        setCustomPresets(JSON.parse(saved));
      }
    } catch (err) {
      console.warn('Failed to load custom presets:', err);
    }
  }, []);

  const handleValueChange = useCallback((name, value, type, unit = '') => {
    const cssValue = type === 'number' ? `${value}${unit}` : value;
    setCSSVariable(name, cssValue);
    setValues(prev => ({ ...prev, [name]: value }));
  }, []);

  const handleThemeModeChange = useCallback((mode) => {
    themeManager.setPreference(mode);
    setThemeMode(mode);
  }, []);

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
    if (DEFAULT_PRESETS[name]) {
      // Built-in preset - switch theme mode
      themeManager.setPreference(DEFAULT_PRESETS[name]);
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

  const renderGroup = (groupName, group) => {
    if (groupName === 'Theme Mode') {
      return (
        <div className="theme-mode-selector">
          <label>Current Theme:</label>
          <select
            value={themeMode}
            onChange={(e) => handleThemeModeChange(e.target.value)}
          >
            <option value="light">Light (Terminal Beige)</option>
            <option value="dark">Dark (CRT Phosphor)</option>
            <option value="system">Follow System</option>
          </select>
          <p className="theme-mode-hint">
            {themeMode === 'system'
              ? `Following system (currently ${themeManager.getCurrentTheme()})`
              : `Using ${themeMode} theme`}
          </p>
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
                    value={value}
                    onChange={(e) => handleValueChange(v.name, e.target.value, 'number', group.unit)}
                  />
                  <input
                    type="number"
                    min={v.min || 0}
                    max={v.max || 100}
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
    <div className="theme-editor">
      <div className="theme-editor-sidebar">
        <h3>Categories</h3>
        <ul className="category-list">
          {Object.keys(VARIABLE_GROUPS).map(name => (
            <li
              key={name}
              className={activeGroup === name ? 'active' : ''}
              onClick={() => setActiveGroup(name)}
            >
              {name}
            </li>
          ))}
        </ul>

        <h3>Presets</h3>
        <ul className="preset-list">
          {Object.keys(DEFAULT_PRESETS).map(name => (
            <li key={name} onClick={() => loadPreset(name)}>
              {name}
            </li>
          ))}
          {Object.keys(customPresets).map(name => (
            <li key={name} className="custom-preset">
              <span onClick={() => loadPreset(name)}>{name}</span>
              <button onClick={() => deletePreset(name)} title="Delete">x</button>
            </li>
          ))}
        </ul>

        <div className="preset-actions">
          <div className="save-preset">
            <input
              type="text"
              placeholder="Preset name..."
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <button onClick={savePreset} disabled={!presetName.trim()}>Save</button>
          </div>
          <div className="preset-buttons">
            <button onClick={exportPresets}>Export</button>
            <button onClick={importPresets}>Import</button>
            <button onClick={resetToDefault}>Reset</button>
          </div>
        </div>
      </div>

      <div className="theme-editor-content">
        <h2>{activeGroup}</h2>
        {renderGroup(activeGroup, VARIABLE_GROUPS[activeGroup])}
      </div>
    </div>
  );
}
