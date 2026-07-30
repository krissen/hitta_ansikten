/**
 * Loading v1-shaped preferences after v2 added `paths.externalEditor`.
 *
 * v1 had no such key and no UI that could set one, so there is no stored value
 * to rewrite — merging with the defaults is what gives an existing install
 * Lightroom Classic. What has to hold: the new key appears, the rest of a v1
 * payload survives, and a value the user has since chosen is never overwritten.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

/**
 * An in-memory storage this file owns outright, with the two things the tests
 * need to drive built in rather than monkeypatched on: a write counter and a
 * switch that makes writes fail.
 *
 * It is installed **unconditionally**, replacing whatever the environment
 * provides. Doing it conditionally is what made this file environment-dependent
 * and turned CI red once: under Node 26 the bare `localStorage` global is Node's
 * own (unavailable) built-in, so the shim installed and a `localStorage.setItem
 * = …` swap took effect — while CI's Node has no such built-in, so Vitest's
 * jsdom left a **real** `Storage` there, the shim was skipped, and assigning to
 * `setItem` on a jsdom Storage does not replace the method at all: the proxy
 * stores an *item* named "setItem" and the real method keeps running. The
 * refuse-writes test then never refused anything, and the write-counter test
 * counted nothing while still passing.
 */
function createMemoryStorage() {
  const store = new Map();
  return {
    /** setItem calls seen, including refused ones. */
    writes: 0,
    /** When true, setItem throws the way a full or read-only backend does. */
    refuseWrites: false,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      this.writes += 1;
      if (this.refuseWrites) throw new Error('QuotaExceededError');
      store.set(k, String(v));
    },
    removeItem: (k) => store.delete(k),
    clear() {
      store.clear();
      this.writes = 0;
      this.refuseWrites = false;
    },
  };
}

// The module creates a singleton manager on import, so the storage has to be in
// place before it is loaded — hence the install here plus the dynamic import
// below. defineProperty rather than assignment: on Node 26 the global is a
// getter-only property, which a plain assignment cannot replace.
const storage = createMemoryStorage();
Object.defineProperty(globalThis, 'localStorage', {
  value: storage,
  configurable: true,
  writable: true,
});

let PreferencesManager;
let DEFAULT_EXTERNAL_EDITOR;

beforeAll(async () => {
  ({ PreferencesManager, DEFAULT_EXTERNAL_EDITOR } =
    await import('../src/renderer/workspace/preferences.js'));
});

const STORAGE_KEY = 'ansikten-preferences';

/** Seed localStorage with stored preferences and load them through a manager. */
function loadStored(stored) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return new PreferencesManager();
}

beforeEach(() => localStorage.clear());

