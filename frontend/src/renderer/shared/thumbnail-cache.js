/**
 * Thumbnail Cache
 *
 * In-memory blob URL cache for face thumbnails.
 * Caches fetched thumbnails as blob URLs to avoid re-fetching
 * during navigation and component re-renders.
 *
 * Features:
 * - Automatic blob URL creation and caching
 * - LRU eviction when cache exceeds max size
 * - Automatic cleanup of blob URLs on eviction
 */

import { debug, debugWarn } from './debug.js';
import { apiClient } from './api-client.js';

class ThumbnailCache {
  constructor(maxSize = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
  }

  /**
   * Get cache key from thumbnail URL parameters
   */
  _getCacheKey(imagePath, bbox, size = 150) {
    return `${imagePath}|${bbox.x},${bbox.y},${bbox.width},${bbox.height}|${size}`;
  }

  /**
   * Get or fetch a thumbnail as a blob URL
   * @param {string} imagePath - Source image path
   * @param {object} bbox - Bounding box {x, y, width, height}
   * @param {number} size - Thumbnail size (default 150)
   * @returns {Promise<string>} Blob URL for the thumbnail
   */
  async getThumbnail(imagePath, bbox, size = 150) {
    const key = this._getCacheKey(imagePath, bbox, size);

    // Check cache
    if (this.cache.has(key)) {
      debug('ThumbnailCache', `Cache hit: ${key.slice(0, 40)}...`);
      this._updateAccessOrder(key);
      return this.cache.get(key);
    }

    // Fetch and cache
    const url = new URL('/api/v1/face-thumbnail', apiClient.baseUrl);
    url.searchParams.set('image_path', imagePath);
    url.searchParams.set('x', bbox.x || 0);
    url.searchParams.set('y', bbox.y || 0);
    url.searchParams.set('width', bbox.width || 100);
    url.searchParams.set('height', bbox.height || 100);
    url.searchParams.set('size', size);

    try {
      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('Empty thumbnail response');
      }
      const blobUrl = URL.createObjectURL(blob);

      // Enforce size limit before adding
      this._enforceLimit();

      // Store in cache
      this.cache.set(key, blobUrl);
      this.accessOrder.push(key);
      debug(
        'ThumbnailCache',
        `Cached: ${key.slice(0, 40)}... (${this.cache.size}/${this.maxSize})`,
      );

      return blobUrl;
    } catch (err) {
      debugWarn('ThumbnailCache', `Failed to fetch thumbnail: ${err.message}`);
      throw err;
    }
  }

  /**
   * Update LRU access order
   */
  _updateAccessOrder(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  /**
   * Enforce cache size limit (LRU eviction)
   */
  _enforceLimit() {
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      const blobUrl = this.cache.get(oldestKey);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        this.cache.delete(oldestKey);
        debug('ThumbnailCache', `Evicted: ${oldestKey.slice(0, 40)}...`);
      }
    }
  }

  /**
   * Clear all cached thumbnails
   */
  clear() {
    for (const blobUrl of this.cache.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.cache.clear();
    this.accessOrder = [];
    debug('ThumbnailCache', 'Cache cleared');
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

// Singleton instance
export const thumbnailCache = new ThumbnailCache(100);

/**
 * React hook for getting cached thumbnails
 * @param {string} imagePath - Source image path
 * @param {object} bbox - Bounding box {x, y, width, height}
 * @param {number} size - Thumbnail size (default 150)
 * @returns {{ url: string|null, loading: boolean, error: Error|null }}
 */
export function useThumbnail(imagePath, bbox, size = 150) {
  const { useState, useEffect } = require('react');

  const [state, setState] = useState({ url: null, loading: true, error: null });

  useEffect(() => {
    if (!imagePath || !bbox) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    thumbnailCache
      .getThumbnail(imagePath, bbox, size)
      .then((url) => {
        if (!cancelled) {
          setState({ url, loading: false, error: null });
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState({ url: null, loading: false, error });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [imagePath, bbox?.x, bbox?.y, bbox?.width, bbox?.height, size]);

  return state;
}
