/**
 * FileQueueModule - File queue management for batch image processing
 *
 * Features:
 * - Visual file list with status indicators
 * - Add/remove files from queue
 * - Click to load file in ImageViewer
 * - Auto-advance after review completion
 * - Fix mode for re-reviewing processed files
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useModuleEvent, useEmitEvent, useModuleAPI } from '../hooks/useModuleEvent.js';
import { useBackend } from '../context/BackendContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { apiClient } from '../shared/api-client.js';
import { getPreprocessingManager, PreprocessingStatus } from '../services/preprocessing/index.js';
import { Icon } from './Icon.jsx';
import { isFileEligible as isFileEligiblePure, findNextEligibleIndex, isRenameEligible } from './fileQueueEligibility.js';
import { compileFilter } from './filterExpression.js';
import { formatNamesToFit, measureTextWidth } from '../shared/nameFormatter.js';
import { t } from '../../i18n/index.js';
import {
  getAutoLoadPreference,
  getRenameConfig,
  getNotificationPreference,
  getPreprocessingConfig,
  getRequireRenameConfirmation,
  getAutoRemoveMissingPreference,
  getToastDurationMultiplier,
  getInsertModePreference,
} from './fileQueue/fileQueuePrefs.js';
import './FileQueueModule.css';

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
const generateId = () => Math.random().toString(36).substring(2, 9);

// Supported image file extensions
const SUPPORTED_EXTENSIONS = new Set(['nef', 'cr2', 'arw', 'jpg', 'jpeg', 'png', 'tiff']);

/**
 * FileQueueModule Component
 */
