// Shared counting settings for Räkna spelare (PlayerCountModule) and the culling
// stats panel. The Baslinje choice (median/mean) plus min_images and gap_minutes
// are conceptually one setting: a choice made in one module should follow to the
// other and survive a remount / app restart. Both consumers subscribe, so a
// change in one updates the other live (both can be mounted at once in FlexLayout,
// which rules out the storage-event-only usePersistedValue path).
//
// Backed by localStorage (unlike scanScope/playerSession, which are session-only):
// the baseline choice is a durable preference, so it persists across app restarts.

const STORAGE_KEY = 'ansikten.countSettings';

// Default counting options, mirroring the CLI's argparse defaults.
export const DEFAULTS = { gapMinutes: 30, baseline: 'median', minImages: 3 };

const VALID_BASELINES = ['median', 'mean'];

let current = null;
// A reload re-imports this module (current = null); hydrate from localStorage on
// first read so subscribers/consumers see the persisted settings.
let hydrated = false;
const subscribers = new Set();

// Coerce a stored/patched value to a valid setting, falling back to the default
// for a missing or malformed field (corrupt localStorage must not break counts).
function sanitize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const gap = Math.trunc(Number(src.gapMinutes));
  const min = Math.trunc(Number(src.minImages));
  return {
    gapMinutes: Number.isFinite(gap) && gap >= 1 ? gap : DEFAULTS.gapMinutes,
    baseline: VALID_BASELINES.includes(src.baseline)
      ? src.baseline
      : DEFAULTS.baseline,
    minImages: Number.isFinite(min) && min >= 1 ? min : DEFAULTS.minImages,
  };
}

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    current = sanitize(stored ? JSON.parse(stored) : {});
  } catch {
    // Unreadable/parse error just means we fall back to the defaults.
    current = { ...DEFAULTS };
  }
}

/** The current counting settings: { gapMinutes, baseline, minImages }. */
export function getCountSettings() {
  hydrate();
  return { ...current };
}

/**
 * Pure preview of what setCountSettings(patch) would store: the sanitized
 * shallow-merge of the current settings and `patch`, without persisting or
 * notifying. setCountSettings notifies subscribers SYNCHRONOUSLY, so a caller
 * that also subscribes must pre-adopt this value (e.g. into the ref its
 * self-notify guard reads) BEFORE calling setCountSettings — otherwise the
 * guard compares against a stale value during the notify and misfires.
 */
export function sanitizeCountSettings(patch) {
  hydrate();
  return sanitize({ ...current, ...(patch || {}) });
}

/**
 * Shallow-merge `patch` into the settings, sanitize, persist, and notify
 * subscribers. Returns the new settings object.
 */
export function setCountSettings(patch) {
  hydrate();
  const next = sanitize({ ...current, ...(patch || {}) });
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Storage unavailable/full just falls back to in-memory only.
  }
  notify();
  return { ...current };
}

/** Subscribe to settings changes. Returns an unsubscribe function. */
export function subscribeCountSettings(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function notify() {
  const snapshot = { ...current };
  for (const cb of subscribers) {
    try {
      cb(snapshot);
    } catch {
      // A broken subscriber must not stop the others.
    }
  }
}
