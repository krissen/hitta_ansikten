/**
 * useNefRename - React binding for the face-name NEF rename flow.
 *
 * Owns the rename UI state (show-preview toggle, preview lookup, in-progress
 * flag) and the three handlers the shell wires up: fetchRenamePreview (dry-run),
 * handlePreviewToggle and handleRename (the confirmed rename + path-update
 * propagation onto the queue and the preprocessing caches). The pure path/name
 * computation lives in renameLogic.js.
 *
 * Distinct from RenameNefModule, which renames raw files from EXIF CreateDate
 * via /rename-nef/*; this flow suffixes filenames with confirmed person names
 * via /files/rename*. They share no endpoints or logic.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { debug, debugError } from '../../shared/debug.js';
import { t } from '../../../i18n/index.js';
import { PreprocessingStatus } from '../../services/preprocessing/index.js';
import { getRenameConfig, getRequireRenameConfirmation } from './fileQueuePrefs.js';
import {
  selectRenamePaths,
  buildPreviewLookup,
  buildRenamedMap,
  remapPathKeys,
  renameSummaryCounts,
} from './renameLogic.js';

/**
 * @param {object} deps
 * @param {Array} deps.queue - queue state (drives the initial-preview effect)
 * @param {React.MutableRefObject} deps.queueRef - always-current queue ref
 * @param {Function} deps.applyRename - propagate a renamed map onto the queue
 * @param {object} deps.api - backend client
 * @param {Function} deps.showToast
 * @param {Function} deps.confirm - promise-based confirm() from useConfirm()
 * @param {boolean} deps.isConnected
 * @param {boolean} deps.fixMode
 * @param {React.MutableRefObject} deps.fixModeRef
 * @param {React.MutableRefObject} deps.dirtyPathsRef
 * @param {Set<string>} deps.selectedFiles - checkbox selection
 * @param {React.MutableRefObject} deps.visibleIdsRef - filter-visible ids
 * @param {object} deps.preprocessingStatus
 * @param {React.MutableRefObject} deps.preprocessingManager
 * @param {Function} deps.setPreprocessingStatus
 */