export function FileQueueModule({ node }) {
  const { api, isConnected } = useBackend();
  const emit = useEmitEvent();
  const { hasListeners, waitForListeners } = useModuleAPI();
  const globalShowToast = useToast();

  // Queue state
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [fixMode, setFixMode] = useState(false);
  const [processedFiles, setProcessedFiles] = useState(new Set());
  const [processedHashes, setProcessedHashes] = useState(new Set());
  const processedHashesRef = useRef(processedHashes);
  processedHashesRef.current = processedHashes;
  const [processedFilesLoaded, setProcessedFilesLoaded] = useState(false);
  const [preprocessingStatus, setPreprocessingStatus] = useState({});
  const [preprocessingPaused, setPreprocessingPaused] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set()); // Checkbox-selected file IDs
  const [focusedIndex, setFocusedIndex] = useState(-1); // Clicked-on item (visual highlight only)

  // Filter state
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const filterInputRef = useRef(null);

  // Rename state
  const [showPreviewNames, setShowPreviewNames] = useState(false);
  const [previewData, setPreviewData] = useState(null); // { path: { newName, status, persons } }
  const [renameInProgress, setRenameInProgress] = useState(false);
  // Paths whose review has unsaved changes; held out of rename until persisted.
  const [dirtyPaths, setDirtyPaths] = useState(new Set());
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0); // Track nested drag enter/leave events
  const renameInProgressRef = useRef(false);
  renameInProgressRef.current = renameInProgress;

  // Toast wrapper that applies duration preference
  // Base durations are longer now: success=4s, info=4s, warning=5s, error=6s
  const showToast = useCallback((message, type = 'success', baseDuration = 4000) => {
    const multiplier = getToastDurationMultiplier();
    const duration = Math.round(baseDuration * multiplier);
    globalShowToast(message, type, duration);
  }, [globalShowToast]);

  // Alias for backwards compatibility
  const queueToast = showToast;

  // Track missing files for batched removal
  const missingFilesRef = useRef([]);
  const missingFilesTimeoutRef = useRef(null);

  // Refs for processed files state (for use in callbacks without stale closure)
  const processedFilesLoadedRef = useRef(false);
  processedFilesLoadedRef.current = processedFilesLoaded;
  const processedFilesRef = useRef(new Set());
  processedFilesRef.current = processedFiles;

  // Queued manual load: stores index to load once processedFiles are ready
  const pendingManualLoadRef = useRef(-1);

  // Get preprocessing manager (singleton)
  const preprocessingManager = useRef(null);
  if (!preprocessingManager.current) {
    const config = getPreprocessingConfig();
    preprocessingManager.current = getPreprocessingManager(config);
  }

  // Refs
  const moduleRef = useRef(null);
  const listRef = useRef(null);
  const currentFileRef = useRef(null);
  const queueRef = useRef(queue); // Keep current queue in ref for callbacks
  queueRef.current = queue; // Sync on every render (not just in useEffect)
  const visibleIdsRef = useRef(null); // Current filter-visible IDs for action scoping
  const fixModeRef = useRef(fixMode);
  fixModeRef.current = fixMode;

  const loadFileRef = useRef(null);

  // Undo stack for delete-to-trash. Each entry: { id, item, index } — the trash
  // id (for restore), the removed queue item, and its original index.
  const deleteUndoStackRef = useRef([]);

  const [shouldAutoLoad, setShouldAutoLoad] = useState(false);
  const savedIndexRef = useRef(-1);

  // Load processed files from backend on mount
  const loadProcessedFilesFailedRef = useRef(false);
  const loadProcessedFiles = useCallback(async () => {
    debug('FileQueue', '>>> loadProcessedFiles starting...');
    try {
      const response = await api.get('/api/v1/management/recent-files?n=100000');
      if (response && Array.isArray(response)) {
        const fileNames = new Set(response.map(f => f.name));
        const fileHashes = new Set(response.map(f => f.hash).filter(Boolean));
        setProcessedFiles(fileNames);
        setProcessedHashes(fileHashes);
        setProcessedFilesLoaded(true);
        debug('FileQueue', '>>> loadProcessedFiles COMPLETE:', fileNames.size, 'files loaded');
        loadProcessedFilesFailedRef.current = false;
      }
    } catch (err) {
      debugWarn('FileQueue', 'Could not load processed files (non-fatal):', err.message);
      setProcessedFilesLoaded(true);
      if (!loadProcessedFilesFailedRef.current) {
        loadProcessedFilesFailedRef.current = true;
        showToast(t('fileQueue.toasts.loadProcessedFailed'), 'warning', 3000);
      }
    }
  }, [api, showToast]);

  const emitQueueStatus = useCallback((currentIdx = currentIndex) => {
    const q = queueRef.current;
    const done = q.filter(item => item.status === 'completed').length;
    // Remaining = total - done, but minimum 0 (avoid -1 when queue is empty)
    const remaining = Math.max(0, q.length - done);
    const preprocessed = countPreprocessed(q);
    emit('queue-status', {
      total: q.length,
      current: currentIdx,
      done: done,
      remaining: remaining,
      preprocessed: preprocessed
    });
  }, [emit, currentIndex]);

  // Keep the Review queue-overview bar live: re-emit when the queue itself
  // changes (add files, clear completed, remove — none of which load or
  // complete a file) and when files finish preprocessing in the background
  // (the completion paths only update preprocessingStatus). Also answer a
  // late subscriber that asks for the current status on mount.
  useEffect(() => {
    emitQueueStatus();
  }, [queue, preprocessingStatus, emitQueueStatus]);

  useModuleEvent('request-queue-status', useCallback(() => {
    emitQueueStatus();
  }, [emitQueueStatus]));

  useEffect(() => {
    loadProcessedFiles();
  }, [loadProcessedFiles]);

  useEffect(() => {
    if (preprocessingManager.current) {
      preprocessingManager.current.setHashChecker((hash) => processedHashesRef.current.has(hash));
    }
  }, [processedFilesLoaded]);

  // Execute queued manual load once processed files are ready
  useEffect(() => {
    if (processedFilesLoaded && pendingManualLoadRef.current >= 0) {
      const idx = pendingManualLoadRef.current;
      pendingManualLoadRef.current = -1;
      debug('FileQueue', 'Executing queued manual load at index', idx);
      loadFileRef.current?.(idx);
    }
  }, [processedFilesLoaded]);

  const statsFetchedRef = useRef(new Set());
  useEffect(() => {
    if (!processedFilesLoaded || processedFiles.size === 0) return;
    
    setQueue(prev => {
      let hasChanges = false;
      const updated = prev.map(item => {
        const shouldBeProcessed = processedFiles.has(item.fileName);
        if (shouldBeProcessed && !item.isAlreadyProcessed) {
          hasChanges = true;
          return { ...item, isAlreadyProcessed: true };
        }
        return item;
      });
      return hasChanges ? updated : prev;
    });
  }, [processedFilesLoaded, processedFiles]);

  useEffect(() => {
    if (!processedFilesLoaded || processedFiles.size === 0 || !api) return;
    
    const itemsNeedingStats = queue.filter(item => 
      item.isAlreadyProcessed && !statsFetchedRef.current.has(item.filePath)
    );
    
    if (itemsNeedingStats.length === 0) return;
    
    itemsNeedingStats.forEach(item => statsFetchedRef.current.add(item.filePath));
    
    const filepaths = itemsNeedingStats.map(item => item.filePath);
    debug('FileQueue', 'Fetching stats via hash for', filepaths.length, 'files');
    api.post('/api/v1/statistics/file-stats', { filepaths })
      .then(stats => {
        debug('FileQueue', 'Got stats for', Object.keys(stats).length, 'files');
        setPreprocessingStatus(prev => {
          const updates = {};
          for (const item of itemsNeedingStats) {
            const stat = stats[item.fileName];
            if (stat) {
              updates[item.filePath] = {
                status: PreprocessingStatus.COMPLETED,
                faceCount: stat.face_count,
                persons: stat.persons,
              };
            }
          }
          return { ...prev, ...updates };
        });
      })
      .catch(err => {
        debugWarn('FileQueue', 'Failed to fetch stats for processed files:', err);
      });
  }, [processedFilesLoaded, processedFiles, api, queue]);

  // Subscribe to preprocessing manager events
  useEffect(() => {
    const manager = preprocessingManager.current;
    if (!manager) return;

    const handleStatusChange = ({ filePath, status }) => {
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { ...(prev[filePath] || {}), status }
      }));
    };

    const handleCompleted = ({ filePath, hash, faceCount }) => {
      setPreprocessingStatus(prev => {
        const existing = prev[filePath];
        // Preserve existing faceCount if it's valid (faces-detected may have set it)
        const actualFaceCount = (existing?.faceCount > 0) ? existing.faceCount : faceCount;
        return {
          ...prev,
          [filePath]: { status: PreprocessingStatus.COMPLETED, faceCount: actualFaceCount, hash }
        };
      });

      // Check if file hash matches a processed file (handles renamed files)
      if (hash && processedHashes.has(hash)) {
        setQueue(prev => prev.map(item =>
          item.filePath === filePath && !item.isAlreadyProcessed
            ? { ...item, isAlreadyProcessed: true }
            : item
        ));
        debug('FileQueue', 'File recognized by hash as already processed:', filePath);
      }

      debug('FileQueue', 'Preprocessing completed:', filePath, `(${faceCount ?? 0} faces)`);
    };

    const handleError = ({ filePath, error }) => {
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { status: PreprocessingStatus.ERROR }
      }));
      debugWarn('FileQueue', 'Preprocessing error:', filePath, error);
      // Show error toast for preprocessing failure
      const fileName = filePath.split('/').pop();
      showToast(t('fileQueue.toasts.preprocessingFailed', { fileName }), 'error', 4000);
    };

    const handleFileNotFound = ({ filePath }) => {
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { status: PreprocessingStatus.FILE_NOT_FOUND }
      }));

      const hash = preprocessingManager.current?.removeFile(filePath);
      if (hash) {
        apiClient.batchDeleteCache([hash]).catch(() => {});
      }

      const autoRemove = getAutoRemoveMissingPreference();

      if (autoRemove) {
        missingFilesRef.current.push(filePath);

        if (missingFilesTimeoutRef.current) {
          clearTimeout(missingFilesTimeoutRef.current);
        }

        missingFilesTimeoutRef.current = setTimeout(() => {
          const count = missingFilesRef.current.length;
          if (count > 0) {
            const pathsToRemove = new Set(missingFilesRef.current);
            setQueue(prev => prev.filter(item => !pathsToRemove.has(item.filePath)));
            showToast(t('fileQueue.toasts.removedMissing', { count }), 'info', 3000);
            debug('FileQueue', `Auto-removed ${count} missing files`);
            missingFilesRef.current = [];
          }
        }, 500);
      } else {
        setQueue(prev => prev.map(item =>
          item.filePath === filePath
            ? { ...item, status: 'missing', error: 'File not found' }
            : item
        ));
      }
      debug('FileQueue', 'File not found:', filePath);
    };

    const handlePaused = ({ readyCount, queueLength }) => {
      debug('FileQueue', `Preprocessing paused: ${readyCount} ready, ${queueLength} in queue`);
      setPreprocessingPaused(true);
      const showPauseToast = getNotificationPreference('showToastOnPause');
      if (showPauseToast) {
        showToast(t('fileQueue.toasts.preprocessingPaused', { count: readyCount }), 'info', 3000);
      }
    };

    const handleResumed = () => {
      debug('FileQueue', 'Preprocessing resumed');
      setPreprocessingPaused(false);
      const showResumeToast = getNotificationPreference('showToastOnResume');
      if (showResumeToast) {
        showToast(t('fileQueue.toasts.preprocessingResumed'), 'info', 2000);
      }
    };

    const handleCacheCleared = async ({ count, hashes }) => {
      debug('FileQueue', `Preprocessing cache cleared: ${count} items`);
      if (hashes && hashes.length > 0) {
        try {
          await apiClient.batchDeleteCache(hashes);
          debug('FileQueue', `Cleared ${hashes.length} items from backend cache`);
        } catch (err) {
          debugWarn('FileQueue', 'Failed to clear backend cache:', err.message);
        }
      }
    };

    const handleAlreadyProcessed = ({ filePath, hash }) => {
      debug('FileQueue', 'File skipped (hash already processed):', filePath);
      setQueue(prev => prev.map(item =>
        item.filePath === filePath
          ? { ...item, isAlreadyProcessed: true }
          : item
      ));
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { status: PreprocessingStatus.COMPLETED, skipped: true }
      }));
    };

    manager.on('status-change', handleStatusChange);
    manager.on('completed', handleCompleted);
    manager.on('error', handleError);
    manager.on('file-not-found', handleFileNotFound);
    manager.on('paused', handlePaused);
    manager.on('resumed', handleResumed);
    manager.on('cache-cleared', handleCacheCleared);
    manager.on('already-processed', handleAlreadyProcessed);

    return () => {
      manager.off('status-change', handleStatusChange);
      manager.off('completed', handleCompleted);
      manager.off('error', handleError);
      manager.off('file-not-found', handleFileNotFound);
      manager.off('paused', handlePaused);
      manager.off('resumed', handleResumed);
      manager.off('cache-cleared', handleCacheCleared);
      manager.off('already-processed', handleAlreadyProcessed);
    };
  }, [showToast, processedHashes]);

  // Handle file-deleted events from file watcher
  // Use refs to avoid re-subscribing on every preprocessingStatus change
  const preprocessingStatusRef = useRef(preprocessingStatus);
  preprocessingStatusRef.current = preprocessingStatus;

  // Count files that are preprocessed (in the cache, ready to open) but not yet
  // reviewed this session. Used for the queue overview bar in ReviewModule.
  const countPreprocessed = useCallback((queueArr) => {
    const pp = preprocessingStatusRef.current;
    return queueArr.filter(
      item => item.status !== 'completed' &&
              pp[item.filePath]?.status === PreprocessingStatus.COMPLETED
    ).length;
  }, []);

  useEffect(() => {
    const handleFileDeleted = (filePath) => {
      debug('FileQueue', 'File deleted from disk:', filePath);

      // During rename, ignore file-deleted events entirely
      // (rename triggers delete events for old paths - we handle path updates in handleRename)
      if (renameInProgressRef.current) {
        debug('FileQueue', 'Ignoring file-deleted during rename:', filePath.split('/').pop());
        return;
      }

      const ppStatus = preprocessingStatusRef.current[filePath];
      const removedHash = preprocessingManager.current?.removeFile(filePath);
      const hash = removedHash || ppStatus?.hash;

      if (hash) {
        apiClient.batchDeleteCache([hash]).catch(err => {
          debugWarn('FileQueue', 'Failed to clear backend cache:', err.message);
        });
      }

      setPreprocessingStatus(prev => {
        const updated = { ...prev };
        delete updated[filePath];
        return updated;
      });

      const fileName = filePath.split('/').pop();
      setQueue(prev => prev.filter(item => item.filePath !== filePath));
      showToast(t('fileQueue.toasts.removedDeletedFile', { fileName }), 'info', 3000);
    };

    const unsubscribe = window.ansiktenAPI?.onFileDeleted(handleFileDeleted);
    return () => unsubscribe?.();
  }, [showToast]);

  useEffect(() => {
    const handleWatcherError = (dir, affectedFiles) => {
      const currentQueue = queueRef.current;
      const queuePaths = new Set(currentQueue.map(item => item.filePath));
      const stillInQueue = affectedFiles.filter(fp => queuePaths.has(fp));

      if (stillInQueue.length > 0) {
        debugWarn('FileQueue', `Watcher error for ${dir}, re-registering ${stillInQueue.length}/${affectedFiles.length} files`);
        for (const filePath of stillInQueue) {
          window.ansiktenAPI?.watchFile(filePath);
        }
      }
    };

    const unsubscribe = window.ansiktenAPI?.onWatcherError(handleWatcherError);
    return () => unsubscribe?.();
  }, []);

  // Load queue from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ansikten-file-queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
          // Reset 'active' status to 'pending' since no file is loaded yet
          // This prevents mismatch between status and currentIndex at startup
          const restoredQueue = parsed.queue.map(item => ({
            ...item,
            status: item.status === 'active' ? 'pending' : item.status
          }));
          setQueue(restoredQueue);
          setAutoAdvance(parsed.autoAdvance ?? true);
          setFixMode(parsed.fixMode ?? false);
          setShowPreviewNames(parsed.showPreviewNames ?? false);
          savedIndexRef.current = parsed.currentIndex ?? -1;
          setShouldAutoLoad(true);
          debug('FileQueue', 'Restored queue with', restoredQueue.length, 'files, will auto-load');
          const withReviewed = restoredQueue.filter(q => q.reviewedFaces?.length > 0);
          if (withReviewed.length > 0) {
            debug('FileQueue', `Found ${withReviewed.length} items with reviewedFaces:`,
              withReviewed.map(q => `${q.fileName}: ${q.reviewedFaces.length} faces`));
          }
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to load saved queue:', err);
    }
  }, []);

  const [pendingAutoLoad, setPendingAutoLoad] = useState(-1);

  // Save queue to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('ansikten-file-queue', JSON.stringify({
        queue,
        currentIndex,
        autoAdvance,
        fixMode,
        showPreviewNames
      }));
    } catch (err) {
      debugError('FileQueue', 'Failed to save queue:', err);
    }
  }, [queue, currentIndex, autoAdvance, fixMode, showPreviewNames]);

  // Watch queued files for deletion
  const watchedFilesRef = useRef(new Set());
  useEffect(() => {
    const currentPaths = new Set(queue.map(item => item.filePath));
    const watched = watchedFilesRef.current;

    currentPaths.forEach(filePath => {
      if (!watched.has(filePath)) {
        window.ansiktenAPI?.watchFile(filePath);
        watched.add(filePath);
      }
    });

    watched.forEach(filePath => {
      if (!currentPaths.has(filePath)) {
        window.ansiktenAPI?.unwatchFile(filePath);
        watched.delete(filePath);
      }
    });

  }, [queue]);

  // Cleanup all file watchers only on unmount
  useEffect(() => {
    return () => {
      window.ansiktenAPI?.unwatchAllFiles();
      watchedFilesRef.current.clear();
    };
  }, []);

  // Update backend cache priority (queue files evicted last)
  const priorityHashesTimerRef = useRef(null);
  useEffect(() => {
    if (priorityHashesTimerRef.current) {
      clearTimeout(priorityHashesTimerRef.current);
    }

    priorityHashesTimerRef.current = setTimeout(() => {
      const queueHashes = queue
        .map(item => preprocessingStatus[item.filePath]?.hash)
        .filter(Boolean);

      // Always send, even empty list to clear old priorities
      apiClient.setPriorityCacheHashes(queueHashes).catch(() => {});
    }, 500);

    return () => {
      if (priorityHashesTimerRef.current) {
        clearTimeout(priorityHashesTimerRef.current);
      }
    };
  }, [queue, preprocessingStatus]);

  // Track preprocessing completion for toast notification
  const prevPreprocessingCountRef = useRef({ pending: 0, total: 0 });
  useEffect(() => {
    if (queue.length === 0) return;

    // Count files still preprocessing
    const pendingPreprocessing = queue.filter(item => {
      const status = preprocessingStatus[item.filePath];
      // Still preprocessing if no status yet or in progress
      return !status ||
             (status !== PreprocessingStatus.COMPLETED &&
              status !== PreprocessingStatus.ERROR &&
              status !== PreprocessingStatus.FILE_NOT_FOUND);
    }).length;

    const prev = prevPreprocessingCountRef.current;

    // Show toast when preprocessing completes (was pending, now all done)
    if (prev.pending > 0 && pendingPreprocessing === 0 && queue.length > 0) {
      const completedCount = queue.filter(item =>
        preprocessingStatus[item.filePath] === PreprocessingStatus.COMPLETED
      ).length;
      if (completedCount > 0) {
        showToast(t('fileQueue.toasts.preprocessingComplete', { count: completedCount }), 'success', 3000);
      }
    }

    prevPreprocessingCountRef.current = { pending: pendingPreprocessing, total: queue.length };
  }, [queue, preprocessingStatus, showToast]);

  // Backend connection status - only show toast on RECONNECTION (not initial connect)
  const connectionStateRef = useRef({ prev: null, hasEverConnected: false });
  useEffect(() => {
    const state = connectionStateRef.current;

    if (state.prev === null) {
      state.prev = isConnected;
      if (isConnected) state.hasEverConnected = true;
      return;
    }

    if (state.prev !== isConnected) {
      if (isConnected) {
        if (state.hasEverConnected) {
          showToast(t('fileQueue.toasts.backendReconnected'), 'success', 2500);
        }
        state.hasEverConnected = true;
      } else {
        // Ignore disconnect during rename (WebSocket briefly disconnects during file operations)
        if (renameInProgressRef.current) {
          debug('FileQueue', 'Backend disconnected during rename - ignoring');
        } else {
          showToast(t('fileQueue.toasts.backendDisconnected'), 'error', 4000);
        }
      }
      state.prev = isConnected;
    }
  }, [isConnected, showToast]);

  // Startup toasts - show once after initial load
  const startupToastsShownRef = useRef(false);
  useEffect(() => {
    if (startupToastsShownRef.current) return;

    const showStartupToasts = async () => {
      startupToastsShownRef.current = true;

      // Wait a bit for queue to load
      await new Promise(r => setTimeout(r, 1000));

      // Show queue count if files are queued
      if (queue.length > 0) {
        const pending = queue.filter(q => q.status === 'pending').length;
        if (pending > 0) {
          queueToast(t('fileQueue.toasts.filesInQueue', { total: queue.length, pending }), 'info', 3000);
        }
      }

      // Database stats now shown in StartupStatus - no separate toast needed

      // Check cache status
      try {
        const cacheStatus = await api.get('/api/v1/preprocessing/cache/status');
        if (cacheStatus && cacheStatus.usage_percent > 80) {
          queueToast(
            t('fileQueue.toasts.cacheFull', {
              percent: Math.round(cacheStatus.usage_percent),
              used: Math.round(cacheStatus.total_size_mb),
              max: Math.round(cacheStatus.max_size_mb)
            }),
            'warning',
            5000
          );
        }
      } catch (err) {
        // Non-fatal - skip this toast
        debug('FileQueue', 'Could not fetch cache status:', err.message);
      }
    };

    showStartupToasts();
  }, [queue, queueToast, api]);

  // Check if file is already processed
  const getEligibilityContext = useCallback(() => ({
    fixMode: fixModeRef.current,
    processedFiles: processedFilesRef.current
  }), []);

  const isFileEligible = useCallback((item) => {
    return isFileEligiblePure(item, getEligibilityContext());
  }, [getEligibilityContext]);

  const startNextEligible = useCallback((options = {}) => {
    const { preferIndex = -1, showToastIfNone = true } = options;

    if (!processedFilesLoadedRef.current) {
      debug('FileQueue', 'startNextEligible: BLOCKED - processed files not loaded');
      return false;
    }

    const q = queueRef.current;
    const context = getEligibilityContext();
    const indexToLoad = findNextEligibleIndex(q, context, { preferIndex });

    debug('FileQueue', 'startNextEligible:', { preferIndex, indexToLoad, queueLength: q.length });

    if (indexToLoad >= 0) {
      loadFileRef.current?.(indexToLoad);
      return true;
    }

    if (showToastIfNone && q.length > 0) {
      showToast(t('fileQueue.toasts.allProcessed'), 'info', 5000);
    }
    return false;
  }, [getEligibilityContext, showToast]);

  useEffect(() => {
    if (!processedFilesLoaded) return;
    if (!shouldAutoLoad || queue.length === 0) return;
    setShouldAutoLoad(false);

    if (preprocessingManager.current) {
      const context = getEligibilityContext();
      const eligibleItems = queue.filter(item => isFileEligiblePure(item, context));
      debug('FileQueue', 'Starting preprocessing for', eligibleItems.length, 'eligible items');
      eligibleItems.forEach(item => preprocessingManager.current.addToQueue(item.filePath));
    }

    if (!getAutoLoadPreference()) {
      debug('FileQueue', 'Auto-load disabled in preferences');
      return;
    }

    const preferIndex = savedIndexRef.current;
    debug('FileQueue', 'Auto-load: trying to start with preferIndex:', preferIndex);
    startNextEligible({ preferIndex, showToastIfNone: true });
  }, [shouldAutoLoad, queue, processedFilesLoaded, getEligibilityContext, startNextEligible]);

  const addFiles = useCallback((filePaths, position = 'default') => {
    if (!filePaths || filePaths.length === 0) return;

    const currentProcessedFiles = processedFilesRef.current;
    debug('FileQueue', '>>> addFiles called', {
      count: filePaths.length,
      processedFilesLoaded: processedFilesLoadedRef.current,
      processedFilesSize: currentProcessedFiles.size,
      fixMode: fixModeRef.current
    });

    const effectivePosition = position === 'default' ? getInsertModePreference() : position;

    // Filter out unsupported file types (e.g. XMP sidecars from glob expansion)
    const supportedPaths = filePaths.filter(fp => {
      const ext = fp.split('.').pop()?.toLowerCase();
      return ext && SUPPORTED_EXTENSIONS.has(ext);
    });
    const skippedCount = filePaths.length - supportedPaths.length;
    if (skippedCount > 0) {
      debug('FileQueue', `Filtered out ${skippedCount} unsupported file(s)`);
    }
    if (supportedPaths.length === 0) {
      if (skippedCount > 0) {
        showToast(t('fileQueue.toasts.noSupportedSkipped', { count: skippedCount }), 'warning', 3000);
      }
      return;
    }

    const newItems = supportedPaths.map(filePath => {
      const fileName = filePath.split('/').pop();
      const alreadyProcessed = currentProcessedFiles.has(fileName);
      debug('FileQueue', '>>> addFiles item', { fileName, alreadyProcessed });
      return {
        id: generateId(),
        filePath,
        fileName,
        status: 'pending',
        isAlreadyProcessed: alreadyProcessed,
        error: null
      };
    });

    let addedCount = 0;
    let alreadyProcessedFiles = [];
    setQueue(prev => {
      const existingPaths = new Set(prev.map(item => item.filePath));
      const uniqueNew = newItems.filter(item => !existingPaths.has(item.filePath));
      addedCount = uniqueNew.length;

      const currentFixMode = fixModeRef.current;
      uniqueNew.forEach(item => {
        if (!currentFixMode && item.isAlreadyProcessed) {
          debug('FileQueue', 'Skipping preprocessing (already processed, fix-mode OFF):', item.fileName);
          alreadyProcessedFiles.push(item);
          return;
        }
        if (preprocessingManager.current) {
          preprocessingManager.current.addToQueue(item.filePath);
        }
      });

      if (effectivePosition === 'start') {
        return [...uniqueNew, ...prev];
      } else if (effectivePosition === 'sorted' || effectivePosition === 'alphabetical') {
        const combined = [...prev, ...uniqueNew];
        return combined.sort(naturalSortCompare);
      }
      return [...prev, ...uniqueNew];
    });

    if (newItems.length > 0) {
      const dupeCount = newItems.length - addedCount;
      if (addedCount > 0) {
        let msg = t('fileQueue.toasts.addedFiles', { count: addedCount });
        if (dupeCount > 0) {
          msg += t('fileQueue.toasts.alreadyInQueueSuffix', { count: dupeCount });
        }
        showToast(msg, 'info', 3000);
      } else if (dupeCount > 0) {
        const msg = dupeCount === 1
          ? t('fileQueue.toasts.fileAlreadyInQueue')
          : t('fileQueue.toasts.allFilesAlreadyInQueue', { count: dupeCount });
        showToast(msg, 'info', 2500);
      }
    }

    debug('FileQueue', 'Added', newItems.length, 'files, mode:', effectivePosition);

    // Fetch face stats for already-processed files that weren't preprocessed
    if (alreadyProcessedFiles.length > 0 && api) {
      const filepaths = alreadyProcessedFiles.map(item => item.filePath);
      api.post('/api/v1/statistics/file-stats', { filepaths })
        .then(stats => {
          debug('FileQueue', 'Got file stats for', Object.keys(stats).length, 'files');
          setPreprocessingStatus(prev => {
            const updates = {};
            for (const item of alreadyProcessedFiles) {
              const stat = stats[item.fileName];
              if (stat) {
                updates[item.filePath] = {
                  status: PreprocessingStatus.COMPLETED,
                  faceCount: stat.face_count,
                  persons: stat.persons,
                };
              }
            }
            return { ...prev, ...updates };
          });
        })
        .catch(err => {
          debugWarn('FileQueue', 'Failed to fetch file stats:', err);
        });
    }
  }, [showToast, api]);

  // Sort existing queue alphabetically
  const sortQueue = useCallback(() => {
    setQueue(prev => [...prev].sort(naturalSortCompare));
    showToast(t('fileQueue.toasts.queueSorted'), 'info', 2000);
  }, [showToast]);

  // Remove file from queue
  const removeFile = useCallback((id) => {
    // Find the file to get its path before removing
    const fileToRemove = queue.find(item => item.id === id);
    if (fileToRemove) {
      if (preprocessingManager.current) {
        preprocessingManager.current.removeFile(fileToRemove.filePath);
      }
      // Clear viewer if this was the active file
      if (fileToRemove.filePath === currentFileRef.current) {
        emit('clear-image');
        currentFileRef.current = null;
      }
    }

    setQueue(prev => prev.filter(item => item.id !== id));
    // Adjust currentIndex if needed
    setCurrentIndex(prev => {
      const removedIndex = queue.findIndex(item => item.id === id);
      if (removedIndex < prev) return prev - 1;
      if (removedIndex === prev) return -1;
      return prev;
    });
  }, [queue, emit]);

  // Clear all files
  const clearQueue = useCallback(() => {
    // Stop all preprocessing
    if (preprocessingManager.current) {
      preprocessingManager.current.stop();
    }
    // Clear viewer if there was an active file
    if (currentFileRef.current) {
      emit('clear-image');
      currentFileRef.current = null;
    }
    setQueue([]);
    setCurrentIndex(-1);
  }, [emit]);

  // Clear completed files
  // When fix-mode is OFF, also clear already-processed files (they're considered done)
  // When fix-mode is ON, keep already-processed files (they need reprocessing)
  const clearCompleted = useCallback(() => {
    const currentFixMode = fixModeRef.current;
    const currentQueue = queueRef.current;
    const currentVisibleIds = visibleIdsRef.current;

    const isDone = (item) => {
      if (item.status === 'completed') return true;
      if (!currentFixMode && item.isAlreadyProcessed) return true;
      return false;
    };

    // Check if active file will be removed
    const activeFile = currentQueue.find(item => item.filePath === currentFileRef.current);
    const activeWillBeRemoved = activeFile && isDone(activeFile) &&
      (!currentVisibleIds || currentVisibleIds.has(activeFile.id));

    if (activeWillBeRemoved) {
      emit('clear-image');
      currentFileRef.current = null;
    }

    setQueue(prev => prev.filter(item => {
      if (!isDone(item)) return true;
      // When filter is active, only clear visible completed items
      if (currentVisibleIds && !currentVisibleIds.has(item.id)) return true;
      return false;
    }));
    setCurrentIndex(-1);
    setSelectedFiles(new Set());
  }, [emit]);

  // Clear selected files
  const clearSelected = useCallback(() => {
    const currentQueue = queueRef.current;

    // Check if active file is among selected
    const activeFile = currentQueue.find(item => item.filePath === currentFileRef.current);
    if (activeFile && selectedFiles.has(activeFile.id)) {
      emit('clear-image');
      currentFileRef.current = null;
    }

    setQueue(prev => prev.filter(item => !selectedFiles.has(item.id)));
    setCurrentIndex(-1);
    setSelectedFiles(new Set());
  }, [selectedFiles, emit]);

  // Select all files
  const selectAll = useCallback(() => {
    setSelectedFiles(new Set(queue.map(item => item.id)));
  }, [queue]);

  // Deselect all files
  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  // Toggle file selection
  const toggleFileSelection = useCallback((id) => {
    setSelectedFiles(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  // Track last selected index for shift-click range selection
  const lastSelectedIndexRef = useRef(-1);

  const loadFile = useCallback(async (index) => {
    const currentQueue = queueRef.current;
    debug('FileQueue', '>>> loadFile called', {
      index,
      queueLength: currentQueue.length,
      processedFilesLoaded: processedFilesLoadedRef.current,
      processedFilesSize: processedFiles.size,
      fixMode: fixModeRef.current
    });

    if (index < 0 || index >= currentQueue.length) {
      debug('FileQueue', 'loadFile: Invalid index', index, 'queue length:', currentQueue.length);
      return;
    }

    if (!processedFilesLoadedRef.current) {
      debug('FileQueue', 'loadFile: Queuing load - processed files not loaded yet');
      pendingManualLoadRef.current = index;
      showToast(t('fileQueue.toasts.loadingFileList'), 'info', 2000);
      return;
    }

    const item = currentQueue[index];
    const currentProcessedFiles = processedFilesRef.current;
    const inSetCheck = currentProcessedFiles.has(item.fileName);
    
    debug('FileQueue', '>>> loadFile checks', {
      fileName: item.fileName,
      'item.isAlreadyProcessed': item.isAlreadyProcessed,
      'processedFilesRef.current.has()': inSetCheck,
      'processedFilesRef.current.size': currentProcessedFiles.size,
      fixMode: fixModeRef.current
    });

    const fileIsProcessed = item.isAlreadyProcessed || inSetCheck;
    const skipAutoDetect = !fixModeRef.current && fileIsProcessed;
    
    debug('FileQueue', '>>> loadFile decision', {
      fileIsProcessed,
      skipAutoDetect,
      'will proceed': !skipAutoDetect
    });

    if (skipAutoDetect) {
      debug('FileQueue', 'loadFile: BLOCKED - file already processed, fix-mode OFF');
      showToast(t('fileQueue.toasts.fileAlreadyProcessed', { fileName: item.fileName }), 'info', 5000);
      return;
    }

    // Ensure image viewer tab is visible/focused
    if (window.workspace?.openModule) {
      window.workspace.openModule('image-viewer');
    }

    // Wait for ImageViewer to mount and register its load-image handler.
    // openModule may create or activate the tab, but React renders async —
    // emitting before the component mounts loses the event.
    if (!hasListeners('load-image')) {
      debug('FileQueue', 'Waiting for load-image listener (ImageViewer mounting)...');
      const ready = await waitForListeners('load-image', 2000, 10);
      if (!ready) {
        debugWarn('FileQueue', 'Timeout waiting for ImageViewer - emitting anyway');
      }
    }

    if (fixModeRef.current && item.isAlreadyProcessed) {
      try {
        debug('FileQueue', 'Undoing file for fix mode:', item.fileName);
        await api.post('/api/v1/management/undo-file', {
          filename_pattern: item.fileName
        });
        await loadProcessedFiles();
        showToast(t('fileQueue.toasts.undid', { fileName: item.fileName }), 'info', 2500);
      } catch (err) {
        debugError('FileQueue', 'Failed to undo file:', err);
        showToast(t('fileQueue.toasts.undoFailed', { fileName: item.fileName }), 'error', 3000);
      }
    }

    setQueue(prev => prev.map((q, i) => ({
      ...q,
      status: i === index ? 'active' : (q.status === 'active' ? 'pending' : q.status)
    })));

    setCurrentIndex(index);
    currentFileRef.current = item.filePath;

    debug('FileQueue', 'Emitting load-image for:', item.filePath, { skipAutoDetect });
    emit('load-image', { imagePath: item.filePath, skipAutoDetect });
    emitQueueStatus(index);
  }, [api, loadProcessedFiles, emit, hasListeners, waitForListeners, showToast, emitQueueStatus]);

  loadFileRef.current = loadFile;

  // Force reprocess a file (when fix-mode is OFF but user wants to reprocess)
  const forceReprocess = useCallback(async (index) => {
    const currentQueue = queueRef.current;
    if (index < 0 || index >= currentQueue.length) return;

    const item = currentQueue[index];
    if (!item.isAlreadyProcessed) return;

    debug('FileQueue', 'Force reprocess requested for:', item.fileName);

    try {
      // 1. Undo the file in backend (remove from processed_files.jsonl)
      await api.post('/api/v1/management/undo-file', {
        filename_pattern: item.fileName
      });

      // 2. Clear from preprocessing completed cache
      if (preprocessingManager.current) {
        preprocessingManager.current.removeFile(item.filePath);
      }

      // 3. Refresh processed files list
      await loadProcessedFiles();

      // 4. Update queue item to not be marked as already processed
      setQueue(prev => prev.map((q, i) => 
        i === index ? { ...q, isAlreadyProcessed: false } : q
      ));

      // 5. Add to preprocessing queue with priority
      if (preprocessingManager.current) {
        preprocessingManager.current.addToQueue(item.filePath, { priority: true });
      }

      showToast(t('fileQueue.toasts.reprocessing', { fileName: item.fileName }), 'info', 2500);

      // 6. Load the file
      loadFile(index);
    } catch (err) {
      debugError('FileQueue', 'Failed to force reprocess:', err);
      showToast(t('fileQueue.toasts.reprocessFailed', { fileName: item.fileName }), 'error', 3000);
    }
  }, [api, loadProcessedFiles, loadFile, showToast]);

  // Handle file item click with modifier key support
  // Single click = select, Double click = load
  const handleItemClick = useCallback((index, event) => {
    const item = queue[index];
    if (!item) return;

    // Shift+Click: Select range
    if (event.shiftKey && lastSelectedIndexRef.current >= 0) {
      event.preventDefault(); // Prevent text selection
      const start = Math.min(lastSelectedIndexRef.current, index);
      const end = Math.max(lastSelectedIndexRef.current, index);
      const rangeIds = queue.slice(start, end + 1).map(q => q.id);

      setSelectedFiles(prev => {
        const next = new Set(prev);
        rangeIds.forEach(id => next.add(id));
        return next;
      });
      // Don't update lastSelectedIndex on shift-click (keep anchor)
      return;
    }

    // Cmd/Ctrl+Click: Toggle selection without loading
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault();
      toggleFileSelection(item.id);
      lastSelectedIndexRef.current = index;
      return;
    }

    // Single click: Focus the item (visual highlight only, no checkbox)
    lastSelectedIndexRef.current = index;
    setFocusedIndex(index);
  }, [queue, toggleFileSelection]);

  // Handle double-click to load file
  const handleItemDoubleClick = useCallback((index) => {
    loadFile(index);
  }, [loadFile]);

  // Execute pending auto-load (after loadFile is defined)
  useEffect(() => {
    if (pendingAutoLoad >= 0) {
      const indexToLoad = pendingAutoLoad;
      setPendingAutoLoad(-1); // Clear to prevent re-trigger

      // Wait for workspace to be ready - check immediately, then poll quickly
      const waitForWorkspace = () => {
        if (window.workspace?.openModule) {
          debug('FileQueue', 'Workspace ready, auto-loading file at index', indexToLoad);
          loadFile(indexToLoad);
        } else {
          setTimeout(waitForWorkspace, 50); // Fast polling
        }
      };

      // Start checking immediately (no initial delay)
      waitForWorkspace();
    }
  }, [pendingAutoLoad, loadFile]);

  const advanceToNext = useCallback(() => {
    const currentQueue = queueRef.current;
    const nextIndex = currentQueue.findIndex((item, i) => 
      i !== currentIndex && isFileEligible(item)
    );

    if (nextIndex >= 0) {
      loadFile(nextIndex);
    } else {
      debug('FileQueue', 'No more eligible files');
      setCurrentIndex(-1);
    }
  }, [currentIndex, loadFile, isFileEligible]);

  // Skip current file
  const skipCurrent = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  // Fetch rename preview from backend
  // Uses queueRef to always get current queue (avoids stale closure issues)
  const fetchRenamePreview = useCallback(async () => {
    // Include files eligible for rename:
    // - completed: reviewed this session
    // - isAlreadyProcessed (when fix-mode OFF): already in database, includes active files being re-viewed
    const currentQueue = queueRef.current;
    const currentFixMode = fixModeRef.current;
    const dirty = dirtyPathsRef.current;
    const eligiblePaths = currentQueue
      .filter(q => isRenameEligible(q, currentFixMode, dirty))
      .map(q => q.filePath);

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

      // Build lookup: path -> { newName, status, persons, sidecars }
      const lookup = {};
      for (const item of result.items) {
        lookup[item.original_path] = {
          newName: item.new_name,
          status: item.status,
          persons: item.persons || [],
          sidecars: item.sidecars || []
        };
      }
      setPreviewData(lookup);
      debug('FileQueue', 'Fetched rename preview for', eligiblePaths.length, 'files');
    } catch (err) {
      debugError('FileQueue', 'Failed to fetch rename preview:', err);
      setPreviewData({});
    }
  }, [api, showToast]);

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

    const currentVisibleIds = visibleIdsRef.current;
    const eligiblePaths = queue
      .filter(q => {
        const isEligible = isRenameEligible(q, currentFixMode, dirtyPathsRef.current);
        if (hasSelection) return isEligible && selectedFiles.has(q.id);
        if (currentVisibleIds) return isEligible && currentVisibleIds.has(q.id);
        return isEligible;
      })
      .map(q => q.filePath);

    if (eligiblePaths.length === 0) return;

    const requireConfirmation = getRequireRenameConfirmation();

    if (requireConfirmation) {
      const selectionNote = hasSelection ? t('fileQueue.dialogs.renameConfirmSelection') : '';
      const confirmed = window.confirm(
        t('fileQueue.dialogs.renameConfirm', {
          count: eligiblePaths.length,
          selection: selectionNote
        })
      );
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

      const renamedCount = result.renamed?.length || 0;
      const skippedCount = result.skipped?.length || 0;
      const errorCount = result.errors?.length || 0;

      // Update queue with new filenames
      if (renamedCount > 0) {
        const renamedMap = {};
        for (const r of result.renamed) {
          renamedMap[r.original] = r.new;
        }

        setQueue(prev => prev.map(item => {
          if (renamedMap[item.filePath]) {
            const newPath = renamedMap[item.filePath];
            return {
              ...item,
              filePath: newPath,
              fileName: newPath.split('/').pop()
            };
          }
          return item;
        }));

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
        setPreprocessingStatus(prev => {
          const updated = { ...prev };
          for (const [oldPath, newPath] of Object.entries(renamedMap)) {
            if (updated[oldPath]) {
              updated[newPath] = updated[oldPath];
              delete updated[oldPath];
            }
          }
          return updated;
        });
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
  }, [queue, api, showPreviewNames, fetchRenamePreview, showToast, selectedFiles]);

  // Listen for review-complete event
  useModuleEvent('review-complete', useCallback(({ imagePath, success, reviewedFaces }) => {
    debug('FileQueue', 'Review complete:', imagePath, success, 'faces:', reviewedFaces?.length);

    // The review is persisted by the time this fires, so the file is safe to rename again.
    setDirtyPaths(prev => {
      if (!prev.has(imagePath)) return prev;
      const next = new Set(prev);
      next.delete(imagePath);
      return next;
    });

    if (success && preprocessingManager.current) {
      preprocessingManager.current.markDone(imagePath);
    }

    if (currentFileRef.current === imagePath) {
      const currentQueue = queueRef.current;
      const currentIdx = currentQueue.findIndex(item => item.filePath === imagePath);
      const fileName = imagePath.split('/').pop();
      const faceCount = reviewedFaces?.length || 0;

      const nextIdx = currentQueue.findIndex((item) => 
        item.filePath !== imagePath && isFileEligible(item)
      );

      debug('FileQueue', 'Current index:', currentIdx, 'Next index:', nextIdx, 'Queue length:', currentQueue.length);

      setQueue(prev => prev.map(item => {
        if (item.filePath === imagePath) {
          return {
            ...item,
            status: success ? 'completed' : 'error',
            reviewedFaces: reviewedFaces || []
          };
        }
        return item;
      }));

      const prevDone = currentQueue.filter(q => q.status === 'completed').length;
      const newDone = success ? prevDone + 1 : prevDone;
      // Patch the just-reviewed file to 'completed' so it isn't also counted as
      // preprocessed (setQueue above is async, so currentQueue is still stale here).
      const patchedQueue = success
        ? currentQueue.map(item =>
            item.filePath === imagePath ? { ...item, status: 'completed' } : item
          )
        : currentQueue;
      emit('queue-status', {
        total: currentQueue.length,
        current: nextIdx >= 0 ? nextIdx : currentIdx,
        done: newDone,
        remaining: Math.max(0, currentQueue.length - newDone),
        preprocessed: countPreprocessed(patchedQueue)
      });

      // Show toast for review result
      if (success) {
        showToast(t('fileQueue.toasts.savedReview', { fileName, count: faceCount }), 'success', 2500);
      } else {
        showToast(t('fileQueue.toasts.saveReviewFailed', { fileName }), 'error', 4000);
      }

      // Clear preview data when queue changes (force re-fetch)
      setPreviewData(null);

      // If showing preview names, re-fetch after a short delay
      if (showPreviewNames) {
        setTimeout(() => fetchRenamePreview(), 200);
      }

      // Refresh processed files list
      loadProcessedFiles();

      // Auto-advance to next
      if (autoAdvance && nextIdx >= 0) {
        debug('FileQueue', 'Auto-advancing to index:', nextIdx);
        setTimeout(() => loadFile(nextIdx), 300);
      } else if (nextIdx < 0) {
        debug('FileQueue', 'No more pending files (or all skipped due to fix-mode OFF)');
        setCurrentIndex(-1);
        // Show queue complete toast
        showToast(t('fileQueue.toasts.queueComplete'), 'success', 4000);
      }
    }
  }, [autoAdvance, loadFile, loadProcessedFiles, showToast, emit, isFileEligible]));

  // Soft-delete a file to the app trash, then advance to the next eligible file.
  // The path is supplied by the caller (the visible review surface via
  // 'file-queue:trash'), NOT read from this module's own current-file ref —
  // the queue module stays mounted in other layouts (e.g. culling) where that
  // ref is stale, so trusting it would trash the wrong file.
  const deleteFile = useCallback(async (targetPath) => {
    const path = targetPath || null;
    if (!path) {
      showToast(t('fileQueue.toasts.nothingToDelete'), 'info', 2500);
      return;
    }
    const beforeQueue = queueRef.current;
    const idx = beforeQueue.findIndex((item) => item.filePath === path);
    if (idx < 0) return;
    const victim = beforeQueue[idx];
    const fileName = path.split('/').pop();
    // First eligible file that isn't the one being deleted (matches the
    // review-complete advance semantics), captured before the optimistic remove.
    const nextPath = beforeQueue.find(
      (item) => item.filePath !== path && isFileEligible(item)
    )?.filePath || null;

    // Optimistic removal so the UI reacts immediately.
    const wasCurrent = currentFileRef.current === path;
    setQueue((prev) => prev.filter((item) => item.filePath !== path));
    if (wasCurrent) currentFileRef.current = null;

    let trashedId = null;
    try {
      const res = await api.post('/api/v1/culling/trash', { paths: [path] });
      trashedId = res?.trashed?.[0]?.id || null;
      if (!trashedId) {
        // 200 with errors[] means the file is still on disk (lock/permission/race).
        showToast(res?.errors?.[0]?.error || t('fileQueue.toasts.trashFailed', { fileName }), 'error', 5000);
      }
    } catch (err) {
      showToast(err.message || String(err), 'error', 5000);
    }

    if (!trashedId) {
      // Roll back the optimistic removal.
      setQueue((prev) => {
        if (prev.some((item) => item.filePath === path)) return prev;
        const copy = [...prev];
        copy.splice(Math.min(idx, copy.length), 0, victim);
        return copy;
      });
      if (wasCurrent) currentFileRef.current = path;
      return;
    }

    // The file is gone — drop any dirty/unsaved-review marker for it so it can't
    // hold up a later rename of the remaining files.
    setDirtyPaths((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Set(prev);
      next.delete(path);
      return next;
    });

    deleteUndoStackRef.current.push({ id: trashedId, item: victim, index: idx });
    showToast(t('fileQueue.toasts.movedToTrash', { fileName }), 'info', 4000);

    // Advance to the next eligible file (if any), reading the freshly-synced
    // queue ref after the removal has rendered.
    if (autoAdvance && nextPath) {
      setTimeout(() => {
        const nextIdx = queueRef.current.findIndex((item) => item.filePath === nextPath);
        if (nextIdx >= 0) loadFileRef.current?.(nextIdx);
      }, 250);
    } else {
      setCurrentIndex(-1);
    }
  }, [api, autoAdvance, isFileEligible, showToast]);

  // Undo the most recent delete-to-trash: restore the file and re-insert it into
  // the queue at its original position. Bound to Cmd+Shift+Backspace (a dedicated
  // accelerator, NOT Cmd+Z, which is already Review's face-undo).
  const undoDeleteFile = useCallback(async () => {
    const stack = deleteUndoStackRef.current;
    if (stack.length === 0) {
      showToast(t('fileQueue.toasts.nothingToUndo'), 'info', 2500);
      return;
    }
    while (stack.length > 0) {
      const entry = stack.pop();
      try {
        const res = await api.post('/api/v1/culling/restore', { ids: [entry.id] });
        if (res?.restored?.length > 0) {
          setQueue((prev) => {
            if (prev.some((item) => item.filePath === entry.item.filePath)) return prev;
            const copy = [...prev];
            copy.splice(Math.min(entry.index, copy.length), 0, entry.item);
            return copy;
          });
          const fileName = entry.item.filePath.split('/').pop();
          showToast(t('fileQueue.toasts.restoredFromTrash', { fileName }), 'success', 3000);
          setTimeout(() => {
            const ri = queueRef.current.findIndex((item) => item.filePath === entry.item.filePath);
            if (ri >= 0) loadFileRef.current?.(ri);
          }, 250);
          return;
        }
        // Entry no longer in trash (e.g. emptied) — try the next one down.
      } catch (err) {
        showToast(err.message || String(err), 'error', 5000);
        return;
      }
    }
    // Stack drained without a successful restore (e.g. trash emptied).
    showToast(t('fileQueue.toasts.nothingToUndo'), 'info', 2500);
  }, [api, showToast]);

  // Trash/undo requests come from the visible review surface (ReviewModule),
  // which passes the exact file path — see deleteFile's comment for why this
  // module never reads its own (possibly stale) current-file ref here.
  useModuleEvent('file-queue:trash', useCallback(({ imagePath } = {}) => {
    deleteFile(imagePath);
  }, [deleteFile]));
  useModuleEvent('file-queue:undo-trash', undoDeleteFile);

  // Track files whose review has unsaved changes; while dirty they're held out of
  // rename so a rename can't read the database before a just-added manual face persists.
  useModuleEvent('review-dirty', useCallback(({ imagePath, dirty }) => {
    if (!imagePath) return;
    setDirtyPaths(prev => {
      const has = prev.has(imagePath);
      if (dirty === has) return prev;
      const next = new Set(prev);
      if (dirty) next.add(imagePath);
      else next.delete(imagePath);
      return next;
    });
  }, []));

  // Listen for faces-detected event to update face count for the detected file
  // This updates the face count when detection completes (not just from preprocessing)
  // Uses imagePath from event to avoid race conditions when user clicks another file during detection
  useModuleEvent('faces-detected', useCallback(({ faces, imagePath }) => {
    if (!imagePath) return;

    const faceCount = faces?.length ?? 0;
    debug('FileQueue', 'Faces detected for file:', imagePath, `(${faceCount} faces)`);

    // Update preprocessing status with actual detected face count
    setPreprocessingStatus(prev => ({
      ...prev,
      [imagePath]: {
        ...(prev[imagePath] || {}),
        status: PreprocessingStatus.COMPLETED,
        faceCount
      }
    }));
  }, []));

  // Open file dialog
  const openFileDialog = useCallback(async () => {
    try {
      // Try multi-file dialog first
      let filePaths = await window.ansiktenAPI?.invoke('open-multi-file-dialog');

      // Fall back to single file dialog
      if (!filePaths) {
        const singlePath = await window.ansiktenAPI?.invoke('open-file-dialog');
        if (singlePath) {
          filePaths = [singlePath];
        }
      }

      if (filePaths && filePaths.length > 0) {
        addFiles(filePaths);

        if (queue.length === 0 && filePaths.length > 0) {
          setTimeout(() => startNextEligible(), 100);
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to open file dialog:', err);
    }
  }, [addFiles, queue.length, loadFile]);

  // Open folder dialog
  const openFolderDialog = useCallback(async () => {
    try {
      const filePaths = await window.ansiktenAPI?.invoke('open-folder-dialog');

      if (filePaths && filePaths.length > 0) {
        addFiles(filePaths);

        if (queue.length === 0 && filePaths.length > 0) {
          setTimeout(() => startNextEligible(), 100);
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to open folder dialog:', err);
    }
  }, [addFiles, queue.length, loadFile]);

  // Drag-and-drop handlers
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    const files = e.dataTransfer.files;
    if (!files || files.length === 0) return;

    // Filter for supported file types and extract paths
    const validPaths = [];
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (ext && SUPPORTED_EXTENSIONS.has(ext)) {
        // In Electron, file.path gives the full path
        if (file.path) {
          validPaths.push(file.path);
        }
      }
    }

    if (validPaths.length > 0) {
      debug('FileQueue', `Dropped ${validPaths.length} valid files`);
      addFiles(validPaths);

      // Auto-start if queue was empty
      if (queue.length === 0) {
        setTimeout(() => startNextEligible(), 100);
      }
    } else {
      showToast(t('fileQueue.toasts.noSupportedFound'), 'warning');
    }
  }, [addFiles, queue.length, startNextEligible, showToast]);

  useEffect(() => {
    const handleQueueFiles = ({ files, position, startQueue, clear }) => {
      debug('FileQueue', `Received ${files.length} files from main process (position: ${position}, clear: ${clear})`);
      // --clear empties the queue first; alone (no files) it just empties.
      if (clear) {
        clearQueue();
        if (files.length === 0) return;
      }
      addFiles(files, position || 'default');
      if (startQueue && files.length > 0) {
        setTimeout(() => startNextEligible(), 100);
      }
    };

    const off = window.ansiktenAPI?.on('queue-files', handleQueueFiles);
    return () => off?.();
  }, [addFiles, startNextEligible, clearQueue]);

  // Expose fileQueue API globally for programmatic access
  useEffect(() => {
    // Helper to expand glob patterns
    const expandAndAdd = async (pattern, position) => {
      if (pattern.includes('*') || pattern.includes('?')) {
        // It's a glob pattern - expand it
        const files = await window.ansiktenAPI?.invoke('expand-glob', pattern);
        if (files && files.length > 0) {
          addFiles(files, position);
          debug('FileQueue', `Expanded glob "${pattern}" to ${files.length} files`);
        } else {
          debugWarn('FileQueue', `No files matched pattern "${pattern}"`);
        }
      } else {
        // Direct path(s)
        addFiles(Array.isArray(pattern) ? pattern : [pattern], position);
      }
    };

    window.fileQueue = {
      add: (pattern, position = 'default') => expandAndAdd(pattern, position),
      addToStart: (pattern) => expandAndAdd(pattern, 'start'),
      addToEnd: (pattern) => expandAndAdd(pattern, 'end'),
      addSorted: (pattern) => expandAndAdd(pattern, 'sorted'),
      sort: sortQueue,
      clear: clearQueue,
      clearCompleted: clearCompleted,
      loadFile: loadFile,
      start: () => startNextEligible({ showToastIfNone: false }),
      getQueue: () => queueRef.current,
      getCurrentIndex: () => currentIndex
    };
    return () => { delete window.fileQueue; };
  }, [addFiles, sortQueue, clearQueue, clearCompleted, loadFile, startNextEligible, currentIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (currentIndex >= 0 && listRef.current) {
      const activeEl = listRef.current.querySelector('.file-item.active');
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentIndex]);

  // Keyboard shortcuts
  const openFilter = useCallback(() => {
    setShowFilter(true);
    // Focus input on next tick (after React renders)
    requestAnimationFrame(() => filterInputRef.current?.focus());
  }, []);

  const closeFilter = useCallback(() => {
    setShowFilter(false);
    setFilterText('');
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      // Skip keyboard handling when this tab is hidden in FlexLayout
      if (node && !node.isVisible()) return;

      // Escape closes filter when filter input is focused
      if (e.key === 'Escape' && showFilter) {
        e.preventDefault();
        closeFilter();
        moduleRef.current?.focus();
        return;
      }

      // Allow Cmd+F anywhere in the module to open filter
      if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
        const module = moduleRef.current;
        const hasFocus = module && (
          module === document.activeElement ||
          module.contains(document.activeElement)
        );
        if (hasFocus) {
          e.preventDefault();
          e.stopPropagation();
          openFilter();
          return;
        }
      }

      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      // / (slash) - open filter (vim-style search)
      if (e.key === '/') {
        e.preventDefault();
        openFilter();
        return;
      }

      // Cmd/Ctrl+A - select all files (prevent text selection)
      if (e.key === 'a' && (e.metaKey || e.ctrlKey)) {
        // Check if file-queue-module has focus or contains the active element
        const module = moduleRef.current;
        const hasFocus = module && (
          module === document.activeElement ||
          module.contains(document.activeElement)
        );
        if (hasFocus) {
          e.preventDefault();
          e.stopPropagation();
          if (selectedFiles.size === queue.length && queue.length > 0) {
            deselectAll();
          } else {
            selectAll();
          }
          return;
        }
      }

      // N - next file
      if (e.key === 'n' || e.key === 'N') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          advanceToNext();
        }
      }

      // P - previous file
      if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        const prevIndex = currentIndex - 1;
        if (prevIndex >= 0) {
          loadFile(prevIndex);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [advanceToNext, currentIndex, loadFile, queue, selectedFiles.size, selectAll, deselectAll, showFilter, openFilter, closeFilter]);

  // Calculate stats
  // When fix-mode is OFF, already-processed files count as "done" (they're skipped)
  // When fix-mode is ON, only actually completed files count
  const completedCount = queue.filter(q =>
    q.status === 'completed' || (!fixMode && q.isAlreadyProcessed)
  ).length;

  const hasSelection = selectedFiles.size > 0;

  const displayOrder = useMemo(() => {
    const all = queue.map((item, i) => ({ item, originalIndex: i }));
    if (!filterText) return all;

    const matcher = compileFilter(filterText);

    return all.filter(({ item }) => {
      // Build searchable text: filename + detected/confirmed person names
      const pp = preprocessingStatus[item.filePath];
      const names = previewData?.[item.filePath]?.persons
        || item.reviewedFaces?.map(f => f.personName).filter(Boolean)
        || pp?.persons
        || [];
      const searchText = [item.fileName, ...names].join(' ');
      return matcher(searchText);
    });
  }, [queue, filterText, preprocessingStatus, previewData]);

  // Set of IDs currently visible after filtering — used for action scoping
  const visibleIds = useMemo(() => {
    if (!filterText) return null; // null = no filter active, all visible
    return new Set(displayOrder.map(({ item }) => item.id));
  }, [displayOrder, filterText]);
  visibleIdsRef.current = visibleIds;

  const activeFile = currentIndex >= 0 ? queue[currentIndex] : null;

  return (
    <div
      ref={moduleRef}
      className={`module-container file-queue-module ${hasSelection ? 'has-selection' : ''} ${isDragOver ? 'drag-over' : ''}`}
      tabIndex={0}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="module-header">
        <span className="module-title">{t('fileQueue.title')}</span>
        <div className="file-queue-actions">
          <button
            className="btn-icon"
            onClick={openFileDialog}
            title={t('fileQueue.buttons.addFiles')}
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            className="btn-icon"
            onClick={openFolderDialog}
            title={t('fileQueue.buttons.addFolder')}
          >
            <Icon name="folder-plus" size={14} />
          </button>
          <button
            className="btn-icon"
            onClick={sortQueue}
            title={t('fileQueue.buttons.sortQueue')}
            disabled={queue.length < 2}
          >
            <Icon name="sort" size={14} />
          </button>
          <button
            className="btn-icon"
            onClick={() => setAutoAdvance(!autoAdvance)}
            title={autoAdvance ? t('fileQueue.buttons.autoAdvanceOn') : t('fileQueue.buttons.autoAdvanceOff')}
          >
            <Icon name={autoAdvance ? 'play' : 'pause'} size={14} />
          </button>
        </div>
      </div>

      {/* Fix mode toggle */}
      <div className="file-queue-toolbar">
        <label className="fix-mode-toggle">
          <input
            type="checkbox"
            checked={fixMode}
            onChange={(e) => setFixMode(e.target.checked)}
          />
          <span>{t('fileQueue.toggles.fixMode')}</span>
        </label>
        {completedCount > 0 && (
          <label className="preview-toggle">
            <input
              type="checkbox"
              checked={showPreviewNames}
              onChange={handlePreviewToggle}
            />
            <span>{t('fileQueue.toggles.showNewNames')}</span>
          </label>
        )}
        {queue.length > 0 && (
          <>
            {selectedFiles.size > 0 && (
              <button
                className="btn-secondary"
                onClick={clearSelected}
                title={t('fileQueue.buttons.clearSelectedTitle')}
              >
                {t('fileQueue.buttons.clearSelected')}
              </button>
            )}
            {completedCount > 0 && selectedFiles.size === 0 && (
              <button
                className="btn-secondary"
                onClick={clearCompleted}
                title={t('fileQueue.buttons.clearDoneTitle')}
              >
                {t('fileQueue.buttons.clearDone')}
              </button>
            )}
            <button
              className="btn-secondary"
              onClick={clearQueue}
              title={t('fileQueue.buttons.clearAllTitle')}
            >
              {t('fileQueue.buttons.clearAll')}
            </button>
          </>
        )}
      </div>

      {/* Filter bar */}
      {showFilter && (
        <div className="file-queue-filter-bar">
          <span className="filter-icon">/</span>
          <input
            ref={filterInputRef}
            type="text"
            className="filter-input"
            placeholder={t('fileQueue.filter.placeholder')}
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                closeFilter();
                moduleRef.current?.focus();
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                filterInputRef.current?.blur();
              }
            }}
          />
          {filterText && (
            <span className="filter-count">
              {displayOrder.length}/{queue.length}
            </span>
          )}
          <button
            className="btn-icon filter-close"
            onClick={closeFilter}
            title={t('fileQueue.filter.clearTitle')}
          >
            <Icon name="close" size={12} />
          </button>
        </div>
      )}

      {/* Current file status bar */}
      {activeFile && (
        <div className="current-file-bar" onClick={() => {
          const activeEl = listRef.current?.querySelector('.file-item.active');
          activeEl?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }}>
          <Icon name="play" size={12} />
          <span className="current-file-name">{activeFile.fileName}</span>
          <span className="current-file-hint">{t('fileQueue.currentFile.scrollHint')}</span>
        </div>
      )}

      {/* File list */}
      <div ref={listRef} className="module-body file-queue-list">
        {queue.length === 0 ? (
          <div className="empty-state">
            <p>{t('fileQueue.emptyStates.noFiles')}</p>
            <p className="hint">{t('fileQueue.emptyStates.addHint')}</p>
          </div>
        ) : (
          displayOrder.map(({ item, originalIndex }) => (
            <FileQueueItem
              key={item.id}
              item={item}
              index={originalIndex}
              isActive={originalIndex === currentIndex}
              isFocused={originalIndex === focusedIndex}
              isSelected={selectedFiles.has(item.id)}
              onClick={(e) => handleItemClick(originalIndex, e)}
              onDoubleClick={() => handleItemDoubleClick(originalIndex)}
              onToggleSelect={() => toggleFileSelection(item.id)}
              onRemove={() => removeFile(item.id)}
              onForceReprocess={() => forceReprocess(originalIndex)}
              fixMode={fixMode}
              preprocessingStatus={preprocessingStatus[item.filePath]}
              showPreview={showPreviewNames}
              previewInfo={previewData?.[item.filePath]}
            />
          ))
        )}
      </div>

      {/* Footer with progress */}
      {queue.length > 0 && (
        <div className="module-footer file-queue-footer">
          <div className="file-queue-progress">
            <span className="progress-text">
              {completedCount}/{queue.length}
            </span>
            <div className="progress-bar">
              <div
                className="progress-fill"
                style={{ width: `${(completedCount / queue.length) * 100}%` }}
              />
            </div>
          </div>
          {getNotificationPreference('showStatusIndicator') && (
            <div className="preprocessing-status">
              {preprocessingPaused ? (
                <span className="status-paused" title={t('fileQueue.preprocessing.bufferedTitle')}>
                  <Icon name="layers" size={12} /> {t('fileQueue.preprocessing.buffered')}
                </span>
              ) : queue.some(q => {
                const status = preprocessingStatus[q.filePath];
                return status && status.status !== PreprocessingStatus.COMPLETED &&
                       status.status !== PreprocessingStatus.ERROR &&
                       status.status !== PreprocessingStatus.FILE_NOT_FOUND;
              }) ? (
                <span className="status-active" title={t('fileQueue.preprocessing.processingTitle')}>
                  <Icon name="refresh" size={12} className="spinning" /> {t('fileQueue.preprocessing.processing')}
                </span>
              ) : (
                <span className="status-ready" title={t('fileQueue.preprocessing.readyTitle')}>
                  <Icon name="check" size={12} /> {t('fileQueue.preprocessing.ready')}
                </span>
              )}
            </div>
          )}
          <div className="file-queue-controls">
            {(() => {
              const hasSelection = selectedFiles.size > 0;
              const isEligible = q => isRenameEligible(q, fixMode, dirtyPaths);
              let renameCount, renameLabel;
              if (hasSelection) {
                renameCount = queue.filter(q => selectedFiles.has(q.id) && isEligible(q)).length;
                renameLabel = t('fileQueue.buttons.renameSelected', { count: renameCount });
              } else if (visibleIds) {
                renameCount = queue.filter(q => visibleIds.has(q.id) && isEligible(q)).length;
                renameLabel = t('fileQueue.buttons.renameFiltered', { count: renameCount });
              } else {
                // Use the gated predicate (not completedCount) so the count excludes
                // files transiently held out of rename by unsaved review changes.
                renameCount = queue.filter(isEligible).length;
                renameLabel = t('fileQueue.buttons.rename', { count: renameCount });
              }
              return renameCount > 0 && (
                <button
                  className="btn-secondary"
                  onClick={handleRename}
                  disabled={renameInProgress}
                  title={hasSelection ? t('fileQueue.buttons.renameSelectedTitle') : visibleIds ? t('fileQueue.buttons.renameFilteredTitle') : t('fileQueue.buttons.renameTitle')}
                >
                  {renameInProgress ? t('fileQueue.buttons.renaming') : renameLabel}
                </button>
              );
            })()}
            {currentIndex >= 0 ? (
              <button className="btn-secondary" onClick={skipCurrent}>
                {t('fileQueue.buttons.skip')} <Icon name="skip-next" size={12} />
              </button>
            ) : queue.some(isFileEligible) ? (
              <button className="btn-action" onClick={() => startNextEligible({ showToastIfNone: false })}>
                {t('fileQueue.buttons.start')} <Icon name="play" size={12} />
              </button>
            ) : null}
          </div>
        </div>
      )}

      {/* Drop overlay */}
      {isDragOver && (
        <div className="drop-overlay">
          <div className="drop-overlay-content">
            <Icon name="plus" size={48} />
            <span>{t('fileQueue.dropOverlay')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FileQueueItem Component
 */
function FileQueueItem({ item, index, isActive, isFocused, isSelected, onClick, onDoubleClick, onToggleSelect, onRemove, onForceReprocess, fixMode, preprocessingStatus, showPreview, previewInfo }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [namesDisplay, setNamesDisplay] = useState('');
  const itemRef = useRef(null);
  const nameAreaRef = useRef(null);
  const tooltipTimerRef = useRef(null);

  const handleMouseEnter = (e) => {
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      setTooltipPos({ x: rect.left, y: rect.bottom + 4 });
    }
    tooltipTimerRef.current = setTimeout(() => setShowTooltip(true), 400);
  };

  const handleMouseLeave = () => {
    if (tooltipTimerRef.current) {
      clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setShowTooltip(false);
  };

  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
    };
  }, []);

  // Calculate confirmed names display based on available width
  // Dependencies: confirmedNames, shouldShowPreview, item.fileName are calculated later in component
  // but useEffect runs after render so they're available via closure
  const truncateFilenameForMeasure = useCallback((name, maxLen = 25) => {
    const chars = [...name];
    if (chars.length <= maxLen) return name;
    const lastDotIndex = name.lastIndexOf('.');
    const hasExt = lastDotIndex !== -1;
    const ext = hasExt ? name.slice(lastDotIndex) : '';
    const base = hasExt ? name.slice(0, lastDotIndex) : name;
    const baseChars = [...base];
    const extLen = [...ext].length;
    const availableForBase = Math.max(0, maxLen - 3 - extLen);
    const truncatedBase = baseChars.slice(0, availableForBase).join('');
    return truncatedBase + '...' + ext;
  }, []);

  // Compute these early so useEffect can use them
  const ppPersonsEarly = preprocessingStatus?.persons;
  const confirmedNamesEarly = previewInfo?.persons || item.reviewedFaces?.map(f => f.personName).filter(Boolean) || ppPersonsEarly || [];
  const shouldShowPreviewEarly = showPreview && (item.status === 'completed' || item.isAlreadyProcessed) && previewInfo;

  useEffect(() => {
    // Only show names when NOT showing preview and we have names
    if (shouldShowPreviewEarly || !confirmedNamesEarly.length) {
      setNamesDisplay('');
      return;
    }

    if (!nameAreaRef.current) return;

    const calculateNames = () => {
      const container = nameAreaRef.current;
      if (!container) return;

      const style = getComputedStyle(container);
      const font = `${style.fontSize} ${style.fontFamily}`;

      // Measure filename width
      const fileNameText = truncateFilenameForMeasure(item.fileName);
      const fileNameWidth = measureTextWidth(fileNameText, font);

      // Available space: container width - filename - padding (40px for gaps and margins)
      const availableWidth = container.offsetWidth - fileNameWidth - 40;

      if (availableWidth > 30) {
        const result = formatNamesToFit(confirmedNamesEarly, availableWidth, font);
        setNamesDisplay(result.text);
      } else {
        setNamesDisplay('');
      }
    };

    calculateNames();

    const observer = new ResizeObserver(calculateNames);
    observer.observe(nameAreaRef.current);

    return () => observer.disconnect();
  }, [confirmedNamesEarly, shouldShowPreviewEarly, item.fileName, truncateFilenameForMeasure]);

  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed':
        return <span className="status-icon completed"><Icon name="check" size={12} /></span>;
      case 'active':
        return <span className="status-icon active"><Icon name="play" size={12} /></span>;
      case 'error':
        return <span className="status-icon error"><Icon name="close" size={12} /></span>;
      case 'missing':
        return <span className="status-icon missing" title={t('fileQueue.tooltips.fileNotFound')}><Icon name="warning" size={12} /></span>;
      default:
        if (item.isAlreadyProcessed) {
          if (fixMode) {
            // Fix-mode ON: same icon as pending, but with green tint
            return <span className="status-icon pending-reprocess"><Icon name="circle" size={12} /></span>;
          } else {
            // Fix-mode OFF: checkmark to show "already done"
            return <span className="status-icon already-done"><Icon name="check" size={12} /></span>;
          }
        }
        return <span className="status-icon pending"><Icon name="circle" size={12} /></span>;
    }
  };

  const getStatusText = () => {
    switch (item.status) {
      case 'completed': return t('fileQueue.status.done');
      case 'active': return t('fileQueue.status.active');
      case 'error': return t('fileQueue.status.error');
      case 'missing': return t('fileQueue.status.notFound');
      default:
        if (item.isAlreadyProcessed) {
          return fixMode ? t('fileQueue.status.queuedReprocess') : t('fileQueue.status.processed');
        }
        return t('fileQueue.status.queued');
    }
  };

  // Get preprocessing indicator
  // preprocessingStatus is now an object: { status, faceCount }
  const ppStatus = preprocessingStatus?.status || preprocessingStatus; // Handle both formats
  const ppFaceCount = preprocessingStatus?.faceCount;

  const getPreprocessingIndicator = () => {
    // No status recorded yet
    if (!ppStatus) {
      return null;
    }
    // Show checkmark for completed preprocessing
    if (ppStatus === PreprocessingStatus.COMPLETED) {
      return <Icon name="bolt" size={14} className="preprocess-indicator completed" title={t('fileQueue.tooltips.cached')} />;
    }
    if (ppStatus === PreprocessingStatus.FILE_NOT_FOUND) {
      return null; // Status already shown in main icon
    }
    if (ppStatus === PreprocessingStatus.ERROR) {
      return <span className="preprocess-indicator error" title={t('fileQueue.tooltips.preprocessingFailed')}>!</span>;
    }
    // Show spinner for any in-progress state
    return <Icon name="refresh" size={14} className="preprocess-indicator loading" title={t('fileQueue.tooltips.preprocessing', { status: ppStatus })} />;
  };

  // Truncate filename for display (Unicode-safe, preserves extension)
  const truncateFilename = (name, maxLen = 25) => {
    const chars = [...name]; // Spread to handle multi-byte Unicode correctly
    if (chars.length <= maxLen) return name;
    const lastDotIndex = name.lastIndexOf('.');
    const hasExt = lastDotIndex !== -1;
    const ext = hasExt ? name.slice(lastDotIndex) : '';
    const base = hasExt ? name.slice(0, lastDotIndex) : name;
    const baseChars = [...base];
    const extLen = [...ext].length;
    const availableForBase = Math.max(0, maxLen - 3 - extLen);
    const truncatedBase = baseChars.slice(0, availableForBase).join('');
    return truncatedBase + '...' + ext;
  };

  // Show preview info if available (for completed or already-processed files)
  // Don't show if new name is identical to current name (nothing would change)
  const newName = previewInfo?.newName;
  const previewStatus = previewInfo?.status;
  const nameWouldChange = newName && newName !== item.fileName;
  const shouldShowPreview = showPreview && (item.status === 'completed' || item.isAlreadyProcessed) && previewInfo;

  // Face count priority: reviewedFaces (from review-complete) > ppFaceCount (from preprocessing)
  // Using || instead of ?? because ppFaceCount=0 might be stale (race with faces-detected)
  const reviewedCount = item.reviewedFaces?.length;
  const detectedFaceCount = reviewedCount > 0 ? reviewedCount : (ppFaceCount || null);
  const hasDetectedFaces = detectedFaceCount !== null;

  // Confirmed names: previewInfo (rename) > reviewedFaces (this session) > preprocessingStatus (from file stats)
  const ppPersons = preprocessingStatus?.persons;
  const confirmedNames = previewInfo?.persons || item.reviewedFaces?.map(f => f.personName).filter(Boolean) || ppPersons || [];
  const confirmedCount = confirmedNames.length;

  // Sidecars from rename preview
  const sidecars = previewInfo?.sidecars || [];
  const hasSidecars = sidecars.length > 0;

  return (
    <div
      ref={itemRef}
      className={`file-item ${item.status} ${isActive ? 'active' : ''} ${isFocused ? 'focused' : ''} ${isSelected ? 'selected' : ''} ${item.isAlreadyProcessed ? 'already-processed' : ''} ${shouldShowPreview ? 'with-preview' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <input
        type="checkbox"
        className="file-select-checkbox"
        checked={isSelected}
        onChange={(e) => {
          e.stopPropagation();
          onToggleSelect();
        }}
        onClick={(e) => e.stopPropagation()}
      />
      {getStatusIcon()}
      {/* Wrapper for file name + preview to maintain consistent right-column alignment */}
      <div className="file-name-area" ref={nameAreaRef}>
        <span className="file-name">
          {/* When showing preview, don't pre-truncate - let CSS handle it */}
          {shouldShowPreview ? item.fileName : truncateFilename(item.fileName)}
          {hasSidecars && shouldShowPreview && (
            <span className="sidecar-indicator" title={sidecars.map(s => s.split('/').pop()).join(', ')}>
              {/* Show extension badges for each sidecar */}
              {[...new Set(sidecars.map(s => s.split('.').pop().toLowerCase()))].map(ext => (
                <span key={ext} className="sidecar-badge">{ext}</span>
              ))}
            </span>
          )}
        </span>
        {/* Confirmed names display (when not showing preview) */}
        {!shouldShowPreview && namesDisplay && (
          <span className="confirmed-names" title={confirmedNames.join(', ')}>
            {namesDisplay}
          </span>
        )}
        {/* Inline preview of new name (only if name would actually change) */}
        {shouldShowPreview && nameWouldChange && (
          <span className="inline-preview">
            <span className="arrow">→</span>
            <span className="new-name">{newName}</span>
          </span>
        )}
        {shouldShowPreview && !newName && previewStatus && previewStatus !== 'ok' && (
          <span className={`inline-preview ${previewStatus === 'no_persons' || previewStatus === 'already_renamed' ? 'muted' : 'error'}`}>
            <span className="arrow">→</span>
            <span className={previewStatus === 'no_persons' || previewStatus === 'already_renamed' ? 'preview-muted' : 'preview-error'}>
              {previewStatus === 'no_persons' ? t('fileQueue.status.noPersons') :
               previewStatus === 'already_renamed' ? t('fileQueue.status.alreadyRenamed') :
               previewStatus}
            </span>
          </span>
        )}
      </div>
      {/* Fixed-width columns for alignment */}
      <span className="preprocess-col">
        {getPreprocessingIndicator()}
      </span>
      <span className="face-count" title={confirmedNames.length > 0 ? t('fileQueue.tooltips.confirmedList', { names: confirmedNames.join(', ') }) : (hasDetectedFaces ? t('fileQueue.tooltips.detectedCount', { count: detectedFaceCount }) : t('fileQueue.tooltips.notLoaded'))}>
        <Icon name="user" size={12} />{hasDetectedFaces ? detectedFaceCount : '–'}
      </span>
      <span className="file-status">{getStatusText()}</span>
      {!fixMode && item.isAlreadyProcessed ? (
        <button
          className="reprocess-btn"
          onClick={(e) => {
            e.stopPropagation();
            onForceReprocess();
          }}
          title={t('fileQueue.tooltips.reprocessFile')}
        >
          <Icon name="refresh" size={12} />
        </button>
      ) : (
        <span className="reprocess-btn-placeholder" />
      )}
      <button
        className="remove-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title={t('fileQueue.tooltips.removeFromQueue')}
      >
        ×
      </button>

      {/* Unified tooltip */}
      {showTooltip && (
        <div
          className="file-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
          <div className="tooltip-row">
            <span className="tooltip-label">{t('fileQueue.tooltips.file')}</span>
            <span className="tooltip-value">{item.fileName}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">{t('fileQueue.tooltips.folder')}</span>
            <span className="tooltip-value tooltip-path">{item.filePath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')}</span>
          </div>
          {hasDetectedFaces && (
            <div className="tooltip-row">
              <span className="tooltip-label">{t('fileQueue.tooltips.detected')}</span>
              <span className="tooltip-value">{t('fileQueue.tooltips.faceCount', { count: detectedFaceCount })}</span>
            </div>
          )}
          {confirmedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">{t('fileQueue.tooltips.confirmed', { count: confirmedCount })}</span>
              <span className="tooltip-value">{confirmedNames.join(', ')}</span>
            </div>
          )}
          {shouldShowPreview && nameWouldChange && (
            <div className="tooltip-row tooltip-newname">
              <span className="tooltip-label">{t('fileQueue.tooltips.newName')}</span>
              <span className="tooltip-value">{newName}</span>
            </div>
          )}
          {shouldShowPreview && hasSidecars && (
            <div className="tooltip-row tooltip-sidecars">
              <span className="tooltip-label">{t('fileQueue.tooltips.sidecars', { count: sidecars.length })}</span>
              <span className="tooltip-value">{sidecars.map(s => s.split('/').pop()).join(', ')}</span>
            </div>
          )}
          {shouldShowPreview && !newName && previewStatus && (
            <div className="tooltip-row tooltip-error">
              <span className="tooltip-label">{t('fileQueue.tooltips.rename')}</span>
              <span className="tooltip-value">{previewStatus}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FileQueueModule;
