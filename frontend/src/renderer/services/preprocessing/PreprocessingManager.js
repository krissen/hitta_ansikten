/**
 * Preprocessing Manager
 *
 * Coordinates background preprocessing of queued files.
 * Manages parallel workers and tracks status per file.
 */

import { apiClient } from '../../shared/api-client.js';
import { debug, debugWarn, debugError } from '../../shared/debug.js';

// Preprocessing status enum
export const PreprocessingStatus = {
  PENDING: 'pending',
  HASHING: 'hashing',
  NEF_CONVERTING: 'nef_converting',
  DETECTING_FACES: 'detecting_faces',
  GENERATING_THUMBNAILS: 'generating_thumbnails',
  COMPLETED: 'completed',
  ERROR: 'error',
  CACHED: 'cached',
  FILE_NOT_FOUND: 'file_not_found',
};

/**
 * PreprocessingManager
 *
 * Manages background preprocessing of files in the queue.
 * Runs configurable number of parallel workers.
 */
export class PreprocessingManager {
  constructor(options = {}) {
    // Configuration
    this.maxWorkers = options.maxWorkers || 2;
    this.enabled = options.enabled !== false;
    this.steps = {
      nefConversion: options.steps?.nefConversion ?? true,
      faceDetection: options.steps?.faceDetection ?? true,
      thumbnails: options.steps?.thumbnails ?? true,
    };

    // Rolling window configuration
    this.rollingWindow = {
      maxReadyItems: options.rollingWindow?.maxReadyItems ?? 15,
      minQueueBuffer: options.rollingWindow?.minQueueBuffer ?? 10,
      resumeThreshold: options.rollingWindow?.resumeThreshold ?? 5,
    };

    this.isHashAlreadyProcessed =
      options.isHashAlreadyProcessed || (() => false);

    // State
    this.queue = []; // Files waiting to be processed
    this.processing = new Map(); // file_path -> { status, progress, hash }
    this.completed = new Map(); // file_path -> { hash, cached_data }
    this.activeWorkers = 0;

    // Rolling window state
    this.isPaused = false;
    this.doneItems = new Set();
    this.doneCount = 0;

    // Event handlers
    this.handlers = new Map();

    debug(
      'Preprocessing',
      `Manager initialized: maxWorkers=${this.maxWorkers}, enabled=${this.enabled}, rollingWindow=${JSON.stringify(this.rollingWindow)}`,
    );
  }

