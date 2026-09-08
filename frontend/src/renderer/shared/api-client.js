/**
 * API Client
 *
 * HTTP and WebSocket client for communicating with the FastAPI backend.
 * Provides methods for REST API calls and WebSocket event streaming.
 */

import { debug, debugWarn, debugError } from './debug.js';
import { t } from '../../i18n/index.js';

export class NetworkError extends Error {
  constructor(
    message,
    {
      isOffline = false,
      isTimeout = false,
      statusCode = null,
      retryable = true,
    } = {},
  ) {
    super(message);
    this.name = 'NetworkError';
    this.isOffline = isOffline;
    this.isTimeout = isTimeout;
    this.statusCode = statusCode;
    this.retryable = retryable;
  }
}

/**
 * True when an error means the request never reached a completed backend
 * response — a timed-out or dropped/offline connection. It is deliberately
 * strict: a genuine backend response (4xx/5xx sets `statusCode`) and any other
 * unexpected throw (no `statusCode`, but also no `isTimeout`/`isOffline`) both
 * return false. Callers whose work continues server-side and reports out of
 * band (e.g. the card import, which streams a terminal event over the
 * WebSocket) use this to treat a lost response as "still running" rather than a
 * failure — while never swallowing a real error into an endless in-progress state.
 * @param {unknown} err
 * @returns {boolean}
 */
export function isConnectionLostError(err) {
  return err?.statusCode == null && Boolean(err?.isTimeout || err?.isOffline);
}

export class APIClient {
  constructor(baseUrl = 'http://127.0.0.1:5001') {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.wsHandlers = new Map();
    this.connectionListeners = new Set();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.isConnecting = false;
    this._connected = false;
    this._shouldReconnect = true;
    this._isOffline = false;
    this._offlineListeners = new Set();
    this._requestTimeout = 30000;
  }

  get isOffline() {
    return this._isOffline;
  }

  addOfflineListener(callback) {
    this._offlineListeners.add(callback);
    callback(this._isOffline);
  }

  removeOfflineListener(callback) {
    this._offlineListeners.delete(callback);
  }

  _setOffline(offline) {
    if (this._isOffline !== offline) {
      this._isOffline = offline;
      this._offlineListeners.forEach((cb) => {
        try {
          cb(offline);
        } catch (e) {
          debugError('APIClient', 'Offline listener error:', e);
        }
      });
    }
  }

  async _classifyError(err, response = null) {
    if (!navigator.onLine) {
      this._setOffline(true);
      return new NetworkError(t('errors.noConnection'), {
        isOffline: true,
        retryable: true,
      });
    }

    if (err?.name === 'AbortError') {
      return new NetworkError(t('errors.timeout'), {
        isTimeout: true,
        retryable: true,
      });
    }

    if (err?.name === 'TypeError' && err.message.includes('fetch')) {
      this._setOffline(true);
      return new NetworkError(t('errors.unreachable'), {
        isOffline: true,
        retryable: true,
      });
    }

    if (response) {
      const statusCode = response.status;
      const retryable = statusCode >= 500 || statusCode === 429;
      // Prefer the backend's JSON error detail (FastAPI `{"detail": "..."}`)
      // over the bare status text so users see the real cause, e.g.
      // "HTTP 400: exiftool krävs men hittades inte i PATH." The response body
      // can only be read once; this is the sole reader on the error path (the
      // success path returns before classification runs).
      const detail = await this._readErrorDetail(response);
      const message = detail || response.statusText;
      return new NetworkError(`HTTP ${statusCode}: ${message}`, {
        statusCode,
        retryable,
      });
    }

    return new NetworkError(err?.message || t('errors.unknown'), {
      retryable: false,
    });
  }

  /**
   * Read a FastAPI-style error detail string from a response body.
   * Returns null for non-JSON bodies, a non-string `detail`, or a body that
   * cannot be read (e.g. already consumed) — callers fall back to status text.
   * @param {Response} response
   * @returns {Promise<string|null>}
   */
  async _readErrorDetail(response) {
    try {
      const body = await response.json();
      if (body && typeof body.detail === 'string') {
        return body.detail;
      }
    } catch {
      // Non-JSON or unreadable body → caller falls back to statusText.
    }
    return null;
  }

