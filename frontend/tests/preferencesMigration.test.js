/**
 * Loading v1-shaped preferences after v2 added `paths.externalEditor`.
 *
 * v1 had no such key and no UI that could set one, so there is no stored value
 * to rewrite — merging with the defaults is what gives an existing install
 * Lightroom Classic. What has to hold: the new key appears, the rest of a v1
 * payload survives, and a value the user has since chosen is never overwritten.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';

// The module creates a singleton manager on import, so localStorage has to
// exist before it is loaded — hence the shim + dynamic import here.
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

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

  it('stamps the current version on the next save, not on load', () => {
    // Pre-existing behaviour: mergeWithDefaults copies the stored version over
    // the default, so the bump lands when something is written back.
    const prefs = loadStored({ version: 1, paths: { rawRoot: '~/Bilder/raw' } });
    expect(prefs.get('version')).toBe(1);
    prefs.save();
    expect(prefs.get('version')).toBe(2);
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