  /**
   * Subscribe to preprocessing events
   * @param {string} event - Event name: 'status-change', 'progress', 'completed', 'error'
   * @param {Function} callback - Callback function
   */
  on(event, callback) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event).add(callback);
  }

  off(event, callback) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).delete(callback);
    }
  }

  setHashChecker(callback) {
    this.isHashAlreadyProcessed = callback || (() => false);
  }

  emit(event, data) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          debugError(
            'Preprocessing',
            `Error in event handler for ${event}:`,
            err,
          );
        }
      });
    }
  }

  /**
   * Add file to preprocessing queue
   * @param {string} filePath - Path to file
   * @param {object} options - Options (priority, force, etc.)
   */
  addToQueue(filePath, options = {}) {
    if (!this.enabled) {
      debug('Preprocessing', 'Preprocessing disabled, skipping:', filePath);
      return;
    }

    // Skip if already queued, processing, or completed
    if (
      this.queue.includes(filePath) ||
      this.processing.has(filePath) ||
      this.completed.has(filePath)
    ) {
      debug(
        'Preprocessing',
        'File already in queue/processing/completed:',
        filePath,
      );
      return;
    }

    // Add to queue (priority items go to front)
    if (options.priority) {
      this.queue.unshift(filePath);
    } else {
      this.queue.push(filePath);
    }

    debug(
      'Preprocessing',
      `Added to queue: ${filePath} (queue size: ${this.queue.length})`,
    );

    // Force processing bypasses pause state (for user-requested items)
    if (options.force && this.isPaused) {
      debug('Preprocessing', `Force processing: ${filePath} (bypassing pause)`);
      this._forceProcessFile(filePath);
      return;
    }

    // Start processing if workers available
    this._processNext();
  }

  /**
   * Force process a specific file immediately, bypassing pause state
   * @param {string} filePath - Path to file
   */
  _forceProcessFile(filePath) {
    const index = this.queue.indexOf(filePath);
    if (index === -1) return;

    this.queue.splice(index, 1);
    this.activeWorkers++;
    this.processing.set(filePath, {
      status: PreprocessingStatus.HASHING,
      startTime: Date.now(),
    });

    this.emit('status-change', {
      filePath,
      status: PreprocessingStatus.HASHING,
    });

    this._processFile(filePath)
      .catch((err) => {
        debugError('Preprocessing', `Error processing ${filePath}:`, err);
        if (this.processing.has(filePath)) {
          this.processing.set(filePath, {
            status: PreprocessingStatus.ERROR,
            error: err.message,
          });
          this.emit('error', { filePath, error: err.message });
        }
      })
      .finally(() => {
        this.activeWorkers--;
        this._processNext();
      });
  }

  /**
   * Add multiple files to queue
   * @param {string[]} filePaths - Array of file paths
   */
  addMultipleToQueue(filePaths) {
    filePaths.forEach((path) => this.addToQueue(path));
  }

  /**
   * Remove file from queue
   * @param {string} filePath - Path to file
   */
  removeFromQueue(filePath) {
    const index = this.queue.indexOf(filePath);
    if (index > -1) {
      this.queue.splice(index, 1);
      debug('Preprocessing', `Removed from queue: ${filePath}`);
    }
  }

  /**
   * Get preprocessing status for a file
   * @param {string} filePath - Path to file
   * @returns {object|null} Status object or null
   */
  getStatus(filePath) {
    if (this.completed.has(filePath)) {
      return {
        status: PreprocessingStatus.COMPLETED,
        ...this.completed.get(filePath),
      };
    }
    if (this.processing.has(filePath)) {
      return this.processing.get(filePath);
    }
    if (this.queue.includes(filePath)) {
      return { status: PreprocessingStatus.PENDING };
    }
    return null;
  }

  /**
   * Check if preprocessing is complete for a file
   * @param {string} filePath - Path to file
   * @returns {boolean}
   */
  isComplete(filePath) {
    return this.completed.has(filePath);
  }

  /**
   * Get cached data for a completed file
   * @param {string} filePath - Path to file
   * @returns {object|null} Cached data or null
   */
  getCachedData(filePath) {
    return this.completed.get(filePath) || null;
  }

  /**
   * Clear completed entries
   */
  clearCompleted() {
    this.completed.clear();
    this.doneItems.clear();
    this.doneCount = 0;
    // Check if we should resume after clearing
    if (this.isPaused && this.queue.length > 0) {
      this.isPaused = false;
      this._processNext();
    }
    debug('Preprocessing', 'Cleared completed entries');
  }

  /**
   * Remove a file from all preprocessing tracking
   * @param {string} filePath - Path to file
   * @returns {string|null} File hash if found, null otherwise
   */
  removeFile(filePath) {
    const entry = this.completed.get(filePath);
    const hash = entry?.hash || null;
    const wasDone = this.doneItems.has(filePath);

    this.completed.delete(filePath);
    this.doneItems.delete(filePath);
    this.processing.delete(filePath);
    this.removeFromQueue(filePath);

    if (wasDone && this.doneCount > 0) {
      this.doneCount--;
    }

    if (hash) {
      debug(
        'Preprocessing',
        `Removed file from cache: ${filePath} (hash: ${hash.substring(0, 8)}...)`,
      );
      this.emit('file-removed', { filePath, hash });
    }

    // Check if we should resume after removing files
    if (
      this.isPaused &&
      this.getReadyCount() < this.rollingWindow.minQueueBuffer
    ) {
      this.isPaused = false;
      debug(
        'Preprocessing',
        'Auto-resumed after file removal (ready count below threshold)',
      );
      this._processNext();
    }

    return hash;
  }

  /**
   * Get count of "ready" items (preprocessed but not yet reviewed)
   * @returns {number}
   */
  getReadyCount() {
    let count = 0;
    for (const filePath of this.completed.keys()) {
      if (!this.doneItems.has(filePath)) {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if preprocessing should pause (buffer full)
   * @returns {boolean}
   */
  shouldPause() {
    const readyCount = this.getReadyCount();
    const hasMoreToProcess = this.queue.length > 0;
    return readyCount >= this.rollingWindow.minQueueBuffer && hasMoreToProcess;
  }

  /**
   * Check if preprocessing should resume
   * @returns {boolean}
   */
  shouldResume() {
    return (
      this.isPaused && this.doneCount >= this.rollingWindow.resumeThreshold
    );
  }

  /**
   * Mark item as "done" (reviewed by user)
   * @param {string} filePath - Path to reviewed file
   */
  markDone(filePath) {
    if (!this.completed.has(filePath)) return;
    if (this.doneItems.has(filePath)) return;

    this.doneItems.add(filePath);
    this.doneCount++;

    debug(
      'Preprocessing',
      `Marked done: ${filePath} (done count: ${this.doneCount})`,
    );

    if (this.shouldResume()) {
      this._resumeProcessing();
    }
  }

  /**
   * Clear done items from completed map to free memory
   * @private
   */
  _clearDoneItems() {
    const toRemove = Math.min(
      this.doneCount,
      this.rollingWindow.resumeThreshold,
    );
    let removed = 0;
    const removedHashes = [];

    for (const filePath of this.doneItems) {
      if (removed >= toRemove) break;

      const entry = this.completed.get(filePath);
      if (entry?.hash) {
        removedHashes.push(entry.hash);
      }

      this.completed.delete(filePath);
      this.doneItems.delete(filePath);
      removed++;
    }

    this.doneCount = Math.max(0, this.doneCount - removed);
    debug('Preprocessing', `Cleared ${removed} done items from cache`);

    this.emit('cache-cleared', { count: removed, hashes: removedHashes });
  }

  /**
   * Pause preprocessing (buffer full)
   * @private
   */
  _pauseProcessing() {
    if (this.isPaused) return;

    this.isPaused = true;
    const readyCount = this.getReadyCount();
    debug(
      'Preprocessing',
      `Paused: ${readyCount} ready items, ${this.queue.length} in queue`,
    );

    this.emit('paused', {
      readyCount,
      queueLength: this.queue.length,
    });
  }

  /**
   * Resume preprocessing after enough items reviewed
   * @private
   */
  _resumeProcessing() {
    if (!this.isPaused) return;

    this._clearDoneItems();

    this.isPaused = false;
    // doneCount already decremented by _clearDoneItems

    debug('Preprocessing', 'Resumed preprocessing');
    this.emit('resumed', {});

    this._processNext();
  }

  /**
   * Process next item(s) in queue - launches multiple workers in parallel
   * @private
   */
  _processNext() {
    if (this.isPaused) {
      return;
    }

    if (this.shouldPause()) {
      this._pauseProcessing();
      return;
    }

    if (this.getReadyCount() >= this.rollingWindow.maxReadyItems) {
      debug(
        'Preprocessing',
        `At max ready items (${this.rollingWindow.maxReadyItems}), waiting...`,
      );
      return;
    }

    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const filePath = this.queue.shift();
      if (!filePath) {
        break;
      }

      // Start processing
      this.activeWorkers++;
      this.processing.set(filePath, {
        status: PreprocessingStatus.HASHING,
        startTime: Date.now(),
      });

      this.emit('status-change', {
        filePath,
        status: PreprocessingStatus.HASHING,
      });

      this._processFile(filePath)
        .catch((err) => {
          debugError('Preprocessing', `Error processing ${filePath}:`, err);
          if (this.processing.has(filePath)) {
            this.processing.set(filePath, {
              status: PreprocessingStatus.ERROR,
              error: err.message,
            });
            this.emit('error', { filePath, error: err.message });
          }
        })
        .finally(() => {
          this.activeWorkers--;
          this._processNext();
        });
    }
  }

  /**
   * Process a single file through all preprocessing steps
   * @private
   */
  async _processFile(filePath) {
    let fileHash = null;

    // Step 1: Compute hash
    this._updateStatus(filePath, PreprocessingStatus.HASHING);
    try {
      const hashResult = await apiClient.post('/api/v1/preprocessing/hash', {
        file_path: filePath,
      });
      fileHash = hashResult.file_hash;
      debug(
        'Preprocessing',
        `Hash computed: ${filePath} -> ${fileHash.substring(0, 8)}...`,
      );
      this.emit('hash-computed', { filePath, hash: fileHash });

      if (this.isHashAlreadyProcessed(fileHash)) {
        debug('Preprocessing', `Hash already processed, skipping: ${filePath}`);
        this.emit('already-processed', { filePath, hash: fileHash });
        this._completeFile(filePath, fileHash, {
          skipped: true,
          face_count: 0,
        });
        return;
      }
    } catch (err) {
      if (err.message && err.message.includes('404')) {
        debugWarn('Preprocessing', `File not found: ${filePath}`);
        this.processing.set(filePath, {
          status: PreprocessingStatus.FILE_NOT_FOUND,
          error: 'File not found',
        });
        this.emit('file-not-found', { filePath });
        return;
      }
      throw new Error(`Hash computation failed: ${err.message}`);
    }

    // Step 2: Check what's already cached
    const cacheCheck = await apiClient.post('/api/v1/preprocessing/check', {
      file_hash: fileHash,
    });

    // If everything is cached, we're done
    if (
      cacheCheck.has_nef_conversion &&
      cacheCheck.has_face_detection &&
      cacheCheck.has_thumbnails
    ) {
      debug(
        'Preprocessing',
        `All cached for: ${filePath} (${cacheCheck.face_count ?? 0} faces)`,
      );
      this._completeFile(filePath, fileHash, cacheCheck);
      return;
    }

    // Track actual status after each step
    const actualStatus = {
      has_nef_conversion: cacheCheck.has_nef_conversion,
      has_face_detection: cacheCheck.has_face_detection,
      has_thumbnails: cacheCheck.has_thumbnails,
      nef_jpg_path: cacheCheck.nef_jpg_path,
      face_count: cacheCheck.face_count,
    };
    let hasErrors = false;

    // Step 3: NEF conversion (if needed and enabled)
    if (
      this.steps.nefConversion &&
      this._isRawFile(filePath) &&
      !cacheCheck.has_nef_conversion
    ) {
      this._updateStatus(filePath, PreprocessingStatus.NEF_CONVERTING);
      try {
        const result = await apiClient.post('/api/v1/preprocessing/nef', {
          file_path: filePath,
          file_hash: fileHash,
        });
        if (result.status === 'completed' || result.status === 'cached') {
          actualStatus.has_nef_conversion = true;
          actualStatus.nef_jpg_path = result.nef_jpg_path;
        }
        debug('Preprocessing', `NEF converted: ${filePath}`);
      } catch (err) {
        debugWarn('Preprocessing', `NEF conversion failed: ${err.message}`);
        // Continue anyway - face detection can work on NEF directly
      }
    }

    // Step 4: Face detection (if enabled and not cached)
    if (this.steps.faceDetection && !cacheCheck.has_face_detection) {
      this._updateStatus(filePath, PreprocessingStatus.DETECTING_FACES);
      try {
        const result = await apiClient.post('/api/v1/preprocessing/faces', {
          file_path: filePath,
          file_hash: fileHash,
        });
        if (result.status === 'completed' || result.status === 'cached') {
          actualStatus.has_face_detection = true;
          actualStatus.face_count = result.face_count;
        } else if (result.status === 'error') {
          hasErrors = true;
          debugError('Preprocessing', `Face detection error: ${result.error}`);
        }
        debug(
          'Preprocessing',
          `Faces detected: ${filePath} (${result.face_count ?? 0} faces)`,
        );
      } catch (err) {
        hasErrors = true;
        debugError('Preprocessing', `Face detection failed: ${err.message}`);
      }
    }

    // Step 5: Thumbnails (if enabled and not cached)
    if (this.steps.thumbnails && !cacheCheck.has_thumbnails) {
      this._updateStatus(filePath, PreprocessingStatus.GENERATING_THUMBNAILS);
      try {
        const result = await apiClient.post(
          '/api/v1/preprocessing/thumbnails',
          {
            file_path: filePath,
            file_hash: fileHash,
          },
        );
        if (result.status === 'completed' || result.status === 'cached') {
          actualStatus.has_thumbnails = true;
        } else if (result.status === 'error') {
          hasErrors = true;
          debugError('Preprocessing', `Thumbnail error: ${result.error}`);
        }
        debug('Preprocessing', `Thumbnails generated: ${filePath}`);
      } catch (err) {
        hasErrors = true;
        debugError(
          'Preprocessing',
          `Thumbnail generation failed: ${err.message}`,
        );
      }
    }

    if (!this.processing.has(filePath)) {
      debug('Preprocessing', `Skipping result - file was removed: ${filePath}`);
      return;
    }

    if (hasErrors) {
      this.processing.set(filePath, {
        status: PreprocessingStatus.ERROR,
        error: 'One or more preprocessing steps failed',
      });
      this.emit('error', { filePath, error: 'Preprocessing partially failed' });
    } else {
      this._completeFile(filePath, fileHash, actualStatus);
    }
  }

  /**
   * Update status for a file
   * @private
   */
  _updateStatus(filePath, status) {
    const current = this.processing.get(filePath) || {};
    this.processing.set(filePath, { ...current, status });
    this.emit('status-change', { filePath, status });
  }

  /**
   * Mark file as complete
   * @private
   */
  _completeFile(filePath, fileHash, cacheData) {
    if (!this.processing.has(filePath)) {
      debug(
        'Preprocessing',
        `Skipping completion - file was removed: ${filePath}`,
      );
      return;
    }
    this.processing.delete(filePath);
    this.completed.set(filePath, {
      hash: fileHash,
      ...cacheData,
      completedAt: Date.now(),
    });
    this.emit('completed', {
      filePath,
      hash: fileHash,
      faceCount: cacheData.face_count,
    });
    debug(
      'Preprocessing',
      `Completed: ${filePath} (${cacheData.face_count ?? 0} faces)`,
    );
  }

  /**
   * Check if file is a RAW format
   * @private
   */
  _isRawFile(filePath) {
    const ext = filePath.toLowerCase().split('.').pop();
    return ['nef', 'cr2', 'arw', 'raw'].includes(ext);
  }

  /**
   * Update configuration
   * @param {object} config - New configuration
   */
  updateConfig(config) {
    if (config.maxWorkers !== undefined) {
      this.maxWorkers = config.maxWorkers;
    }
    if (config.enabled !== undefined) {
      this.enabled = config.enabled;
    }
    if (config.steps) {
      this.steps = { ...this.steps, ...config.steps };
    }
    if (config.rollingWindow) {
      this.rollingWindow = { ...this.rollingWindow, ...config.rollingWindow };
    }
    debug('Preprocessing', 'Config updated:', {
      maxWorkers: this.maxWorkers,
      enabled: this.enabled,
      steps: this.steps,
      rollingWindow: this.rollingWindow,
    });
  }

  /**
   * Get manager statistics
   * @returns {object}
   */
  getStats() {
    return {
      queueLength: this.queue.length,
      processingCount: this.processing.size,
      completedCount: this.completed.size,
      activeWorkers: this.activeWorkers,
      maxWorkers: this.maxWorkers,
      enabled: this.enabled,
      isPaused: this.isPaused,
      readyCount: this.getReadyCount(),
      doneCount: this.doneCount,
      rollingWindow: this.rollingWindow,
    };
  }

  /**
   * Stop all processing and clear queue
   */
  stop() {
    this.queue = [];
    this.processing.clear();
    this.completed.clear();
    this.activeWorkers = 0;
    this.isPaused = false;
    this.doneItems.clear();
    this.doneCount = 0;
    debug('Preprocessing', 'Manager stopped, all state reset');
  }
}

// Singleton instance
let managerInstance = null;

/**
 * Get or create the singleton PreprocessingManager instance
 * @param {object} options - Configuration options (only used on first call)
 * @returns {PreprocessingManager}
 */
export function getPreprocessingManager(options = {}) {
  if (!managerInstance) {
    managerInstance = new PreprocessingManager(options);
    if (typeof window !== 'undefined') {
      window.__preprocessingManager = managerInstance;
    }
  }
  return managerInstance;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetPreprocessingManager() {
  if (managerInstance) {
    managerInstance.stop();
  }
  managerInstance = null;
}
