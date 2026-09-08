/**
 * fileQueuePrefs - localStorage-backed preference readers for FileQueueModule.
 *
 * Each reader parses the persisted `ansikten-preferences` blob directly to avoid
 * a preferences-module import (which would introduce a circular dependency).
 */

/**
 * Read auto-load preference from localStorage.
 * Avoids a preferences import to prevent circular dependency.
 * @returns {boolean}
 */
export const getAutoLoadPreference = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.fileQueue?.autoLoadOnStartup ?? true;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return true; // Default to enabled
};

/**
 * Read rename configuration from preferences, omitting defaults.
 * @returns {object|null}
 */
export const getRenameConfig = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      const rename = prefs.rename || {};
      // Only include non-default values
      const config = {};
      if (rename.prefixSource !== undefined)
        config.prefixSource = rename.prefixSource;
      if (rename.exifFallback !== undefined)
        config.exifFallback = rename.exifFallback;
      if (rename.datePattern !== undefined)
        config.datePattern = rename.datePattern;
      if (rename.filenamePattern !== undefined)
        config.filenamePattern = rename.filenamePattern;
      if (rename.nameSeparator !== undefined)
        config.nameSeparator = rename.nameSeparator;
      if (rename.useFirstNameOnly !== undefined)
        config.useFirstNameOnly = rename.useFirstNameOnly;
      if (rename.alwaysIncludeSurname !== undefined)
        config.alwaysIncludeSurname = rename.alwaysIncludeSurname;
      if (rename.disambiguationStyle !== undefined)
        config.disambiguationStyle = rename.disambiguationStyle;
      if (rename.removeDiacritics !== undefined)
        config.removeDiacritics = rename.removeDiacritics;
      if (rename.includeIgnoredFaces !== undefined)
        config.includeIgnoredFaces = rename.includeIgnoredFaces;
      if (rename.allowAlreadyRenamed !== undefined)
        config.allowAlreadyRenamed = rename.allowAlreadyRenamed;
      // Sidecar settings
      if (rename.renameSidecars !== undefined)
        config.renameSidecars = rename.renameSidecars;
      if (rename.sidecarExtensions !== undefined)
        config.sidecarExtensions = rename.sidecarExtensions;
      return Object.keys(config).length > 0 ? config : null;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
};

/**
 * Read preprocessing notification preference by key.
 * @param {string} key
 * @returns {boolean}
 */
export const getNotificationPreference = (key) => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      const notifications = prefs.preprocessing?.notifications || {};
      if (key === 'showStatusIndicator')
        return notifications.showStatusIndicator ?? true;
      if (key === 'showToastOnPause')
        return notifications.showToastOnPause ?? true;
      if (key === 'showToastOnResume')
        return notifications.showToastOnResume ?? false;
    }
  } catch (e) {
    // Ignore parse errors
  }
  if (key === 'showStatusIndicator') return true;
  if (key === 'showToastOnPause') return true;
  if (key === 'showToastOnResume') return false;
  return false;
};

/**
 * Read preprocessing config including rolling window settings.
 * @returns {object}
 */
export const getPreprocessingConfig = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      const preprocessing = prefs.preprocessing || {};
      return {
        enabled: preprocessing.enabled ?? true,
        maxWorkers: preprocessing.parallelWorkers ?? 2,
        steps: preprocessing.steps || {},
        rollingWindow: preprocessing.rollingWindow || {},
      };
    }
  } catch (e) {
    // Ignore parse errors
  }
  return {};
};

/**
 * Read rename confirmation preference.
 * @returns {boolean}
 */
export const getRequireRenameConfirmation = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.rename?.requireConfirmation ?? true;
    }
  } catch (e) {}
  return true;
};

/**
 * Read auto-remove missing files preference.
 * @returns {boolean}
 */
export const getAutoRemoveMissingPreference = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.fileQueue?.autoRemoveMissing ?? true;
    }
  } catch (e) {}
  return true;
};

/**
 * Read toast duration multiplier from preferences.
 * @returns {number}
 */
export const getToastDurationMultiplier = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.notifications?.toastDuration ?? 1.0;
    }
  } catch (e) {}
  return 1.0;
};

/**
 * Read insert mode preference ("bottom" or "alphabetical").
 * @returns {string}
 */
export const getInsertModePreference = () => {
  try {
    const stored = localStorage.getItem('ansikten-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.fileQueue?.insertMode ?? 'alphabetical';
    }
  } catch (e) {}
  return 'alphabetical';
};
