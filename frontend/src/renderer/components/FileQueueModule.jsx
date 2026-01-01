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

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useModuleEvent, useEmitEvent } from '../hooks/useModuleEvent.js';
import { useBackend } from '../context/BackendContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { debug, debugWarn, debugError } from '../shared/debug.js';
import { getPreprocessingManager, PreprocessingStatus } from '../services/preprocessing/index.js';
import { Icon } from './Icon.jsx';
import './FileQueueModule.css';

// Read preference directly from localStorage to avoid circular dependency
const getAutoLoadPreference = () => {
  try {
    const stored = localStorage.getItem('bildvisare-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.fileQueue?.autoLoadOnStartup ?? true;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return true; // Default to enabled
};

// Get rename configuration from preferences
const getRenameConfig = () => {
  try {
    const stored = localStorage.getItem('bildvisare-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      const rename = prefs.rename || {};
      // Only include non-default values
      const config = {};
      if (rename.prefixSource !== undefined) config.prefixSource = rename.prefixSource;
      if (rename.exifFallback !== undefined) config.exifFallback = rename.exifFallback;
      if (rename.datePattern !== undefined) config.datePattern = rename.datePattern;
      if (rename.filenamePattern !== undefined) config.filenamePattern = rename.filenamePattern;
      if (rename.nameSeparator !== undefined) config.nameSeparator = rename.nameSeparator;
      if (rename.useFirstNameOnly !== undefined) config.useFirstNameOnly = rename.useFirstNameOnly;
      if (rename.alwaysIncludeSurname !== undefined) config.alwaysIncludeSurname = rename.alwaysIncludeSurname;
      if (rename.disambiguationStyle !== undefined) config.disambiguationStyle = rename.disambiguationStyle;
      if (rename.removeDiacritics !== undefined) config.removeDiacritics = rename.removeDiacritics;
      if (rename.includeIgnoredFaces !== undefined) config.includeIgnoredFaces = rename.includeIgnoredFaces;
      if (rename.allowAlreadyRenamed !== undefined) config.allowAlreadyRenamed = rename.allowAlreadyRenamed;
      return Object.keys(config).length > 0 ? config : null;
    }
  } catch (e) {
    // Ignore parse errors
  }
  return null;
};

// Get rename confirmation preference
const getRequireRenameConfirmation = () => {
  try {
    const stored = localStorage.getItem('bildvisare-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.rename?.requireConfirmation ?? true;
    }
  } catch (e) {}
  return true;
};

// Get auto-remove missing files preference
const getAutoRemoveMissingPreference = () => {
  try {
    const stored = localStorage.getItem('bildvisare-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.fileQueue?.autoRemoveMissing ?? true;
    }
  } catch (e) {}
  return true;
};

// Get toast duration multiplier from preferences (1.0 = normal, 2.0 = double)
const getToastDurationMultiplier = () => {
  try {
    const stored = localStorage.getItem('bildvisare-preferences');
    if (stored) {
      const prefs = JSON.parse(stored);
      return prefs.notifications?.toastDuration ?? 1.0;
    }
  } catch (e) {}
  return 1.0;
};

// Generate simple unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * FileQueueModule Component
 */
export function FileQueueModule() {
  const { api, isConnected } = useBackend();
  const emit = useEmitEvent();
  const globalShowToast = useToast();

  // Queue state
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [fixMode, setFixMode] = useState(false);
  const [processedFiles, setProcessedFiles] = useState(new Set()); // Set of filenames
  const [processedHashes, setProcessedHashes] = useState(new Set()); // Set of file hashes
  const [preprocessingStatus, setPreprocessingStatus] = useState({}); // filePath -> status
  const [selectedFiles, setSelectedFiles] = useState(new Set()); // Selected file IDs

  // Rename state
  const [showPreviewNames, setShowPreviewNames] = useState(false);
  const [previewData, setPreviewData] = useState(null); // { path: { newName, status, persons } }
  const [renameInProgress, setRenameInProgress] = useState(false);

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

  // Get preprocessing manager (singleton)
  const preprocessingManager = useRef(null);
  if (!preprocessingManager.current) {
    preprocessingManager.current = getPreprocessingManager();
  }

  // Refs
  const moduleRef = useRef(null);
  const listRef = useRef(null);
  const currentFileRef = useRef(null);
  const queueRef = useRef(queue); // Keep current queue in ref for callbacks
  queueRef.current = queue; // Sync on every render (not just in useEffect)
  const fixModeRef = useRef(fixMode); // Keep fixMode in ref for callbacks
  fixModeRef.current = fixMode; // Sync on every render

  // Auto-load state for restoration
  const [shouldAutoLoad, setShouldAutoLoad] = useState(false);
  const savedIndexRef = useRef(-1);

  // Load processed files from backend on mount
  const loadProcessedFilesFailedRef = useRef(false);
  const loadProcessedFiles = useCallback(async () => {
    try {
      // Use smaller n to avoid validation errors with legacy data
      const response = await api.get('/api/management/recent-files?n=1000');
      if (response && Array.isArray(response)) {
        const fileNames = new Set(response.map(f => f.name));
        const fileHashes = new Set(response.map(f => f.hash).filter(Boolean));
        setProcessedFiles(fileNames);
        setProcessedHashes(fileHashes);
        debug('FileQueue', 'Loaded', fileNames.size, 'processed files,', fileHashes.size, 'hashes');
        loadProcessedFilesFailedRef.current = false; // Reset on success
      }
    } catch (err) {
      // Non-fatal error - processed files indicator will be missing
      debugWarn('FileQueue', 'Could not load processed files (non-fatal):', err.message);
      // Show toast only once to avoid spam on retries
      if (!loadProcessedFilesFailedRef.current) {
        loadProcessedFilesFailedRef.current = true;
        showToast('⚠️ Could not load processed files status', 'warning', 3000);
      }
    }
  }, [api, showToast]);

  useEffect(() => {
    loadProcessedFiles();
  }, [loadProcessedFiles]);

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
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { status: PreprocessingStatus.COMPLETED, faceCount, hash }
      }));

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
      showToast(`❌ Preprocessing failed: ${fileName}`, 'error', 4000);
    };

    const handleFileNotFound = ({ filePath }) => {
      setPreprocessingStatus(prev => ({
        ...prev,
        [filePath]: { status: PreprocessingStatus.FILE_NOT_FOUND }
      }));

      const autoRemove = getAutoRemoveMissingPreference();

      if (autoRemove) {
        // Batch removal - collect missing files and remove after a short delay
        missingFilesRef.current.push(filePath);

        // Clear existing timeout and set a new one
        if (missingFilesTimeoutRef.current) {
          clearTimeout(missingFilesTimeoutRef.current);
        }

        missingFilesTimeoutRef.current = setTimeout(() => {
          const count = missingFilesRef.current.length;
          if (count > 0) {
            const pathsToRemove = new Set(missingFilesRef.current);
            setQueue(prev => prev.filter(item => !pathsToRemove.has(item.filePath)));
            showToast(`Removed ${count} missing file${count > 1 ? 's' : ''} from queue`, 'warning', 3000);
            debug('FileQueue', `Auto-removed ${count} missing files`);
            missingFilesRef.current = [];
          }
        }, 500); // Wait 500ms to batch multiple removals
      } else {
        // Mark file as missing in queue (keep in list)
        setQueue(prev => prev.map(item =>
          item.filePath === filePath
            ? { ...item, status: 'missing', error: 'File not found' }
            : item
        ));
      }
      debug('FileQueue', 'File not found:', filePath);
    };

    manager.on('status-change', handleStatusChange);
    manager.on('completed', handleCompleted);
    manager.on('error', handleError);
    manager.on('file-not-found', handleFileNotFound);

    return () => {
      manager.off('status-change', handleStatusChange);
      manager.off('completed', handleCompleted);
      manager.off('error', handleError);
      manager.off('file-not-found', handleFileNotFound);
    };
  }, [showToast, processedHashes]);

  // Load queue from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bildvisare-file-queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.queue) && parsed.queue.length > 0) {
          setQueue(parsed.queue);
          // Don't restore currentIndex - we'll auto-load in a separate effect
          setAutoAdvance(parsed.autoAdvance ?? true);
          setFixMode(parsed.fixMode ?? false);
          setShowPreviewNames(parsed.showPreviewNames ?? false);
          // Save the index we want to resume from
          savedIndexRef.current = parsed.currentIndex ?? -1;
          setShouldAutoLoad(true);
          debug('FileQueue', 'Restored queue with', parsed.queue.length, 'files, will auto-load');
          // Debug: Log items with reviewedFaces
          const withReviewed = parsed.queue.filter(q => q.reviewedFaces?.length > 0);
          if (withReviewed.length > 0) {
            debug('FileQueue', `Found ${withReviewed.length} items with reviewedFaces:`,
              withReviewed.map(q => `${q.fileName}: ${q.reviewedFaces.length} faces`));
          } else {
            debug('FileQueue', 'No items have reviewedFaces data');
          }
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to load saved queue:', err);
    }
  }, []);

  // State to store pending auto-load index (triggers effect when set)
  const [pendingAutoLoad, setPendingAutoLoad] = useState(-1);

  // Auto-load effect - runs after queue is restored from localStorage
  // Sets pendingAutoLoad, actual load happens in a later effect
  useEffect(() => {
    if (shouldAutoLoad && queue.length > 0) {
      setShouldAutoLoad(false);

      // Check if auto-load is enabled in preferences
      if (!getAutoLoadPreference()) {
        debug('FileQueue', 'Auto-load disabled in preferences');
        // Still start preprocessing for all pending items
        if (preprocessingManager.current) {
          const pendingItems = queue.filter(item => item.status !== 'completed');
          pendingItems.forEach(item => preprocessingManager.current.addToQueue(item.filePath));
        }
        return;
      }

      // Determine which file to load
      let indexToLoad = savedIndexRef.current;

      // Validate the saved index
      if (indexToLoad < 0 || indexToLoad >= queue.length) {
        indexToLoad = queue.findIndex(item => item.status === 'pending');
      }

      // If saved index was completed, find next pending
      if (indexToLoad >= 0 && queue[indexToLoad]?.status === 'completed') {
        const nextPending = queue.findIndex((item, i) => i > indexToLoad && item.status === 'pending');
        indexToLoad = nextPending >= 0 ? nextPending : queue.findIndex(item => item.status === 'pending');
      }

      // Start preprocessing for restored queue items
      if (preprocessingManager.current) {
        // First, check the file we're about to load (with priority)
        // This ensures we detect if it's missing before trying to load it
        if (indexToLoad >= 0 && queue[indexToLoad]) {
          preprocessingManager.current.addToQueue(queue[indexToLoad].filePath, { priority: true });
        }

        // Then add remaining pending items
        const pendingItems = queue.filter((item, i) =>
          item.status !== 'completed' && i !== indexToLoad
        );
        debug('FileQueue', 'Starting preprocessing for', pendingItems.length + (indexToLoad >= 0 ? 1 : 0), 'items');
        pendingItems.forEach(item => {
          preprocessingManager.current.addToQueue(item.filePath);
        });
      }

      if (indexToLoad >= 0) {
        debug('FileQueue', 'Will auto-load file at index', indexToLoad);
        setPendingAutoLoad(indexToLoad);
      } else {
        debug('FileQueue', 'No pending files to auto-load');
      }
    }
  }, [shouldAutoLoad, queue]);

  // Save queue to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem('bildvisare-file-queue', JSON.stringify({
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
        showToast(`⚡ Preprocessing complete (${completedCount} files cached)`, 'success', 3000);
      }
    }

    prevPreprocessingCountRef.current = { pending: pendingPreprocessing, total: queue.length };
  }, [queue, preprocessingStatus, showToast]);

  // Backend connection status tracking
  const prevConnectedRef = useRef(null);
  useEffect(() => {
    // Skip initial render (prevConnectedRef.current is null)
    if (prevConnectedRef.current === null) {
      prevConnectedRef.current = isConnected;
      return;
    }

    // Only show toast if status actually changed
    if (prevConnectedRef.current !== isConnected) {
      if (isConnected) {
        showToast('🟢 Backend connected', 'success', 2500);
      } else {
        showToast('🔴 Backend disconnected', 'error', 4000);
      }
      prevConnectedRef.current = isConnected;
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
          queueToast(`📁 ${queue.length} files in queue (${pending} pending)`, 'info', 3000);
        }
      }

      // Get database stats (faces loaded)
      try {
        const stats = await api.get('/api/management/stats');
        if (stats && stats.unique_persons > 0) {
          queueToast(`👤 ${stats.unique_persons} known faces loaded`, 'info', 3000);
        }
      } catch (err) {
        // Non-fatal - skip this toast
        debug('FileQueue', 'Could not fetch database stats:', err.message);
      }

      // Check cache status
      try {
        const cacheStatus = await api.get('/api/preprocessing/cache/status');
        if (cacheStatus && cacheStatus.usage_percent > 80) {
          queueToast(
            `⚠️ Cache ${Math.round(cacheStatus.usage_percent)}% full (${Math.round(cacheStatus.total_size_mb)}/${cacheStatus.max_size_mb} MB)`,
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
  const isFileProcessed = useCallback((fileName) => {
    return processedFiles.has(fileName);
  }, [processedFiles]);

  // Add files to queue
  // position: 'end' (default) or 'start'
  const addFiles = useCallback((filePaths, position = 'end') => {
    if (!filePaths || filePaths.length === 0) return;

    const newItems = filePaths.map(filePath => {
      const fileName = filePath.split('/').pop();
      return {
        id: generateId(),
        filePath,
        fileName,
        status: 'pending',
        isAlreadyProcessed: isFileProcessed(fileName),
        error: null
      };
    });

    let addedCount = 0;
    setQueue(prev => {
      // Dedupe by filePath
      const existingPaths = new Set(prev.map(item => item.filePath));
      const uniqueNew = newItems.filter(item => !existingPaths.has(item.filePath));
      addedCount = uniqueNew.length;

      // Start preprocessing for new files
      if (preprocessingManager.current) {
        uniqueNew.forEach(item => {
          preprocessingManager.current.addToQueue(item.filePath);
        });
      }

      if (position === 'start') {
        return [...uniqueNew, ...prev];
      }
      return [...prev, ...uniqueNew];
    });

    // Show toast for added files
    if (newItems.length > 0) {
      const dupeCount = newItems.length - addedCount;
      if (addedCount > 0) {
        let msg = `📁 Added ${addedCount} file${addedCount !== 1 ? 's' : ''} to queue`;
        if (dupeCount > 0) {
          msg += ` (${dupeCount} already in queue)`;
        }
        showToast(msg, 'info', 3000);
      } else if (dupeCount > 0) {
        // All files were duplicates
        const msg = dupeCount === 1
          ? '📁 File already in queue'
          : `📁 All ${dupeCount} files already in queue`;
        showToast(msg, 'info', 2500);
      }
    }

    debug('FileQueue', 'Added', newItems.length, 'files at', position);
  }, [isFileProcessed, showToast]);

  // Remove file from queue
  const removeFile = useCallback((id) => {
    // Find the file to get its path before removing
    const fileToRemove = queue.find(item => item.id === id);
    if (fileToRemove) {
      if (preprocessingManager.current) {
        preprocessingManager.current.removeFromQueue(fileToRemove.filePath);
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

    // Check if active file will be removed
    const activeFile = currentQueue.find(item => item.filePath === currentFileRef.current);
    const activeWillBeRemoved = activeFile && (
      activeFile.status === 'completed' ||
      (!currentFixMode && activeFile.isAlreadyProcessed)
    );

    if (activeWillBeRemoved) {
      emit('clear-image');
      currentFileRef.current = null;
    }

    setQueue(prev => prev.filter(item => {
      if (item.status === 'completed') return false;
      if (!currentFixMode && item.isAlreadyProcessed) return false;
      return true;
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

  // Load file by index
  const loadFile = useCallback(async (index) => {
    const currentQueue = queueRef.current;
    if (index < 0 || index >= currentQueue.length) {
      debug('FileQueue', 'loadFile: Invalid index', index, 'queue length:', currentQueue.length);
      return;
    }

    // Check if ImageViewer already exists in the workspace
    const workspace = window.workspace;
    let hasImageViewer = false;

    if (workspace?.model) {
      // FlexLayout model - find existing image-viewer tab
      workspace.model.visitNodes(node => {
        if (node.getComponent?.() === 'image-viewer') {
          hasImageViewer = true;
        }
      });
    }

    // Only open a new ImageViewer if none exists (manual file selection, not auto-load)
    if (!hasImageViewer && workspace?.openModule) {
      debug('FileQueue', 'No ImageViewer found, opening one');
      workspace.openModule('image-viewer');
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    const item = currentQueue[index];

    // If fix mode and file is already processed, undo it first
    if (fixMode && item.isAlreadyProcessed) {
      try {
        debug('FileQueue', 'Undoing file for fix mode:', item.fileName);
        await api.post('/api/management/undo-file', {
          filename_pattern: item.fileName
        });
        // Refresh processed files list
        await loadProcessedFiles();
        showToast(`🔄 Undid processing for ${item.fileName}`, 'info', 2500);
      } catch (err) {
        debugError('FileQueue', 'Failed to undo file:', err);
        showToast(`Failed to undo ${item.fileName}`, 'error', 3000);
        // Continue anyway
      }
    }

    // Update status
    setQueue(prev => prev.map((q, i) => ({
      ...q,
      status: i === index ? 'active' : (q.status === 'active' ? 'pending' : q.status)
    })));

    setCurrentIndex(index);
    currentFileRef.current = item.filePath;

    // Emit load-image event
    debug('FileQueue', 'Emitting load-image for:', item.filePath);
    emit('load-image', { imagePath: item.filePath });
  }, [fixMode, api, loadProcessedFiles, emit, showToast]);

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

    // Single click: Select the file (clear others, select this one)
    lastSelectedIndexRef.current = index;
    setSelectedFiles(new Set([item.id]));
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

  // Advance to next file
  const advanceToNext = useCallback(() => {
    const currentQueue = queueRef.current;
    const currentFixMode = fixModeRef.current;
    const nextIndex = currentQueue.findIndex((item, i) => {
      if (i <= currentIndex) return false;
      if (item.status === 'completed') return false;
      // Skip already-processed files when fix-mode is OFF
      if (!currentFixMode && item.isAlreadyProcessed) return false;
      return true;
    });

    if (nextIndex >= 0) {
      loadFile(nextIndex);
    } else {
      debug('FileQueue', 'All files completed (or skipped due to fix-mode OFF)');
      setCurrentIndex(-1);
    }
  }, [currentIndex, loadFile]);

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
    const eligiblePaths = currentQueue
      .filter(q => q.status === 'completed' || (!currentFixMode && q.isAlreadyProcessed))
      .map(q => q.filePath);

    if (eligiblePaths.length === 0) {
      setPreviewData({});
      return;
    }

    // Get rename config from preferences
    const renameConfig = getRenameConfig();

    try {
      const result = await api.post('/api/files/rename-preview', {
        file_paths: eligiblePaths,
        config: renameConfig
      });

      // Build lookup: path -> { newName, status, persons }
      const lookup = {};
      for (const item of result.items) {
        lookup[item.original_path] = {
          newName: item.new_name,
          status: item.status,
          persons: item.persons || []
        };
      }
      setPreviewData(lookup);
      debug('FileQueue', 'Fetched rename preview for', eligiblePaths.length, 'files');
    } catch (err) {
      debugError('FileQueue', 'Failed to fetch rename preview:', err);
      setPreviewData({});
    }
  }, [api]);

  // Handle preview toggle
  const handlePreviewToggle = useCallback(async (e) => {
    const show = e.target.checked;
    setShowPreviewNames(show);

    // Always fetch fresh preview when toggling on to avoid stale data
    if (show) {
      await fetchRenamePreview();
    }
  }, [fetchRenamePreview]);

  // Fetch preview on startup if showPreviewNames was restored as true
  // Wait for preprocessing to complete so backend has the data
  const initialPreviewFetchedRef = useRef(false);
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
    // Include both completed files AND already-processed files (when not in fix-mode)
    const currentFixMode = fixModeRef.current;
    const eligiblePaths = queue
      .filter(q => q.status === 'completed' || (!currentFixMode && q.isAlreadyProcessed))
      .map(q => q.filePath);

    if (eligiblePaths.length === 0) return;

    // Check if confirmation is required
    const requireConfirmation = getRequireRenameConfirmation();

    if (requireConfirmation) {
      // Show confirmation dialog
      const confirmed = window.confirm(
        `Rename ${eligiblePaths.length} file(s)?\n\n` +
        `This will rename files based on detected faces.\n` +
        `Check Preferences for rename format settings.`
      );
      if (!confirmed) return;
    }

    setRenameInProgress(true);

    // Get rename config from preferences
    const renameConfig = getRenameConfig();

    try {
      const result = await api.post('/api/files/rename', {
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
      }

      // Refresh preview data to get updated info for renamed files
      setPreviewData(null);
      if (showPreviewNames) {
        // Re-fetch after delay to allow queue state to update
        setTimeout(() => fetchRenamePreview(), 300);
      }

      // Show toast notification
      let message = `✓ Renamed ${renamedCount} file(s)`;
      if (skippedCount > 0) message += ` · ${skippedCount} skipped`;
      if (errorCount > 0) message += ` · ${errorCount} error(s)`;
      showToast(message, errorCount > 0 ? 'warning' : 'success');

    } catch (err) {
      debugError('FileQueue', 'Rename failed:', err);
      showToast(`Rename failed: ${err.message}`, 'error');
    } finally {
      setRenameInProgress(false);
    }
  }, [queue, api, showPreviewNames, fetchRenamePreview, showToast]);

  // Listen for review-complete event
  useModuleEvent('review-complete', useCallback(({ imagePath, success, reviewedFaces }) => {
    debug('FileQueue', 'Review complete:', imagePath, success, 'faces:', reviewedFaces?.length);

    // Mark current file as completed
    if (currentFileRef.current === imagePath) {
      // Use refs for current state (avoids stale closure)
      const currentQueue = queueRef.current;
      const currentFixMode = fixModeRef.current;
      const currentIdx = currentQueue.findIndex(item => item.filePath === imagePath);
      const fileName = imagePath.split('/').pop();
      const faceCount = reviewedFaces?.length || 0;

      const nextIdx = currentQueue.findIndex((item, i) => {
        if (i <= currentIdx) return false;
        if (item.status === 'completed') return false;
        if (item.filePath === imagePath) return false;
        // Skip already-processed files when fix-mode is OFF
        if (!currentFixMode && item.isAlreadyProcessed) return false;
        return true;
      });

      debug('FileQueue', 'Current index:', currentIdx, 'Next index:', nextIdx, 'Queue length:', currentQueue.length, 'fixMode:', currentFixMode);

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

      // Show toast for review result
      if (success) {
        showToast(`✓ Saved review for ${fileName} (${faceCount} face${faceCount !== 1 ? 's' : ''})`, 'success', 2500);
      } else {
        showToast(`❌ Failed to save review for ${fileName}`, 'error', 4000);
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
        showToast('🎉 Queue complete - all files reviewed!', 'success', 4000);
      }
    }
  }, [autoAdvance, loadFile, loadProcessedFiles, showToast]));

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
      let filePaths = await window.bildvisareAPI?.invoke('open-multi-file-dialog');

      // Fall back to single file dialog
      if (!filePaths) {
        const singlePath = await window.bildvisareAPI?.invoke('open-file-dialog');
        if (singlePath) {
          filePaths = [singlePath];
        }
      }

      if (filePaths && filePaths.length > 0) {
        addFiles(filePaths);

        // Auto-start if queue was empty
        if (queue.length === 0 && filePaths.length > 0) {
          setTimeout(() => loadFile(0), 100);
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to open file dialog:', err);
    }
  }, [addFiles, queue.length, loadFile]);

  // Open folder dialog
  const openFolderDialog = useCallback(async () => {
    try {
      const filePaths = await window.bildvisareAPI?.invoke('open-folder-dialog');

      if (filePaths && filePaths.length > 0) {
        addFiles(filePaths);

        // Auto-start if queue was empty
        if (queue.length === 0 && filePaths.length > 0) {
          setTimeout(() => loadFile(0), 100);
        }
      }
    } catch (err) {
      debugError('FileQueue', 'Failed to open folder dialog:', err);
    }
  }, [addFiles, queue.length, loadFile]);

  // Listen for files from main process (command line arguments)
  useEffect(() => {
    const handleQueueFiles = ({ files, position, startQueue }) => {
      debug('FileQueue', `Received ${files.length} files from main process (position: ${position})`);
      addFiles(files, position || 'end');
      if (startQueue && files.length > 0) {
        setTimeout(() => loadFile(0), 100);
      }
    };

    window.bildvisareAPI?.on('queue-files', handleQueueFiles);
    // Note: No cleanup needed as Electron IPC listeners persist
  }, [addFiles, loadFile]);

  // Expose fileQueue API globally for programmatic access
  useEffect(() => {
    // Helper to expand glob patterns
    const expandAndAdd = async (pattern, position) => {
      if (pattern.includes('*') || pattern.includes('?')) {
        // It's a glob pattern - expand it
        const files = await window.bildvisareAPI?.invoke('expand-glob', pattern);
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
      add: (pattern, position = 'end') => expandAndAdd(pattern, position),
      addToStart: (pattern) => expandAndAdd(pattern, 'start'),
      addToEnd: (pattern) => expandAndAdd(pattern, 'end'),
      clear: clearQueue,
      clearCompleted: clearCompleted,
      loadFile: loadFile,
      start: () => { if (queueRef.current.length > 0) loadFile(0); },
      getQueue: () => queueRef.current,
      getCurrentIndex: () => currentIndex
    };
    return () => { delete window.fileQueue; };
  }, [addFiles, clearQueue, clearCompleted, loadFile, currentIndex]);

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
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

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
  }, [advanceToNext, currentIndex, loadFile, queue, selectedFiles.size, selectAll, deselectAll]);

  // Calculate stats
  // When fix-mode is OFF, already-processed files count as "done" (they're skipped)
  // When fix-mode is ON, only actually completed files count
  const completedCount = queue.filter(q =>
    q.status === 'completed' || (!fixMode && q.isAlreadyProcessed)
  ).length;
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const activeCount = queue.filter(q => q.status === 'active').length;

  const hasSelection = selectedFiles.size > 0;

  return (
    <div ref={moduleRef} className={`file-queue-module ${hasSelection ? 'has-selection' : ''}`} tabIndex={0}>
      {/* Header */}
      <div className="file-queue-header">
        <span className="file-queue-title">File Queue</span>
        <div className="file-queue-actions">
          <button
            className="file-queue-btn add"
            onClick={openFileDialog}
            title="Add files"
          >
            <Icon name="plus" size={14} />
          </button>
          <button
            className="file-queue-btn folder"
            onClick={openFolderDialog}
            title="Add folder"
          >
            <Icon name="folder-plus" size={14} />
          </button>
          <button
            className="file-queue-btn settings"
            onClick={() => setAutoAdvance(!autoAdvance)}
            title={autoAdvance ? 'Auto-advance ON' : 'Auto-advance OFF'}
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
          <span>Fix mode</span>
        </label>
        {completedCount > 0 && (
          <label className="preview-toggle">
            <input
              type="checkbox"
              checked={showPreviewNames}
              onChange={handlePreviewToggle}
            />
            <span>Show new names</span>
          </label>
        )}
        {queue.length > 0 && (
          <>
            {selectedFiles.size > 0 && (
              <button
                className="clear-btn"
                onClick={clearSelected}
                title="Clear selected files"
              >
                Clear selected
              </button>
            )}
            {completedCount > 0 && selectedFiles.size === 0 && (
              <button
                className="clear-btn"
                onClick={clearCompleted}
                title="Clear completed files"
              >
                Clear done
              </button>
            )}
            <button
              className="clear-btn clear-all"
              onClick={clearQueue}
              title="Clear all files from queue"
            >
              Clear all
            </button>
          </>
        )}
      </div>

      {/* File list */}
      <div ref={listRef} className="file-queue-list">
        {queue.length === 0 ? (
          <div className="file-queue-empty">
            <p>No files in queue</p>
            <p className="hint">Click + to add files</p>
          </div>
        ) : (
          queue.map((item, index) => (
            <FileQueueItem
              key={item.id}
              item={item}
              index={index}
              isActive={index === currentIndex}
              isSelected={selectedFiles.has(item.id)}
              onClick={(e) => handleItemClick(index, e)}
              onDoubleClick={() => handleItemDoubleClick(index)}
              onToggleSelect={() => toggleFileSelection(item.id)}
              onRemove={() => removeFile(item.id)}
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
        <div className="file-queue-footer">
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
          <div className="file-queue-controls">
            {completedCount > 0 && (
              <button
                className="control-btn rename"
                onClick={handleRename}
                disabled={renameInProgress}
                title="Rename files based on detected faces"
              >
                {renameInProgress ? 'Renaming...' : `Rename (${completedCount})`}
              </button>
            )}
            {currentIndex >= 0 ? (
              <button className="control-btn" onClick={skipCurrent}>
                Skip ⏭
              </button>
            ) : queue.some(q => {
              if (q.status !== 'pending') return false;
              // Skip already-processed when fix-mode is OFF
              if (!fixMode && q.isAlreadyProcessed) return false;
              return true;
            }) ? (
              <button className="control-btn start" onClick={() => {
                const firstEligible = queue.findIndex(q => {
                  if (q.status !== 'pending') return false;
                  if (!fixMode && q.isAlreadyProcessed) return false;
                  return true;
                });
                if (firstEligible >= 0) loadFile(firstEligible);
              }}>
                Start ▶
              </button>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * FileQueueItem Component
 */
function FileQueueItem({ item, index, isActive, isSelected, onClick, onDoubleClick, onToggleSelect, onRemove, fixMode, preprocessingStatus, showPreview, previewInfo }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const itemRef = useRef(null);

  // Handle mouse enter/leave for tooltip
  const handleMouseEnter = (e) => {
    if (itemRef.current) {
      const rect = itemRef.current.getBoundingClientRect();
      setTooltipPos({ x: rect.left, y: rect.bottom + 4 });
    }
    setShowTooltip(true);
  };

  const handleMouseLeave = () => {
    setShowTooltip(false);
  };
  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed':
        return <span className="status-icon completed">✓</span>;
      case 'active':
        return <span className="status-icon active">►</span>;
      case 'error':
        return <span className="status-icon error">✗</span>;
      case 'missing':
        return <span className="status-icon missing" title="File not found">⚠</span>;
      default:
        if (item.isAlreadyProcessed) {
          if (fixMode) {
            // Fix-mode ON: same icon as pending, but with green tint
            return <span className="status-icon pending-reprocess">○</span>;
          } else {
            // Fix-mode OFF: checkmark to show "already done"
            return <span className="status-icon already-done">✓</span>;
          }
        }
        return <span className="status-icon pending">○</span>;
    }
  };

  const getStatusText = () => {
    switch (item.status) {
      case 'completed': return 'Done';
      case 'active': return 'Active';
      case 'error': return 'Error';
      case 'missing': return 'Not found';
      default:
        if (item.isAlreadyProcessed) {
          return fixMode ? 'Queued (reprocess)' : 'Processed';
        }
        return 'Queued';
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
      return <span className="preprocess-indicator completed" title="Cached">⚡</span>;
    }
    if (ppStatus === PreprocessingStatus.FILE_NOT_FOUND) {
      return null; // Status already shown in main icon
    }
    if (ppStatus === PreprocessingStatus.ERROR) {
      return <span className="preprocess-indicator error" title="Preprocessing failed">!</span>;
    }
    // Show spinner for any in-progress state
    return <span className="preprocess-indicator loading" title={`Preprocessing: ${ppStatus}`}>⟳</span>;
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

  // Face count for icon: prefer preprocessing count, fall back to reviewedFaces length for completed files
  // This ensures completed files show their face count even if preprocessing status was cleared
  const detectedFaceCount = ppFaceCount ?? item.reviewedFaces?.length ?? null;
  const hasDetectedFaces = detectedFaceCount !== null;

  // Confirmed names for hover: from previewInfo (rename) or reviewedFaces (this session)
  const confirmedNames = previewInfo?.persons || item.reviewedFaces?.map(f => f.personName).filter(Boolean) || [];
  const confirmedCount = confirmedNames.length;

  // Debug: trace face info source
  if (item.status === 'completed' || item.reviewedFaces || hasDetectedFaces) {
    debug('FileQueue', `[${item.fileName}] detected=${detectedFaceCount}, confirmed=${confirmedCount}, names=${confirmedNames.join(',')}`);
  }

  return (
    <div
      ref={itemRef}
      className={`file-item ${item.status} ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${item.isAlreadyProcessed ? 'already-processed' : ''} ${shouldShowPreview ? 'with-preview' : ''}`}
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
      <span className="file-name">
        {truncateFilename(item.fileName)}
      </span>
      {/* Inline preview of new name (only if name would actually change) */}
      {shouldShowPreview && nameWouldChange && (
        <span className="inline-preview">
          <span className="arrow">→</span>
          <span className="new-name">{truncateFilename(newName, 30)}</span>
        </span>
      )}
      {shouldShowPreview && !newName && previewStatus && previewStatus !== 'ok' && (
        <span className={`inline-preview ${previewStatus === 'no_persons' || previewStatus === 'already_renamed' ? 'muted' : 'error'}`}>
          <span className="arrow">→</span>
          <span className={previewStatus === 'no_persons' || previewStatus === 'already_renamed' ? 'preview-muted' : 'preview-error'}>
            {previewStatus === 'no_persons' ? '(no persons)' :
             previewStatus === 'already_renamed' ? '(already renamed)' :
             previewStatus}
          </span>
        </span>
      )}
      {/* Fixed-width columns for alignment */}
      <span className="preprocess-col">
        {getPreprocessingIndicator()}
      </span>
      <span className="face-count" title={confirmedNames.length > 0 ? `Confirmed: ${confirmedNames.join(', ')}` : (hasDetectedFaces ? `${detectedFaceCount} detected` : 'Not loaded')}>
        👤{hasDetectedFaces ? detectedFaceCount : '–'}
      </span>
      <span className="file-status">{getStatusText()}</span>
      <button
        className="remove-btn"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove from queue"
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
            <span className="tooltip-label">File:</span>
            <span className="tooltip-value">{item.fileName}</span>
          </div>
          <div className="tooltip-row">
            <span className="tooltip-label">Path:</span>
            <span className="tooltip-value tooltip-path">{item.filePath}</span>
          </div>
          {hasDetectedFaces && (
            <div className="tooltip-row">
              <span className="tooltip-label">Detected:</span>
              <span className="tooltip-value">{detectedFaceCount} face{detectedFaceCount !== 1 ? 's' : ''}</span>
            </div>
          )}
          {confirmedCount > 0 && (
            <div className="tooltip-row">
              <span className="tooltip-label">Confirmed ({confirmedCount}):</span>
              <span className="tooltip-value">{confirmedNames.join(', ')}</span>
            </div>
          )}
          {shouldShowPreview && nameWouldChange && (
            <div className="tooltip-row tooltip-newname">
              <span className="tooltip-label">New name:</span>
              <span className="tooltip-value">{newName}</span>
            </div>
          )}
          {shouldShowPreview && !newName && previewStatus && (
            <div className="tooltip-row tooltip-error">
              <span className="tooltip-label">Rename:</span>
              <span className="tooltip-value">{previewStatus}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default FileQueueModule;
