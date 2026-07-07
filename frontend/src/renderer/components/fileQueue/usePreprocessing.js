/**
 * usePreprocessing - React binding for the background preprocessing manager.
 *
 * Owns everything that wires the getPreprocessingManager singleton into the
 * FileQueueModule shell: the manager ref, the manager.on(...) event
 * subscriptions (status-change / completed / error / file-not-found / paused /
 * resumed / cache-cleared / already-processed), the pause/resume toasts, the
 * missing-file batching, the hash checker, the backend cache-priority push and
 * the "all done" completion toast.
 *
 * The services/preprocessing/ layer holds the actual manager; this hook is only
 * the React binding. Queue mutations triggered by manager events (marking a file
 * processed by hash, removing missing files, etc.) are applied through the
 * `setQueue` updater the shell owns, so the queue remains the single source of
 * truth.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getPreprocessingManager, PreprocessingStatus } from '../../services/preprocessing/index.js';
import { apiClient } from '../../shared/api-client.js';
import { debug, debugWarn } from '../../shared/debug.js';
import { t } from '../../../i18n/index.js';
import {
  getPreprocessingConfig,
  getNotificationPreference,
  getAutoRemoveMissingPreference,
} from './fileQueuePrefs.js';

/**
 * @param {Array} queue - current queue array (drives priority + completion toast)
 * @param {object} deps
 * @param {Set<string>} deps.processedHashes - hashes already in the database
 * @param {boolean} deps.processedFilesLoaded - gate for wiring the hash checker
 * @param {Function} deps.showToast - toast emitter
 * @param {Function} deps.setQueue - queue state updater (for manager-driven mutations)
 * @returns {{
 *   preprocessingManager: React.MutableRefObject,
 *   preprocessingStatus: object,
 *   setPreprocessingStatus: Function,
 *   preprocessingStatusRef: React.MutableRefObject,
 *   preprocessingPaused: boolean,
 *   countPreprocessed: Function,
 * }}
 */
export function usePreprocessing(queue, { processedHashes, processedFilesLoaded, showToast, setQueue }) {
  const [preprocessingStatus, setPreprocessingStatus] = useState({});
  const [preprocessingPaused, setPreprocessingPaused] = useState(false);

  // Get preprocessing manager (singleton)
  const preprocessingManager = useRef(null);
  if (!preprocessingManager.current) {
    const config = getPreprocessingConfig();
    preprocessingManager.current = getPreprocessingManager(config);
  }

  // Track missing files for batched removal
  const missingFilesRef = useRef([]);
  const missingFilesTimeoutRef = useRef(null);

  // Wire the hash checker once processed files are loaded
  useEffect(() => {
    if (preprocessingManager.current) {
      preprocessingManager.current.setHashChecker((hash) => processedHashes.has(hash));
    }
  }, [processedFilesLoaded, processedHashes]);

  // Count files that are preprocessed (in the cache, ready to open) but not yet
  // reviewed this session. Used for the queue overview bar in ReviewModule.
  const preprocessingStatusRef = useRef(preprocessingStatus);
  preprocessingStatusRef.current = preprocessingStatus;

  const countPreprocessed = useCallback((queueArr) => {
    const pp = preprocessingStatusRef.current;
    return queueArr.filter(
      item => item.status !== 'completed' &&
              pp[item.filePath]?.status === PreprocessingStatus.COMPLETED
    ).length;
  }, []);

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
  }, [showToast, processedHashes, setQueue]);

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

  return {
    preprocessingManager,
    preprocessingStatus,
    setPreprocessingStatus,
    preprocessingStatusRef,
    preprocessingPaused,
    countPreprocessed,
  };
}
