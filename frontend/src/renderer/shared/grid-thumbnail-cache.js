/**
 * Grid Thumbnail Cache
 *
 * In-memory blob URL cache for whole-frame overview thumbnails, used by the
 * culling grid where many images are shown at once.
 *
 * Backed by the backend endpoint GET /api/v1/preprocessing/preview-thumb, which
 * downscales JPEG/RAW and caches on disk. This client cache keeps the fetched
 * blob URLs so scrolling/re-render doesn't re-fetch.
 *
 * Keyed on path|size|fingerprint. The fingerprint (mtime-size) lets an in-place
 * re-export invalidate the cell — mirrors how the loupe cache-busts by mtime+size
 * (see shared/fileUrl.js). Larger LRU cap than the face-thumbnail cache since a
 * grid holds many cells simultaneously.
 */

import { debug, debugWarn } from './debug.js';
import { apiClient } from './api-client.js';

export class GridThumbnailCache {
  constructor(maxSize = 400) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = [];
  }

  _getCacheKey(imagePath, size, fingerprint) {
    return `${imagePath}|${size}|${fingerprint ?? ''}`;
  }

  /**
   * Get or fetch an overview thumbnail as a blob URL.
   * @param {string} imagePath - Source image path
   * @param {number} size - Thumbnail size (longest edge, px)
   * @param {string} [fingerprint] - Cache-busting token (e.g. `${mtimeMs}-${size}`)
   * @returns {Promise<string>} Blob URL for the thumbnail
   */
  async getThumbnail(imagePath, size = 256, fingerprint) {
    const key = this._getCacheKey(imagePath, size, fingerprint);

    if (this.cache.has(key)) {
      this._updateAccessOrder(key);
      return this.cache.get(key);
    }

    const url = new URL('/api/v1/preprocessing/preview-thumb', apiClient.baseUrl);
    url.searchParams.set('path', imagePath);
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

      this._enforceLimit();

      this.cache.set(key, blobUrl);
      this.accessOrder.push(key);
      debug('GridThumbnailCache', `Cached: ${key.slice(0, 40)}... (${this.cache.size}/${this.maxSize})`);

      return blobUrl;
    } catch (err) {
      debugWarn('GridThumbnailCache', `Failed to fetch thumbnail: ${err.message}`);
      throw err;
    }
  }

  _updateAccessOrder(key) {
    const index = this.accessOrder.indexOf(key);
    if (index > -1) {
      this.accessOrder.splice(index, 1);
    }
    this.accessOrder.push(key);
  }

  _enforceLimit() {
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldestKey = this.accessOrder.shift();
      const blobUrl = this.cache.get(oldestKey);
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
        this.cache.delete(oldestKey);
        debug('GridThumbnailCache', `Evicted: ${oldestKey.slice(0, 40)}...`);
      }
    }
  }

  clear() {
    for (const blobUrl of this.cache.values()) {
      URL.revokeObjectURL(blobUrl);
    }
    this.cache.clear();
    this.accessOrder = [];
    debug('GridThumbnailCache', 'Cache cleared');
  }

  getStats() {
    return { size: this.cache.size, maxSize: this.maxSize };
  }
}

// Singleton instance
export const gridThumbnailCache = new GridThumbnailCache(400);

/**
 * React hook for a cached overview thumbnail.
 * @param {string} imagePath - Source image path
 * @param {number} size - Thumbnail size (longest edge, px)
 * @param {string} [fingerprint] - Cache-busting token (e.g. `${mtimeMs}-${size}`)
 * @returns {{ url: string|null, loading: boolean, error: Error|null }}
 */
export function useGridThumbnail(imagePath, size = 256, fingerprint) {
  const { useState, useEffect } = require('react');

  const [state, setState] = useState({ url: null, loading: true, error: null });

  useEffect(() => {
    if (!imagePath) {
      setState({ url: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState((prev) => ({ ...prev, loading: true, error: null }));

    gridThumbnailCache.getThumbnail(imagePath, size, fingerprint)
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
  }, [imagePath, size, fingerprint]);

  return state;
}
