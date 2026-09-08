import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedValue } from '../src/renderer/hooks/usePersistedValue.js';

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

beforeEach(() => localStorage.clear());

describe('usePersistedValue', () => {
  it('uses the default when nothing is stored and writes it back', () => {
    const { result } = renderHook(() => usePersistedValue('k.num', 42));
    expect(result.current[0]).toBe(42);
    expect(localStorage.getItem('k.num')).toBe('42');
  });

  it('reads a stored value through parse on mount', () => {
    localStorage.setItem('k.num', '7');
    const { result } = renderHook(() =>
      usePersistedValue('k.num', 42, { parse: (raw) => parseInt(raw, 10) }),
    );
    expect(result.current[0]).toBe(7);
  });

  it('persists updates via serialize (functional updater supported)', () => {
    const { result } = renderHook(() =>
      usePersistedValue('k.str', 'a', { serialize: (v) => v.toUpperCase() }),
    );
    act(() => result.current[1]((prev) => prev + 'b'));
    expect(result.current[0]).toBe('ab');
    expect(localStorage.getItem('k.str')).toBe('AB');
  });

  it('falls back to the default when parse maps to it (e.g. NaN)', () => {
    localStorage.setItem('k.num', 'not-a-number');
    const { result } = renderHook(() =>
      usePersistedValue('k.num', 5, {
        parse: (raw, fb) => {
          const v = parseFloat(raw);
          return Number.isFinite(v) ? v : fb;
        },
      }),
    );
    expect(result.current[0]).toBe(5);
  });
});
