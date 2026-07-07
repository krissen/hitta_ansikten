import { describe, it, expect, vi } from 'vitest';
import { createRawIndexCache } from '../src/main/raw-index.js';

// Build fake Dirent-like entries for the injected readdir. Node 20 gives each
// entry a parentPath; we mirror that so the index reconstructs full paths.
function dirent(parentPath, name, isFile = true) {
  return { name, parentPath, isFile: () => isFile };
}

describe('createRawIndexCache.buildIndex', () => {
  it('keys RAW files by their leading token and ignores non-RAW / tokenless files', async () => {
    const entries = [
      dirent('/raw/a', '260626_194742_ArvidJ.NEF'),
      dirent('/raw/a', '260626_194742_ArvidJ.jpg'), // JPEG: not RAW
      dirent('/raw/a', '260626_194742_ArvidJ.xmp'), // sidecar: not RAW
      dirent('/raw/b', '260627_173803.NEF'),
      dirent('/raw/b', 'IMG_1234.NEF'), // no timestamp token
      dirent('/raw/b', 'subdir', false), // directory
    ];
    const cache = createRawIndexCache({ readdir: async () => entries });
    const index = await cache.buildIndex('/raw');

    expect([...index.keys()].sort()).toEqual(['260626_194742', '260627_173803']);
    expect(index.get('260626_194742')).toEqual(['/raw/a/260626_194742_ArvidJ.NEF']);
    expect(index.get('260627_173803')).toEqual(['/raw/b/260627_173803.NEF']);
  });
});

describe('createRawIndexCache.lookup', () => {
  it('returns the deterministic first (sorted) match for a token', async () => {
    // Three burst NEFs for the same token, supplied out of order.
    const entries = [
      dirent('/raw', '260626_194742_c.NEF'),
      dirent('/raw', '260626_194742_a.NEF'),
      dirent('/raw', '260626_194742_b.NEF'),
    ];
    const cache = createRawIndexCache({ readdir: async () => entries });
    expect(await cache.lookup('/raw', '260626_194742')).toBe('/raw/260626_194742_a.NEF');
  });

  it('distinguishes a plain token from its burst counterpart (exact token equality)', async () => {
    const entries = [
      dirent('/raw', '260627_173803.NEF'),
      dirent('/raw', '260627_173803-1.NEF'),
    ];
    const cache = createRawIndexCache({ readdir: async () => entries });
    expect(await cache.lookup('/raw', '260627_173803')).toBe('/raw/260627_173803.NEF');
    expect(await cache.lookup('/raw', '260627_173803-1')).toBe('/raw/260627_173803-1.NEF');
  });

  it('returns null for an unknown token and for a falsy token', async () => {
    const cache = createRawIndexCache({ readdir: async () => [dirent('/raw', '260626_194742.NEF')] });
    expect(await cache.lookup('/raw', '999999_999999')).toBeNull();
    expect(await cache.lookup('/raw', null)).toBeNull();
    expect(await cache.lookup('/raw', '')).toBeNull();
  });

  it('is case-insensitive on the RAW extension', async () => {
    const cache = createRawIndexCache({ readdir: async () => [dirent('/raw', '260626_194742_x.nef')] });
    expect(await cache.lookup('/raw', '260626_194742')).toBe('/raw/260626_194742_x.nef');
  });
});

describe('createRawIndexCache caching + TTL', () => {
  it('scans once across a keystroke burst, then rescans after the TTL expires', async () => {
    let clock = 1000;
    const readdir = vi.fn(async () => [dirent('/raw', '260626_194742.NEF')]);
    const cache = createRawIndexCache({ readdir, ttlMs: 30_000, now: () => clock });

    // Burst of lookups within the TTL window -> a single scan.
    await cache.lookup('/raw', '260626_194742');
    await cache.lookup('/raw', '260626_194742');
    clock += 29_999;
    await cache.lookup('/raw', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(1);

    // Cross the TTL boundary -> exactly one more scan.
    clock += 2;
    await cache.lookup('/raw', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(2);
  });

  it('caches per-root independently', async () => {
    const readdir = vi.fn(async (root) => [dirent(root, '260626_194742.NEF')]);
    const cache = createRawIndexCache({ readdir, now: () => 0 });

    await cache.lookup('/raw/one', '260626_194742');
    await cache.lookup('/raw/two', '260626_194742');
    await cache.lookup('/raw/one', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(2);
    expect(await cache.lookup('/raw/two', '260626_194742')).toBe('/raw/two/260626_194742.NEF');
  });

  it('invalidate() forces a rescan', async () => {
    const readdir = vi.fn(async () => [dirent('/raw', '260626_194742.NEF')]);
    const cache = createRawIndexCache({ readdir, now: () => 0 });

    await cache.lookup('/raw', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(1);
    cache.invalidate('/raw');
    await cache.lookup('/raw', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(2);
    cache.invalidate(); // clear all
    await cache.lookup('/raw', '260626_194742');
    expect(readdir).toHaveBeenCalledTimes(3);
  });
});
