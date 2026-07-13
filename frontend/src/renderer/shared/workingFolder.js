// Shared "working folder" anchor — a single pointer to the folder of the event
// currently being worked on. The pipeline (Import → Rename → Review → Count →
// Culling) has three independent working sets (file queue, scan scope,
// destination), but they tend to point at the same event folder. This anchor
// lets a later step pre-fill from where an earlier step left off, without
// merging those working sets. It is a pointer only — no queue, no scanning.
//
// Adoption is always opt-in: a step reads the anchor to seed a default, never
// to auto-load. `step` records which pipeline step last set the anchor
// ('import' | 'rename' | …) so a UI (arriving in a later stage) can label it.
//
// Backed by sessionStorage (like scanScope.js): the anchor survives a renderer
// reload (Cmd+R) but clears when the app quits. sessionStorage is deliberately
// chosen over localStorage so last week's event is never offered on a fresh
// launch — the anchor only ever points at an event touched this session.

const STORAGE_KEY = 'ansikten.workingFolder';

let current = null;
// A reload re-imports this module (current = null); hydrate from sessionStorage
// on first read so an adopting step sees the pre-reload anchor.
let hydrated = false;
const subscribers = new Set();

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) current = JSON.parse(raw);
  } catch {
    /* ignore — unreadable/parse error just means no restored anchor */
  }
}

/**
 * The current working-folder anchor, or null if none set this session.
 * Shape: { roots: string[], step: string | null, ts: number }.
 */
export function getWorkingFolder() {
  hydrate();
  return current;
}

/**
 * Set the anchor. Stamps `ts` itself. Pass { roots, step }; a shallow copy of
 * roots is stored. Subscribers are notified.
 */
export function setWorkingFolder({ roots = [], step = null } = {}) {
  hydrated = true; // an explicit set supersedes any not-yet-hydrated value
  current = { roots: [...roots], step, ts: Date.now() };
  persist();
  notify();
}

/** Clear the anchor. Subscribers are notified. */
export function clearWorkingFolder() {
  hydrated = true;
  current = null;
  persist();
  notify();
}

/**
 * Subscribe to anchor changes. Returns an unsubscribe function.
 * The callback receives the current anchor (or null).
 */
export function subscribeWorkingFolder(cb) {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

function persist() {
  try {
    if (current) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(current));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore — storage unavailable/full just falls back to in-memory only */
  }
}

function notify() {
  for (const cb of subscribers) {
    try {
      cb(current);
    } catch {
      /* a broken subscriber must not stop the others */
    }
  }
}
