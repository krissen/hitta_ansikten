/**
 * CullingModule - Stats-driven culling/balancing workspace.
 *
 * Pick a player (or type a Finder-style glob), preview their JPEGs, and trash the
 * weak ones recoverably until each player is balanced against the others. Layout:
 * a full-width filter bar on top, then a resizable two-column row - file list on
 * the left, the selected image maximized on the right.
 *
 * Trashing is reversible (app-managed trash + restore). Works on JPEGs over
 * file://, so no NEF/RAW pipeline is needed.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useBackend } from '../context/BackendContext.jsx';
import { useModuleEvent } from '../hooks/useModuleEvent.js';
import { namesInBasename, removeNamesFromBasename } from './culling-names.js';
import { TrashPanel } from './TrashPanel.jsx';
import { CullingGrid } from './CullingGrid.jsx';
import { gridThumbnailCache } from '../shared/grid-thumbnail-cache.js';
import { gridNavTarget } from './culling-grid-nav.js';
import { preferences } from '../workspace/preferences.js';
import { getScanScope, setScanScope, scanScopeHasSelection, takeExternalLoad } from '../shared/scanScope.js';
import { toFileUrl, bustedFileUrl } from '../shared/fileUrl.js';
import { RAW_EXTS, extOf } from '../shared/fileExts.js';
import './CullingModule.css';

const REFRESH_DEBOUNCE_MS = 400;
// Rows to jump when paging the file list with Alt+arrow.
const PAGE_STEP = 10;

// Persisted widths of the two resizable internal column boundaries: the stats
// column (px) and the list/preview split (percent of the list+preview area).
const STATS_WIDTH_KEY = 'ansikten.culling.statsWidth';
const LIST_PCT_KEY = 'ansikten.culling.listPct';
const STATS_WIDTH_DEFAULT = 240;
const STATS_WIDTH_MIN = 150;
const LIST_PCT_DEFAULT = 32;

// View mode (single-image "loupe" vs. thumbnail "grid" overview), persisted like
// the column widths so the chosen mode survives a restart.
const VIEW_MODE_KEY = 'ansikten.culling.viewMode';
// Min grid cell width (px) — kept in sync with `minmax(160px, ...)` in
// CullingModule.css. Used to derive the column count for 2-D keyboard nav.
const GRID_CELL_MIN = 160;
const GRID_GAP = 8;

function readStoredNumber(key, fallback) {
  try {
    const v = parseFloat(localStorage.getItem(key));
    return Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function readStoredString(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}
// Delay RAW conversion until the selection settles, so fast keyboard stepping
// only converts the file the user rests on, not every file passed through.
const PREVIEW_DEBOUNCE_MS = 150;
// Delay before showing a loading indicator on a new JPEG selection — an
// already-settled file resolves faster than this, so stepping through old
// photos never flashes a placeholder; only a fresh, still-writing file waits.
const PREVIEW_LOADING_DELAY_MS = 150;
// If a file is still being written when the stat settle-wait times out, wait
// this long before re-checking rather than swapping in a possibly-partial decode.
const PREVIEW_RECHECK_MS = 800;

// The live stats panel counts every player in the folder, so it uses the
// scan scope only — not the player/name_glob filter that narrows the file list.
// It deliberately keeps the count endpoint's defaults (min_images, exclusions)
// so the included-player set matches `rakna_spelare.py` and the Räkna spelare
// page exactly — coaches/audience and below-threshold names land in `excluded`,
// not in the live count.
function statsScopeFromQuery(q) {
  if (!q) return null;
  return {
    roots: q.roots,
    globs: q.globs,
    extension_preset: q.extension_preset,
    recursive: q.recursive,
    date_from: q.date_from,
    date_to: q.date_to,
  };
}

export function CullingModule({ node }) {
  const { api } = useBackend();

  const [roots, setRoots] = useState([]);
  const [glob, setGlob] = useState('');
  const [player, setPlayer] = useState('');
  const [players, setPlayers] = useState([]);
  // Live per-player counts for the current scope (from /players/count), shown in
  // the left stats column and refreshed as files are culled.
  const [stats, setStats] = useState(null);
  const [preset, setPreset] = useState('jpg'); // jpg | nef | raw
  // Scope carried from the stats module (glob-only runs, date span, recursion).
  // The culling bar has no date inputs, so we keep these to honour the count's
  // selection and to preserve scope across a manual re-"Visa".
  const [carriedGlobs, setCarriedGlobs] = useState([]);
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [recursive, setRecursive] = useState(true);

  const [files, setFiles] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  // Inline rename: path of the file being edited (null = none) + its draft
  // value. Keyed by path, not list index, so a mid-edit auto-refresh that
  // reorders the list can't make Enter rename a different file.
  const [editPath, setEditPath] = useState(null);
  const [editValue, setEditValue] = useState('');
  // Right-click context menu: { x, y, path } at the cursor, or null. Keyed by
  // file path (not index) so a live list reload while the menu is open can't
  // make an action hit the wrong file — same approach as the inline rename.
  const [menu, setMenu] = useState(null);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasRun, setHasRun] = useState(false);

  const [showTrash, setShowTrash] = useState(false);

  // Widths of the two resizable column boundaries, restored from localStorage.
  // leftWidthPct is clamped to the drag range on read; statsWidth gets a lower
  // bound here and is additionally clamped against the live window width on
  // mount (a width saved on a wide window must not squash a narrow one).
  const [statsWidth, setStatsWidth] = useState(() =>
    Math.max(STATS_WIDTH_MIN, readStoredNumber(STATS_WIDTH_KEY, STATS_WIDTH_DEFAULT))
  );
  const [leftWidthPct, setLeftWidthPct] = useState(() =>
    Math.min(70, Math.max(15, readStoredNumber(LIST_PCT_KEY, LIST_PCT_DEFAULT)))
  );

  // View mode: 'single' (loupe, default) or 'grid' (thumbnail overview). Persisted.
  const [viewMode, setViewMode] = useState(() =>
    readStoredString(VIEW_MODE_KEY, 'single') === 'grid' ? 'grid' : 'single'
  );
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  // Player whose thumbnails are visually highlighted in the grid (session-only,
  // not a filter — the full set stays visible, non-matches are dimmed).
  const [highlightPlayer, setHighlightPlayer] = useState('');
  // Grid container + live column count for 2-D keyboard navigation.
  const gridRef = useRef(null);
  const colsRef = useRef(1);

  // Resolved preview for the right pane. JPEGs load directly; RAW goes through
  // the NEF->JPG pipeline, so resolution is async.
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  // Bumped on every folder-change so the current JPEG preview re-checks the file
  // on disk — a Lightroom re-export overwrites it in place (same path), so this
  // is what lets the preview pick up the fresh bytes.
  const [folderNonce, setFolderNonce] = useState(0);

  // Latest filter params for auto-refresh; undo stack of trashed ids.
  const lastQueryRef = useRef(null);
  // Monotonic id so out-of-order list responses (e.g. switching players fast on
  // a large folder) can't clobber a newer result — critical here because the
  // list drives which files `x`/Delete trashes.
  const reqSeqRef = useRef(0);
  const statsSeqRef = useRef(0);
  // New path of a just-renamed file to advance past, honored by whichever
  // loadList resolves last so a racing folder-watch refresh can't clobber the
  // auto-advance. Consumed (cleared) by that reload.
  const pendingAdvanceRef = useRef(null);
  const undoStackRef = useRef([]);
  const watchedDirsRef = useRef(new Set());
  const debounceRef = useRef(null);
  const statsDebounceRef = useRef(null);
  const mainRef = useRef(null);
  const bodyRef = useRef(null);
  const listRef = useRef(null);
  // Latest isLoading for the global keydown handler, so a cull shortcut can't
  // trash a file from the previous list while a new query is still resolving.
  const isLoadingRef = useRef(false);

  // Move keyboard focus to the file list so arrow/j-k navigation continues
  // seamlessly after an action that left focus on a control (the player
  // dropdown, or a name-overlay checkbox after a rename). preventScroll: the
  // dedicated autoscroll effect handles keeping the active row visible.
  const focusList = useCallback(() => {
    listRef.current?.focus({ preventScroll: true });
  }, []);
  isLoadingRef.current = isLoading;

  // The editable glob is a Finder-style basename filter (name_glob) over the
  // resolved files, NOT an independent filesystem glob. The scan source is
  // roots (+ any path-globs carried from the stats module).
  // `overrides` lets callers run with a just-changed value before the matching
  // setState has flushed (e.g. auto-apply on a dropdown change).
  const buildQuery = useCallback(
    (overrides = {}) => ({
      roots,
      globs: carriedGlobs,
      extension_preset: preset,
      recursive,
      date_from: dateFrom,
      date_to: dateTo,
      // Exact player filter (from the dropdown / stats hand-off) so substring
      // names can't conflate players; name_glob is the extra editable refinement.
      player: player || null,
      name_glob: glob.trim() || null,
      ...overrides,
    }),
    [roots, carriedGlobs, preset, recursive, dateFrom, dateTo, player, glob]
  );

  // ----- folder watching (live refresh) ------------------------------
  const watchDirs = useCallback(() => {
    const dirs = new Set(roots);
    for (const g of carriedGlobs) {
      const base = globBaseDir(g);
      if (base) dirs.add(base);
    }
    return dirs;
  }, [roots, carriedGlobs]);

  const updateWatches = useCallback((desired) => {
    const current = watchedDirsRef.current;
    for (const dir of current) {
      if (!desired.has(dir)) window.ansiktenAPI.unwatchFolder?.(dir);
    }
    for (const dir of desired) {
      if (!current.has(dir)) window.ansiktenAPI.watchFolder?.(dir, true);
    }
    watchedDirsRef.current = desired;
  }, []);

  // ----- listing ------------------------------------------------------
  const loadList = useCallback(
    async (query, { keepIndex = false, advancePastPath = null } = {}) => {
      // A fresh load (a deliberate (re)query, not a keepIndex folder-refresh or
      // a rename advance) drops any pending rename-advance, so a query issued
      // while a rename reload is still in flight resets to the top instead of
      // inheriting that stale target. The folder-watch refresh keeps it — that's
      // the race the ref must win.
      if (!keepIndex && !advancePastPath) pendingAdvanceRef.current = null;
      // Publish the scan scope so Räkna spelare mirrors the same selection.
      setScanScope(statsScopeFromQuery(query));
      const seq = ++reqSeqRef.current;
      setIsLoading(true);
      try {
        const data = await api.post('/api/v1/culling/files', query);
        if (seq !== reqSeqRef.current) return; // a newer request superseded this one
        // Honor an explicit advance target, or a pending one from a rename (so a
        // racing folder-watch refresh that resolves last still advances rather
        // than clobbering it). This is the winning reload, so consume the ref.
        const advanceTo = advancePastPath || pendingAdvanceRef.current;
        if (advanceTo) pendingAdvanceRef.current = null;
        setFiles(data.files);
        setPlayers(data.players);
        setError(null);
        setCurrentIndex((prev) => {
          if (data.files.length === 0) return -1;
          // Auto-advance after a rename: position relative to the renamed file
          // in the RELOADED list, so a file that left a player/glob filter
          // doesn't cause a skip. Still present → step to the next item; gone
          // (filtered out) → the next item already slid into prev's slot, stay.
          if (advanceTo) {
            const j = data.files.findIndex((f) => f.path === advanceTo);
            const target = j >= 0 ? j + 1 : (prev >= 0 ? prev : 0);
            return Math.min(target, data.files.length - 1);
          }
          if (keepIndex && prev >= 0) return Math.min(prev, data.files.length - 1);
          return 0;
        });
      } catch (err) {
        if (seq !== reqSeqRef.current) return;
        setError(err.message || String(err));
      } finally {
        // Leave isLoading true if a newer request is still in flight (it will clear it).
        if (seq === reqSeqRef.current) {
          setIsLoading(false);
          setHasRun(true);
        }
      }
    },
    [api]
  );

  // Live per-player counts for the scan scope (no player filter), so the panel
  // shows the balance across all players. Guarded against out-of-order responses.
  const loadStats = useCallback(
    async (scope) => {
      if (!scope) return;
      const seq = ++statsSeqRef.current;
      try {
        const data = await api.post('/api/v1/players/count', scope);
        if (seq !== statsSeqRef.current) return;
        setStats(data);
      } catch {
        if (seq === statsSeqRef.current) setStats(null);
      }
    },
    [api]
  );

  // Trailing-debounced stats refresh for the mutation paths (cull/restore), so
  // rapid culling coalesces into one rescan instead of a backend scan per key.
  const refreshStatsDebounced = useCallback(() => {
    if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
    statsDebounceRef.current = setTimeout(() => {
      loadStats(statsScopeFromQuery(lastQueryRef.current));
    }, REFRESH_DEBOUNCE_MS);
  }, [loadStats]);

  const runFilter = useCallback((overrides = {}) => {
    const query = buildQuery(overrides);
    lastQueryRef.current = query;
    loadList(query);
    loadStats(statsScopeFromQuery(query));
    updateWatches(watchDirs());
  }, [buildQuery, loadList, loadStats, updateWatches, watchDirs]);

  // Auto-refresh on folder change.
  useEffect(() => {
    const unsubscribe = window.ansiktenAPI.onFolderChanged?.(() => {
      if (!lastQueryRef.current) return;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        loadList(lastQueryRef.current, { keepIndex: true });
        loadStats(statsScopeFromQuery(lastQueryRef.current));
        // Re-check the current file too — if it was re-exported in place, the
        // preview needs to reload the new bytes (same path, changed content).
        setFolderNonce((n) => n + 1);
      }, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (statsDebounceRef.current) clearTimeout(statsDebounceRef.current);
      if (unsubscribe) unsubscribe();
      for (const dir of watchedDirsRef.current) window.ansiktenAPI.unwatchFolder?.(dir);
      watchedDirsRef.current = new Set();
      // Free the overview grid's blob URLs on teardown (all tabs stay mounted —
      // enableRenderOnDemand:false — so this runs only on genuine close, not a
      // tab switch, and won't refetch on return).
      gridThumbnailCache.clear();
    };
  }, [loadList, loadStats]);

  // ----- filter bar actions ------------------------------------------
  const addFolders = useCallback(async () => {
    try {
      const paths = await window.ansiktenAPI.invoke('open-folder-paths');
      if (paths && paths.length) {
        setRoots((r) => Array.from(new Set([...r, ...paths])));
        // A manual folder choice replaces the (hidden) scan source carried from a
        // glob-only count, so the stale glob can't silently mix into the results.
        setCarriedGlobs([]);
      }
    } catch (err) {
      console.error('[Culling] folder pick failed', err);
    }
  }, []);

  // Picking a player fills the editable glob with a basename pattern (the user's
  // "klicka till glob" affordance); the directory scope (roots) is untouched.
  const selectPlayer = useCallback((name) => {
    setPlayer(name);
    setGlob(name ? `*${name}*` : '');
  }, []);

  // Filter the file list to a player (stats-row click, loupe mode; and grid
  // double-click). Selecting the already-active player clears the filter — same
  // hand-off as the player dropdown.
  const filterToPlayer = useCallback((name) => {
    selectPlayer(name);
    if (lastQueryRef.current) {
      const g = name ? `*${name}*` : '';
      runFilter({ player: name || null, name_glob: g || null });
    }
  }, [selectPlayer, runFilter]);

  // Open filtered to a player from the stats module, honouring the count's full
  // scope: folders OR path-globs, the date span, and the recursion flag.
  useModuleEvent(
    'cull-player',
    (data) => {
      if (!data) return;
      // We are the external load the adopt effect deferred to — clear the flag
      // (covers the case where culling was already mounted so adopt didn't run).
      takeExternalLoad();
      const nextRoots = data.roots || [];
      const nextGlobs = data.globs || [];
      const nextRecursive = data.recursive ?? true;
      const nextFrom = data.date_from || null;
      const nextTo = data.date_to || null;
      setRoots(nextRoots);
      setCarriedGlobs(nextGlobs);
      setRecursive(nextRecursive);
      setDateFrom(nextFrom);
      setDateTo(nextTo);
      setPlayer(data.name || '');
      setGlob(data.name ? `*${data.name}*` : '');
      // Stats culling is always on developed JPEGs.
      setPreset('jpg');

      const query = {
        roots: nextRoots,
        globs: nextGlobs,
        extension_preset: 'jpg',
        recursive: nextRecursive,
        date_from: nextFrom,
        date_to: nextTo,
        player: data.name || null,
        name_glob: data.name ? `*${data.name}*` : null,
      };
      lastQueryRef.current = query;
      loadList(query);
      loadStats(statsScopeFromQuery(query));

      const dirs = new Set(nextRoots);
      for (const g of nextGlobs) {
        const base = globBaseDir(g);
        if (base) dirs.add(base);
      }
      updateWatches(dirs);
    },
    [loadList, loadStats, updateWatches]
  );

  // CLI hand-off (`ansikten culling DIR`): set the folder scope and run.
  // clear replaces the current roots; otherwise the folders are appended.
  // A bare clear (no roots) empties the workspace.
  useModuleEvent(
    'culling-load',
    (data) => {
      if (!data) return;
      const incoming = data.roots || [];
      const nextRoots = data.clear
        ? incoming
        : Array.from(new Set([...roots, ...incoming]));
      // CLI controls recursion explicitly (default off — just the named
      // folder); reflect it in the toggle so the user sees the active scope.
      const nextRecursive = data.recursive ?? false;

      setRoots(nextRoots);
      setRecursive(nextRecursive);
      // CLI scope is a plain folder pick — drop any glob/player/date carried
      // from a previous stats hand-off so it can't silently mix in.
      setCarriedGlobs([]);
      setPlayer('');
      setGlob('');
      setDateFrom(null);
      setDateTo(null);

      if (nextRoots.length === 0) {
        // Bare --clear: empty the list and stop watching. Bump the request seqs
        // so an in-flight load/stats from the mount-adopt (which fires when this
        // tab freshly mounts and a prior shared scope exists) is discarded when
        // it returns — otherwise it would repopulate the just-cleared workspace.
        ++reqSeqRef.current;
        ++statsSeqRef.current;
        setFiles([]);
        // Working set is being emptied — free the grid's cached thumbnail blobs
        // so a later scope doesn't inherit stale entries (guarded against any
        // in-flight fetch by the cache's generation counter).
        gridThumbnailCache.clear();
        setCurrentIndex(-1);
        setStats(null);
        setHasRun(false);
        // The discarded adopt load left isLoading true (its finally skips the
        // seq-mismatched response); reset it so the cleared workspace shows the
        // "välj mapp" hint instead of a stuck "…".
        setIsLoading(false);
        lastQueryRef.current = null;
        // Clear the shared scope too, so Räkna spelare (or a culling remount)
        // doesn't adopt the now-discarded selection.
        setScanScope(null);
        updateWatches(new Set());
        return;
      }

      const query = {
        roots: nextRoots,
        globs: [],
        extension_preset: preset,
        recursive: nextRecursive,
        date_from: null,
        date_to: null,
        player: null,
        name_glob: null,
      };
      lastQueryRef.current = query;
      loadList(query);
      loadStats(statsScopeFromQuery(query));
      updateWatches(new Set(nextRoots));
    },
    [roots, preset, loadList, loadStats, updateWatches]
  );

  // On open, adopt the shared scan scope (e.g. coming from Räkna spelare) when
  // we have nothing of our own yet. A CLI culling-load (~1s later) or any user
  // action still takes over; the player/name filter is never inherited.
  useEffect(() => {
    if (hasRun || roots.length > 0) return;
    // A cull-player hand-off (clicking a player in Räkna spelare) is about to
    // load the player-filtered query — skip the unfiltered adopt load so the
    // folder isn't scanned twice and the unfiltered list doesn't flash.
    if (takeExternalLoad()) return;
    const s = getScanScope();
    if (!scanScopeHasSelection(s)) return;
    // Culling's file-type control only knows jpg/nef/raw; Räkna also offers
    // images/all. Map a preset culling can't represent to jpg, so the dropdown
    // isn't desynced and the list doesn't include types culling never exposes.
    const preset = ['jpg', 'nef', 'raw'].includes(s.extension_preset) ? s.extension_preset : 'jpg';
    setRoots(s.roots || []);
    setCarriedGlobs(s.globs || []);
    setRecursive(s.recursive ?? true);
    setDateFrom(s.date_from || null);
    setDateTo(s.date_to || null);
    setPreset(preset);
    const query = {
      roots: s.roots || [],
      globs: s.globs || [],
      extension_preset: preset,
      recursive: s.recursive ?? true,
      date_from: s.date_from || null,
      date_to: s.date_to || null,
      player: null,
      name_glob: null,
    };
    lastQueryRef.current = query;
    loadList(query);
    loadStats(statsScopeFromQuery(query));
    // Watch roots AND each path-glob's base dir, so a glob-only mirrored scope
    // (e.g. adopted from Räkna spelare) still auto-refreshes on file changes.
    const dirs = new Set(s.roots || []);
    for (const g of (s.globs || [])) {
      const base = globBaseDir(g);
      if (base) dirs.add(base);
    }
    updateWatches(dirs);
     
  }, []);

  // ----- cull loop ----------------------------------------------------
  const trashIndex = useCallback(async (index) => {
    if (index < 0 || index >= files.length) return;
    const victim = files[index];
    // Optimistic: drop from list, advance.
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setCurrentIndex((prev) => {
      const nextLen = files.length - 1;
      if (nextLen === 0) return -1;
      return Math.min(prev, nextLen - 1);
    });
    try {
      const res = await api.post('/api/v1/culling/trash', { paths: [victim.path] });
      const id = res.trashed?.[0]?.id;
      if (id) {
        undoStackRef.current.push(id);
        // Reflect the removed image in the live counts (debounced for fast culling).
        refreshStatsDebounced();
      } else {
        // 200 with errors[] (permission/lock/race): the file is still on disk, so
        // roll the optimistic removal back by reloading and surface the reason.
        setError(res.errors?.[0]?.error || 'Kunde inte flytta filen till papperskorgen.');
        if (lastQueryRef.current) loadList(lastQueryRef.current, { keepIndex: true });
      }
    } catch (err) {
      setError(err.message || String(err));
      // Re-fetch to recover correct state on failure.
      if (lastQueryRef.current) loadList(lastQueryRef.current, { keepIndex: true });
    }
  }, [api, files, loadList, refreshStatsDebounced]);

  const trashCurrent = useCallback(() => trashIndex(currentIndex), [trashIndex, currentIndex]);

  const undoTrash = useCallback(async () => {
    // Pop until a still-trashed id restores - ids restored via the trash view
    // are removed from the stack, but guard anyway so Cmd+Z never no-ops loudly.
    while (undoStackRef.current.length > 0) {
      const id = undoStackRef.current.pop();
      try {
        const res = await api.post('/api/v1/culling/restore', { ids: [id] });
        if (res.restored && res.restored.length > 0) {
          if (lastQueryRef.current) {
            loadList(lastQueryRef.current, { keepIndex: true });
            refreshStatsDebounced();
          }
          return;
        }
        // id no longer in trash -> fall through and try the next one.
      } catch (err) {
        setError(err.message || String(err));
        return;
      }
    }
  }, [api, loadList, refreshStatsDebounced]);

  // ----- inline rename -----------------------------------------------
  // Edit the filename without its extension (Finder-style); the extension is
  // re-appended on commit so the YYMMDD_HHMMSS… format / suffix is preserved.
  const beginEdit = useCallback((index) => {
    const f = files[index];
    if (!f) return;
    setCurrentIndex(index);
    setEditValue(stripExt(f.basename));
    setEditPath(f.path);
  }, [files]);

  const cancelEdit = useCallback(() => setEditPath(null), []);

  // Reload after a rename, auto-advancing past the renamed file when the
  // preference is on (default), else keeping the current index. Advance is by
  // file identity (the new path), resolved against the reloaded list inside
  // loadList, so a rename that drops the file from a player/glob filter doesn't
  // skip the file that slides into its slot. The pending ref makes it robust to
  // a racing folder-watch refresh.
  const reloadAfterRename = useCallback((newPath) => {
    if (!lastQueryRef.current) return;
    if (preferences.get('culling.autoAdvanceAfterRename') !== false) {
      pendingAdvanceRef.current = newPath;
      loadList(lastQueryRef.current, { advancePastPath: newPath });
    } else {
      loadList(lastQueryRef.current, { keepIndex: true });
    }
    // Return focus to the list so keyboard nav continues without a click — the
    // inline rename input has unmounted and a name-overlay checkbox would
    // otherwise keep focus and swallow arrow keys.
    focusList();
  }, [loadList, focusList]);

  const commitEdit = useCallback(async () => {
    const path = editPath;
    setEditPath(null);
    if (!path) return;
    const next = editValue.trim();
    // Derive the extension from the file being renamed (not the list), so a
    // reorder mid-edit can't change which file or extension we commit.
    const newBasename = next + extOf(basename(path));
    if (!next || newBasename === basename(path)) return; // no-op
    try {
      const res = await api.post('/api/v1/culling/rename', { path, new_basename: newBasename });
      // Use the backend's actual new path (native separators) for identity;
      // fall back to a separator-agnostic dir swap if absent.
      const newPath = res?.path || path.replace(/[^/\\]+$/, '') + newBasename;
      reloadAfterRename(newPath);
      refreshStatsDebounced();
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [api, editPath, editValue, reloadAfterRename, refreshStatsDebounced]);

  // ----- name-removal overlay state -----------------------------------
  // Declared above the keyboard + dialog effects below, which list these in
  // their dependency arrays (dep arrays are evaluated during render, so the
  // referenced bindings must already exist — no TDZ).
  // Names toggled off for the current file (cleaned form); the overlay previews
  // the result and Cmd+Enter commits the rename. A ref mirrors it for the global
  // keydown handler (avoids re-subscribing on every toggle).
  const [removedNames, setRemovedNames] = useState(() => new Set());
  const removedNamesRef = useRef(removedNames);
  removedNamesRef.current = removedNames;

  // Confirm dialog when navigating away with uncommitted toggles: { run } holds
  // the deferred navigation. A ref mirrors it so the keyboard handlers bail
  // while it's open.
  const [confirmNav, setConfirmNav] = useState(null);
  const confirmNavRef = useRef(null);
  confirmNavRef.current = confirmNav;
  // Mirror the context-menu state so the capture-phase key handler can bail
  // while the menu is open (its own Esc handler closes it).
  const menuRef = useRef(null);
  menuRef.current = menu;

  // Run a navigation, but defer it behind the confirm dialog when the current
  // file has unsaved name toggles.
  const guardedNavigate = useCallback((run) => {
    if (removedNamesRef.current.size > 0) setConfirmNav({ run });
    else run();
  }, []);

  // ----- keyboard ----------------------------------------------------
  useEffect(() => {
    const handler = (e) => {
      if (node && !node.isVisible?.()) return;
      if (showTrash) return;
      if (confirmNavRef.current) return; // the confirm dialog owns the keyboard
      const target = e.target;
      const tag = target?.tagName;
      // Text entry (rename field, glob, dropdown) swallows keys; a checkbox in
      // the name overlay does not — Cmd shortcuts still work while it's focused.
      const isTextField =
        (tag === 'INPUT' && target.type !== 'checkbox') ||
        tag === 'TEXTAREA' ||
        tag === 'SELECT';

      if (e.metaKey || e.ctrlKey) {
        if (isTextField) return; // let text fields handle Cmd-combos natively
        if (e.key.toLowerCase() === 'z') {
          e.preventDefault();
          undoTrash();
        } else if (e.key === 'Backspace') {
          // Finder convention: ⌘⌫ moves the current file to trash. Ignore while
          // a query is loading, so it can't trash a stale list's current file.
          e.preventDefault();
          if (!isLoadingRef.current) trashCurrent();
        }
        // ⌘↵ (commit name removal) is handled in the capture-phase Enter
        // handler below, so it can stop the event before ReviewModule's
        // document handler treats it as confirming a face.
        return;
      }

      // Single-key nav/cull is swallowed only by real text entry — NOT by a
      // name-overlay checkbox, so arrows still navigate when focus lingers on a
      // chip (e.g. right after a ⌘↵ rename). (Esc-discard is handled in the
      // capture-phase handler below, so it can win over Review and gate on the
      // active tabset.)
      if (isTextField) return;

      // Navigation. In the grid, arrows/j/k move in 2-D (up/down by a full row);
      // in the loupe, movement is 1-D (next/previous). Alt pages either way.
      const navKeys = ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'j', 'k'];
      if (navKeys.includes(e.key)) {
        e.preventDefault();
        if (viewModeRef.current === 'grid') {
          const cols = Math.max(1, colsRef.current || 1);
          let dir;
          if (e.key === 'ArrowRight') dir = 'right';
          else if (e.key === 'ArrowLeft') dir = 'left';
          else if (e.key === 'ArrowDown' || e.key === 'j') dir = 'down';
          else dir = 'up'; // ArrowUp or k
          guardedNavigate(() =>
            setCurrentIndex((i) => gridNavTarget(i, cols, files.length, dir, e.altKey))
          );
        } else {
          const step = e.altKey ? PAGE_STEP : 1;
          if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'j') {
            guardedNavigate(() => setCurrentIndex((i) => Math.min(i + step, files.length - 1)));
          } else {
            guardedNavigate(() => setCurrentIndex((i) => Math.max(i - step, 0)));
          }
        }
        return;
      }

      if (!e.altKey && (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'x')) {
        // Ignore the cull shortcut while a query is loading — `files` still
        // holds the previous filter, so culling now would trash the wrong file.
        e.preventDefault();
        if (!isLoadingRef.current) trashCurrent();
      } else if (!e.altKey && e.key.toLowerCase() === 'l') {
        // Open the current photo's original NEF in Lightroom.
        e.preventDefault();
        openRawRef.current?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [node, files.length, showTrash, trashCurrent, undoTrash, guardedNavigate]);

  // Keep the selected row visible as the selection moves (arrow nav, advance),
  // with ~3 rows of padding above/below where the list allows. Uses rects so it
  // works regardless of the row's offsetParent.
  useEffect(() => {
    const list = listRef.current;
    if (!list || currentIndex < 0) return;
    const item = list.children[currentIndex];
    if (!item) return;
    const lr = list.getBoundingClientRect();
    const ir = item.getBoundingClientRect();
    const pad = ir.height * 3;
    if (ir.top - pad < lr.top) {
      list.scrollTop -= lr.top - (ir.top - pad);
    } else if (ir.bottom + pad > lr.bottom) {
      list.scrollTop += ir.bottom + pad - lr.bottom;
    }
  }, [currentIndex, files]);

  // While the unsaved-changes confirm dialog is open it owns the keyboard:
  // ⌘↵ saves (commits the rename, which advances), ↵ discards and runs the
  // deferred navigation (the default), Esc cancels and stays. Capture phase so
  // it preempts the culling/Review document handlers.
  useEffect(() => {
    if (!confirmNav) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setConfirmNav(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        if (e.metaKey || e.ctrlKey) {
          commitNameToggleRef.current?.(); // save (commit + advance)
          setConfirmNav(null);
        } else {
          setRemovedNames(new Set()); // discard, then run the deferred nav
          const run = confirmNav.run;
          setConfirmNav(null);
          run?.();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [confirmNav]);

  // Enter/Esc handling for culling, on document in the CAPTURE phase so it
  // preempts other modules' document-level handlers (e.g. ReviewModule confirming
  // a face) — a window/bubble listener would fire too late. Plain Enter starts an
  // inline rename; Cmd/Ctrl+Enter commits the previewed name removal. BOTH must
  // be claimed here (stopImmediatePropagation) when culling is the active
  // tabset, so a modified Enter can't also reach Review and silently confirm a
  // face. Only acts when culling is the active tabset, so an inactive culling
  // panel never steals Enter.
  // Esc discards the current file's pending name toggles (row un-oranges) — the
  // "undo pending edit" affordance — and shares this handler so it, too, wins
  // over Review's Esc and only fires when culling is the active tabset (an Esc
  // meant for another visible pane must not silently drop culling's edits). While
  // the context menu is open Esc bails (the menu effect closes+swallows it) and
  // Enter is swallowed to a true no-op — consumed so it neither edits under the
  // menu nor leaks to other modules' Enter handlers.
  useEffect(() => {
    const onKeyCapture = (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      if (node && !node.isVisible?.()) return;
      if (confirmNavRef.current) return; // the confirm dialog owns Enter/⌘↵/Esc
      const tag = e.target?.tagName;
      // Text fields (rename input, glob, dropdown) handle these keys themselves
      // and already stop their own propagation; don't intercept them. A checkbox
      // in the name overlay is fine to intercept.
      if ((tag === 'INPUT' && e.target.type !== 'checkbox') || tag === 'TEXTAREA' || tag === 'SELECT') return;
      // Note: no `currentIndex < 0` bail here — Esc-to-grid and grid Enter-to-loupe
      // must work with an empty selection (e.g. after culling the last file). The
      // one action that needs a current file (beginEdit) is guarded at its call.
      if (showTrash) return;
      const activeTabsetId = node?.getModel?.().getActiveTabset?.()?.getId?.();
      const myTabsetId = node?.getParent?.()?.getId?.();
      if (activeTabsetId && myTabsetId && activeTabsetId !== myTabsetId) return;

      if (e.key === 'Escape') {
        // The context menu owns Esc while open — bail (without swallowing) so
        // the menu effect below, registered later in the same capture phase,
        // closes and swallows it.
        if (menuRef.current) return;
        // Discarding pending name toggles takes priority over any mode switch.
        if (removedNamesRef.current.size > 0) {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          setRemovedNames(new Set());
          return;
        }
        // Nothing being edited: in the loupe, Esc returns to the grid overview.
        if (viewModeRef.current === 'single') {
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          setViewMode('grid');
        }
        return;
      }

      // Enter (plain or ⌘/Ctrl). Swallow first, then decide: while the context
      // menu is open Enter is a true no-op — we still consume the event here so
      // it neither renames/commits underneath the (mouse-driven, unfocused) menu
      // nor leaks to other capture-phase document handlers (e.g. ReviewModule's
      // Enter-to-confirm) while culling is the active tabset.
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      if (menuRef.current) return;
      if (viewModeRef.current === 'grid') {
        // In the grid, Enter opens the focused cell in the loupe (keyboard
        // parity with double-click); ⌘↵ has no name-removal target here.
        if (!(e.metaKey || e.ctrlKey)) setViewMode('single');
        return;
      }
      if (e.metaKey || e.ctrlKey) commitNameToggleRef.current?.();
      else if (currentIndex >= 0) beginEdit(currentIndex);
    };
    document.addEventListener('keydown', onKeyCapture, true);
    return () => document.removeEventListener('keydown', onKeyCapture, true);
  }, [node, showTrash, currentIndex, beginEdit]);

  // Dismiss the context menu on any click, a fresh right-click elsewhere,
  // scroll, resize, or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    // Esc closes the menu authoritatively: swallow it so it can't also reach
    // other document handlers (e.g. Review's Esc) while the menu is open.
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      setMenu(null);
    };
    window.addEventListener('click', close);
    window.addEventListener('contextmenu', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('contextmenu', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [menu]);

  // ----- trash view --------------------------------------------------
  // TrashPanel owns the trash list/filter and the restore/empty calls; this
  // callback keeps CullingModule's own state in sync after a change. On restore
  // or a filtered empty the affected ids are no longer trashable, so drop them
  // from the cull-loop undo stack; an empty-all (ids null) clears it entirely.
  // A restore also puts files back on disk, so refresh the file list and stats.
  const handleTrashChange = useCallback(
    (kind, ids) => {
      if (ids) {
        const gone = new Set(ids);
        undoStackRef.current = undoStackRef.current.filter((x) => !gone.has(x));
      } else {
        undoStackRef.current = [];
      }
      if (kind === 'restore' && lastQueryRef.current) {
        loadList(lastQueryRef.current, { keepIndex: true });
        refreshStatsDebounced();
      }
    },
    [loadList, refreshStatsDebounced]
  );

  // ----- divider drag ------------------------------------------------
  // List/preview split: percent of the list+preview area (excludes the stats
  // column, which is sized separately by startStatsDrag).
  const startDrag = useCallback((e) => {
    e.preventDefault();
    const main = mainRef.current;
    if (!main) return;
    const onMove = (ev) => {
      const rect = main.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setLeftWidthPct(Math.min(70, Math.max(15, pct)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Stats column width: absolute pixels measured from the body's left edge,
  // capped so the list+preview area keeps a usable minimum.
  const startStatsDrag = useCallback((e) => {
    e.preventDefault();
    const body = bodyRef.current;
    if (!body) return;
    const onMove = (ev) => {
      const rect = body.getBoundingClientRect();
      const px = ev.clientX - rect.left;
      const max = Math.max(STATS_WIDTH_MIN, rect.width - 300);
      setStatsWidth(Math.min(max, Math.max(STATS_WIDTH_MIN, px)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Persist column widths so they survive restarts.
  useEffect(() => {
    try { localStorage.setItem(STATS_WIDTH_KEY, String(statsWidth)); } catch { /* ignore */ }
  }, [statsWidth]);
  useEffect(() => {
    try { localStorage.setItem(LIST_PCT_KEY, String(leftWidthPct)); } catch { /* ignore */ }
  }, [leftWidthPct]);
  useEffect(() => {
    try { localStorage.setItem(VIEW_MODE_KEY, viewMode); } catch { /* ignore */ }
  }, [viewMode]);

  // The per-player highlight is a grid-only affordance; drop it when leaving grid.
  useEffect(() => {
    if (viewMode !== 'grid') setHighlightPlayer('');
  }, [viewMode]);

  // Track the grid's column count so arrow-key up/down move by a full row.
  // Only observes while the grid is mounted.
  useEffect(() => {
    if (viewMode !== 'grid') return;
    const el = gridRef.current;
    if (!el) return;
    const compute = () => {
      const w = el.clientWidth - GRID_GAP * 2; // grid has GRID_GAP padding both sides
      colsRef.current = Math.max(1, Math.floor((w + GRID_GAP) / (GRID_CELL_MIN + GRID_GAP)));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
    // Column count is width-driven only; don't re-subscribe on list changes
    // (culling/filtering) — the observed element and its width are unaffected.
  }, [viewMode]);

  // On mount, clamp a restored stats width against the current window so a width
  // saved on a wide window can't squash list+preview on a narrow one (the drag
  // handler only clamps live, not on restore).
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const max = Math.max(STATS_WIDTH_MIN, body.getBoundingClientRect().width - 300);
    setStatsWidth((w) => Math.min(w, max));
     
  }, []);

  const current = currentIndex >= 0 ? files[currentIndex] : null;
  const canFilter = roots.length > 0 || glob.trim() !== '';

  // ----- on-the-fly name removal (preview overlay) -------------------
  // removedNames / removedNamesRef / confirmNav / confirmNavRef / guardedNavigate
  // are declared earlier (above the keyboard + dialog effects that list them in
  // their dependency arrays). Reset the toggle when the selected file changes —
  // overrides are per file.
  useEffect(() => { setRemovedNames(new Set()); }, [current?.path]);

  const currentNames = current ? namesInBasename(current.basename) : [];
  const previewBasename = current && removedNames.size
    ? (removeNamesFromBasename(current.basename, removedNames) || current.basename)
    : (current?.basename || '');
  const namePreviewPending = !!current && previewBasename !== current.basename;

  const toggleName = useCallback((name) => {
    setRemovedNames((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  // Commit the previewed name removal as a real rename (Cmd+Enter). Reuses the
  // same /culling/rename endpoint and refresh path as the inline rename.
  const commitNameToggle = useCallback(async () => {
    if (!current || removedNames.size === 0) return;
    const newBasename = removeNamesFromBasename(current.basename, removedNames);
    if (!newBasename || newBasename === current.basename) return;
    const path = current.path;
    try {
      const res = await api.post('/api/v1/culling/rename', { path, new_basename: newBasename });
      setRemovedNames(new Set());
      // Use the backend's actual new path (native separators) for identity;
      // fall back to a separator-agnostic dir swap if absent.
      const newPath = res?.path || path.replace(/[^/\\]+$/, '') + newBasename;
      reloadAfterRename(newPath);
      refreshStatsDebounced();
    } catch (err) {
      setError(err.message || String(err));
    }
  }, [api, current, removedNames, reloadAfterRename, refreshStatsDebounced]);
  // Latest commit fn for the keydown handler without re-subscribing on every
  // toggle/selection change.
  const commitNameToggleRef = useRef(null);
  commitNameToggleRef.current = commitNameToggle;

  // ----- open original NEF in Lightroom ------------------------------
  // The developed JPEG and its source NEF share only the leading timestamp
  // token; the main process resolves it recursively under the configured RAW
  // root and opens it in Lightroom (macOS). Failure surfaces on the error line.
  const openRawInLightroom = useCallback(async (imagePath) => {
    if (!imagePath) return;
    // Default here too so the scanned root, the IPC payload, and any error
    // message all agree even if the preference is unset or cleared.
    const rawRoot = preferences.get('paths.rawRoot') || '~/Pictures/nerladdat';
    try {
      const res = await window.ansiktenAPI?.invoke('open-raw-in-lightroom', { imagePath, rawRoot });
      if (res?.ok) return;
      const reason = res?.reason;
      if (reason === 'not-found') {
        setError(`Ingen NEF hittad för ${res.token} i ${rawRoot}`);
      } else if (reason === 'no-timestamp') {
        setError('Kunde inte härleda tidsstämpel ur filnamnet');
      } else if (reason === 'scan-error') {
        setError(`Kunde inte söka i RAW-mappen ${rawRoot}${res?.error ? `: ${res.error}` : ''}`);
      } else if (reason === 'unsupported-platform') {
        setError('Öppna i Lightroom stöds bara på macOS');
      } else {
        setError(`Kunde inte öppna i Lightroom${res?.error ? `: ${res.error}` : ''}`);
      }
    } catch (err) {
      setError(err.message || String(err));
    }
  }, []);
  // Latest "open current" fn for the keydown handler (captures the current
  // selection each render without re-subscribing the key listener).
  const openRawRef = useRef(null);
  openRawRef.current = () => openRawInLightroom(current?.path);
  // Menu command (View menu / ⌘⇧L) → same action as the `l` key.
  useModuleEvent('open-raw-in-lightroom', () => openRawRef.current?.());

  const currentPath = current?.path;

  // Resolve the preview for a plain JPEG. We wait (in the main process) for the
  // file to finish being written before reading it, so a Lightroom export that's
  // still flushing can't decode into a truncated strip; then we cache-bust the
  // <img> URL by the file's mtime+size so a re-export in place reloads the fresh
  // bytes instead of the browser's cached (possibly stale) decode. Re-runs on
  // folderNonce so an in-place re-export of the current file is picked up.
  const lastPreviewPathRef = useRef(null);
  useEffect(() => {
    if (!currentPath) {
      lastPreviewPathRef.current = null;
      setPreviewUrl(null); setPreviewError(null); setPreviewLoading(false);
      return;
    }
    if (isRaw(currentPath)) {
      // RAW is handled by the conversion effect below. Clear the ref so returning
      // to a JPEG counts as a new path (the current frame is now the RAW preview,
      // not that JPEG) and doesn't keep showing the wrong photo.
      lastPreviewPathRef.current = null;
      return;
    }
    // A genuine selection change vs. a same-path folderNonce re-check (in-place
    // re-export). On a change we must not keep showing the previous photo; on a
    // re-check we keep the current frame so the update is seamless.
    const isNewPath = currentPath !== lastPreviewPathRef.current;
    lastPreviewPathRef.current = currentPath;
    let cancelled = false;
    setPreviewError(null);
    // Clear any loading state inherited from the previous selection (e.g. a RAW
    // conversion or a still-writing JPEG that left it true) so an already-settled
    // JPEG doesn't briefly show the placeholder. The delayed timer below re-sets
    // it only if this file's stat is actually slow.
    setPreviewLoading(false);
    // Only blank + show a loading indicator if the stat is slow (a fresh,
    // still-writing file). Already-settled files resolve first, so stepping
    // through old photos swaps without a flash.
    let loadingTimer = null;
    let recheckTimer = null;
    if (isNewPath) {
      loadingTimer = setTimeout(() => {
        if (!cancelled) { setPreviewUrl(null); setPreviewLoading(true); }
      }, PREVIEW_LOADING_DELAY_MS);
    }
    window.ansiktenAPI.invoke('stat-file-stable', { filePath: currentPath })
      .then((res) => {
        if (cancelled) return;
        if (loadingTimer) clearTimeout(loadingTimer);
        if (!res?.ok) {
          setPreviewLoading(false);
          setPreviewUrl(null);
          setPreviewError(res?.reason === 'not-found' ? 'Filen hittades inte.' : 'Filen kunde inte läsas.');
          return;
        }
        if (res.settled === false) {
          // The settle-wait timed out while the file was still being written.
          // Don't swap in a possibly-truncated decode — keep the loading
          // indicator and re-check shortly (the ongoing write also bumps
          // folderNonce via the watcher, so this is a fallback either way).
          setPreviewLoading(true);
          recheckTimer = setTimeout(() => { if (!cancelled) setFolderNonce((n) => n + 1); }, PREVIEW_RECHECK_MS);
          return;
        }
        setPreviewLoading(false);
        setPreviewUrl(bustedFileUrl(currentPath, `${res.mtimeMs}-${res.size}`));
      })
      .catch((err) => {
        if (cancelled) return;
        if (loadingTimer) clearTimeout(loadingTimer);
        console.error('[Culling] preview stat failed:', err);
        setPreviewLoading(false);
        setPreviewUrl(null);
        setPreviewError('Kunde inte läsa in bilden.');
      });
    return () => {
      cancelled = true;
      if (loadingTimer) clearTimeout(loadingTimer);
      if (recheckTimer) clearTimeout(recheckTimer);
    };
  }, [currentPath, folderNonce]);

  // Resolve the preview for a RAW file via the NEF conversion pipeline. The
  // cancelled guard prevents a slow conversion from painting over a newer
  // selection when the user steps quickly.
  useEffect(() => {
    if (!currentPath || !isRaw(currentPath)) return;
    let cancelled = false;
    setPreviewLoading(true); setPreviewError(null); setPreviewUrl(null);
    // Debounced: clearing the timer on a fast step cancels the POST before it
    // fires, so no abandoned conversions pile up behind the one the user lands on.
    const timer = setTimeout(() => {
      api.post('/api/v1/preprocessing/nef', { file_path: currentPath })
        .then((res) => {
          if (cancelled) return;
          if (res.status === 'error' || !res.nef_jpg_path) {
            setPreviewError(res.error || 'Kunde inte konvertera NEF.');
          } else {
            setPreviewUrl(toFileUrl(res.nef_jpg_path));
          }
        })
        .catch((err) => { if (!cancelled) setPreviewError(err.message || String(err)); })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, PREVIEW_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [currentPath, api]);

  // Prefetch the next RAW so stepping through is usually a cache hit - also
  // debounced, so a fast run of keypresses only warms the file after the rest.
  useEffect(() => {
    const next = files[currentIndex + 1];
    if (!next || !isRaw(next.path)) return;
    const timer = setTimeout(() => {
      api.post('/api/v1/preprocessing/nef', { file_path: next.path }).catch(() => {});
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [currentIndex, files, api]);

  return (
    <div className="module-container culling">
      <div className="culling-filterbar">
        <button className="btn-secondary" onClick={addFolders}>+ Mapp</button>
        <select
          className="form-select"
          value={preset}
          onChange={(e) => {
            const v = e.target.value;
            setPreset(v);
            // Auto-apply once a scope exists (a query has run).
            if (lastQueryRef.current) runFilter({ extension_preset: v });
          }}
          title="Filtyp"
        >
          <option value="jpg">jpg / jpeg</option>
          <option value="nef">nef</option>
          <option value="raw">raw (alla)</option>
        </select>
        <select
          className="form-select"
          value={player}
          onChange={(e) => {
            const name = e.target.value;
            selectPlayer(name);
            // Picking a player applies immediately — no need to press Visa.
            if (lastQueryRef.current) {
              const g = name ? `*${name}*` : '';
              runFilter({ player: name || null, name_glob: g || null });
            }
            // Hand focus to the list so the next arrow press navigates files
            // instead of changing the dropdown selection.
            e.target.blur();
            focusList();
          }}
          title="Spelare"
        >
          <option value="">Alla spelare</option>
          {players.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          className="form-input culling-glob"
          type="text"
          placeholder="Glob, t.ex. *ArvidW*"
          value={glob}
          onChange={(e) => { setGlob(e.target.value); setPlayer(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') runFilter(); }}
        />
        <button className="btn-action" onClick={() => runFilter()} disabled={!canFilter || isLoading}>
          {isLoading ? '…' : 'Visa'}
        </button>
        <button
          className={viewMode === 'grid' ? 'btn-action' : 'btn-secondary'}
          aria-pressed={viewMode === 'grid'}
          onClick={() => setViewMode((m) => (m === 'grid' ? 'single' : 'grid'))}
          title={viewMode === 'grid' ? 'Visa enkelbild' : 'Visa översikt (rutnät)'}
        >
          Rutnät
        </button>
        <span className="culling-spacer" />
        <button
          className={showTrash ? 'btn-action' : 'btn-secondary'}
          onClick={() => setShowTrash((v) => !v)}
        >
          Papperskorg
        </button>
      </div>

      {roots.length > 0 && (
        <div className="culling-roots">
          {roots.map((r) => (
            <span className="culling-chip" key={r} title={r}>
              {basename(r)}
              <button className="culling-chip-x" onClick={() => setRoots((rs) => rs.filter((x) => x !== r))}>×</button>
            </span>
          ))}
        </div>
      )}

      {error && <div className="status-message error">Fel: {error}</div>}

      {showTrash ? (
        <TrashPanel onAfterChange={handleTrashChange} />
      ) : (
        <div className="culling-body" ref={bodyRef}>
          <CullingStats
            stats={stats}
            mode={viewMode}
            selected={viewMode === 'grid' ? highlightPlayer : player}
            width={statsWidth}
            onSelect={(name) => {
              if (viewMode === 'grid') {
                // Grid: single-click highlights the player's thumbnails (no
                // filtering); clicking the highlighted one clears the highlight.
                setHighlightPlayer((h) => (h === name ? '' : name));
              } else {
                // Loupe: single-click filters the list immediately (same hand-off
                // as the player dropdown); clicking the active one clears it.
                filterToPlayer(name);
              }
            }}
            onActivate={(name) => {
              // Grid double-click: filter to the player and drop the highlight.
              setHighlightPlayer('');
              filterToPlayer(name);
            }}
          />
          <div className="culling-stats-divider" onMouseDown={startStatsDrag} />
          {viewMode === 'single' ? (
          <div className="culling-main" ref={mainRef}>
          <div className="culling-list" style={{ width: `${leftWidthPct}%` }}>
            <div className="culling-list-header">
              {files.length} bilder{player ? ` · ${player}` : ''}
            </div>
            {!hasRun && !isLoading && (
              <div className="empty-state">Välj mapp + spelare/glob och tryck <strong>Visa</strong>.</div>
            )}
            {hasRun && files.length === 0 && !isLoading && (
              <div className="empty-state">Inga bilder.</div>
            )}
            <ul className="culling-files" ref={listRef} tabIndex={-1}>
              {files.map((f, i) => (
                <li
                  key={f.path}
                  className={`${i === currentIndex ? 'active row-selected' : ''}${i === currentIndex && namePreviewPending ? ' pending' : ''}`}
                  onClick={() => guardedNavigate(() => setCurrentIndex(i))}
                  onDoubleClick={() => beginEdit(i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCurrentIndex(i);
                    setMenu({ x: e.clientX, y: e.clientY, path: f.path });
                  }}
                >
                  {editPath === f.path ? (
                    <input
                      className="culling-rename-input"
                      value={editValue}
                      autoFocus
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setEditValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        // Keep editing keystrokes inside the input: stop them
                        // bubbling to document-level handlers (e.g. ReviewModule
                        // confirming a face from the rename draft in a split view).
                        e.stopPropagation();
                        if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                        else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                      }}
                      onBlur={cancelEdit}
                    />
                  ) : (
                    // The current row previews the toggled-off name live (orange
                    // while uncommitted); other rows show their real basename.
                    <span className="culling-file-name">
                      {i === currentIndex && namePreviewPending ? previewBasename : f.basename}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>

          <div className="culling-divider" onMouseDown={startDrag} />

          <div className="culling-preview">
            {current && currentNames.length > 0 && (
              <div className="culling-name-overlay">
                <div className="culling-name-chips">
                  {currentNames.map((name) => {
                    const removed = removedNames.has(name);
                    return (
                      <label
                        key={name}
                        className={`culling-name-chip${removed ? ' removed' : ''}`}
                        title={removed ? `Lägg tillbaka ${name}` : `Ta bort ${name}`}
                      >
                        <input
                          type="checkbox"
                          checked={!removed}
                          onChange={() => toggleName(name)}
                        />
                        <span>{name}</span>
                      </label>
                    );
                  })}
                </div>
                {namePreviewPending && (
                  <div className="culling-name-hint">
                    <kbd>⌘</kbd><kbd>↵</kbd> döp om · <kbd>↵</kbd> ångra
                  </div>
                )}
              </div>
            )}
            {!current ? (
              <div className="empty-state">Ingen bild vald.</div>
            ) : previewError ? (
              <div className="status-message error">Fel: {previewError}</div>
            ) : previewLoading ? (
              <div className="empty-state">{isRaw(currentPath) ? 'Konverterar…' : 'Läser in…'}</div>
            ) : previewUrl ? (
              <img className="culling-image" src={previewUrl} alt={current.basename} />
            ) : null}
          </div>
          </div>
          ) : (
            <CullingGrid
              files={files}
              currentIndex={currentIndex}
              highlightPlayer={highlightPlayer}
              gridRef={gridRef}
              onSelect={(i) => guardedNavigate(() => setCurrentIndex(i))}
              onOpen={(i) => { setCurrentIndex(i); setViewMode('single'); }}
              onContextMenu={(e, i, f) => {
                e.preventDefault();
                e.stopPropagation();
                guardedNavigate(() => setCurrentIndex(i));
                setMenu({ x: e.clientX, y: e.clientY, path: f.path });
              }}
            />
          )}
        </div>
      )}

      {menu && (
        <ul
          className="culling-context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.max(i - 1, 0))); }}>
            {/* In the grid ↑/↓ move by rows, so the prev/next hint is just ←/→ there. */}
            <span>Föregående</span><span className="culling-menu-keys"><kbd>←</kbd>{viewMode !== 'grid' && <kbd>↑</kbd>}</span>
          </li>
          <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.min(i + 1, files.length - 1))); }}>
            <span>Nästa</span><span className="culling-menu-keys"><kbd>→</kbd>{viewMode !== 'grid' && <kbd>↓</kbd>}</span>
          </li>
          <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.max(i - PAGE_STEP, 0))); }}>
            <span>Hoppa bakåt</span><span className="culling-menu-keys"><kbd>⌥</kbd><kbd>←</kbd></span>
          </li>
          <li onClick={() => { setMenu(null); guardedNavigate(() => setCurrentIndex((i) => Math.min(i + PAGE_STEP, files.length - 1))); }}>
            <span>Hoppa framåt</span><span className="culling-menu-keys"><kbd>⌥</kbd><kbd>→</kbd></span>
          </li>
          <li className="culling-menu-sep" role="separator" />
          <li onClick={() => {
            setMenu(null);
            const idx = files.findIndex((f) => f.path === menu.path);
            if (idx >= 0) beginEdit(idx);
          }}>
            <span>Byt namn</span><span className="culling-menu-keys"><kbd>Enter</kbd></span>
          </li>
          <li onClick={() => {
            setMenu(null);
            const idx = files.findIndex((f) => f.path === menu.path);
            if (idx >= 0) trashIndex(idx);
          }}>
            <span>Gallra</span><span className="culling-menu-keys"><kbd>X</kbd><kbd>⌘</kbd><kbd>⌫</kbd></span>
          </li>
          <li onClick={() => { setMenu(null); undoTrash(); }}>
            <span>Ångra senaste</span><span className="culling-menu-keys"><kbd>⌘</kbd><kbd>Z</kbd></span>
          </li>
          <li className="culling-menu-sep" role="separator" />
          <li onClick={() => { const p = menu.path; setMenu(null); openRawInLightroom(p); }}>
            <span>Öppna i Lightroom</span><span className="culling-menu-keys"><kbd>L</kbd></span>
          </li>
        </ul>
      )}

      {confirmNav && (
        <div className="culling-confirm-backdrop" onClick={() => setConfirmNav(null)}>
          <div
            className="culling-confirm"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="culling-confirm-title">Osparade namnändringar</div>
            <div className="culling-confirm-preview">{previewBasename}</div>
            <div className="culling-confirm-actions">
              <button
                className="btn-action"
                onClick={() => { commitNameToggleRef.current?.(); setConfirmNav(null); }}
              >
                Spara <span className="culling-menu-keys"><kbd>⌘</kbd><kbd>↵</kbd></span>
              </button>
              <button
                className="btn-secondary"
                onClick={() => { setRemovedNames(new Set()); const run = confirmNav.run; setConfirmNav(null); run?.(); }}
              >
                Kasta <span className="culling-menu-keys"><kbd>↵</kbd></span>
              </button>
              <button className="btn-secondary" onClick={() => setConfirmNav(null)}>
                Avbryt <span className="culling-menu-keys"><kbd>Esc</kbd></span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function isRaw(p) {
  const i = p.lastIndexOf('.');
  return i !== -1 && RAW_EXTS.includes(p.slice(i).toLowerCase());
}

function globBaseDir(pattern) {
  const idx = pattern.search(/[*?[]/);
  const literal = idx === -1 ? pattern : pattern.slice(0, idx);
  const slash = literal.lastIndexOf('/');
  return slash === -1 ? '' : literal.slice(0, slash);
}

// Separator-agnostic basename so paths with Windows backslashes resolve too
// (the backend returns native str(Path) values). Without this, the inline-rename
// no-op guard never matches on Windows and an unchanged rename would advance.
function basename(p) {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

function stripExt(name) {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

const EXCLUDED_LABELS = {
  tranare: 'Tränare',
  grupp: 'Gruppbilder',
  publik: 'Publik',
  below_threshold: 'Under tröskeln',
};

/** Collapsible groups for names the count excludes (coaches, group photos,
 *  audience, below-threshold) — visible but separated from the live counts,
 *  matching the Räkna spelare page. */
function CullingExcluded({ excluded }) {
  if (!excluded) return null;
  const groups = Object.entries(EXCLUDED_LABELS).filter(
    ([key]) => excluded[key] && excluded[key].length > 0
  );
  if (groups.length === 0) return null;
  return (
    <div className="culling-stats-excluded">
      {groups.map(([key, label]) => (
        <details key={key} className="culling-stats-group">
          <summary>{label} ({excluded[key].length})</summary>
          <ul>
            {excluded[key].map((e) => (
              <li key={e.name}>{e.name}: {e.count} ({e.pct}%)</li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}

/**
 * Live per-player count for the current scope, shown left of the file list.
 * Mirrors the Räkna spelare table (name · count · % · Δ% · distribution bar)
 * so the same numbers are in front of the user while culling. `stats` is the
 * /players/count response (or null); `selected` highlights the active player;
 * `width` is the column's pixel width (resizable via the stats divider).
 *
 * Row clicks are mode-dependent (`mode`): in the loupe a single click filters
 * the list to the player (`onSelect`); in the grid a single click highlights the
 * player's thumbnails (`onSelect`) while a double click filters (`onActivate`).
 * The single click is debounced in grid mode so a double click can cancel it.
 */
function CullingStats({ stats, selected, onSelect, onActivate, mode, width }) {
  const players = stats?.players || [];
  const maxCount = players.reduce((m, p) => Math.max(m, p.count), 1);
  const clickTimerRef = useRef(null);
  useEffect(() => () => clearTimeout(clickTimerRef.current), []);
  // Cancel a pending single-click when the mode changes, so a debounced grid
  // highlight can't fire after the user has switched to the loupe.
  useEffect(() => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
  }, [mode]);

  // Loupe: fire immediately (no double-click role). Grid: debounce so a double
  // click (filter) can cancel the pending single click (highlight).
  const handleRowClick = (name) => {
    if (mode !== 'grid') { onSelect?.(name); return; }
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onSelect?.(name);
    }, 200);
  };
  const handleRowDouble = (name) => {
    clearTimeout(clickTimerRef.current);
    clickTimerRef.current = null;
    onActivate?.(name);
  };
  // Show excluded groups even when no player clears the threshold (small folders,
  // or after culling everyone below min_images) — otherwise the section this
  // change is meant to surface would be hidden behind the empty "—".
  const excluded = stats?.excluded || null;
  const hasExcluded = !!excluded &&
    Object.keys(EXCLUDED_LABELS).some((k) => excluded[k] && excluded[k].length > 0);
  return (
    <div className="culling-stats" style={{ flex: `0 0 ${width}px` }}>
      <div className="culling-stats-header">
        <span>Spelare</span>
        {stats?.baseline != null && (
          <span className="culling-stats-baseline" title="Baslinje (median)">
            ~{Math.round(stats.baseline)}
          </span>
        )}
      </div>
      {players.length === 0 && !hasExcluded ? (
        <div className="culling-stats-empty">—</div>
      ) : (
        <div className="culling-stats-scroll">
          {players.length > 0 && (
          <table className="culling-stats-table">
            <thead>
              <tr>
                <th>Namn</th>
                <th className="num">Antal</th>
                <th className="num">%</th>
                <th className="num">Δ%</th>
                <th className="bar-col">Fördelning</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr
                  key={p.name}
                  className={`culling-stat-row${onSelect ? ' clickable' : ''}${p.name === selected ? ' active row-selected' : ''}`}
                  onClick={onSelect ? () => handleRowClick(p.name === selected ? '' : p.name) : undefined}
                  onDoubleClick={mode === 'grid' && onActivate ? () => handleRowDouble(p.name) : undefined}
                  title={
                    !onSelect
                      ? `${p.name}: ${p.count}`
                      : mode === 'grid'
                        ? `Markera ${p.name} · dubbelklicka för att filtrera`
                        : `Filtrera på ${p.name}`
                  }
                >
                  <td className="culling-stat-name">{p.name}</td>
                  <td className="num">{p.count}</td>
                  <td className="num">{p.pct}%</td>
                  <td className={`num delta delta-${p.level || 'ok'}`}>
                    {p.delta_pct > 0 ? '+' : ''}{p.delta_pct}%
                  </td>
                  <td className="bar-col">
                    <div className="culling-bar-track">
                      <div
                        className={`culling-bar-fill level-${p.level || 'ok'}`}
                        style={{ width: `${(p.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
          <CullingExcluded excluded={excluded} />
        </div>
      )}
    </div>
  );
}

export default CullingModule;
