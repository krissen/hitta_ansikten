/**
 * usePersistedValue - a useState whose value is mirrored to localStorage.
 *
 * Generic and module-agnostic: give it a storage `key`, a `defaultValue` used
 * when nothing is stored, and (optionally) `parse`/`serialize` to convert
 * between the stored string and the in-memory value. Returns `[value, setValue]`
 * with the same shape as useState, so callers can pass a functional updater.
 *
 * Reads and writes are wrapped in try/catch so a disabled or throwing
 * localStorage degrades to plain component state rather than crashing.
 *
 *   const [width, setWidth] = usePersistedValue('mod.width', 240, {
 *     parse: (raw) => { const v = parseFloat(raw); return Number.isFinite(v) ? v : 240; },
 *   });
 *
 * @param {string} key - localStorage key.
 * @param {*} defaultValue - value used when the key is absent.
 * @param {object} [opts]
 * @param {(raw: string, fallback: *) => *} [opts.parse] - stored string -> value.
 *   Defaults to identity (returns the raw string).
 * @param {(value: *) => string} [opts.serialize] - value -> stored string.
 *   Defaults to String().
 * @returns {[*, Function]} [value, setValue]
 */
import { useState, useEffect } from 'react';

export function usePersistedValue(
  key,
  defaultValue,
  { parse, serialize } = {},
) {
  const [value, setValue] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return defaultValue;
      return parse ? parse(raw, defaultValue) : raw;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, serialize ? serialize(value) : String(value));
    } catch {
      /* ignore */
    }
  }, [key, value, serialize]);

  return [value, setValue];
}

export default usePersistedValue;
