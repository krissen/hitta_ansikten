import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getWorkingFolder,
  setWorkingFolder,
  clearWorkingFolder,
  subscribeWorkingFolder,
} from '../src/renderer/shared/workingFolder.js';

const STORAGE_KEY = 'ansikten.workingFolder';

describe('workingFolder store', () => {
  beforeEach(() => clearWorkingFolder());

  it('starts empty', () => {
    expect(getWorkingFolder()).toBeNull();
  });

  it('set stamps ts and stores roots + step', () => {
    const before = Date.now();
    setWorkingFolder({ roots: ['/photos/event'], step: 'import' });
    const wf = getWorkingFolder();
    expect(wf.roots).toEqual(['/photos/event']);
    expect(wf.step).toBe('import');
    expect(typeof wf.ts).toBe('number');
    expect(wf.ts).toBeGreaterThanOrEqual(before);
  });

  it('stores a copy of roots (later mutation of the source does not leak in)', () => {
    const src = ['/a'];
    setWorkingFolder({ roots: src, step: 'rename' });
    src.push('/b');
    expect(getWorkingFolder().roots).toEqual(['/a']);
  });

  it('defaults roots to [] and step to null', () => {
    setWorkingFolder({});
    const wf = getWorkingFolder();
    expect(wf.roots).toEqual([]);
    expect(wf.step).toBeNull();
  });

  it('clearWorkingFolder resets to null', () => {
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    clearWorkingFolder();
    expect(getWorkingFolder()).toBeNull();
  });
});

describe('workingFolder subscription', () => {
  beforeEach(() => clearWorkingFolder());

  it('notifies subscribers on set and clear', () => {
    const cb = vi.fn();
    subscribeWorkingFolder(cb);
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0].roots).toEqual(['/a']);
    clearWorkingFolder();
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toBeNull();
  });

  it('unsubscribe stops further notifications', () => {
    const cb = vi.fn();
    const unsub = subscribeWorkingFolder(cb);
    unsub();
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    expect(cb).not.toHaveBeenCalled();
  });

  it('a broken subscriber does not stop the others', () => {
    const good = vi.fn();
    subscribeWorkingFolder(() => {
      throw new Error('boom');
    });
    subscribeWorkingFolder(good);
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('workingFolder persistence (survives a renderer reload)', () => {
  beforeEach(() => clearWorkingFolder());

  it('setWorkingFolder writes the anchor to sessionStorage', () => {
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw)).toMatchObject({ roots: ['/a'], step: 'import' });
  });

  it('clearWorkingFolder removes the sessionStorage key', () => {
    setWorkingFolder({ roots: ['/a'], step: 'import' });
    clearWorkingFolder();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('a re-imported module (reload) hydrates the persisted anchor on first read', async () => {
    setWorkingFolder({ roots: ['/photos'], step: 'rename' });
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/workingFolder.js');
    expect(fresh.getWorkingFolder()).toMatchObject({
      roots: ['/photos'],
      step: 'rename',
    });
  });

  it('a re-imported module with nothing persisted stays empty', async () => {
    clearWorkingFolder();
    vi.resetModules();
    const fresh = await import('../src/renderer/shared/workingFolder.js');
    expect(fresh.getWorkingFolder()).toBeNull();
  });
});
