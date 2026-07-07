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
import { useConfirm } from '../context/ConfirmContext.jsx';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { apiClient } from '../shared/api-client.js';
import { scrollBehavior } from '../shared/motion.js';
import { PreprocessingStatus } from '../services/preprocessing/index.js';
import { Icon } from './Icon.jsx';
import { Button, IconButton, EmptyState } from './shared';
import { isFileEligible as isFileEligiblePure, findNextEligibleIndex, isRenameEligible } from './fileQueueEligibility.js';
import { compileFilter } from './filterExpression.js';
import { t } from '../../i18n/index.js';
import {
  getAutoLoadPreference,
  getNotificationPreference,
  getToastDurationMultiplier,
  getInsertModePreference,
} from './fileQueue/fileQueuePrefs.js';
import { generateId, SUPPORTED_EXTENSIONS } from './fileQueue/queueUtils.js';
import { usePreprocessing } from './fileQueue/usePreprocessing.js';
import { useNefRename } from './fileQueue/useNefRename.js';
import { useFileQueue } from './fileQueue/useFileQueue.js';
import FileQueueItem from './fileQueue/FileQueueItem.jsx';
import './FileQueueModule.css';

/**
 * FileQueueModule Component
 */
export function FileQueueModule({ node }) {
  const { api, isConnected } = useBackend();
  const emit = useEmitEvent();
  const { hasListeners, waitForListeners } = useModuleAPI();
  const globalShowToast = useToast();
  const confirm = useConfirm();

  // Queue state (queue + currentIndex) lives in a reducer-backed hook; every
  // mutation goes through queueActions.* so the transitions stay pure/testable.
  const { queue, currentIndex, queueRef, actions: queueActions } = useFileQueue();
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [fixMode, setFixMode] = useState(false);
  const [processedFiles, setProcessedFiles] = useState(new Set());
  const [processedHashes, setProcessedHashes] = useState(new Set());
  const [processedFilesLoaded, setProcessedFilesLoaded] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState(new Set()); // Checkbox-selected file IDs
  const [focusedIndex, setFocusedIndex] = useState(-1); // Clicked-on item (visual highlight only)

  // Filter state
  const [filterText, setFilterText] = useState('');
  const [showFilter, setShowFilter] = useState(false);
  const filterInputRef = useRef(null);

  // Rename state
  // Paths whose review has unsaved changes; held out of rename until persisted.
  const [dirtyPaths, setDirtyPaths] = useState(new Set());
  const dirtyPathsRef = useRef(dirtyPaths);
  dirtyPathsRef.current = dirtyPaths;

  // Drag-and-drop state
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0); // Track nested drag enter/leave events

  // Toast wrapper that applies duration preference
  // Base durations are longer now: success=4s, info=4s, warning=5s, error=6s
  const showToast = useCallback((message, type = 'success', baseDuration = 4000) => {
    const multiplier = getToastDurationMultiplier();
    const duration = Math.round(baseDuration * multiplier);
    globalShowToast(message, type, duration);
  }, [globalShowToast]);

  // Alias for backwards compatibility
  const queueToast = showToast;

  // Refs for processed files state (for use in callbacks without stale closure)
  const processedFilesLoadedRef = useRef(false);
  processedFilesLoadedRef.current = processedFilesLoaded;
  const processedFilesRef = useRef(new Set());
  processedFilesRef.current = processedFiles;

  // Queued manual load: stores index to load once processedFiles are ready
  const pendingManualLoadRef = useRef(-1);

  // Preprocessing orchestration: the getPreprocessingManager singleton, its event
  // subscriptions, pause/resume toasts, missing-file batching, hash checker,
  // cache-priority push and the "all done" completion toast all live in this hook.
  const {
    preprocessingManager,
    preprocessingStatus,
    setPreprocessingStatus,
    preprocessingStatusRef,
    preprocessingPaused,
    countPreprocessed,
  } = usePreprocessing(queue, {
    processedHashes,
    processedFilesLoaded,
    showToast,
    markProcessed: queueActions.markProcessed,
    removePaths: queueActions.removePaths,
    markMissing: queueActions.markMissing,
  });

  // Refs
  const moduleRef = useRef(null);
  const listRef = useRef(null);
  const currentFileRef = useRef(null);
  const visibleIdsRef = useRef(null); // Current filter-visible IDs for action scoping
  const fixModeRef = useRef(fixMode);
  fixModeRef.current = fixMode;

  const loadFileRef = useRef(null);

  // Undo stack for delete-to-trash. Each entry: { id, item, index } — the trash
  // id (for restore), the removed queue item, and its original index.
  const deleteUndoStackRef = useRef([]);

  // Face-name NEF rename flow: preview toggle, preview lookup, in-progress flag
  // and the fetch/toggle/rename handlers (path-update propagation onto the queue
  // and the preprocessing caches). Pure path/name computation is in renameLogic.
  const {
    showPreviewNames,
    setShowPreviewNames,
    previewData,
    setPreviewData,
    renameInProgress,
    renameInProgressRef,
    fetchRenamePreview,
    handlePreviewToggle,
    handleRename,
  } = useNefRename({
    queue,
    queueRef,
    applyRename: queueActions.applyRename,
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
  });

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
    
    queueActions.markProcessedByNames(processedFiles);
  }, [processedFilesLoaded, processedFiles, queueActions]);

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

  // Handle file-deleted events from file watcher
  // Use refs to avoid re-subscribing on every preprocessingStatus change
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
      queueActions.removePaths(new Set([filePath]));
      showToast(t('fileQueue.toasts.removedDeletedFile', { fileName }), 'info', 3000);
    };

    const unsubscribe = window.ansiktenAPI?.onFileDeleted(handleFileDeleted);
    return () => unsubscribe?.();
  }, [showToast, queueActions]);

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
          queueActions.restore(restoredQueue);
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

    // Dedup against the current queue before running side effects, then dispatch
    // the insert (the reducer re-dedups defensively). Preprocessing enqueue and
    // the already-processed stats fetch are side effects that stay out of the
    // pure reducer.
    const existingPaths = new Set(queueRef.current.map(item => item.filePath));
    const uniqueNew = newItems.filter(item => !existingPaths.has(item.filePath));
    const addedCount = uniqueNew.length;
    const alreadyProcessedFiles = [];

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

    queueActions.add(uniqueNew, effectivePosition);

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
  }, [showToast, api, queueActions]);

  // Sort existing queue alphabetically
  const sortQueue = useCallback(() => {
    queueActions.sort();
    showToast(t('fileQueue.toasts.queueSorted'), 'info', 2000);
  }, [showToast, queueActions]);

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

    queueActions.removeById(id);
  }, [queue, emit, queueActions]);

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
    queueActions.clear();
  }, [emit, queueActions]);

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

    queueActions.clearDone(currentFixMode, currentVisibleIds);
    setSelectedFiles(new Set());
  }, [emit, queueActions]);

  // Clear selected files
  const clearSelected = useCallback(() => {
    const currentQueue = queueRef.current;

    // Check if active file is among selected
    const activeFile = currentQueue.find(item => item.filePath === currentFileRef.current);
    if (activeFile && selectedFiles.has(activeFile.id)) {
      emit('clear-image');
      currentFileRef.current = null;
    }

    queueActions.clearSelected(selectedFiles);
    setSelectedFiles(new Set());
  }, [selectedFiles, emit, queueActions]);

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

    queueActions.setActive(index);
    currentFileRef.current = item.filePath;

    debug('FileQueue', 'Emitting load-image for:', item.filePath, { skipAutoDetect });
    emit('load-image', { imagePath: item.filePath, skipAutoDetect });
    emitQueueStatus(index);
  }, [api, loadProcessedFiles, emit, hasListeners, waitForListeners, showToast, emitQueueStatus, queueActions]);

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
      queueActions.clearProcessedFlag(index);

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
  }, [api, loadProcessedFiles, loadFile, showToast, queueActions]);

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
      queueActions.setIndex(-1);
    }
  }, [currentIndex, loadFile, isFileEligible, queueActions]);

  // Skip current file
  const skipCurrent = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

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

      queueActions.setReviewed(imagePath, success ? 'completed' : 'error', reviewedFaces || []);

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
        queueActions.setIndex(-1);
        // Show queue complete toast
        showToast(t('fileQueue.toasts.queueComplete'), 'success', 4000);
      }
    }
  }, [autoAdvance, loadFile, loadProcessedFiles, showToast, emit, isFileEligible, queueActions]));

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
    queueActions.removePaths(new Set([path]));
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
      queueActions.insertAt(victim, idx);
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
      queueActions.setIndex(-1);
    }
  }, [api, autoAdvance, isFileEligible, showToast, queueActions]);

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
          queueActions.insertAt(entry.item, entry.index);
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
  }, [api, showToast, queueActions]);

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
        activeEl.scrollIntoView({ behavior: scrollBehavior(), block: 'nearest' });
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

  // Roving tabindex target (accessibility.md §2a): the single row that is
  // keyboard-tabbable. Prefer the clicked/focused row, then the active file,
  // else the first row shown — so Tab always lands somewhere sensible and the
  // list is one tab stop instead of ~4 per row.
  const rovingIndex = focusedIndex >= 0 && focusedIndex < queue.length
    ? focusedIndex
    : currentIndex >= 0
      ? currentIndex
      : (displayOrder[0]?.originalIndex ?? -1);

  return (
    <div
      ref={moduleRef}
      className={`module-container file-queue-module ${hasSelection ? 'has-selection' : ''} ${isDragOver ? 'drag-over' : ''}`}
      tabIndex={0}
      // Companion to Review (often the same tabset): when focus sits inside the
      // queue — its filter/rename inputs or a focused row — Review's single-key
      // shortcuts (a/i/arrows/numbers/Enter) must not fire. The queue's own
      // n/p/filter handler is a document listener gated on tab visibility, so
      // isolation doesn't disable the companion workflow. See
      // docs/dev/accessibility.md "Keyboard scope".
      data-keyboard-scope="isolated"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="module-header">
        <span className="module-title">{t('fileQueue.title')}</span>
        <div className="file-queue-actions">
          <IconButton
            icon="plus"
            size="sm"
            label={t('fileQueue.buttons.addFiles')}
            onClick={openFileDialog}
          />
          <IconButton
            icon="folder-plus"
            size="sm"
            label={t('fileQueue.buttons.addFolder')}
            onClick={openFolderDialog}
          />
          <IconButton
            icon="sort"
            size="sm"
            label={t('fileQueue.buttons.sortQueue')}
            onClick={sortQueue}
            disabled={queue.length < 2}
          />
          <IconButton
            icon={autoAdvance ? 'play' : 'pause'}
            size="sm"
            label={autoAdvance ? t('fileQueue.buttons.autoAdvanceOn') : t('fileQueue.buttons.autoAdvanceOff')}
            onClick={() => setAutoAdvance(!autoAdvance)}
          />
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
              <Button
                variant="ghost"
                size="sm"
                onClick={clearSelected}
                title={t('fileQueue.buttons.clearSelectedTitle')}
              >
                {t('fileQueue.buttons.clearSelected')}
              </Button>
            )}
            {completedCount > 0 && selectedFiles.size === 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompleted}
                title={t('fileQueue.buttons.clearDoneTitle')}
              >
                {t('fileQueue.buttons.clearDone')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={clearQueue}
              title={t('fileQueue.buttons.clearAllTitle')}
            >
              {t('fileQueue.buttons.clearAll')}
            </Button>
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
          <IconButton
            icon="close"
            size="sm"
            variant="ghost"
            className="filter-close"
            label={t('fileQueue.filter.clearTitle')}
            onClick={closeFilter}
          />
        </div>
      )}

      {/* Current file status bar */}
      {activeFile && (
        <div className="current-file-bar" onClick={() => {
          const activeEl = listRef.current?.querySelector('.file-item.active');
          activeEl?.scrollIntoView({ behavior: scrollBehavior(), block: 'center' });
        }}>
          <Icon name="play" size={12} />
          <span className="current-file-name">{activeFile.fileName}</span>
          <span className="current-file-hint">{t('fileQueue.currentFile.scrollHint')}</span>
        </div>
      )}

      {/* File list */}
      <div ref={listRef} className="module-body file-queue-list">
        {queue.length === 0 ? (
          <EmptyState
            title={t('fileQueue.emptyStates.noFiles')}
            description={t('fileQueue.emptyStates.addHint')}
          />
        ) : (
          displayOrder.map(({ item, originalIndex }) => (
            <FileQueueItem
              key={item.id}
              item={item}
              index={originalIndex}
              isActive={originalIndex === currentIndex}
              isFocused={originalIndex === focusedIndex}
              isRovingTarget={originalIndex === rovingIndex}
              onRove={setFocusedIndex}
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
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={handleRename}
                  loading={renameInProgress}
                  title={hasSelection ? t('fileQueue.buttons.renameSelectedTitle') : visibleIds ? t('fileQueue.buttons.renameFilteredTitle') : t('fileQueue.buttons.renameTitle')}
                >
                  {renameInProgress ? t('fileQueue.buttons.renaming') : renameLabel}
                </Button>
              );
            })()}
            {currentIndex >= 0 ? (
              <Button variant="secondary" size="sm" onClick={skipCurrent}>
                {t('fileQueue.buttons.skip')} <Icon name="skip-next" size={12} />
              </Button>
            ) : queue.some(isFileEligible) ? (
              <Button variant="primary" size="sm" onClick={() => startNextEligible({ showToastIfNone: false })}>
                {t('fileQueue.buttons.start')} <Icon name="play" size={12} />
              </Button>
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

export default FileQueueModule;
