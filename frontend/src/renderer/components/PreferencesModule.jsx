/**
 * PreferencesModule Component
 *
 * Theme-aware preferences editor as a FlexLayout module.
 * Replaces the old modal-based preferences UI.
 */

import React, { useState, useEffect, useCallback, useId, useRef } from 'react';
import {
  preferences,
  DEFAULT_EXTERNAL_EDITOR,
} from '../workspace/preferences.js';
import { themeManager } from '../theme-manager.js';
import {
  getCategories,
  setCategories,
  resetCategories,
  debug,
  debugError,
} from '../shared/debug.js';
import { t } from '../../i18n/index.js';
import { Button } from './shared/index.js';
import { useConfirm } from '../context/ConfirmContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import './PreferencesModule.css';

// Preference section ids. Labels are resolved with t() at render time (not at
// module load) so they pick up the active locale even if i18n initialises after
// this module is imported.
const SECTION_IDS = [
  'general',
  'layout',
  'image-viewer',
  'review',
  'files',
  'preprocessing',
  'dashboard',
  'advanced',
];

const sectionLabel = (id) => t(`preferences.sections.${id}`);

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

/**
 * Slider with synced number input
 */
function SliderField({ label, hint, value, onChange, min, max, step = 1 }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pref-field">
      <label htmlFor={id}>{label}</label>
      <div className="slider-group">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          aria-describedby={hintId}
        />
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="number-input"
          aria-label={label}
          aria-describedby={hintId}
        />
      </div>
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

/**
 * Checkbox field
 */
function CheckboxField({ label, hint, checked, onChange, disabled }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pref-field">
      <label className="checkbox-label" htmlFor={id}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          aria-describedby={hintId}
        />
        {label}
      </label>
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

/**
 * Select field
 */
function SelectField({ label, hint, value, onChange, options }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pref-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hintId}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

/**
 * Text input field
 */
function TextField({ label, hint, value, onChange, placeholder, disabled }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pref-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className="text-input"
        aria-describedby={hintId}
      />
      {hint && <small id={hintId}>{hint}</small>}
    </div>
  );
}

/**
 * Number input field (without slider)
 */
function NumberField({ label, hint, value, onChange, min, max, step = 1 }) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="pref-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="number-input-standalone"
        aria-describedby={hintId}
      />
      {hint && <small id={hintId}>{hint}</small>}
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
  const [trashRetention, setTrashRetention] = useState(null); // days; null = not loaded
  // Debug categories need React state to trigger re-render on change
  const [debugCategories, setDebugCategories] = useState(() => getCategories());
  const confirm = useConfirm();
  const showToast = useToast();
  // Guards against a second activation while a confirm dialog is already open.
  const confirmBusyRef = useRef(false);

  // Helper function to apply toast opacity CSS variable
  // Used for immediate live preview when user adjusts slider
  const applyToastOpacity = useCallback((opacity) => {
    if (opacity !== undefined) {
      document.documentElement.style.setProperty(
        '--toast-opacity',
        String(opacity),
      );
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
    setPrefs((prev) => {
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
  const handleReset = useCallback(async () => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const ok = await confirm({
        message: t('preferences.dialogs.resetConfirm'),
        confirmLabel: t('common.reset'),
      });
      if (!ok) return;
      const defaults = preferences.getDefaults();
      setPrefs(defaults);
      setHasChanges(true);
    } finally {
      confirmBusyRef.current = false;
    }
  }, [confirm]);

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

  // Load the app-trash retention threshold from the backend when the Files
  // section opens (it's backend config, not a localStorage preference).
  useEffect(() => {
    if (activeSection !== 'files') return;
    let cancelled = false;
    (async () => {
      try {
        const { apiClient } = await import('../shared/api-client.js');
        const { days } = await apiClient.getTrashRetention();
        if (!cancelled) setTrashRetention(days);
      } catch (err) {
        if (!cancelled) setTrashRetention(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeSection]);

  // Persist the retention threshold to backend config (clamped to >= 0).
  const handleTrashRetentionChange = useCallback(
    async (days) => {
      const v = Math.max(0, Math.floor(Number.isFinite(days) ? days : 0));
      setTrashRetention(v); // optimistic
      try {
        const { apiClient } = await import('../shared/api-client.js');
        const res = await apiClient.setTrashRetention(v);
        setTrashRetention(res.days);
      } catch (err) {
        debugError('Preferences', 'Failed to save trash retention:', err);
        showToast(t('preferences.toasts.trashRetentionError'), {
          type: 'error',
        });
      }
    },
    [showToast],
  );

  // Clear cache
  const handleClearCache = useCallback(async () => {
    if (confirmBusyRef.current) return;
    confirmBusyRef.current = true;
    try {
      const ok = await confirm({
        message: t('preferences.dialogs.clearCacheConfirm'),
        confirmLabel: t('preferences.dialogs.clearCacheConfirmLabel'),
        variant: 'danger',
      });
      if (!ok) return;
      try {
        const { apiClient } = await import('../shared/api-client.js');
        await apiClient.clearCache();
        const status = await apiClient.getCacheStatus();
        setCacheStatus(status);
      } catch (err) {
        debugError('Preferences', 'Failed to clear cache:', err);
        showToast(t('preferences.toasts.clearCacheError'), { type: 'error' });
      }
    } finally {
      confirmBusyRef.current = false;
    }
  }, [confirm, showToast]);

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
      <SectionHeader title={t('preferences.general.backendHeader')} />
      <CheckboxField
        label={t('preferences.general.autoStart')}
        checked={prefs.backend?.autoStart ?? true}
        onChange={(v) => updatePref('backend.autoStart', v)}
      />
      <NumberField
        label={t('preferences.general.port.label')}
        hint={t('preferences.general.port.hint')}
        value={prefs.backend?.port ?? 5001}
        onChange={(v) => updatePref('backend.port', v)}
        min={1024}
        max={65535}
      />
      <TextField
        label={t('preferences.general.pythonPath.label')}
        hint={t('preferences.general.pythonPath.hint')}
        value={prefs.backend?.pythonPath ?? ''}
        onChange={(v) => updatePref('backend.pythonPath', v)}
      />

      <SectionHeader title={t('preferences.general.uiHeader')} />
      <SelectField
        label={t('preferences.general.theme.label')}
        hint={t('preferences.general.theme.hint')}
        value={prefs.ui?.theme ?? 'system'}
        onChange={(v) => {
          updatePref('ui.theme', v);
          themeManager.previewPreference(v);
        }}
        options={[
          { value: 'dark', label: t('preferences.general.theme.dark') },
          { value: 'light', label: t('preferences.general.theme.light') },
          { value: 'system', label: t('preferences.general.theme.system') },
        ]}
      />
      <SelectField
        label={t('preferences.general.defaultLayout.label')}
        value={prefs.ui?.defaultLayout ?? 'standard'}
        onChange={(v) => updatePref('ui.defaultLayout', v)}
        options={[
          {
            value: 'standard',
            label: t('preferences.general.defaultLayout.standard'),
          },
          {
            value: 'compact',
            label: t('preferences.general.defaultLayout.compact'),
          },
          {
            value: 'review-focused',
            label: t('preferences.general.defaultLayout.reviewFocused'),
          },
        ]}
      />
      <CheckboxField
        label={t('preferences.general.showWelcome')}
        checked={prefs.ui?.showWelcome ?? true}
        onChange={(v) => updatePref('ui.showWelcome', v)}
      />
    </>
  );

  const renderLayoutSection = () => (
    <>
      <SectionHeader title={t('preferences.layout.header')} />
      <CheckboxField
        label={t('preferences.layout.showWorkflowBar.label')}
        hint={t('preferences.layout.showWorkflowBar.hint')}
        checked={prefs.workspace?.showWorkflowBar ?? true}
        onChange={(v) => updatePref('workspace.showWorkflowBar', v)}
      />
      <CheckboxField
        label={t('preferences.layout.workflowBarAutoHide.label')}
        hint={t('preferences.layout.workflowBarAutoHide.hint')}
        checked={prefs.workspace?.workflowBarAutoHide ?? true}
        disabled={(prefs.workspace?.showWorkflowBar ?? true) === false}
        onChange={(v) => updatePref('workspace.workflowBarAutoHide', v)}
      />
      <SelectField
        label={t('preferences.layout.template.label')}
        hint={t('preferences.layout.template.hint')}
        value={prefs.layout?.defaultTemplate ?? 'review'}
        onChange={(v) => updatePref('layout.defaultTemplate', v)}
        options={[
          { value: 'review', label: t('preferences.layout.template.review') },
          {
            value: 'comparison',
            label: t('preferences.layout.template.comparison'),
          },
          {
            value: 'full-image',
            label: t('preferences.layout.template.fullImage'),
          },
          { value: 'stats', label: t('preferences.layout.template.stats') },
        ]}
      />
      <SelectField
        label={t('preferences.layout.gridPreset.label')}
        hint={t('preferences.layout.gridPreset.hint')}
        value={prefs.layout?.defaultGridPreset ?? '50-50'}
        onChange={(v) => updatePref('layout.defaultGridPreset', v)}
        options={[
          { value: '50-50', label: '50% / 50%' },
          { value: '60-40', label: '60% / 40%' },
          { value: '70-30', label: '70% / 30%' },
          { value: '30-70', label: '30% / 70%' },
          { value: '40-60', label: '40% / 60%' },
        ]}
      />
      <CheckboxField
        label={t('preferences.layout.autoSave.label')}
        hint={t('preferences.layout.autoSave.hint')}
        checked={prefs.layout?.autoSaveLayout ?? true}
        onChange={(v) => updatePref('layout.autoSaveLayout', v)}
      />
      <CheckboxField
        label={t('preferences.layout.rememberSizes.label')}
        hint={t('preferences.layout.rememberSizes.hint')}
        checked={prefs.layout?.rememberPanelSizes ?? true}
        onChange={(v) => updatePref('layout.rememberPanelSizes', v)}
      />
    </>
  );

  const renderImageViewerSection = () => (
    <>
      <SectionHeader title={t('preferences.imageViewer.header')} />
      <SliderField
        label={t('preferences.imageViewer.zoomSpeed.label')}
        hint={t('preferences.imageViewer.zoomSpeed.hint')}
        value={prefs.imageViewer?.zoomSpeed ?? 1.07}
        onChange={(v) => updatePref('imageViewer.zoomSpeed', v)}
        min={1.01}
        max={2.0}
        step={0.01}
      />
      <SliderField
        label={t('preferences.imageViewer.maxZoom')}
        value={prefs.imageViewer?.maxZoom ?? 20}
        onChange={(v) => updatePref('imageViewer.maxZoom', v)}
        min={1}
        max={50}
      />
      <SliderField
        label={t('preferences.imageViewer.minZoom')}
        value={prefs.imageViewer?.minZoom ?? 0.1}
        onChange={(v) => updatePref('imageViewer.minZoom', v)}
        min={0.01}
        max={1}
        step={0.01}
      />
      <SelectField
        label={t('preferences.imageViewer.zoomMode.label')}
        value={prefs.imageViewer?.defaultZoomMode ?? 'auto-fit'}
        onChange={(v) => updatePref('imageViewer.defaultZoomMode', v)}
        options={[
          {
            value: 'auto-fit',
            label: t('preferences.imageViewer.zoomMode.autoFit'),
          },
          {
            value: '1:1',
            label: t('preferences.imageViewer.zoomMode.oneToOne'),
          },
        ]}
      />
      <CheckboxField
        label={t('preferences.imageViewer.smoothPan')}
        checked={prefs.imageViewer?.smoothPan ?? true}
        onChange={(v) => updatePref('imageViewer.smoothPan', v)}
      />
    </>
  );

  const renderReviewSection = () => (
    <>
      <SectionHeader title={t('preferences.review.header')} />
      <CheckboxField
        label={t('preferences.review.autoSave')}
        checked={prefs.reviewModule?.autoSaveOnComplete ?? false}
        onChange={(v) => updatePref('reviewModule.autoSaveOnComplete', v)}
      />
      <CheckboxField
        label={t('preferences.review.confirmBeforeSave')}
        checked={prefs.reviewModule?.confirmBeforeSave ?? true}
        onChange={(v) => updatePref('reviewModule.confirmBeforeSave', v)}
      />
      <SelectField
        label={t('preferences.review.action.label')}
        value={prefs.reviewModule?.defaultAction ?? 'next'}
        onChange={(v) => updatePref('reviewModule.defaultAction', v)}
        options={[
          { value: 'next', label: t('preferences.review.action.next') },
          { value: 'stay', label: t('preferences.review.action.stay') },
        ]}
      />
      <CheckboxField
        label={t('preferences.review.showConfidence')}
        checked={prefs.reviewModule?.showConfidenceScores ?? true}
        onChange={(v) => updatePref('reviewModule.showConfidenceScores', v)}
      />
      <SelectField
        label={t('preferences.review.saveMode.label')}
        hint={t('preferences.review.saveMode.hint')}
        value={prefs.reviewModule?.saveMode ?? 'per-image'}
        onChange={(v) => updatePref('reviewModule.saveMode', v)}
        options={[
          {
            value: 'per-image',
            label: t('preferences.review.saveMode.perImage'),
          },
          {
            value: 'per-face',
            label: t('preferences.review.saveMode.perFace'),
          },
        ]}
      />
      <NumberField
        label={t('preferences.review.matchAlternatives.label')}
        hint={t('preferences.review.matchAlternatives.hint')}
        value={prefs.reviewModule?.maxAlternatives ?? 5}
        onChange={(v) =>
          updatePref(
            'reviewModule.maxAlternatives',
            Math.max(1, Math.min(9, v)),
          )
        }
        min={1}
        max={9}
      />
    </>
  );

  const renderFilesSection = () => (
    <>
      <SectionHeader title={t('preferences.files.cullingHeader')} />
      <TextField
        label={t('preferences.files.rawRoot.label')}
        hint={t('preferences.files.rawRoot.hint')}
        value={prefs.paths?.rawRoot || '~/Pictures/nerladdat'}
        onChange={(v) => updatePref('paths.rawRoot', v)}
        placeholder="~/Pictures/nerladdat"
      />
      <TextField
        label={t('preferences.files.externalEditor.label')}
        hint={t('preferences.files.externalEditor.hint')}
        value={prefs.paths?.externalEditor ?? ''}
        onChange={(v) => updatePref('paths.externalEditor', v)}
        placeholder={DEFAULT_EXTERNAL_EDITOR}
      />

      <SectionHeader title={t('preferences.files.queueHeader')} />
      <CheckboxField
        label={t('preferences.files.autoLoad.label')}
        hint={t('preferences.files.autoLoad.hint')}
        checked={prefs.fileQueue?.autoLoadOnStartup ?? true}
        onChange={(v) => updatePref('fileQueue.autoLoadOnStartup', v)}
      />
      <CheckboxField
        label={t('preferences.files.autoRemove.label')}
        hint={t('preferences.files.autoRemove.hint')}
        checked={prefs.fileQueue?.autoRemoveMissing ?? true}
        onChange={(v) => updatePref('fileQueue.autoRemoveMissing', v)}
      />
      <SelectField
        label={t('preferences.files.insertMode.label')}
        hint={t('preferences.files.insertMode.hint')}
        value={prefs.fileQueue?.insertMode ?? 'alphabetical'}
        onChange={(v) => updatePref('fileQueue.insertMode', v)}
        options={[
          {
            value: 'alphabetical',
            label: t('preferences.files.insertMode.alphabetical'),
          },
          { value: 'bottom', label: t('preferences.files.insertMode.bottom') },
        ]}
      />

      <SectionHeader title={t('preferences.files.notificationsHeader')} />
      <SelectField
        label={t('preferences.files.toastDuration.label')}
        hint={t('preferences.files.toastDuration.hint')}
        value={String(prefs.notifications?.toastDuration ?? 1.0)}
        onChange={(v) =>
          updatePref('notifications.toastDuration', parseFloat(v))
        }
        options={[
          { value: '0.5', label: t('preferences.files.toastDuration.short') },
          { value: '1.0', label: t('preferences.files.toastDuration.normal') },
          { value: '1.5', label: t('preferences.files.toastDuration.long') },
          {
            value: '2.0',
            label: t('preferences.files.toastDuration.veryLong'),
          },
        ]}
      />
      <SliderField
        label={t('preferences.files.toastOpacity.label')}
        hint={t('preferences.files.toastOpacity.hint')}
        value={prefs.notifications?.toastOpacity ?? 0.94}
        onChange={(v) => {
          updatePref('notifications.toastOpacity', v);
          applyToastOpacity(v); // Live preview
        }}
        min={0.5}
        max={1.0}
        step={0.01}
      />

      <SectionHeader title={t('preferences.files.renameHeader')} />
      <CheckboxField
        label={t('preferences.files.requireConfirm')}
        checked={prefs.rename?.requireConfirmation ?? true}
        onChange={(v) => updatePref('rename.requireConfirmation', v)}
      />
      <CheckboxField
        label={t('preferences.files.allowAlreadyRenamed')}
        checked={prefs.rename?.allowAlreadyRenamed ?? false}
        onChange={(v) => updatePref('rename.allowAlreadyRenamed', v)}
      />
      <SelectField
        label={t('preferences.files.prefixSource.label')}
        hint={t('preferences.files.prefixSource.hint')}
        value={prefs.rename?.prefixSource ?? 'filename'}
        onChange={(v) => updatePref('rename.prefixSource', v)}
        options={[
          {
            value: 'filename',
            label: t('preferences.files.prefixSource.filename'),
          },
          { value: 'exif', label: t('preferences.files.prefixSource.exif') },
          {
            value: 'filedate',
            label: t('preferences.files.prefixSource.filedate'),
          },
          { value: 'none', label: t('preferences.files.prefixSource.none') },
        ]}
      />
      <SelectField
        label={t('preferences.files.nameSeparator.label')}
        value={prefs.rename?.nameSeparator ?? ',_'}
        onChange={(v) => updatePref('rename.nameSeparator', v)}
        options={[
          {
            value: ',_',
            label: t('preferences.files.nameSeparator.commaUnderscore'),
          },
          {
            value: '_',
            label: t('preferences.files.nameSeparator.underscore'),
          },
          { value: '-', label: t('preferences.files.nameSeparator.dash') },
          { value: '_och_', label: t('preferences.files.nameSeparator.och') },
        ]}
      />
      <CheckboxField
        label={t('preferences.files.useFirstName.label')}
        hint={t('preferences.files.useFirstName.hint')}
        checked={prefs.rename?.useFirstNameOnly ?? true}
        onChange={(v) => updatePref('rename.useFirstNameOnly', v)}
      />
      <CheckboxField
        label={t('preferences.files.removeDiacritics.label')}
        hint={t('preferences.files.removeDiacritics.hint')}
        checked={prefs.rename?.removeDiacritics ?? true}
        onChange={(v) => updatePref('rename.removeDiacritics', v)}
      />

      <SectionHeader title={t('preferences.files.sidecarHeader')} />
      <CheckboxField
        label={t('preferences.files.renameSidecars.label')}
        hint={t('preferences.files.renameSidecars.hint')}
        checked={prefs.rename?.renameSidecars ?? true}
        onChange={(v) => updatePref('rename.renameSidecars', v)}
      />
      <TextField
        label={t('preferences.files.sidecarExtensions.label')}
        hint={t('preferences.files.sidecarExtensions.hint')}
        value={(prefs.rename?.sidecarExtensions ?? ['xmp']).join(', ')}
        onChange={(v) => {
          const exts = v
            .split(',')
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e);
          updatePref('rename.sidecarExtensions', exts);
        }}
        placeholder="xmp, dng"
        disabled={!(prefs.rename?.renameSidecars ?? true)}
      />

      <SectionHeader title={t('preferences.files.trashHeader')} />
      <NumberField
        label={t('preferences.files.autoEmpty.label')}
        hint={t('preferences.files.autoEmpty.hint')}
        value={trashRetention ?? 30}
        onChange={handleTrashRetentionChange}
        min={0}
        max={3650}
        step={1}
      />

      <SectionHeader title={t('preferences.files.cullingPlayerHeader')} />
      <CheckboxField
        label={t('preferences.files.autoAdvance.label')}
        hint={t('preferences.files.autoAdvance.hint')}
        checked={prefs.culling?.autoAdvanceAfterRename ?? true}
        onChange={(v) => updatePref('culling.autoAdvanceAfterRename', v)}
      />
    </>
  );

  const renderPreprocessingSection = () => (
    <>
      <SectionHeader title={t('preferences.preprocessing.backgroundHeader')} />
      <p className="section-hint">{t('preferences.preprocessing.intro')}</p>
      <CheckboxField
        label={t('preferences.preprocessing.enable.label')}
        hint={t('preferences.preprocessing.enable.hint')}
        checked={prefs.preprocessing?.enabled ?? true}
        onChange={(v) => updatePref('preprocessing.enabled', v)}
      />
      <SliderField
        label={t('preferences.preprocessing.workers.label')}
        hint={t('preferences.preprocessing.workers.hint')}
        value={prefs.preprocessing?.parallelWorkers ?? 2}
        onChange={(v) => updatePref('preprocessing.parallelWorkers', v)}
        min={1}
        max={8}
      />

      <SectionHeader title={t('preferences.preprocessing.stepsHeader')} />
      <CheckboxField
        label={t('preferences.preprocessing.nefConversion.label')}
        hint={t('preferences.preprocessing.nefConversion.hint')}
        checked={prefs.preprocessing?.steps?.nefConversion ?? true}
        onChange={(v) => updatePref('preprocessing.steps.nefConversion', v)}
      />
      <CheckboxField
        label={t('preferences.preprocessing.faceDetection.label')}
        hint={t('preferences.preprocessing.faceDetection.hint')}
        checked={prefs.preprocessing?.steps?.faceDetection ?? true}
        onChange={(v) => updatePref('preprocessing.steps.faceDetection', v)}
      />
      <CheckboxField
        label={t('preferences.preprocessing.thumbnails.label')}
        hint={t('preferences.preprocessing.thumbnails.hint')}
        checked={prefs.preprocessing?.steps?.thumbnails ?? true}
        onChange={(v) => updatePref('preprocessing.steps.thumbnails', v)}
      />

      <SectionHeader title={t('preferences.preprocessing.cacheHeader')} />
      <SliderField
        label={t('preferences.preprocessing.maxSize.label')}
        hint={t('preferences.preprocessing.maxSize.hint')}
        value={prefs.preprocessing?.cache?.maxSizeMB ?? 1024}
        onChange={(v) => updatePref('preprocessing.cache.maxSizeMB', v)}
        min={256}
        max={4096}
        step={256}
      />
      {cacheStatus && (
        <div className="cache-status">
          <strong>{t('preferences.preprocessing.cache.statusLabel')}</strong>{' '}
          {t('preferences.preprocessing.cache.entries', {
            count: cacheStatus.total_entries,
          })}
          , {cacheStatus.total_size_mb} MB / {cacheStatus.max_size_mb} MB (
          {cacheStatus.usage_percent}%)
        </div>
      )}
      <Button variant="secondary" onClick={handleClearCache}>
        {t('preferences.buttons.clearCache')}
      </Button>

      <SectionHeader title={t('preferences.preprocessing.rollingHeader')} />
      <p className="section-hint">
        {t('preferences.preprocessing.rollingIntro')}
      </p>
      <NumberField
        label={t('preferences.preprocessing.maxReady.label')}
        hint={t('preferences.preprocessing.maxReady.hint')}
        value={prefs.preprocessing?.rollingWindow?.maxReadyItems ?? 15}
        onChange={(v) => {
          const maxReady = Math.max(5, Math.min(50, v));
          updatePref('preprocessing.rollingWindow.maxReadyItems', maxReady);
          const pauseBuffer =
            prefs.preprocessing?.rollingWindow?.minQueueBuffer ?? 10;
          if (pauseBuffer >= maxReady) {
            updatePref(
              'preprocessing.rollingWindow.minQueueBuffer',
              maxReady - 1,
            );
          }
        }}
        min={5}
        max={50}
      />
      <NumberField
        label={t('preferences.preprocessing.pauseBuffer.label')}
        hint={t('preferences.preprocessing.pauseBuffer.hint')}
        value={prefs.preprocessing?.rollingWindow?.minQueueBuffer ?? 10}
        onChange={(v) => {
          const maxReady =
            prefs.preprocessing?.rollingWindow?.maxReadyItems ?? 15;
          const pauseBuffer = Math.max(3, Math.min(maxReady - 1, v));
          updatePref('preprocessing.rollingWindow.minQueueBuffer', pauseBuffer);
        }}
        min={3}
        max={(prefs.preprocessing?.rollingWindow?.maxReadyItems ?? 15) - 1}
      />
      <NumberField
        label={t('preferences.preprocessing.resumeAfter.label')}
        hint={t('preferences.preprocessing.resumeAfter.hint')}
        value={prefs.preprocessing?.rollingWindow?.resumeThreshold ?? 5}
        onChange={(v) =>
          updatePref(
            'preprocessing.rollingWindow.resumeThreshold',
            Math.max(1, Math.min(15, v)),
          )
        }
        min={1}
        max={15}
      />

      <SectionHeader
        title={t('preferences.preprocessing.notificationsHeader')}
      />
      <CheckboxField
        label={t('preferences.preprocessing.statusIndicator.label')}
        hint={t('preferences.preprocessing.statusIndicator.hint')}
        checked={
          prefs.preprocessing?.notifications?.showStatusIndicator ?? true
        }
        onChange={(v) =>
          updatePref('preprocessing.notifications.showStatusIndicator', v)
        }
      />
      <CheckboxField
        label={t('preferences.preprocessing.toastOnPause.label')}
        hint={t('preferences.preprocessing.toastOnPause.hint')}
        checked={prefs.preprocessing?.notifications?.showToastOnPause ?? true}
        onChange={(v) =>
          updatePref('preprocessing.notifications.showToastOnPause', v)
        }
      />
      <CheckboxField
        label={t('preferences.preprocessing.toastOnResume.label')}
        hint={t('preferences.preprocessing.toastOnResume.hint')}
        checked={prefs.preprocessing?.notifications?.showToastOnResume ?? false}
        onChange={(v) =>
          updatePref('preprocessing.notifications.showToastOnResume', v)
        }
      />
    </>
  );

  const renderDashboardSection = () => (
    <>
      <SectionHeader title={t('preferences.dashboard.sectionsHeader')} />
      <p className="section-hint">{t('preferences.dashboard.intro')}</p>
      <CheckboxField
        label={t('preferences.dashboard.detectionStats.label')}
        hint={t('preferences.dashboard.detectionStats.hint')}
        checked={prefs.dashboard?.showAttemptStats ?? true}
        onChange={(v) => updatePref('dashboard.showAttemptStats', v)}
      />
      <CheckboxField
        label={t('preferences.dashboard.topFaces.label')}
        hint={t('preferences.dashboard.topFaces.hint')}
        checked={prefs.dashboard?.showTopFaces ?? true}
        onChange={(v) => updatePref('dashboard.showTopFaces', v)}
      />
      <CheckboxField
        label={t('preferences.dashboard.recentImages.label')}
        hint={t('preferences.dashboard.recentImages.hint')}
        checked={prefs.dashboard?.showRecentImages ?? true}
        onChange={(v) => updatePref('dashboard.showRecentImages', v)}
      />
      <CheckboxField
        label={t('preferences.dashboard.recentLogs.label')}
        hint={t('preferences.dashboard.recentLogs.hint')}
        checked={prefs.dashboard?.showRecentLogs ?? false}
        onChange={(v) => updatePref('dashboard.showRecentLogs', v)}
      />
      <NumberField
        label={t('preferences.dashboard.logLineCount.label')}
        hint={t('preferences.dashboard.logLineCount.hint')}
        value={prefs.dashboard?.logLineCount ?? 5}
        onChange={(v) => updatePref('dashboard.logLineCount', v)}
        min={3}
        max={10}
      />

      <SectionHeader title={t('preferences.dashboard.autoRefreshHeader')} />
      <CheckboxField
        label={t('preferences.dashboard.autoRefresh.label')}
        hint={t('preferences.dashboard.autoRefresh.hint')}
        checked={prefs.dashboard?.autoRefresh ?? true}
        onChange={(v) => updatePref('dashboard.autoRefresh', v)}
      />
      <SelectField
        label={t('preferences.dashboard.refreshInterval.label')}
        hint={t('preferences.dashboard.refreshInterval.hint')}
        value={String(prefs.dashboard?.refreshInterval ?? 5000)}
        onChange={(v) =>
          updatePref('dashboard.refreshInterval', parseInt(v, 10))
        }
        options={[
          {
            value: '2000',
            label: t('preferences.dashboard.refreshInterval.s2'),
          },
          {
            value: '5000',
            label: t('preferences.dashboard.refreshInterval.s5'),
          },
          {
            value: '10000',
            label: t('preferences.dashboard.refreshInterval.s10'),
          },
          {
            value: '30000',
            label: t('preferences.dashboard.refreshInterval.s30'),
          },
        ]}
      />
    </>
  );

  const renderAdvancedSection = () => {
    return (
      <>
        <SectionHeader title={t('preferences.advanced.loggingHeader')} />
        <SelectField
          label={t('preferences.advanced.logLevel.label')}
          hint={t('preferences.advanced.logLevel.hint')}
          value={prefs.ui?.logLevel ?? 'info'}
          onChange={(v) => updatePref('ui.logLevel', v)}
          options={[
            { value: 'debug', label: t('preferences.advanced.logLevel.debug') },
            { value: 'info', label: t('preferences.advanced.logLevel.info') },
            { value: 'warn', label: t('preferences.advanced.logLevel.warn') },
            { value: 'error', label: t('preferences.advanced.logLevel.error') },
          ]}
        />

        <SectionHeader title={t('preferences.advanced.debugHeader')} />
        <p className="section-hint">{t('preferences.advanced.debugIntro')}</p>
        <div className="debug-grid">
          {Object.entries(debugCategories).map(([name, enabled]) => (
            <label
              key={name}
              className={`debug-item ${enabled ? 'enabled' : ''}`}
            >
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => {
                  const newValue = e.target.checked;
                  setCategories({ [name]: newValue });
                  setDebugCategories((prev) => ({ ...prev, [name]: newValue }));
                }}
              />
              {name}
            </label>
          ))}
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            resetCategories();
            setDebugCategories(getCategories());
          }}
        >
          {t('preferences.buttons.resetDebugCategories')}
        </Button>
      </>
    );
  };

  return (
    <div
      className="module-container has-sidebar preferences-module"
      data-keyboard-scope="isolated"
    >
      <div className="module-sidebar">
        <h3 className="sidebar-title">{t('preferences.sidebarTitle')}</h3>
        <ul className="item-list">
          {SECTION_IDS.map((id) => {
            const active = activeSection === id;
            return (
              <li
                key={id}
                className={`list-item-nav ${active ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                onClick={() => setActiveSection(id)}
                onKeyDown={activateOnKey(() => setActiveSection(id))}
              >
                {sectionLabel(id)}
              </li>
            );
          })}
        </ul>

        <div className="sidebar-actions">
          <Button variant="primary" onClick={handleSave} disabled={!hasChanges}>
            {t('common.save')}
          </Button>
          <Button variant="secondary" onClick={handleReset}>
            {t('common.reset')}
          </Button>
        </div>
      </div>

      <div className="module-content">
        <h2 className="content-title">{sectionLabel(activeSection)}</h2>
        {renderSection()}
      </div>
    </div>
  );
}
