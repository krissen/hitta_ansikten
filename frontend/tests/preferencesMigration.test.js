/**
 * Preferences version migration (v1 -> v2: configurable external editor).
 *
 * v1 had no `paths.externalEditor` at all — the app was pinned to the
 * hardcoded "Adobe Lightroom". The migration must move those installs to
 * Lightroom Classic without touching a value the user chose themselves.
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

  it('moves a v1 install (no stored editor) to Lightroom Classic', () => {
    const prefs = loadStored({ version: 1, paths: { rawRoot: '~/Pictures/nerladdat' } });
    expect(prefs.get('paths.externalEditor')).toBe('Adobe Lightroom Classic');
  });

  it('rewrites the legacy hardcoded "Adobe Lightroom" value', () => {
    const prefs = loadStored({ version: 1, paths: { externalEditor: 'Adobe Lightroom' } });
    expect(prefs.get('paths.externalEditor')).toBe('Adobe Lightroom Classic');
  });

  it('leaves an editor the user picked themselves untouched', () => {
    const prefs = loadStored({ version: 1, paths: { externalEditor: 'Capture One' } });
    expect(prefs.get('paths.externalEditor')).toBe('Capture One');
  });

  it('preserves other v1 settings across the migration', () => {
    const prefs = loadStored({
      version: 1,
      paths: { rawRoot: '~/Bilder/raw' },
      ui: { theme: 'dark' }
    });
    expect(prefs.get('paths.rawRoot')).toBe('~/Bilder/raw');
    expect(prefs.get('ui.theme')).toBe('dark');
  });

  it('does not re-run once the stored version is current', () => {
    const prefs = loadStored({ version: 2, paths: { externalEditor: 'Adobe Lightroom' } });
    expect(prefs.get('paths.externalEditor')).toBe('Adobe Lightroom');
  });
});
