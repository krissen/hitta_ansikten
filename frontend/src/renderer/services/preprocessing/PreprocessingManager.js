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
  CACHED: 'cached'
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
      thumbnails: options.steps?.thumbnails ?? true
    };

    // State
    this.queue = [];           // Files waiting to be processed
    this.processing = new Map(); // file_path -> { status, progress, hash }
    this.completed = new Map();  // file_path -> { hash, cached_data }
    this.activeWorkers = 0;

    // Event handlers
    this.handlers = new Map();

    debug('Preprocessing', `Manager initialized: maxWorkers=${this.maxWorkers}, enabled=${this.enabled}`);
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

  /**
   * Unsubscribe from preprocessing events
   */
  off(event, callback) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).delete(callback);
    }
  }

  /**
   * Emit event to all subscribers
   */
  emit(event, data) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          debugError('Preprocessing', `Error in event handler for ${event}:`, err);
        }
      });
    }
  }

  /**
   * Add file to preprocessing queue
   * @param {string} filePath - Path to file
   * @param {object} options - Options (priority, etc.)
   */
  addToQueue(filePath, options = {}) {
    if (!this.enabled) {
      debug('Preprocessing', 'Preprocessing disabled, skipping:', filePath);
      return;
    }

    // Skip if already queued, processing, or completed
    if (this.queue.includes(filePath) ||
        this.processing.has(filePath) ||
        this.completed.has(filePath)) {
      debug('Preprocessing', 'File already in queue/processing/completed:', filePath);
      return;
    }

    // Add to queue (priority items go to front)
    if (options.priority) {
      this.queue.unshift(filePath);
    } else {
      this.queue.push(filePath);
    }

    debug('Preprocessing', `Added to queue: ${filePath} (queue size: ${this.queue.length})`);

    // Start processing if workers available
    this._processNext();
  }

  /**
   * Add multiple files to queue
   * @param {string[]} filePaths - Array of file paths
   */
  addMultipleToQueue(filePaths) {
    filePaths.forEach(path => this.addToQueue(path));
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
      return { status: PreprocessingStatus.COMPLETED, ...this.completed.get(filePath) };
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
    debug('Preprocessing', 'Cleared completed entries');
  }

  /**
   * Process next item(s) in queue - launches multiple workers in parallel
   * @private
   */
  _processNext() {
    // Start as many workers as we have capacity for
    while (this.activeWorkers < this.maxWorkers && this.queue.length > 0) {
      const filePath = this.queue.shift();
      if (!filePath) {
        break;
      }

      // Start processing
      this.activeWorkers++;
      this.processing.set(filePath, {
        status: PreprocessingStatus.HASHING,
        startTime: Date.now()
      });

      this.emit('status-change', { filePath, status: PreprocessingStatus.HASHING });

      // Launch processing without awaiting - allows parallel execution
      this._processFile(filePath)
        .catch((err) => {
          debugError('Preprocessing', `Error processing ${filePath}:`, err);
          this.processing.set(filePath, {
            status: PreprocessingStatus.ERROR,
            error: err.message
          });
          this.emit('error', { filePath, error: err.message });
        })
        .finally(() => {
          this.activeWorkers--;
          // Try to start more workers if capacity available
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
      const hashResult = await apiClient.post('/api/preprocessing/hash', {
        file_path: filePath
      });
      fileHash = hashResult.file_hash;
      debug('Preprocessing', `Hash computed: ${filePath} -> ${fileHash.substring(0, 8)}...`);
    } catch (err) {
      throw new Error(`Hash computation failed: ${err.message}`);
    }

    // Step 2: Check what's already cached
    const cacheCheck = await apiClient.post('/api/preprocessing/check', {
      file_hash: fileHash
    });

    // If everything is cached, we're done
    if (cacheCheck.has_nef_conversion && cacheCheck.has_face_detection && cacheCheck.has_thumbnails) {
      debug('Preprocessing', `All cached for: ${filePath}`);
      this._completeFile(filePath, fileHash, cacheCheck);
      return;
    }

    // Track actual status after each step
    const actualStatus = {
      has_nef_conversion: cacheCheck.has_nef_conversion,
      has_face_detection: cacheCheck.has_face_detection,
      has_thumbnails: cacheCheck.has_thumbnails,
      nef_jpg_path: cacheCheck.nef_jpg_path
    };
    let hasErrors = false;

    // Step 3: NEF conversion (if needed and enabled)
    if (this.steps.nefConversion && this._isRawFile(filePath) && !cacheCheck.has_nef_conversion) {
      this._updateStatus(filePath, PreprocessingStatus.NEF_CONVERTING);
      try {
        const result = await apiClient.post('/api/preprocessing/nef', {
          file_path: filePath,
          file_hash: fileHash
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
        const result = await apiClient.post('/api/preprocessing/faces', {
          file_path: filePath,
          file_hash: fileHash
        });
        if (result.status === 'completed' || result.status === 'cached') {
          actualStatus.has_face_detection = true;
        } else if (result.status === 'error') {
          hasErrors = true;
          debugError('Preprocessing', `Face detection error: ${result.error}`);
        }
        debug('Preprocessing', `Faces detected: ${filePath}`);
      } catch (err) {
        hasErrors = true;
        debugError('Preprocessing', `Face detection failed: ${err.message}`);
      }
    }

    // Step 5: Thumbnails (if enabled and not cached)
    if (this.steps.thumbnails && !cacheCheck.has_thumbnails) {
      this._updateStatus(filePath, PreprocessingStatus.GENERATING_THUMBNAILS);
      try {
        const result = await apiClient.post('/api/preprocessing/thumbnails', {
          file_path: filePath,
          file_hash: fileHash
        });
        if (result.status === 'completed' || result.status === 'cached') {
          actualStatus.has_thumbnails = true;
        } else if (result.status === 'error') {
          hasErrors = true;
          debugError('Preprocessing', `Thumbnail error: ${result.error}`);
        }
        debug('Preprocessing', `Thumbnails generated: ${filePath}`);
      } catch (err) {
        hasErrors = true;
        debugError('Preprocessing', `Thumbnail generation failed: ${err.message}`);
      }
    }

    // Mark as complete or error based on actual results
    if (hasErrors) {
      this.processing.set(filePath, {
        status: PreprocessingStatus.ERROR,
        error: 'One or more preprocessing steps failed'
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
    this.processing.delete(filePath);
    this.completed.set(filePath, {
      hash: fileHash,
      ...cacheData,
      completedAt: Date.now()
    });
    this.emit('completed', { filePath, hash: fileHash });
    debug('Preprocessing', `Completed: ${filePath}`);
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
    debug('Preprocessing', 'Config updated:', { maxWorkers: this.maxWorkers, enabled: this.enabled, steps: this.steps });
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
      enabled: this.enabled
    };
  }

  /**
   * Stop all processing and clear queue
   */
  stop() {
    this.queue = [];
    debug('Preprocessing', 'Manager stopped, queue cleared');
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
