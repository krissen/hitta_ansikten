import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { hasBeenWelcomed, markWelcomed } from '../src/renderer/workspace/welcomeFlag.js';

// welcomeFlag is the first-run persistence for the StartupLanding welcome card.
// It reads/writes a single localStorage key and fails OPEN toward showing the
// card (missing/corrupt → not-yet-welcomed) so a genuine first-run user always
// gets the guide.

const KEY = 'ansikten-welcomed';

beforeAll(() => {
  if (!window.localStorage) {
    const store = new Map();
    window.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
  }
});

beforeEach(() => {
  window.localStorage.clear();
});

describe('welcomeFlag', () => {
  it('is not welcomed by default (missing key → fail open to showing)', () => {
    expect(hasBeenWelcomed()).toBe(false);
  });

  it('markWelcomed persists the flag so a later read reports welcomed', () => {
    markWelcomed();
    expect(window.localStorage.getItem(KEY)).toBe('true');
    expect(hasBeenWelcomed()).toBe(true);
  });

  it('markWelcomed is idempotent', () => {
    markWelcomed();
    markWelcomed();
    expect(hasBeenWelcomed()).toBe(true);
  });

  it('treats a corrupt value as not-yet-welcomed (only the string "true" counts)', () => {
    window.localStorage.setItem(KEY, 'garbage');
    expect(hasBeenWelcomed()).toBe(false);
    window.localStorage.setItem(KEY, '1');
    expect(hasBeenWelcomed()).toBe(false);
  });
});
