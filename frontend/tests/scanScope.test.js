import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getScanScope,
  setScanScope,
  scanScopeHasSelection,
  signalExternalLoad,
  takeExternalLoad,
  subscribeScanScope,
} from '../src/renderer/shared/scanScope.js';

const STORAGE_KEY = 'ansikten.scanScope';

describe('scanScope store', () => {
  beforeEach(() => setScanScope(null));

  it('starts empty', () => {
    expect(getScanScope()).toBeNull();
  });

  it('stores a shallow copy (later mutation of the source does not leak in)', () => {
    const src = {
      roots: ['/a'],
      globs: [],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    };
    setScanScope(src);
    src.roots.push('/b'); // mutating the array still leaks (shallow), but the object identity is decoupled
    const stored = getScanScope();
    expect(stored).not.toBe(src);
    expect(stored.extension_preset).toBe('jpg');
  });

  it('setScanScope(null) clears', () => {
    setScanScope({ roots: ['/a'], globs: [] });
    setScanScope(null);
    expect(getScanScope()).toBeNull();
  });
});

describe('scanScope persistence (survives a renderer reload)', () => {
  beforeEach(() => setScanScope(null));

  it('setScanScope writes the scope to sessionStorage', () => {
    setScanScope({
      roots: ['/a'],
      globs: ['*.jpg'],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw)).toMatchObject({
      roots: ['/a'],
      globs: ['*.jpg'],
      extension_preset: 'jpg',
    });
  });

  it('setScanScope(null) removes the sessionStorage key', () => {
    setScanScope({ roots: ['/a'], globs: [] });
    setScanScope(null);
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('a re-imported module (reload) hydrates the persisted scope on first read', async () => {
    // Publish, then simulate a Cmd+R reload: the module is re-imported with a
    // fresh in-memory `current = null`, but sessionStorage still holds the scope.
    setScanScope({
      roots: ['/photos'],
      globs: [],
      recursive: false,
      date_from: null,
      date_to: null,
      extension_preset: 'nef',
    });
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/scanScope.js');
    const restored = fresh.getScanScope();
    expect(restored).toMatchObject({
      roots: ['/photos'],
      recursive: false,
      extension_preset: 'nef',
    });
    expect(fresh.scanScopeHasSelection(restored)).toBe(true);
  });

  it('a re-imported module with nothing persisted stays empty', async () => {
    setScanScope(null); // clears the key
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/scanScope.js');
    expect(fresh.getScanScope()).toBeNull();
  });
});

describe('scanScopeHasSelection', () => {
  it('false for null / empty', () => {
    expect(scanScopeHasSelection(null)).toBe(false);
    expect(scanScopeHasSelection({ roots: [], globs: [] })).toBe(false);
    expect(scanScopeHasSelection({})).toBe(false);
  });

  it('true when a folder or path-glob is present', () => {
    expect(scanScopeHasSelection({ roots: ['/a'], globs: [] })).toBe(true);
    expect(scanScopeHasSelection({ roots: [], globs: ['*.jpg'] })).toBe(true);
  });
});

describe('subscribeScanScope (display-only)', () => {
  beforeEach(() => setScanScope(null));

  it('notifies a subscriber on publish with the current scope, then null on clear', () => {
    const cb = vi.fn();
    const unsub = subscribeScanScope(cb);
    setScanScope({ roots: ['/a'], globs: [], recursive: true });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ roots: ['/a'] }));
    setScanScope(null);
    expect(cb).toHaveBeenLastCalledWith(null);
    unsub();
  });

  it('unsubscribe stops notifications (so a display surface can detach cleanly)', () => {
    const cb = vi.fn();
    const unsub = subscribeScanScope(cb);
    unsub();
    setScanScope({ roots: ['/b'], globs: [] });
    expect(cb).not.toHaveBeenCalled();
  });

  it('a throwing subscriber does not stop the others', () => {
    const bad = vi.fn(() => {
      throw new Error('boom');
    });
    const good = vi.fn();
    const u1 = subscribeScanScope(bad);
    const u2 = subscribeScanScope(good);
    setScanScope({ roots: ['/c'], globs: [] });
    expect(good).toHaveBeenCalled();
    u1();
    u2();
  });
});

describe('external-load signal', () => {
  beforeEach(() => {
    takeExternalLoad();
  }); // clear

  it('is false until signalled, then one-shot true', () => {
    expect(takeExternalLoad()).toBe(false);
    signalExternalLoad();
    expect(takeExternalLoad()).toBe(true);
    expect(takeExternalLoad()).toBe(false); // consumed
  });
});