export function useNefRename({
  queue,
  queueRef,
  applyRename,
  api,
  showToast,
  confirm,
  isConnected,
  fixMode,
  fixModeRef,
  dirtyPathsRef,
  selectedFiles,
  visibleIdsRef,
  preprocessingStatus,
  preprocessingManager,
  setPreprocessingStatus,
}) {
  const [showPreviewNames, setShowPreviewNames] = useState(false);
  const [previewData, setPreviewData] = useState(null); // { path: { newName, status, persons } }
  const [renameInProgress, setRenameInProgress] = useState(false);
  const renameInProgressRef = useRef(false);
  renameInProgressRef.current = renameInProgress;

  // Fetch rename preview from backend
  // Uses queueRef to always get current queue (avoids stale closure issues)
  const fetchRenamePreview = useCallback(async () => {
    // Include files eligible for rename:
    // - completed: reviewed this session
    // - isAlreadyProcessed (when fix-mode OFF): already in database, includes active files being re-viewed
    const eligiblePaths = selectRenamePaths(queueRef.current, {
      fixMode: fixModeRef.current,
      dirtyPaths: dirtyPathsRef.current,
    });

    if (eligiblePaths.length === 0) {
      setPreviewData({});
      return;
    }

    // Show loading indicator for large batches
    if (eligiblePaths.length > 5) {
      showToast(t('fileQueue.toasts.generatingNames', { count: eligiblePaths.length }), 'info', 2000);
    }

    // Get rename config from preferences
    const renameConfig = getRenameConfig();

    try {
      const result = await api.post('/api/v1/files/rename-preview', {
        file_paths: eligiblePaths,
        config: renameConfig
      });

      setPreviewData(buildPreviewLookup(result.items));
      debug('FileQueue', 'Fetched rename preview for', eligiblePaths.length, 'files');
    } catch (err) {
      debugError('FileQueue', 'Failed to fetch rename preview:', err);
      setPreviewData({});
    }
  }, [api, showToast, queueRef, fixModeRef, dirtyPathsRef]);

  // Ref to prevent double fetch on initial toggle
  const initialPreviewFetchedRef = useRef(false);

  // Handle preview toggle
  const handlePreviewToggle = useCallback(async (e) => {
    const show = e.target.checked;
    setShowPreviewNames(show);

    // Always fetch fresh preview when toggling on to avoid stale data
    if (show) {
      // Mark as fetched to prevent useEffect from also triggering fetch
      initialPreviewFetchedRef.current = true;
      await fetchRenamePreview();
    }
  }, [fetchRenamePreview]);

  // Fetch preview on startup if showPreviewNames was restored as true
  // Wait for preprocessing to complete so backend has the data
  useEffect(() => {
    // Only run once, when showPreviewNames is on and we have eligible files
    if (initialPreviewFetchedRef.current) return;
    if (!showPreviewNames) return;
    if (!isConnected) return;

    // Check if we have eligible files (completed or already-processed)
    const hasEligibleFiles = queue.some(q =>
      q.status === 'completed' || (!fixMode && q.isAlreadyProcessed)
    );
    if (!hasEligibleFiles) return;

    // Check if preprocessing is done for at least some files
    const hasPreprocessedFiles = queue.some(q =>
      preprocessingStatus[q.filePath]?.status === PreprocessingStatus.COMPLETED
    );
    if (!hasPreprocessedFiles && queue.length > 0) return; // Wait for preprocessing

    initialPreviewFetchedRef.current = true;
    debug('FileQueue', 'Fetching preview on startup (showPreviewNames was saved as true)');
    fetchRenamePreview();
  }, [showPreviewNames, isConnected, queue, fixMode, preprocessingStatus, fetchRenamePreview]);

  // Handle rename action
  const handleRename = useCallback(async () => {
    const currentFixMode = fixModeRef.current;
    const hasSelection = selectedFiles.size > 0;

    const eligiblePaths = selectRenamePaths(queue, {
      fixMode: currentFixMode,
      dirtyPaths: dirtyPathsRef.current,
      selectedIds: selectedFiles,
      visibleIds: visibleIdsRef.current,
    });

    if (eligiblePaths.length === 0) return;

    const requireConfirmation = getRequireRenameConfirmation();

    if (requireConfirmation) {
      const selectionNote = hasSelection ? t('fileQueue.dialogs.renameConfirmSelection') : '';
      const confirmed = await confirm({
        message: t('fileQueue.dialogs.renameConfirm', {
          count: eligiblePaths.length,
          selection: selectionNote
        }),
      });
      if (!confirmed) return;
    }

    setRenameInProgress(true);

    // Show progress toast
    showToast(t('fileQueue.toasts.renaming', { count: eligiblePaths.length }), 'info', null);

    // Get rename config from preferences
    const renameConfig = getRenameConfig();

    try {
      const result = await api.post('/api/v1/files/rename', {
        file_paths: eligiblePaths,
        config: renameConfig
      });

      debug('FileQueue', 'Rename result:', result);

      const { renamedCount, skippedCount, errorCount } = renameSummaryCounts(result);

      // Update queue with new filenames
      if (renamedCount > 0) {
        const renamedMap = buildRenamedMap(result.renamed);

        applyRename(renamedMap);

        // Update preprocessingManager state for renamed files
        if (preprocessingManager.current) {
          for (const [oldPath, newPath] of Object.entries(renamedMap)) {
            const cachedData = preprocessingManager.current.getCachedData(oldPath);
            if (cachedData) {
              preprocessingManager.current.removeFile(oldPath);
              preprocessingManager.current.completed.set(newPath, cachedData);
            }
          }
        }

        // Update React preprocessingStatus state
        setPreprocessingStatus(prev => remapPathKeys(prev, renamedMap));
      }

      // Refresh preview data to get updated info for renamed files
      setPreviewData(null);
      if (showPreviewNames) {
        // Re-fetch after delay to allow queue state to update
        setTimeout(() => fetchRenamePreview(), 300);
      }

      // Show toast notification
      let message = t('fileQueue.toasts.renamed', { count: renamedCount });
      if (skippedCount > 0) message += t('fileQueue.toasts.renamedSkippedSuffix', { count: skippedCount });
      if (errorCount > 0) message += t('fileQueue.toasts.renamedErrorSuffix', { count: errorCount });
      showToast(message, errorCount > 0 ? 'warning' : 'success');

    } catch (err) {
      debugError('FileQueue', 'Rename failed:', err);
      showToast(t('fileQueue.toasts.renameFailed', { message: err.message }), 'error');
    } finally {
      setRenameInProgress(false);
    }
  }, [
    queue, api, showPreviewNames, fetchRenamePreview, showToast, confirm, selectedFiles,
    fixModeRef, dirtyPathsRef, visibleIdsRef, preprocessingManager, applyRename,
    setPreprocessingStatus,
  ]);

  return {
    showPreviewNames,
    setShowPreviewNames,
    previewData,
    setPreviewData,
    renameInProgress,
    renameInProgressRef,
    fetchRenamePreview,
    handlePreviewToggle,
    handleRename,
  };
}
