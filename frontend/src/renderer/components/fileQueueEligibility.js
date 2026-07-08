/**
 * Pure functions for file queue eligibility logic.
 * No React hooks - just plain JavaScript for testability.
 */

/**
 * Determine if a queue item is eligible for processing.
 * @param {Object} item - Queue item with status, isAlreadyProcessed, fileName
 * @param {Object} context - Context with fixMode and processedFiles Set
 * @returns {boolean}
 */
export function isFileEligible(item, context) {
  if (!item) return false;
  if (item.status === 'completed') return false;
  
  if (!context.fixMode) {
    const isProcessed = item.isAlreadyProcessed || context.processedFiles.has(item.fileName);
    if (isProcessed) return false;
  }
  
  return true;
}

/**
 * Determine if a queue item is eligible for the face-based rename.
 *
 * Rename targets files whose review is done (`status === 'completed'`) or that are
 * already in the database (`isAlreadyProcessed`, when not in fix-mode). A file with
 * unsaved review changes (in `dirtyPaths`) is held out until its review is persisted,
 * so a rename never reads the database before a just-added manual face has been saved.
 *
 * @param {Object} item - Queue item with status, isAlreadyProcessed, filePath
 * @param {boolean} fixMode - Whether fix-mode (re-review) is on
 * @param {Set<string>} [dirtyPaths] - filePaths with unsaved review changes
 * @returns {boolean}
 */
export function isRenameEligible(item, fixMode, dirtyPaths) {
  if (!item) return false;
  const eligible = item.status === 'completed' || (!fixMode && item.isAlreadyProcessed);
  if (!eligible) return false;
  if (dirtyPaths && dirtyPaths.has(item.filePath)) return false;
  return true;
}

/**
 * Find the index of the next eligible file in the queue.
 * @param {Array} queue - Array of queue items
 * @param {Object} context - Context with fixMode and processedFiles Set
 * @param {Object} options - Options for finding
 * @param {number} options.excludeIndex - Index to skip (e.g., current file)
 * @param {number} options.preferIndex - Preferred index to try first
 * @returns {number} Index of next eligible file, or -1 if none
 */
export function findNextEligibleIndex(queue, context, options = {}) {
  const { excludeIndex = -1, preferIndex = -1 } = options;
  
  // Try preferred index first if specified and eligible
  if (preferIndex >= 0 && preferIndex < queue.length && preferIndex !== excludeIndex) {
    if (isFileEligible(queue[preferIndex], context)) {
      return preferIndex;
    }
  }
  
  // Find first eligible file
  return queue.findIndex((item, i) => 
    i !== excludeIndex && isFileEligible(item, context)
  );
}
