// raw-index.js
// A lazily-built, TTL-cached filename index of a RAW root, keyed by the leading
// `YYMMDD_HHMMSS[-N]` timestamp token (see raw-match.js).
//
// Motivation: the `open-raw-in-lightroom` IPC handler resolves a viewed JPEG to
// its source NEF by scanning the RAW root. Done naively that recursive scan runs
// once PER KEYSTROKE — fine for small per-match folders, pathological for a big
// RAW root. This module scans the tree once, builds a `token -> sorted paths`
// map, and reuses it across keystrokes until a short TTL expires.
//
// Determinism: within a token the full paths are sorted lexicographically, the
// same order the old inline scan used (`matches.sort()`), so `lookup` returns the
// exact same "first" match as before.
//
// Invalidation: TTL-based. The simplest robust option — a keystroke burst hits
// the warm cache, while a freshly imported RAW appears within one TTL window. A
// filesystem watcher on the RAW root would be tighter but there is no existing
// watcher covering it (the `watch-folder` watchers are keyed to working/queue
// folders, not the RAW root), and adding a dedicated watcher belongs with the
// planned chokidar consolidation, not here.

const fs = require('fs');
const path = require('path');
const { deriveRawToken, DEFAULT_RAW_EXTS } = require('./raw-match');

const DEFAULT_TTL_MS = 30_000;

/**
 * Default recursive directory reader. Returns Dirent[] with parentPath (Node 20+)
 * so callers can reconstruct the full path a file was found at.
 * @param {string} root
 * @returns {Promise<import('fs').Dirent[]>}
 */
function defaultReaddir(root) {
  return fs.promises.readdir(root, { recursive: true, withFileTypes: true });
}

/**
 * Create a RAW-root filename index cache.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs] cache lifetime per root, ms (default 30s)
 * @param {() => number} [opts.now] clock, injectable for tests (default Date.now)
 * @param {(root: string) => Promise<import('fs').Dirent[]>} [opts.readdir]
 *        recursive dir reader, injectable for tests
 * @param {string[]} [opts.rawExts] allowed RAW extensions, lowercase with dot
 * @returns {{
 *   lookup: (root: string, token: string) => Promise<string|null>,
 *   getIndex: (root: string) => Promise<Map<string, string[]>>,
 *   buildIndex: (root: string) => Promise<Map<string, string[]>>,
 *   invalidate: (root?: string) => void,
 * }}
 */
function createRawIndexCache({
  ttlMs = DEFAULT_TTL_MS,
  now = Date.now,
  readdir = defaultReaddir,
  rawExts = DEFAULT_RAW_EXTS,
} = {}) {
  // root -> { builtAt: number, index: Map<token, sortedPaths[]> }
  const cache = new Map();
  const exts = rawExts.map((ext) => ext.toLowerCase());

  /**
   * Scan `root` recursively and build a fresh `token -> sorted paths` index.
   * Only RAW files (matching one of `rawExts`) that carry a leading timestamp
   * token are indexed — the same predicate as basenameMatchesToken.
   */
  async function buildIndex(root) {
    const entries = await readdir(root);
    const index = new Map();
    for (const entry of entries) {
      if (typeof entry.isFile === 'function' && !entry.isFile()) continue;
      const name = entry.name;
      const lower = name.toLowerCase();
      if (!exts.some((ext) => lower.endsWith(ext))) continue;
      const token = deriveRawToken(name);
      if (!token) continue;
      // entry.parentPath (Node 20+) is the directory the file was found in;
      // fall back to entry.path (older Node) or the root itself.
      const dir = entry.parentPath || entry.path || root;
      const full = path.join(dir, name);
      const list = index.get(token);
      if (list) list.push(full);
      else index.set(token, [full]);
    }
    // Deterministic order within each token: same as the old inline matches.sort().
    for (const list of index.values()) list.sort();
    return index;
  }

  /**
   * Return the index for `root`, building (and caching) it if absent or stale.
   */
  async function getIndex(root) {
    const cached = cache.get(root);
    if (cached && now() - cached.builtAt < ttlMs) {
      return cached.index;
    }
    const index = await buildIndex(root);
    cache.set(root, { builtAt: now(), index });
    return index;
  }

  /**
   * Resolve the deterministic first RAW path whose leading token equals `token`,
   * or null if none. Same result the old per-keystroke scan produced.
   */
  async function lookup(root, token) {
    if (!token) return null;
    const index = await getIndex(root);
    const list = index.get(token);
    return (list && list[0]) || null;
  }

  /**
   * Drop cached indexes. With no argument, clears every root.
   */
  function invalidate(root) {
    if (root === undefined) cache.clear();
    else cache.delete(root);
  }

  return { lookup, getIndex, buildIndex, invalidate };
}

module.exports = { createRawIndexCache, DEFAULT_TTL_MS };
