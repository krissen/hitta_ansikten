/**
 * API Client
 *
 * HTTP and WebSocket client for communicating with the FastAPI backend.
 * Provides methods for REST API calls and WebSocket event streaming.
 */

export class APIClient {
  constructor(baseUrl = 'http://127.0.0.1:5001') {
    this.baseUrl = baseUrl;
    this.ws = null;
    this.wsHandlers = new Map(); // event name -> Set of callbacks
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.isConnecting = false;
  }

  /**
   * HTTP GET request
   * @param {string} path - API path (e.g., '/api/status/image.jpg')
   * @param {object} params - Query parameters
   * @returns {Promise<any>}
   */
  async get(path, params = {}) {
    const url = new URL(path, this.baseUrl);

    // Add query parameters
    Object.keys(params).forEach(key => {
      url.searchParams.append(key, params[key]);
    });

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[APIClient] GET ${path} failed:`, err);
      throw err;
    }
  }

  /**
   * HTTP POST request
   * @param {string} path - API path (e.g., '/api/detect-faces')
   * @param {object} body - Request body
   * @returns {Promise<any>}
   */
  async post(path, body = {}) {
    const url = new URL(path, this.baseUrl);

    try {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (err) {
      console.error(`[APIClient] POST ${path} failed:`, err);
      throw err;
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

  /**
   * Connect to WebSocket for real-time updates
   * @returns {Promise<void>}
   */
  connectWebSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[APIClient] WebSocket already connected');
      return Promise.resolve();
    }

    if (this.isConnecting) {
      console.log('[APIClient] WebSocket connection already in progress');
      return Promise.resolve();
    }

    this.isConnecting = true;

    return new Promise((resolve, reject) => {
      const wsUrl = this.baseUrl.replace('http://', 'ws://').replace('https://', 'wss://');
      const url = `${wsUrl}/ws/progress`;

      console.log('[APIClient] Connecting to WebSocket:', url);

      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('[APIClient] WebSocket connected');
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.isConnecting = false;
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          const { event: eventName, data } = message;

          // Trigger all registered handlers for this event
          if (this.wsHandlers.has(eventName)) {
            this.wsHandlers.get(eventName).forEach(callback => {
              try {
                callback(data);
              } catch (err) {
                console.error(`[APIClient] Error in WebSocket handler for ${eventName}:`, err);
              }
            });
          }
        } catch (err) {
          console.error('[APIClient] Error parsing WebSocket message:', err);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[APIClient] WebSocket error:', error);
        this.isConnecting = false;
        reject(error);
      };

      this.ws.onclose = () => {
        console.log('[APIClient] WebSocket disconnected');
        this.isConnecting = false;

        // Attempt reconnection with exponential backoff
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

          console.log(`[APIClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

          setTimeout(() => {
            this.connectWebSocket().catch(err => {
              console.error('[APIClient] Reconnection failed:', err);
            });
          }, delay);
        } else {
          console.error('[APIClient] Max reconnection attempts reached');
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
   */
  disconnectWebSocket() {
    if (this.ws) {
      this.reconnectAttempts = this.maxReconnectAttempts; // Prevent reconnection
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Detect faces in an image
   * @param {string} imagePath - Path to image file
   * @param {boolean} forceReprocess - Force reprocessing even if cached
   * @returns {Promise<object>}
   */
  async detectFaces(imagePath, forceReprocess = false) {
    return await this.post('/api/detect-faces', {
      image_path: imagePath,
      force_reprocess: forceReprocess
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
    return await this.post('/api/confirm-identity', {
      face_id: faceId,
      person_name: personName,
      image_path: imagePath
    });
  }

  /**
   * Ignore/reject a face
   * @param {string} faceId - Face identifier
   * @param {string} imagePath - Source image path
   * @returns {Promise<object>}
   */
  async ignoreFace(faceId, imagePath) {
    return await this.post('/api/ignore-face', {
      face_id: faceId,
      image_path: imagePath
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
    return await this.get('/api/database/people');
  }

  /**
   * Get list of person names (for autocomplete)
   * @returns {Promise<Array<string>>}
   */
  async getPeopleNames() {
    return await this.get('/api/database/people/names');
  }
}

// Singleton instance
export const apiClient = new APIClient();
