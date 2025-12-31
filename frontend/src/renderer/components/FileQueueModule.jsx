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
import { debug, debugWarn, debugError } from '../shared/debug.js';
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

// Generate simple unique ID
const generateId = () => Math.random().toString(36).substring(2, 9);

/**
 * FileQueueModule Component
 */
export function FileQueueModule() {
  const { api } = useBackend();
  const emit = useEmitEvent();

  // Queue state
  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [fixMode, setFixMode] = useState(false);
  const [processedFiles, setProcessedFiles] = useState(new Set());

  // Refs
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
  const loadProcessedFiles = useCallback(async () => {
    try {
      // Use smaller n to avoid validation errors with legacy data
      const response = await api.get('/api/management/recent-files?n=1000');
      if (response && Array.isArray(response)) {
        const fileNames = new Set(response.map(f => f.name));
        setProcessedFiles(fileNames);
        debug('FileQueue', 'Loaded', fileNames.size, 'processed files');
      }
    } catch (err) {
      // Non-fatal error - processed files indicator will be missing
      debugWarn('FileQueue', 'Could not load processed files (non-fatal):', err.message);
    }
  }, [api]);

  useEffect(() => {
    loadProcessedFiles();
  }, [loadProcessedFiles]);

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
          // Save the index we want to resume from
          savedIndexRef.current = parsed.currentIndex ?? -1;
          setShouldAutoLoad(true);
          debug('FileQueue', 'Restored queue with', parsed.queue.length, 'files, will auto-load');
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
        fixMode
      }));
    } catch (err) {
      debugError('FileQueue', 'Failed to save queue:', err);
    }
  }, [queue, currentIndex, autoAdvance, fixMode]);

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

    setQueue(prev => {
      // Dedupe by filePath
      const existingPaths = new Set(prev.map(item => item.filePath));
      const uniqueNew = newItems.filter(item => !existingPaths.has(item.filePath));
      if (position === 'start') {
        return [...uniqueNew, ...prev];
      }
      return [...prev, ...uniqueNew];
    });

    debug('FileQueue', 'Added', newItems.length, 'files at', position);
  }, [isFileProcessed]);

  // Remove file from queue
  const removeFile = useCallback((id) => {
    setQueue(prev => prev.filter(item => item.id !== id));
    // Adjust currentIndex if needed
    setCurrentIndex(prev => {
      const removedIndex = queue.findIndex(item => item.id === id);
      if (removedIndex < prev) return prev - 1;
      if (removedIndex === prev) return -1;
      return prev;
    });
  }, [queue]);

  // Clear all files
  const clearQueue = useCallback(() => {
    setQueue([]);
    setCurrentIndex(-1);
  }, []);

  // Clear completed files
  // When fix-mode is OFF, also clear already-processed files (they're considered done)
  // When fix-mode is ON, keep already-processed files (they need reprocessing)
  const clearCompleted = useCallback(() => {
    const currentFixMode = fixModeRef.current;
    setQueue(prev => prev.filter(item => {
      if (item.status === 'completed') return false;
      if (!currentFixMode && item.isAlreadyProcessed) return false;
      return true;
    }));
    setCurrentIndex(-1);
  }, []);

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
      } catch (err) {
        debugError('FileQueue', 'Failed to undo file:', err);
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
  }, [fixMode, api, loadProcessedFiles, emit]);

  // Execute pending auto-load (after loadFile is defined)
  useEffect(() => {
    if (pendingAutoLoad >= 0) {
      const indexToLoad = pendingAutoLoad;
      setPendingAutoLoad(-1); // Clear to prevent re-trigger

      // Wait for workspace to be fully ready before loading
      const waitForWorkspace = () => {
        if (window.workspace?.openModule) {
          debug('FileQueue', 'Workspace ready, auto-loading file at index', indexToLoad);
          loadFile(indexToLoad);
        } else {
          debug('FileQueue', 'Waiting for workspace to be ready...');
          setTimeout(waitForWorkspace, 100);
        }
      };

      // Initial delay to let FlexLayout fully initialize
      setTimeout(waitForWorkspace, 500);
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

  // Listen for review-complete event
  useModuleEvent('review-complete', useCallback(({ imagePath, success }) => {
    debug('FileQueue', 'Review complete:', imagePath, success);

    // Mark current file as completed
    if (currentFileRef.current === imagePath) {
      // Use refs for current state (avoids stale closure)
      const currentQueue = queueRef.current;
      const currentFixMode = fixModeRef.current;
      const currentIdx = currentQueue.findIndex(item => item.filePath === imagePath);
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
          return { ...item, status: success ? 'completed' : 'error' };
        }
        return item;
      }));

      // Refresh processed files list
      loadProcessedFiles();

      // Auto-advance to next
      if (autoAdvance && nextIdx >= 0) {
        debug('FileQueue', 'Auto-advancing to index:', nextIdx);
        setTimeout(() => loadFile(nextIdx), 300);
      } else if (nextIdx < 0) {
        debug('FileQueue', 'No more pending files (or all skipped due to fix-mode OFF)');
        setCurrentIndex(-1);
      }
    }
  }, [autoAdvance, loadFile, loadProcessedFiles]));

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
  }, [advanceToNext, currentIndex, loadFile]);

  // Calculate stats
  // When fix-mode is OFF, already-processed files count as "done" (they're skipped)
  // When fix-mode is ON, only actually completed files count
  const completedCount = queue.filter(q =>
    q.status === 'completed' || (!fixMode && q.isAlreadyProcessed)
  ).length;
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const activeCount = queue.filter(q => q.status === 'active').length;

  return (
    <div className="file-queue-module">
      {/* Header */}
      <div className="file-queue-header">
        <span className="file-queue-title">File Queue</span>
        <div className="file-queue-actions">
          <button
            className="file-queue-btn add"
            onClick={openFileDialog}
            title="Add files (Cmd+Shift+A)"
          >
            +
          </button>
          <button
            className="file-queue-btn settings"
            onClick={() => setAutoAdvance(!autoAdvance)}
            title={autoAdvance ? 'Auto-advance ON' : 'Auto-advance OFF'}
          >
            {autoAdvance ? '▶' : '⏸'}
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
          <span>Fix mode (re-review)</span>
        </label>
        {queue.length > 0 && (
          <button
            className="clear-completed-btn"
            onClick={clearCompleted}
            disabled={completedCount === 0}
          >
            Clear done
          </button>
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
              isActive={index === currentIndex}
              onClick={() => loadFile(index)}
              onRemove={() => removeFile(item.id)}
              fixMode={fixMode}
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
function FileQueueItem({ item, isActive, onClick, onRemove, fixMode }) {
  const getStatusIcon = () => {
    switch (item.status) {
      case 'completed':
        return <span className="status-icon completed">✓</span>;
      case 'active':
        return <span className="status-icon active">►</span>;
      case 'error':
        return <span className="status-icon error">✗</span>;
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
      default:
        if (item.isAlreadyProcessed) {
          return fixMode ? 'Queued (reprocess)' : 'Processed';
        }
        return 'Queued';
    }
  };

  return (
    <div
      className={`file-item ${item.status} ${isActive ? 'active' : ''} ${item.isAlreadyProcessed ? 'already-processed' : ''}`}
      onClick={onClick}
    >
      {getStatusIcon()}
      <span className="file-name" title={item.filePath}>
        {item.fileName}
        {item.isAlreadyProcessed && <span className="processed-marker">*</span>}
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
    </div>
  );
}

export default FileQueueModule;
