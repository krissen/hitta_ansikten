/**
 * renameLogic - pure path/name computation for the face-name NEF rename flow.
 *
 * These helpers hold no React state. They cover the parts of the FileQueueModule
 * rename flow that are pure data transforms: choosing which queue paths are
 * eligible for a rename, turning a backend preview/result payload into lookup
 * maps, applying the renamed paths back onto the queue, and summarizing counts.
 *
 * This is distinct from RenameNefModule (the EXIF/CreateDate rename of raw files
 * via /rename-nef/*); that flow shares no code or endpoints with this one.
 */

import { isRenameEligible } from '../fileQueueEligibility.js';

/**
 * Basename of a POSIX-style path.
 * @param {string} filePath
 * @returns {string}
 */
export function basename(filePath) {
  return filePath.split('/').pop();
}

/**
 * Choose the queue file paths eligible for a rename, honoring the current scope:
 * an explicit checkbox selection wins, otherwise a filter-visible set narrows,
 * otherwise all rename-eligible files.
 *
 * @param {Array} queue
 * @param {object} opts
 * @param {boolean} opts.fixMode
 * @param {Set<string>} opts.dirtyPaths - paths with unsaved review changes (held out)
 * @param {Set<string>} [opts.selectedIds] - checkbox selection (by item id)
 * @param {Set<string>|null} [opts.visibleIds] - filter-visible item ids, or null for no filter
 * @returns {string[]} eligible file paths
 */
export function selectRenamePaths(
  queue,
  { fixMode, dirtyPaths, selectedIds, visibleIds },
) {
  const hasSelection = selectedIds && selectedIds.size > 0;
  return queue
    .filter((q) => {
      const eligible = isRenameEligible(q, fixMode, dirtyPaths);
      if (hasSelection) return eligible && selectedIds.has(q.id);
      if (visibleIds) return eligible && visibleIds.has(q.id);
      return eligible;
    })
    .map((q) => q.filePath);
}

/**
 * Count rename-eligible queue files for the footer button label, honoring scope.
 * Mirrors selectRenamePaths but returns a count.
 *
 * @param {Array} queue
 * @param {object} opts - same shape as selectRenamePaths
 * @returns {number}
 */
export function countRenameEligible(queue, opts) {
  return selectRenamePaths(queue, opts).length;
}

/**
 * Build the preview lookup: original path -> { newName, status, persons, sidecars }.
 * @param {Array} items - result.items from /files/rename-preview
 * @returns {Object<string, {newName: string, status: string, persons: string[], sidecars: string[]}>}
 */
export function buildPreviewLookup(items) {
  const lookup = {};
  for (const item of items || []) {
    lookup[item.original_path] = {
      newName: item.new_name,
      status: item.status,
      persons: item.persons || [],
      sidecars: item.sidecars || [],
    };
  }
  return lookup;
}

/**
 * Build the renamed map: original path -> new path.
 * @param {Array} renamed - result.renamed from /files/rename
 * @returns {Object<string, string>}
 */
export function buildRenamedMap(renamed) {
  const map = {};
  for (const r of renamed || []) {
    map[r.original] = r.new;
  }
  return map;
}

/**
 * Apply a renamed map onto the queue, updating filePath + derived fileName.
 * Non-renamed items are returned unchanged.
 * @param {Array} queue
 * @param {Object<string, string>} renamedMap
 * @returns {Array} new queue
 */
export function applyRenameToQueue(queue, renamedMap) {
  return queue.map((item) => {
    const newPath = renamedMap[item.filePath];
    if (newPath) {
      return { ...item, filePath: newPath, fileName: basename(newPath) };
    }
    return item;
  });
}

/**
 * Re-key a path-keyed status map for renamed paths (old key -> new key).
 * @param {Object} statusMap
 * @param {Object<string, string>} renamedMap
 * @returns {Object} new status map
 */
export function remapPathKeys(statusMap, renamedMap) {
  const updated = { ...statusMap };
  for (const [oldPath, newPath] of Object.entries(renamedMap)) {
    if (updated[oldPath]) {
      updated[newPath] = updated[oldPath];
      delete updated[oldPath];
    }
  }
  return updated;
}

/**
 * Summarize a rename result's counts.
 * @param {object} result - from /files/rename
 * @returns {{renamedCount: number, skippedCount: number, errorCount: number}}
 */
export function renameSummaryCounts(result) {
  return {
    renamedCount: result?.renamed?.length || 0,
    skippedCount: result?.skipped?.length || 0,
    errorCount: result?.errors?.length || 0,
  };
}
