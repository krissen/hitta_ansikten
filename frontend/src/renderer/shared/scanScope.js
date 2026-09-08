// Shared "scan scope" so Gallra spelare (culling) and Räkna spelare mirror the
// same file selection: each module publishes its scope when it runs a query and
// adopts the shared scope when it opens, so switching between them shows the
// same files instead of an empty panel.
//
// Only the SCAN fields are shared (roots, path-globs, recursion, date span,
// extension preset) — not culling's player/name_glob filter, which Räkna spelare
// doesn't use. Modules adopt on mount (FlexLayout unmounts hidden tabs, so
// opening a tab re-runs mount), which keeps the two in sync without a live
// cross-update loop.
//
// DISPLAY-ONLY subscription: `subscribeScanScope` exists SOLELY so a passive
// status surface (the WorkflowBar chip dropdown) can show the current scope
// live. It must NEVER drive a module's behavior — the adopt-on-mount invariant
// above is deliberate, and a subscription that re-adopts on every publish would
// reintroduce the cross-update loop it was designed out of. Read the scope in a
// subscriber to RENDER it; never to load, scan, or mutate a module's state.
//
// Backed by sessionStorage so the scope survives a renderer reload (Cmd+R) — a
// reload re-imports this module with a fresh `current`, so without a persisted
// copy the mount-adopt effects would find nothing and the panels would come back
// empty (the file list is then re-derived by the adopt effect's re-scan).
// sessionStorage is deliberately chosen over localStorage: it clears when the app
// quits, so it still "resets on app restart" (no stale scope adopted on a fresh
// launch, which would race the one-shot CLI `culling-load`), while surviving a
// reload within the session.

const STORAGE_KEY = 'ansikten.scanScope';

let current = null;
// A reload re-imports this module (current = null); hydrate from sessionStorage on
// first read so the adopt-on-mount effects see the pre-reload scope.
let hydrated = false;
// Display-only listeners (see header). Notified on every publish.
const subscribers = new Set();

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) current = JSON.parse(raw);
  } catch {
    /* ignore — unreadable/parse error just means no restored scope */
  }
}

/**
 * The last scan scope, or null if none set this session.
 * Shape: { roots, globs, recursive, date_from, date_to, extension_preset }.
 */
export function getScanScope() {
  hydrate();
  return current;
}

/** Publish a scan scope (a shallow copy is stored + persisted for the session). */
export function setScanScope(scope) {
  hydrated = true; // an explicit publish supersedes any not-yet-hydrated value
  current = scope ? { ...scope } : null;
  try {
    if (current) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — storage unavailable/full just falls back to in-memory only */
  }
  for (const cb of subscribers) {
    try {
      cb(current);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}

/**
 * Subscribe to scan-scope changes for DISPLAY ONLY. Returns an unsubscribe
 * function; the callback receives the current scope (or null). See the module
 * header: never use this to adopt/load/mutate a module — that stays adopt-on-mount.
 */
export function subscribeScanScope(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

/** True if the scope actually selects something (a folder or a path-glob). */
export function scanScopeHasSelection(scope) {
  return (
    !!scope &&
    ((Array.isArray(scope.roots) && scope.roots.length > 0) ||
      (Array.isArray(scope.globs) && scope.globs.length > 0))
  );
}

// One-shot signal: when Räkna spelare opens culling for a specific player it
// immediately emits `cull-player` with the player-filtered query. This lets
// culling's adopt-on-mount skip its own (unfiltered) load so the folder isn't
// scanned twice / the unfiltered list doesn't briefly flash before collapsing
// to the filtered set.
let externalLoadPending = false;

/** Mark that an external loader (cull-player hand-off) is about to load. */
export function signalExternalLoad() {
  externalLoadPending = true;
}

/** Read and clear the pending-external-load flag. */
export function takeExternalLoad() {
  const v = externalLoadPending;
  externalLoadPending = false;
  return v;
}