describe('preferences v1 -> v2 (external editor)', () => {
  it('defaults to Lightroom Classic on a fresh install', () => {
    const prefs = new PreferencesManager();
    expect(prefs.get('paths.externalEditor')).toBe('Adobe Lightroom Classic');
    expect(DEFAULT_EXTERNAL_EDITOR).toBe('Adobe Lightroom Classic');
    expect(prefs.get('version')).toBe(2);
  });

  it('gives a stored v1 payload the new key, at the Classic default', () => {
    const prefs = loadStored({ version: 1, paths: { rawRoot: '~/Pictures/nerladdat' } });
    expect(prefs.get('paths.externalEditor')).toBe('Adobe Lightroom Classic');
  });

  it('writes the migrated payload back to storage, at the current version', () => {
    const prefs = loadStored({ version: 1, paths: { rawRoot: '~/Bilder/raw' } });
    expect(prefs.get('version')).toBe(2);

    // On disk, not just in memory: a second manager must not re-migrate.
    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(onDisk.version).toBe(2);
    expect(onDisk.paths.rawRoot).toBe('~/Bilder/raw');
  });

  it('persists only the stored payload, keeping the defaults in memory', () => {
    // The write must not freeze today's defaults into this install: a value the
    // user never set stays absent from storage and keeps coming from the
    // defaults, so a later change to a default still reaches a migrated install.
    const prefs = loadStored({ version: 1, paths: { rawRoot: '~/Bilder/raw' } });

    const onDisk = JSON.parse(localStorage.getItem(STORAGE_KEY));
    expect(onDisk.paths.externalEditor).toBeUndefined();
    expect(onDisk.ui).toBeUndefined();
    // …while in memory the defaults apply exactly as before.
    expect(prefs.get('paths.externalEditor')).toBe(DEFAULT_EXTERNAL_EDITOR);
    expect(prefs.get('ui.theme')).toBe('system');
  });

  it('leaves a payload from a NEWER build alone (rollback path)', () => {
    // The user ran a later build, then rolled back to this one. Stamping the
    // stored version down to 2 while the newer keys stay put would make the next
    // newer launch re-run its own 2 -> 3 step on already-migrated data — the
    // double application this write exists to prevent.
    const newer = { version: 3, paths: { rawRoot: '~/Bilder/raw' }, futureSection: { keep: 'me' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newer));
    storage.writes = 0;

    const prefs = new PreferencesManager();

    expect(storage.writes).toBe(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(newer);
    // Usable meanwhile: known keys read through, unknown ones are carried.
    expect(prefs.get('paths.rawRoot')).toBe('~/Bilder/raw');
    expect(prefs.get('futureSection.keep')).toBe('me');
    expect(prefs.get('version')).toBe(3);
  });

  it('migrates a payload that predates versioning', () => {
    // No version field at all must count as older than anything, rather than
    // falling through the comparison as NaN and being treated as newer.
    const prefs = loadStored({ paths: { rawRoot: '~/Bilder/raw' } });
    expect(prefs.get('paths.externalEditor')).toBe(DEFAULT_EXTERNAL_EDITOR);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).version).toBe(2);
  });

  it('leaves an already-current payload untouched on disk', () => {
    const stored = { version: 2, paths: { rawRoot: '~/Bilder/raw' } };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    // The counter counts (this seeding write proves it) — so the zero below is
    // a measurement, not an instrument that was never connected.
    expect(storage.writes).toBe(1);
    storage.writes = 0;

    new PreferencesManager();

    expect(storage.writes).toBe(0);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(stored);
  });

  it('survives a storage backend that refuses writes', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1 }));
    storage.writes = 0;
    storage.refuseWrites = true;

    let prefs;
    try {
      prefs = new PreferencesManager();
    } finally {
      storage.refuseWrites = false;
    }

    // The write was attempted and refused. Without this the rest of the test
    // could pass on a storage that quietly accepted the write — which is
    // exactly how it passed locally and failed in CI.
    expect(storage.writes).toBeGreaterThanOrEqual(1);
    // The migration still applies in memory; only the write back is lost.
    expect(prefs.get('paths.externalEditor')).toBe(DEFAULT_EXTERNAL_EDITOR);
    // Disk keeps the old version, so the step runs again on the next start.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).version).toBe(1);
  });

  it('preserves the rest of a v1 payload', () => {
    const prefs = loadStored({
      version: 1,
      paths: { rawRoot: '~/Bilder/raw' },
      ui: { theme: 'dark' }
    });
    expect(prefs.get('paths.rawRoot')).toBe('~/Bilder/raw');
    expect(prefs.get('ui.theme')).toBe('dark');
  });

  it('never overwrites an editor the user has chosen', () => {
    const prefs = loadStored({ version: 2, paths: { externalEditor: 'Capture One' } });
    expect(prefs.get('paths.externalEditor')).toBe('Capture One');
  });

  it('keeps a cleared field empty rather than snapping it back to the default', () => {
    // The settings field must be emptyable so it can be retyped; both consumers
    // (CullingModule and the main-process handler) fall back to Classic.
    const prefs = loadStored({ version: 2, paths: { externalEditor: '' } });
    expect(prefs.get('paths.externalEditor')).toBe('');
  });
});
