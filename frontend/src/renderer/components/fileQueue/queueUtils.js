/**
 * queueUtils - pure helpers for FileQueueModule's queue list.
 */

/**
 * Compare filenames using numeric-aware collation.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export const naturalSortCompare = (a, b) => {
  return a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' });
};

/**
 * Generate a short random ID for list items.
 * @returns {string}
 */
export const generateId = () => Math.random().toString(36).substring(2, 9);

// Supported image file extensions
export const SUPPORTED_EXTENSIONS = new Set(['nef', 'cr2', 'arw', 'jpg', 'jpeg', 'png', 'tiff']);
