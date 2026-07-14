import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import {
  DEFAULTS,
  getCountSettings,
  setCountSettings,
  subscribeCountSettings,
} from '../src/renderer/shared/countSettings.js';

const STORAGE_KEY = 'ansikten.countSettings';

// jsdom (as pinned here) doesn't provide localStorage; polyfill a minimal one,
// matching tests/usePersistedValue.test.js.
beforeAll(() => {
  if (!globalThis.localStorage) {
    const store = new Map();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  }
});

describe('countSettings store', () => {
  beforeEach(() => {
    localStorage.clear();
    // Reset to defaults so each test starts from a known state (the store is a
    // module-level singleton shared across tests within this file).
    setCountSettings(DEFAULTS);
    localStorage.clear();
  });

  it('returns the defaults when nothing is stored', () => {
    expect(getCountSettings()).toEqual(DEFAULTS);
  });

  it('returns a copy, not the internal object', () => {
    const a = getCountSettings();
    const b = getCountSettings();
    expect(a).not.toBe(b);
    a.baseline = 'mean';
    expect(getCountSettings().baseline).toBe('median');
  });

  it('shallow-merges a patch and keeps the other fields', () => {
    setCountSettings({ baseline: 'mean' });
    expect(getCountSettings()).toEqual({ ...DEFAULTS, baseline: 'mean' });
    setCountSettings({ minImages: 5 });
    expect(getCountSettings()).toEqual({ ...DEFAULTS, baseline: 'mean', minImages: 5 });
  });

  it('persists to localStorage', () => {
    setCountSettings({ baseline: 'mean', minImages: 4, gapMinutes: 45 });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({
      gapMinutes: 45,
      baseline: 'mean',
      minImages: 4,
    });
  });

  it('sanitizes invalid values back to the defaults', () => {
    setCountSettings({ baseline: 'bogus', minImages: 0, gapMinutes: -5 });
    expect(getCountSettings()).toEqual(DEFAULTS);
  });

  it('coerces numeric strings and truncates to integers', () => {
    setCountSettings({ minImages: '7', gapMinutes: 12.9 });
    const s = getCountSettings();
    expect(s.minImages).toBe(7);
    expect(s.gapMinutes).toBe(12);
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen = [];
    const unsub = subscribeCountSettings((s) => seen.push(s.baseline));
    setCountSettings({ baseline: 'mean' });
    setCountSettings({ baseline: 'median' });
    unsub();
    setCountSettings({ baseline: 'mean' });
    expect(seen).toEqual(['mean', 'median']);
  });

  it('a broken subscriber does not stop the others', () => {
    const seen = [];
    const unsubA = subscribeCountSettings(() => { throw new Error('boom'); });
    const unsubB = subscribeCountSettings((s) => seen.push(s.baseline));
    setCountSettings({ baseline: 'mean' });
    unsubA();
    unsubB();
    expect(seen).toEqual(['mean']);
  });
});

describe('countSettings persistence', () => {
  it('hydrates persisted settings after a reload (module re-import)', async () => {
    localStorage.clear();
    setCountSettings({ baseline: 'mean', minImages: 4 });
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/countSettings.js');
    expect(fresh.getCountSettings()).toEqual({ gapMinutes: 30, baseline: 'mean', minImages: 4 });
  });

  it('tolerates corrupt localStorage and falls back to the defaults', async () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/countSettings.js');
    expect(fresh.getCountSettings()).toEqual(fresh.DEFAULTS);
  });
});
