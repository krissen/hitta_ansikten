/**
 * Debug logging system with categories
 *
 * Categories can be enabled/disabled via preferences.
 * Error and warning levels are always shown.
 *
 * Usage:
 *   import { debug, debugWarn, debugError } from '../shared/debug.js';
 *   debug('ModuleAPI', 'emit', eventName, data);
 *   debugWarn('FileQueue', 'No handlers for event');
 *   debugError('ImageViewer', 'Failed to load', error);
 */

// Debug categories - disabled by default except for essential ones
const DEFAULT_CATEGORIES = {
  // Core systems - enabled by default
  'FlexLayout': true,
  'Backend': true,
  'WebSocket': true,

  // Module communication - disabled by default (verbose)
  'ModuleAPI': false,
  'ModuleEvent': false,

  // Individual modules - disabled by default
  'FileQueue': false,
  'ImageViewer': false,
  'ReviewModule': false,
  'OriginalView': false,
  'LogViewer': false,
  'Statistics': false,
  'DatabaseMgmt': false,

  // Subsystems - disabled by default
  'Preferences': false,
  'IPC': false,
  'NEFConvert': false,
  'FaceDetection': false,

  // Preprocessing - enabled by default for testing
  'Preprocessing': true,
  'Cache': true,
};

// Storage key
const STORAGE_KEY = 'bildvisare-debug-categories';

// Current enabled categories (loaded from localStorage)
let enabledCategories = { ...DEFAULT_CATEGORIES };

// Log buffer for LogViewer to read historical logs
const LOG_BUFFER_MAX = 500;
const logBuffer = [];

// Load from localStorage
function loadCategories() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      enabledCategories = { ...DEFAULT_CATEGORIES, ...parsed };
    }
  } catch (err) {
    console.error('[Debug] Failed to load categories:', err);
  }
}

// Save to localStorage
function saveCategories() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(enabledCategories));
  } catch (err) {
    console.error('[Debug] Failed to save categories:', err);
  }
}

// Initialize on load
loadCategories();

/**
 * Check if a category is enabled
 */
export function isCategoryEnabled(category) {
  return enabledCategories[category] ?? false;
}

/**
 * Enable a category
 */
export function enableCategory(category) {
  enabledCategories[category] = true;
  saveCategories();
}

/**
 * Disable a category
 */
export function disableCategory(category) {
  enabledCategories[category] = false;
  saveCategories();
}

/**
 * Toggle a category
 */
export function toggleCategory(category) {
  enabledCategories[category] = !enabledCategories[category];
  saveCategories();
  return enabledCategories[category];
}

/**
 * Get all categories and their states
 */
export function getCategories() {
  return { ...enabledCategories };
}

/**
 * Set multiple categories at once
 */
export function setCategories(categories) {
  enabledCategories = { ...enabledCategories, ...categories };
  saveCategories();
}

/**
 * Reset to defaults
 */
export function resetCategories() {
  enabledCategories = { ...DEFAULT_CATEGORIES };
  saveCategories();
}

/**
 * Add entry to log buffer
 */
function addToBuffer(level, message, source = 'frontend') {
  const entry = {
    id: Date.now() + Math.random(),
    level,
    message,
    timestamp: new Date().toISOString(),
    source
  };
  logBuffer.push(entry);
  // Keep buffer size limited
  if (logBuffer.length > LOG_BUFFER_MAX) {
    logBuffer.shift();
  }
}

/**
 * Get buffered log entries (for LogViewer to read on mount)
 * @returns {Array} Array of log entries
 */
export function getLogBuffer() {
  return [...logBuffer];
}

/**
 * Clear log buffer
 */
export function clearLogBuffer() {
  logBuffer.length = 0;
}

/**
 * Debug log - only shows if category is enabled
 * @param {string} category - Category name (e.g., 'FileQueue', 'ModuleAPI')
 * @param {...any} args - Log arguments
 */
export function debug(category, ...args) {
  if (enabledCategories[category]) {
    const message = `[${category}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
    console.log(`[${category}]`, ...args);
    addToBuffer('info', message);
  }
}

/**
 * Debug warning - ALWAYS shows (regardless of category)
 * @param {string} category - Category name
 * @param {...any} args - Log arguments
 */
export function debugWarn(category, ...args) {
  const message = `[${category}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.warn(`[${category}]`, ...args);
  addToBuffer('warn', message);
}

/**
 * Debug error - ALWAYS shows (regardless of category)
 * @param {string} category - Category name
 * @param {...any} args - Log arguments
 */
export function debugError(category, ...args) {
  const message = `[${category}] ${args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')}`;
  console.error(`[${category}]`, ...args);
  addToBuffer('error', message);
}

/**
 * Create a logger for a specific category
 * Returns an object with log, warn, error methods
 */
export function createLogger(category) {
  return {
    log: (...args) => debug(category, ...args),
    warn: (...args) => debugWarn(category, ...args),
    error: (...args) => debugError(category, ...args),
    isEnabled: () => isCategoryEnabled(category),
  };
}

// Expose globally for console access
window.debugCategories = {
  get: getCategories,
  set: setCategories,
  enable: enableCategory,
  disable: disableCategory,
  toggle: toggleCategory,
  reset: resetCategories,
};

export default { debug, debugWarn, debugError, createLogger };