  addConnectionListener(callback) {
    this.connectionListeners.add(callback);
    callback(this._connected);
  }

  removeConnectionListener(callback) {
    this.connectionListeners.delete(callback);
  }

  _notifyConnectionListeners(connected) {
    this._connected = connected;
    this.connectionListeners.forEach((cb) => {
      try {
        cb(connected);
      } catch (e) {
        debugError('APIClient', 'Connection listener error:', e);
      }
    });
  }

  async _fetchWithTimeout(url, options = {}) {
    // Per-call timeout override: `options.timeout` (ms) wins over the default,
    // and `0` disables the timeout entirely — for long-running calls (e.g. a
    // multi-minute card import) that must not be aborted mid-flight. `timeout`
    // is stripped here so it is never forwarded to fetch as a request option.
    const { timeout, ...fetchOptions } = options;
    const effectiveTimeout = timeout != null ? timeout : this._requestTimeout;
    const controller = new AbortController();
    const externalSignal = fetchOptions.signal;

    // Honour a signal that is already aborted before the request starts.
    if (externalSignal?.aborted) {
      controller.abort();
    }

    // Forward a later external abort. Use { once: true } and remove in finally
    // so a long-lived caller signal does not accumulate listeners across calls.
    const onExternalAbort = () => controller.abort();
    if (externalSignal && !externalSignal.aborted) {
      externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }

    const timeoutId =
      effectiveTimeout > 0
        ? setTimeout(() => controller.abort(), effectiveTimeout)
        : null;

    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: controller.signal,
      });
      this._setOffline(false);
      return response;
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  }

  /**
   * HTTP GET request
   * @param {string} path - API path (e.g., '/api/v1/status/image.jpg')
   * @param {object} params - Query parameters
   * @returns {Promise<any>}
   */
  async get(path, params = {}) {
    const url = new URL(path, this.baseUrl);

    Object.keys(params).forEach((key) => {
      url.searchParams.append(key, params[key]);
    });

    let response;
    try {
      response = await this._fetchWithTimeout(url.toString(), {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw await this._classifyError(null, response);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof NetworkError) {
        debugError('Backend', `GET ${path} failed:`, err.message);
        throw err;
      }
      const classified = await this._classifyError(err, response);
      debugError('Backend', `GET ${path} failed:`, classified.message);
      throw classified;
    }
  }

  /**
   * HTTP POST request
   * @param {string} path - API path (e.g., '/api/v1/detect-faces')
   * @param {object} body - Request body
   * @param {object} options - Optional fetch options (e.g., { signal: AbortSignal })
   * @returns {Promise<any>}
   */
  async post(path, body = {}, options = {}) {
    const url = new URL(path, this.baseUrl);

    let response;
    try {
      response = await this._fetchWithTimeout(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        ...options,
      });

      if (!response.ok) {
        throw await this._classifyError(null, response);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof NetworkError) {
        debugError('Backend', `POST ${path} failed:`, err.message);
        throw err;
      }
      const classified = await this._classifyError(err, response);
      debugError('Backend', `POST ${path} failed:`, classified.message);
      throw classified;
    }
  }

  /**
   * Check backend health
   * @returns {Promise<boolean>}
   */
  async health() {
    try {
      const response = await this.get('/health');
      return response.status === 'ok';
    } catch {
      return false;
    }
  }

  async setLogLevel(level) {
    try {
      await this.post('/api/v1/log-level', { level });
      debug('APIClient', `Backend log level set to ${level}`);
    } catch (err) {
      debugWarn('APIClient', `Failed to set log level: ${err.message}`);
    }
  }

  async setLogCategories(categories) {
    try {
      await this.post('/api/v1/log-categories', { categories });
      debug(
        'APIClient',
        `Backend log categories set: ${categories.length} categories`,
      );
    } catch (err) {
      debugWarn('APIClient', `Failed to set log categories: ${err.message}`);
    }
  }

  /**
   * Connect to WebSocket for real-time updates
   * @returns {Promise<void>}
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      debug('WebSocket', 'WebSocket already connected');
      return Promise.resolve();
    }

    if (this.isConnecting) {
      debug('WebSocket', 'WebSocket connection already in progress');
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl
        .replace('http://', 'ws://')
        .replace('https://', 'wss://');
      const url = `${wsUrl}/ws/progress`;

      debug('WebSocket', 'Connecting to WebSocket:', url);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        debug('WebSocket', 'WebSocket connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this._shouldReconnect = true; // Re-enable reconnection on successful connect
        this.isConnecting = false;
        this._notifyConnectionListeners(true);
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { event: eventName, data } = message;

          // Trigger all registered handlers for this event
          if (this.wsHandlers.has(eventName)) {
            this.wsHandlers.get(eventName).forEach((callback) => {
              try {
                callback(data);
              } catch (err) {
                debugError(
                  'WebSocket',
                  `Error in WebSocket handler for ${eventName}:`,
                  err,
                );
              }
            });
          }
        } catch (err) {
          debugError('WebSocket', 'Error parsing WebSocket message:', err);
        }
      };

      this.ws.onerror = (error) => {
        debugError('WebSocket', 'WebSocket error:', error);
        this.isConnecting = false;
        reject(error);
      };

      this.ws.onclose = () => {
        debug('WebSocket', 'WebSocket disconnected');
        this.isConnecting = false;
        this._notifyConnectionListeners(false);

        // Don't reconnect if intentionally disconnected
        if (!this._shouldReconnect) {
          debug('WebSocket', 'Reconnection disabled');
          return;
        }

        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;

          // Exponential backoff with cap and jitter
          let delay =
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          delay = Math.min(delay, this.maxReconnectDelay); // Cap at max

          // Add ±20% jitter to prevent thundering herd
          const jitter = delay * 0.2 * (Math.random() * 2 - 1);
          delay = Math.round(delay + jitter);

          debug(
            'WebSocket',
            `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
          );

          setTimeout(() => {
            this.connectWebSocket().catch((err) => {
              debugError('WebSocket', 'Reconnection failed:', err);
            });
          }, delay);
        } else {
          debugError('WebSocket', 'Max reconnection attempts reached');
        }
      };
    });
  }

  /**
   * Subscribe to WebSocket event
   * @param {string} eventName - Event name (e.g., 'log-entry', 'face-detected')
   * @param {Function} callback - Callback function
   */
  onWSEvent(eventName, callback) {
    if (!this.wsHandlers.has(eventName)) {
      this.wsHandlers.set(eventName, new Set());
    }
    this.wsHandlers.get(eventName).add(callback);
  }

  /**
   * Unsubscribe from WebSocket event
   * @param {string} eventName - Event name
   * @param {Function} callback - Callback function
   */
  offWSEvent(eventName, callback) {
    if (this.wsHandlers.has(eventName)) {
      this.wsHandlers.get(eventName).delete(callback);
    }
  }

  /**
   * Disconnect WebSocket
   * @param {boolean} allowReconnect - Whether to allow automatic reconnection after disconnect.
   *   - false (default): Disconnect permanently, no auto-reconnect
   *   - true: Disconnect but allow auto-reconnect (e.g., for temporary network issues)
   */
  disconnectWebSocket(allowReconnect = false) {
    this._shouldReconnect = allowReconnect;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if WebSocket is connected
   * @returns {boolean}
   */
  isConnected() {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Detect faces in an image
   * @param {string} imagePath - Path to image file
   * @param {boolean} forceReprocess - Force reprocessing even if cached
   * @returns {Promise<object>}
   */
  async detectFaces(imagePath, forceReprocess = false) {
    return await this.post('/api/v1/detect-faces', {
      image_path: imagePath,
      force_reprocess: forceReprocess,
    });
  }

  /**
   * Confirm face identity
   * @param {string} faceId - Face identifier
   * @param {string} personName - Person name
   * @param {string} imagePath - Source image path
   * @returns {Promise<object>}
   */
  async confirmIdentity(faceId, personName, imagePath) {
    return await this.post('/api/v1/confirm-identity', {
      face_id: faceId,
      person_name: personName,
      image_path: imagePath,
    });
  }

  /**
   * Ignore/reject a face
   * @param {string} faceId - Face identifier
   * @param {string} imagePath - Source image path
   * @returns {Promise<object>}
   */
  async ignoreFace(faceId, imagePath) {
    return await this.post('/api/v1/ignore-face', {
      face_id: faceId,
      image_path: imagePath,
    });
  }

  /**
   * Get image processing status
   * @param {string} imagePath - Path to image file
   * @returns {Promise<object>}
   */
  async getImageStatus(imagePath) {
    // Encode path for URL
    const encodedPath = encodeURIComponent(imagePath);
    return await this.get(`/api/status/${encodedPath}`);
  }

  /**
   * Get list of people in database
   * @returns {Promise<Array>}
   */
  async getPeople() {
    return await this.get('/api/v1/database/people');
  }

  /**
   * Get list of person names (for autocomplete)
   * @returns {Promise<Array<string>>}
   */
  async getPeopleNames() {
    return await this.get('/api/v1/database/people/names');
  }

  // ============================================================================
  // Preprocessing API
  // ============================================================================

  /**
   * Get preprocessing cache status
   * @returns {Promise<object>}
   */
  async getCacheStatus() {
    return await this.get('/api/v1/preprocessing/cache/status');
  }

  /**
   * Update cache settings
   * @param {object} settings - Settings to update
   * @returns {Promise<object>}
   */
  async updateCacheSettings(settings) {
    return await this.post('/api/v1/preprocessing/cache/settings', settings);
  }

  /**
   * Get the app-trash auto-purge threshold in days (0 = keep forever)
   * @returns {Promise<{days: number}>}
   */
  async getTrashRetention() {
    return await this.get('/api/v1/culling/retention');
  }

  /**
   * Set the app-trash auto-purge threshold
   * @param {number} days - Days to keep trashed files (0 = keep forever)
   * @returns {Promise<{days: number}>}
   */
  async setTrashRetention(days) {
    return await this.post('/api/v1/culling/retention', { days });
  }

  /**
   * Clear preprocessing cache
   * @returns {Promise<object>}
   */
  async clearCache() {
    const url = new URL('/api/v1/preprocessing/cache', this.baseUrl);

    let response;
    try {
      response = await this._fetchWithTimeout(url.toString(), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw await this._classifyError(null, response);
      }

      return await response.json();
    } catch (err) {
      if (err instanceof NetworkError) {
        debugError(
          'Backend',
          'DELETE /api/v1/preprocessing/cache failed:',
          err.message,
        );
        throw err;
      }
      const classified = await this._classifyError(err, response);
      debugError(
        'Backend',
        'DELETE /api/v1/preprocessing/cache failed:',
        classified.message,
      );
      throw classified;
    }
  }

  /**
   * Delete multiple cache entries by hash
   * @param {string[]} fileHashes - Array of file hashes to delete
   * @returns {Promise<object>}
   */
  async batchDeleteCache(fileHashes) {
    return await this.post('/api/v1/preprocessing/cache/batch-delete', {
      file_hashes: fileHashes,
    });
  }

  /**
   * Set priority hashes for cache eviction (files in queue evicted last)
   * @param {string[]} fileHashes - Array of file hashes to prioritize
   * @returns {Promise<object>}
   */
  async setPriorityCacheHashes(fileHashes) {
    return await this.post('/api/v1/preprocessing/cache/priority', {
      file_hashes: fileHashes,
    });
  }

  /**
   * Compute file hash
   * @param {string} filePath - Path to file
   * @returns {Promise<object>}
   */
  async computeFileHash(filePath) {
    return await this.post('/api/v1/preprocessing/hash', {
      file_path: filePath,
    });
  }

  /**
   * Check what's cached for a file
   * @param {string} fileHash - File hash
   * @returns {Promise<object>}
   */
  async checkCache(fileHash) {
    return await this.post('/api/v1/preprocessing/check', {
      file_hash: fileHash,
    });
  }

  /**
   * Preprocess file (all steps)
   * @param {string} filePath - Path to file
   * @param {string[]} steps - Optional: specific steps to run
   * @returns {Promise<object>}
   */
  async preprocessFile(filePath, steps = null) {
    return await this.post('/api/v1/preprocessing/all', {
      file_path: filePath,
      steps: steps,
    });
  }
}

// Singleton instance
export const apiClient = new APIClient();
