/**
 * PreferencesModule Component
 *
 * Theme-aware preferences editor as a FlexLayout module.
 * Replaces the old modal-based preferences UI.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { preferences } from '../workspace/preferences.js';
import { themeManager } from '../theme-manager.js';
import { getCategories, setCategories, resetCategories } from '../shared/debug.js';
import { debug } from '../shared/debug.js';
import './PreferencesModule.css';

// Define preference sections
const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'layout', label: 'Layout' },
  { id: 'image-viewer', label: 'Image Viewer' },
  { id: 'review', label: 'Review' },
  { id: 'files', label: 'Files' },
  { id: 'preprocessing', label: 'Preprocessing' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'advanced', label: 'Advanced' }
];

/**
 * Slider with synced number input
 */
function SliderField({ id, label, hint, value, onChange, min, max, step = 1 }) {
  return (
    <div className="pref-field">
      <label>{label}</label>
      <div className="slider-group">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="number-input"
        />
      </div>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Checkbox field
 */
function CheckboxField({ id, label, hint, checked, onChange }) {
  return (
    <div className="pref-field">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        {label}
      </label>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Select field
 */
function SelectField({ id, label, hint, value, onChange, options }) {
  return (
    <div className="pref-field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(opt => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Text input field
 */
function TextField({ id, label, hint, value, onChange, placeholder }) {
  return (
    <div className="pref-field">
      <label>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Number input field (without slider)
 */
function NumberField({ id, label, hint, value, onChange, min, max, step = 1 }) {
  return (
    <div className="pref-field">
      <label>{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="number-input-standalone"
      />
      {hint && <small>{hint}</small>}
    </div>
  );
}

/**
 * Section header
 */
function SectionHeader({ title }) {
  return <h3 className="section-header">{title}</h3>;
}

/**
 * PreferencesModule Component
 */
export function PreferencesModule({ api }) {
  const [activeSection, setActiveSection] = useState('general');
  const [prefs, setPrefs] = useState(() => preferences.getAll());
  const [hasChanges, setHasChanges] = useState(false);
  const [cacheStatus, setCacheStatus] = useState(null);

  // Helper function to apply toast opacity CSS variable
  // Used for immediate live preview when user adjusts slider
  const applyToastOpacity = useCallback((opacity) => {
    if (opacity !== undefined) {
      document.documentElement.style.setProperty('--toast-opacity', String(opacity));
    }
  }, []);

  // Load preferences on mount
  useEffect(() => {
    const loadedPrefs = preferences.getAll();
    setPrefs(loadedPrefs);
    // Apply toast opacity on load
    applyToastOpacity(loadedPrefs.notifications?.toastOpacity);
  }, [applyToastOpacity]);

  // Update a preference value
  const updatePref = useCallback((path, value) => {
    setPrefs(prev => {
      const newPrefs = JSON.parse(JSON.stringify(prev));
      const keys = path.split('.');
      let target = newPrefs;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {};
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = value;
      return newPrefs;
    });
    setHasChanges(true);
  }, []);

  // Save all preferences
  const handleSave = useCallback(() => {
    preferences.setAll(prefs);
    themeManager.setPreference(prefs.ui.theme);
    // Apply toast opacity if set
    applyToastOpacity(prefs.notifications?.toastOpacity);
    window.dispatchEvent(new CustomEvent('preferences-changed'));
    setHasChanges(false);
    debug('PreferencesModule', 'Preferences saved');
  }, [prefs, applyToastOpacity]);

  // Reset to defaults
  const handleReset = useCallback(() => {
    if (confirm('Reset all preferences to defaults?')) {
      const defaults = preferences.getDefaults();
      setPrefs(defaults);
      setHasChanges(true);
    }
  }, []);

  // Load cache status
  useEffect(() => {
    const loadCacheStatus = async () => {
      try {
        const { apiClient } = await import('../shared/api-client.js');
        const status = await apiClient.getCacheStatus();
        setCacheStatus(status);
      } catch (err) {
        setCacheStatus(null);
      }
    };
    if (activeSection === 'preprocessing') {
      loadCacheStatus();
    }
  }, [activeSection]);

  // Clear cache
  const handleClearCache = useCallback(async () => {
    if (confirm('Clear all cached preprocessing data?')) {
      try {
        const { apiClient } = await import('../shared/api-client.js');
        await apiClient.clearCache();
        const status = await apiClient.getCacheStatus();
        setCacheStatus(status);
      } catch (err) {
        console.error('Failed to clear cache:', err);
      }
    }
  }, []);

  // Render section content
  const renderSection = () => {
    switch (activeSection) {
      case 'general':
        return renderGeneralSection();
      case 'layout':
        return renderLayoutSection();
      case 'image-viewer':
        return renderImageViewerSection();
      case 'review':
        return renderReviewSection();
      case 'files':
        return renderFilesSection();
      case 'preprocessing':
        return renderPreprocessingSection();
      case 'dashboard':
        return renderDashboardSection();
      case 'advanced':
        return renderAdvancedSection();
      default:
        return null;
    }
  };

  const renderGeneralSection = () => (
    <>
      <SectionHeader title="Backend Settings" />
      <CheckboxField
        label="Auto-start backend server"
        checked={prefs.backend?.autoStart ?? true}
        onChange={(v) => updatePref('backend.autoStart', v)}
      />
      <NumberField
        label="Server Port"
        hint="Default: 5001. Requires app restart."
        value={prefs.backend?.port ?? 5001}
        onChange={(v) => updatePref('backend.port', v)}
        min={1024}
        max={65535}
      />
      <TextField
        label="Python Path"
        hint="Path to Python interpreter. Requires app restart."
        value={prefs.backend?.pythonPath ?? ''}
        onChange={(v) => updatePref('backend.pythonPath', v)}
      />

      <SectionHeader title="User Interface" />
      <SelectField
        label="Theme"
        hint="Application color theme."
        value={prefs.ui?.theme ?? 'system'}
        onChange={(v) => {
          updatePref('ui.theme', v);
          themeManager.previewPreference(v);
        }}
        options={[
          { value: 'dark', label: 'Dark (CRT Phosphor)' },
          { value: 'light', label: 'Light (Terminal Beige)' },
          { value: 'system', label: 'Follow System' }
        ]}
      />
      <SelectField
        label="Default Layout"
        value={prefs.ui?.defaultLayout ?? 'standard'}
        onChange={(v) => updatePref('ui.defaultLayout', v)}
        options={[
          { value: 'standard', label: 'Standard' },
          { value: 'compact', label: 'Compact (future)' },
          { value: 'review-focused', label: 'Review-Focused (future)' }
        ]}
      />
      <CheckboxField
        label="Show welcome message on startup"
        checked={prefs.ui?.showWelcome ?? true}
        onChange={(v) => updatePref('ui.showWelcome', v)}
      />
    </>
  );

  const renderLayoutSection = () => (
    <>
      <SectionHeader title="Default Layout Settings" />
      <SelectField
        label="Default Layout Template"
        hint="Layout to use when resetting or first launch."
        value={prefs.layout?.defaultTemplate ?? 'review'}
        onChange={(v) => updatePref('layout.defaultTemplate', v)}
        options={[
          { value: 'review', label: 'Review Mode' },
          { value: 'comparison', label: 'Comparison Mode' },
          { value: 'full-image', label: 'Full Image' },
          { value: 'stats', label: 'Statistics Mode' }
        ]}
      />
      <SelectField
        label="Default Grid Preset"
        hint="Default panel size ratio for new layouts."
        value={prefs.layout?.defaultGridPreset ?? '50-50'}
        onChange={(v) => updatePref('layout.defaultGridPreset', v)}
        options={[
          { value: '50-50', label: '50% / 50%' },
          { value: '60-40', label: '60% / 40%' },
          { value: '70-30', label: '70% / 30%' },
          { value: '30-70', label: '30% / 70%' },
          { value: '40-60', label: '40% / 60%' }
        ]}
      />
      <CheckboxField
        label="Auto-save layout on changes"
        hint="Automatically save panel positions and sizes when changed."
        checked={prefs.layout?.autoSaveLayout ?? true}
        onChange={(v) => updatePref('layout.autoSaveLayout', v)}
      />
      <CheckboxField
        label="Remember panel sizes across sessions"
        hint="Restore exact panel dimensions when reopening."
        checked={prefs.layout?.rememberPanelSizes ?? true}
        onChange={(v) => updatePref('layout.rememberPanelSizes', v)}
      />
    </>
  );

  const renderImageViewerSection = () => (
    <>
      <SectionHeader title="Image Viewer" />
      <SliderField
        label="Zoom Speed"
        hint="Zoom multiplier per step (1.07 = 7% per step)"
        value={prefs.imageViewer?.zoomSpeed ?? 1.07}
        onChange={(v) => updatePref('imageViewer.zoomSpeed', v)}
        min={1.01}
        max={2.0}
        step={0.01}
      />
      <SliderField
        label="Maximum Zoom"
        value={prefs.imageViewer?.maxZoom ?? 20}
        onChange={(v) => updatePref('imageViewer.maxZoom', v)}
        min={1}
        max={50}
      />
      <SliderField
        label="Minimum Zoom"
        value={prefs.imageViewer?.minZoom ?? 0.1}
        onChange={(v) => updatePref('imageViewer.minZoom', v)}
        min={0.01}
        max={1}
        step={0.01}
      />
      <SelectField
        label="Default Zoom Mode"
        value={prefs.imageViewer?.defaultZoomMode ?? 'auto-fit'}
        onChange={(v) => updatePref('imageViewer.defaultZoomMode', v)}
        options={[
          { value: 'auto-fit', label: 'Auto-fit (fit to window)' },
          { value: '1:1', label: '1:1 (actual size)' }
        ]}
      />
      <CheckboxField
        label="Smooth panning animation"
        checked={prefs.imageViewer?.smoothPan ?? true}
        onChange={(v) => updatePref('imageViewer.smoothPan', v)}
      />
    </>
  );

  const renderReviewSection = () => (
    <>
      <SectionHeader title="Review Module" />
      <CheckboxField
        label="Auto-save when all faces reviewed"
        checked={prefs.reviewModule?.autoSaveOnComplete ?? false}
        onChange={(v) => updatePref('reviewModule.autoSaveOnComplete', v)}
      />
      <CheckboxField
        label="Ask confirmation before saving"
        checked={prefs.reviewModule?.confirmBeforeSave ?? true}
        onChange={(v) => updatePref('reviewModule.confirmBeforeSave', v)}
      />
      <SelectField
        label="Action after confirming face"
        value={prefs.reviewModule?.defaultAction ?? 'next'}
        onChange={(v) => updatePref('reviewModule.defaultAction', v)}
        options={[
          { value: 'next', label: 'Move to next face' },
          { value: 'stay', label: 'Stay on current face' }
        ]}
      />
      <CheckboxField
        label="Show confidence scores"
        checked={prefs.reviewModule?.showConfidenceScores ?? true}
        onChange={(v) => updatePref('reviewModule.showConfidenceScores', v)}
      />
      <SelectField
        label="Save Mode"
        hint="How review results are written to database"
        value={prefs.reviewModule?.saveMode ?? 'per-image'}
        onChange={(v) => updatePref('reviewModule.saveMode', v)}
        options={[
          { value: 'per-image', label: 'Per image (save all faces for each image)' },
          { value: 'per-face', label: 'Per face (save each face immediately)' }
        ]}
      />
      <NumberField
        label="Match Alternatives"
        hint="Number of match suggestions to show (1-9). Press number keys to select."
        value={prefs.reviewModule?.maxAlternatives ?? 5}
        onChange={(v) => updatePref('reviewModule.maxAlternatives', Math.max(1, Math.min(9, v)))}
        min={1}
        max={9}
      />
    </>
  );

  const renderFilesSection = () => (
    <>
      <SectionHeader title="File Queue" />
      <CheckboxField
        label="Auto-load from queue on startup"
        hint="Automatically load first pending file when app starts"
        checked={prefs.fileQueue?.autoLoadOnStartup ?? true}
        onChange={(v) => updatePref('fileQueue.autoLoadOnStartup', v)}
      />
      <CheckboxField
        label="Auto-remove missing files"
        hint="Automatically remove files from queue if they no longer exist"
        checked={prefs.fileQueue?.autoRemoveMissing ?? true}
        onChange={(v) => updatePref('fileQueue.autoRemoveMissing', v)}
      />

      <SectionHeader title="Notifications" />
      <SelectField
        label="Toast duration"
        hint="How long toast notifications stay visible"
        value={String(prefs.notifications?.toastDuration ?? 1.0)}
        onChange={(v) => updatePref('notifications.toastDuration', parseFloat(v))}
        options={[
          { value: '0.5', label: 'Short (2s)' },
          { value: '1.0', label: 'Normal (4s)' },
          { value: '1.5', label: 'Long (6s)' },
          { value: '2.0', label: 'Very long (8s)' }
        ]}
      />
      <SliderField
        label="Toast opacity"
        hint="Opacity of toast notifications (0.5 = 50%, 1.0 = 100%)"
        value={prefs.notifications?.toastOpacity ?? 0.94}
        onChange={(v) => {
          updatePref('notifications.toastOpacity', v);
          applyToastOpacity(v); // Live preview
        }}
        min={0.5}
        max={1.0}
        step={0.01}
      />

      <SectionHeader title="File Rename" />
      <CheckboxField
        label="Require confirmation before rename"
        checked={prefs.rename?.requireConfirmation ?? true}
        onChange={(v) => updatePref('rename.requireConfirmation', v)}
      />
      <CheckboxField
        label="Allow renaming already-renamed files"
        checked={prefs.rename?.allowAlreadyRenamed ?? false}
        onChange={(v) => updatePref('rename.allowAlreadyRenamed', v)}
      />
      <SelectField
        label="Prefix Source"
        hint="Where to get the date/time for the filename prefix"
        value={prefs.rename?.prefixSource ?? 'filename'}
        onChange={(v) => updatePref('rename.prefixSource', v)}
        options={[
          { value: 'filename', label: 'From filename (YYMMDD_HHMMSS pattern)' },
          { value: 'exif', label: 'From EXIF metadata' },
          { value: 'filedate', label: 'From file modification date' },
          { value: 'none', label: 'No prefix (names only)' }
        ]}
      />
      <SelectField
        label="Name Separator"
        value={prefs.rename?.nameSeparator ?? ',_'}
        onChange={(v) => updatePref('rename.nameSeparator', v)}
        options={[
          { value: ',_', label: ',_ (Anna,_Bert)' },
          { value: '_', label: '_ (Anna_Bert)' },
          { value: '-', label: '- (Anna-Bert)' },
          { value: '_och_', label: '_och_ (Anna_och_Bert)' }
        ]}
      />
      <CheckboxField
        label="Use first name only"
        hint="Use only first name instead of full name"
        checked={prefs.rename?.useFirstNameOnly ?? true}
        onChange={(v) => updatePref('rename.useFirstNameOnly', v)}
      />
      <CheckboxField
        label="Remove diacritics"
        hint="Convert special characters (e.g. e, o) for safer filenames"
        checked={prefs.rename?.removeDiacritics ?? true}
        onChange={(v) => updatePref('rename.removeDiacritics', v)}
      />
    </>
  );

  const renderPreprocessingSection = () => (
    <>
      <SectionHeader title="Background Preprocessing" />
      <p className="section-hint">
        Preprocess queued files in the background to speed up loading.
        Note: Name matching is NOT preprocessed - it requires the current database.
      </p>
      <CheckboxField
        label="Enable background preprocessing"
        hint="Start preprocessing when files are added to queue"
        checked={prefs.preprocessing?.enabled ?? true}
        onChange={(v) => updatePref('preprocessing.enabled', v)}
      />
      <SliderField
        label="Parallel Workers"
        hint="Number of files to preprocess simultaneously (1-8)"
        value={prefs.preprocessing?.parallelWorkers ?? 2}
        onChange={(v) => updatePref('preprocessing.parallelWorkers', v)}
        min={1}
        max={8}
      />

      <SectionHeader title="Preprocessing Steps" />
      <CheckboxField
        label="NEF Conversion"
        hint="Convert RAW files (NEF, CR2, ARW) to JPG"
        checked={prefs.preprocessing?.steps?.nefConversion ?? true}
        onChange={(v) => updatePref('preprocessing.steps.nefConversion', v)}
      />
      <CheckboxField
        label="Face Detection"
        hint="Detect faces and bounding boxes"
        checked={prefs.preprocessing?.steps?.faceDetection ?? true}
        onChange={(v) => updatePref('preprocessing.steps.faceDetection', v)}
      />
      <CheckboxField
        label="Face Thumbnails"
        hint="Generate thumbnail images for detected faces"
        checked={prefs.preprocessing?.steps?.thumbnails ?? true}
        onChange={(v) => updatePref('preprocessing.steps.thumbnails', v)}
      />

      <SectionHeader title="Cache Settings" />
      <SliderField
        label="Maximum Cache Size (MB)"
        hint="Cache uses LRU eviction when this limit is exceeded"
        value={prefs.preprocessing?.cache?.maxSizeMB ?? 1024}
        onChange={(v) => updatePref('preprocessing.cache.maxSizeMB', v)}
        min={256}
        max={4096}
        step={256}
      />
      {cacheStatus && (
        <div className="cache-status">
          <strong>Cache Status:</strong> {cacheStatus.total_entries} entries,
          {' '}{cacheStatus.total_size_mb} MB / {cacheStatus.max_size_mb} MB
          {' '}({cacheStatus.usage_percent}%)
        </div>
      )}
      <button className="btn-secondary" onClick={handleClearCache}>
        Clear Preprocessing Cache
      </button>
    </>
  );

  const renderDashboardSection = () => (
    <>
      <SectionHeader title="Dashboard Sections" />
      <p className="section-hint">
        Choose which sections to display in the Statistics Dashboard.
      </p>
      <CheckboxField
        label="Show detection statistics"
        hint="Detection backend performance table"
        checked={prefs.dashboard?.showAttemptStats ?? true}
        onChange={(v) => updatePref('dashboard.showAttemptStats', v)}
      />
      <CheckboxField
        label="Show top faces grid"
        hint="Most frequently detected persons"
        checked={prefs.dashboard?.showTopFaces ?? true}
        onChange={(v) => updatePref('dashboard.showTopFaces', v)}
      />
      <CheckboxField
        label="Show recent images"
        hint="Recently processed images with detected names"
        checked={prefs.dashboard?.showRecentImages ?? true}
        onChange={(v) => updatePref('dashboard.showRecentImages', v)}
      />
      <CheckboxField
        label="Show recent log lines"
        hint="Latest log entries"
        checked={prefs.dashboard?.showRecentLogs ?? false}
        onChange={(v) => updatePref('dashboard.showRecentLogs', v)}
      />
      <NumberField
        label="Number of log lines"
        hint="How many log lines to show (3-10)"
        value={prefs.dashboard?.logLineCount ?? 5}
        onChange={(v) => updatePref('dashboard.logLineCount', v)}
        min={3}
        max={10}
      />

      <SectionHeader title="Auto-Refresh" />
      <CheckboxField
        label="Auto-refresh on startup"
        hint="Automatically refresh statistics when dashboard opens"
        checked={prefs.dashboard?.autoRefresh ?? true}
        onChange={(v) => updatePref('dashboard.autoRefresh', v)}
      />
      <SelectField
        label="Refresh interval"
        hint="How often to refresh statistics"
        value={String(prefs.dashboard?.refreshInterval ?? 5000)}
        onChange={(v) => updatePref('dashboard.refreshInterval', parseInt(v, 10))}
        options={[
          { value: '2000', label: '2 seconds' },
          { value: '5000', label: '5 seconds' },
          { value: '10000', label: '10 seconds' },
          { value: '30000', label: '30 seconds' }
        ]}
      />
    </>
  );

  const renderAdvancedSection = () => {
    const categories = getCategories();

    return (
      <>
        <SectionHeader title="Logging" />
        <SelectField
          label="Log Level"
          hint="Minimum severity level for console output"
          value={prefs.ui?.logLevel ?? 'info'}
          onChange={(v) => updatePref('ui.logLevel', v)}
          options={[
            { value: 'debug', label: 'Debug (verbose)' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warning' },
            { value: 'error', label: 'Error' }
          ]}
        />

        <SectionHeader title="Debug Categories" />
        <p className="section-hint">
          Enable/disable debug output per category. Warnings and errors always show.
        </p>
        <div className="debug-grid">
          {Object.entries(categories).map(([name, enabled]) => (
            <label key={name} className={`debug-item ${enabled ? 'enabled' : ''}`}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  setCategories({ [name]: e.target.checked });
                }}
              />
              {name}
            </label>
          ))}
        </div>
        <button
          className="btn-secondary"
          onClick={() => {
            resetCategories();
            // Force re-render
            setPrefs({ ...prefs });
          }}
        >
          Reset Debug Categories to Defaults
        </button>
      </>
    );
  };

  return (
    <div className="preferences-module">
      <div className="prefs-sidebar">
        <h3>Settings</h3>
        <ul className="section-list">
          {SECTIONS.map(section => (
            <li
              key={section.id}
              className={activeSection === section.id ? 'active' : ''}
              onClick={() => setActiveSection(section.id)}
            >
              {section.label}
            </li>
          ))}
        </ul>

        <div className="prefs-actions">
          <button
            className="btn-action"
            onClick={handleSave}
            disabled={!hasChanges}
          >
            Save
          </button>
          <button className="btn-secondary" onClick={handleReset}>
            Reset
          </button>
        </div>
      </div>

      <div className="prefs-content">
        <h2>{SECTIONS.find(s => s.id === activeSection)?.label}</h2>
        {renderSection()}
      </div>
    </div>
  );
}
