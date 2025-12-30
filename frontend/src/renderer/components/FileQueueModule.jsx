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
import './FileQueueModule.css';

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

  // Load processed files from backend on mount
  const loadProcessedFiles = useCallback(async () => {
    try {
      // Use smaller n to avoid validation errors with legacy data
      const response = await api.get('/api/management/recent-files?n=1000');
      if (response && Array.isArray(response)) {
        const fileNames = new Set(response.map(f => f.name));
        setProcessedFiles(fileNames);
        console.log('[FileQueue] Loaded', fileNames.size, 'processed files');
      }
    } catch (err) {
      // Non-fatal error - processed files indicator will be missing
      console.warn('[FileQueue] Could not load processed files (non-fatal):', err.message);
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
        if (Array.isArray(parsed.queue)) {
          setQueue(parsed.queue);
          setCurrentIndex(parsed.currentIndex ?? -1);
          setAutoAdvance(parsed.autoAdvance ?? true);
          setFixMode(parsed.fixMode ?? false);
          console.log('[FileQueue] Restored queue with', parsed.queue.length, 'files');
        }
      }
    } catch (err) {
      console.error('[FileQueue] Failed to load saved queue:', err);
    }
  }, []);

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
      console.error('[FileQueue] Failed to save queue:', err);
    }
  }, [queue, currentIndex, autoAdvance, fixMode]);

  // Check if file is already processed
  const isFileProcessed = useCallback((fileName) => {
    return processedFiles.has(fileName);
  }, [processedFiles]);

  // Add files to queue
  const addFiles = useCallback((filePaths) => {
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
      return [...prev, ...uniqueNew];
    });

    console.log('[FileQueue] Added', newItems.length, 'files');
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
  const clearCompleted = useCallback(() => {
    setQueue(prev => prev.filter(item => item.status !== 'completed'));
    setCurrentIndex(-1);
  }, []);

  // Load file by index
  const loadFile = useCallback(async (index) => {
    const currentQueue = queueRef.current;
    if (index < 0 || index >= currentQueue.length) {
      console.log('[FileQueue] loadFile: Invalid index', index, 'queue length:', currentQueue.length);
      return;
    }

    // Ensure ImageViewer is open (it needs to be mounted to receive events)
    if (window.workspace?.openModule) {
      window.workspace.openModule('image-viewer');
      // Small delay to let it mount
      await new Promise(resolve => setTimeout(resolve, 50));
    }

    const item = currentQueue[index];

    // If fix mode and file is already processed, undo it first
    if (fixMode && item.isAlreadyProcessed) {
      try {
        console.log('[FileQueue] Undoing file for fix mode:', item.fileName);
        await api.post('/api/management/undo-file', {
          filename_pattern: item.fileName
        });
        // Refresh processed files list
        await loadProcessedFiles();
      } catch (err) {
        console.error('[FileQueue] Failed to undo file:', err);
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
    console.log('[FileQueue] Emitting load-image for:', item.filePath);
    emit('load-image', { imagePath: item.filePath });
  }, [fixMode, api, loadProcessedFiles, emit]);

  // Advance to next file
  const advanceToNext = useCallback(() => {
    const currentQueue = queueRef.current;
    const nextIndex = currentQueue.findIndex((item, i) =>
      i > currentIndex && item.status !== 'completed'
    );

    if (nextIndex >= 0) {
      loadFile(nextIndex);
    } else {
      console.log('[FileQueue] All files completed');
      setCurrentIndex(-1);
    }
  }, [currentIndex, loadFile]);

  // Skip current file
  const skipCurrent = useCallback(() => {
    advanceToNext();
  }, [advanceToNext]);

  // Listen for review-complete event
  useModuleEvent('review-complete', useCallback(({ imagePath, success }) => {
    console.log('[FileQueue] Review complete:', imagePath, success);

    // Mark current file as completed
    if (currentFileRef.current === imagePath) {
      // Use queueRef for current queue state (avoids stale closure)
      const currentQueue = queueRef.current;
      const currentIdx = currentQueue.findIndex(item => item.filePath === imagePath);
      const nextIdx = currentQueue.findIndex((item, i) =>
        i > currentIdx && item.status !== 'completed' && item.filePath !== imagePath
      );

      console.log('[FileQueue] Current index:', currentIdx, 'Next index:', nextIdx, 'Queue length:', currentQueue.length);

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
        console.log('[FileQueue] Auto-advancing to index:', nextIdx);
        setTimeout(() => loadFile(nextIdx), 300);
      } else if (nextIdx < 0) {
        console.log('[FileQueue] No more pending files');
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
      console.error('[FileQueue] Failed to open file dialog:', err);
    }
  }, [addFiles, queue.length, loadFile]);

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
  const completedCount = queue.filter(q => q.status === 'completed').length;
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
            ) : queue.some(q => q.status === 'pending') ? (
              <button className="control-btn start" onClick={() => {
                const firstPending = queue.findIndex(q => q.status === 'pending');
                if (firstPending >= 0) loadFile(firstPending);
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
          return <span className="status-icon processed">⚠</span>;
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
          return fixMode ? '(fix)' : 'Processed';
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
