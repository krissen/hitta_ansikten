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

/**
 * The source folder of the queued files, for labelling the queue ("Kö: <mapp>").
 * Uses the first file's parent directory (a queue is usually one event folder).
 * Null for an empty queue. Handles both POSIX and Windows separators.
 * @param {{ filePath: string }[]} queue
 * @returns {string|null}
 */
export function queueFolder(queue) {
  if (!Array.isArray(queue) || queue.length === 0) return null;
  const norm = String(queue[0].filePath).replace(/\\/g, '/');
  const idx = norm.lastIndexOf('/');
  if (idx > 0) return norm.slice(0, idx);
  return idx === 0 ? '/' : null;
}
