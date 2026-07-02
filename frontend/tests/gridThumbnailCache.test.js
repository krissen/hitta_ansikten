import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GridThumbnailCache } from '../src/renderer/shared/grid-thumbnail-cache.js';

let blobCounter = 0;
const originals = {};

beforeEach(() => {
  blobCounter = 0;
  // Save the real globals so we can restore them — vi.restoreAllMocks() does NOT
  // revert plain `global.x = ...` assignments, which would leak into other files.
  originals.createObjectURL = global.URL.createObjectURL;
  originals.revokeObjectURL = global.URL.revokeObjectURL;
  originals.fetch = global.fetch;
  global.URL.createObjectURL = vi.fn(() => `blob:${blobCounter++}`);
  global.URL.revokeObjectURL = vi.fn();
  global.fetch = vi.fn(async () => ({
    ok: true,
    blob: async () => ({ size: 42 }),
  }));
});

afterEach(() => {
  global.URL.createObjectURL = originals.createObjectURL;
  global.URL.revokeObjectURL = originals.revokeObjectURL;
  global.fetch = originals.fetch;
});

describe('GridThumbnailCache', () => {
  it('fetches once, then serves the cached blob URL (no second fetch)', async () => {
    const cache = new GridThumbnailCache(10);
    const a = await cache.getThumbnail('/p/a.jpg', 256, '100-2048');
    const b = await cache.getThumbnail('/p/a.jpg', 256, '100-2048');

    expect(a).toBe(b);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('refetches when the fingerprint changes (in-place re-export)', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a.jpg', 256, '100-2048');
    await cache.getThumbnail('/p/a.jpg', 256, '200-4096');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('treats size as part of the key', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a.jpg', 256, 'fp');
    await cache.getThumbnail('/p/a.jpg', 128, 'fp');

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('sends path + size to the preview-thumb endpoint', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a b.jpg', 200, 'fp');

    const calledUrl = global.fetch.mock.calls[0][0];
    expect(calledUrl).toContain('/api/v1/preprocessing/preview-thumb');
    expect(calledUrl).toContain('path=');
    expect(calledUrl).toContain('size=200');
  });

  it('includes the fingerprint in the request URL (defeats the HTTP cache)', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a.jpg', 256, '1700-2048');
    expect(global.fetch.mock.calls[0][0]).toContain('v=1700-2048');
  });

  it('omits the v param when no fingerprint is given', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a.jpg', 256);
    expect(global.fetch.mock.calls[0][0]).not.toContain('v=');
  });

  it('evicts and revokes the least-recently-used entry past maxSize', async () => {
    const cache = new GridThumbnailCache(2);
    await cache.getThumbnail('/p/a.jpg', 256, 'fp'); // blob:0
    await cache.getThumbnail('/p/b.jpg', 256, 'fp'); // blob:1
    await cache.getThumbnail('/p/c.jpg', 256, 'fp'); // evicts a → blob:2

    expect(global.URL.revokeObjectURL).toHaveBeenCalledWith('blob:0');
    expect(cache.getStats().size).toBe(2);
  });

  it('coalesces concurrent requests for the same key into one fetch', async () => {
    let resolveBlob;
    global.fetch = vi.fn(() => new Promise((res) => {
      resolveBlob = () => res({ ok: true, blob: async () => ({ size: 42 }) });
    }));
    const cache = new GridThumbnailCache(10);

    const p1 = cache.getThumbnail('/p/a.jpg', 256, 'fp');
    const p2 = cache.getThumbnail('/p/a.jpg', 256, 'fp');
    resolveBlob();
    const [u1, u2] = await Promise.all([p1, p2]);

    expect(global.fetch).toHaveBeenCalledTimes(1);   // one fetch, not two
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1); // one blob URL
    expect(u1).toBe(u2);
    expect(cache.getStats().size).toBe(1);
  });

  it('throws on an empty blob response', async () => {
    global.fetch = vi.fn(async () => ({ ok: true, blob: async () => ({ size: 0 }) }));
    const cache = new GridThumbnailCache(10);
    await expect(cache.getThumbnail('/p/a.jpg', 256, 'fp')).rejects.toThrow();
  });

  it('clear() revokes all blob URLs', async () => {
    const cache = new GridThumbnailCache(10);
    await cache.getThumbnail('/p/a.jpg', 256, 'fp');
    await cache.getThumbnail('/p/b.jpg', 256, 'fp');
    cache.clear();

    expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    expect(cache.getStats().size).toBe(0);
  });

  it("clear() during an in-flight fetch doesn't repopulate the cache", async () => {
    let resolveBlob;
    global.fetch = vi.fn(() => new Promise((res) => {
      resolveBlob = () => res({ ok: true, blob: async () => ({ size: 42 }) });
    }));
    const cache = new GridThumbnailCache(10);

    const p = cache.getThumbnail('/p/a.jpg', 256, 'fp');
    cache.clear();          // clears while the fetch is still pending
    resolveBlob();

    // The fetch is cancelled — it rejects rather than handing back a revoked URL.
    await expect(p).rejects.toMatchObject({ name: 'CacheClearedError' });
    expect(cache.getStats().size).toBe(0);                 // not repopulated
    expect(global.URL.revokeObjectURL).toHaveBeenCalled(); // the late blob was revoked
  });
});
