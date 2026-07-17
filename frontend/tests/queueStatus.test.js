import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getQueueStatus,
  setQueueStatus,
  subscribeQueueStatus,
} from '../src/renderer/shared/queueStatus.js';

describe('queueStatus store', () => {
  beforeEach(() => setQueueStatus(null));

  it('starts empty', () => {
    expect(getQueueStatus()).toBeNull();
  });

  it('stores a shallow copy (source mutation does not leak into the stored object)', () => {
    const src = { folder: '/a', count: 3, done: 1, remaining: 2, current: 0, preprocessed: 2 };
    setQueueStatus(src);
    src.count = 99;
    expect(getQueueStatus()).not.toBe(src);
    expect(getQueueStatus().count).toBe(3);
  });

  it('setQueueStatus(null) clears', () => {
    setQueueStatus({ folder: '/a', count: 1, done: 0, remaining: 1 });
    setQueueStatus(null);
    expect(getQueueStatus()).toBeNull();
  });

  it('notifies subscribers on every publish, with the current value', () => {
    const cb = vi.fn();
    const unsub = subscribeQueueStatus(cb);
    setQueueStatus({ folder: '/x', count: 2, done: 0, remaining: 2 });
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ folder: '/x', count: 2 }));
    setQueueStatus(null);
    expect(cb).toHaveBeenLastCalledWith(null);
    unsub();
  });

  it('a late subscriber reads the current value on mount (via getQueueStatus)', () => {
    setQueueStatus({ folder: '/late', count: 5, done: 5, remaining: 0 });
    // The store keeps the latest snapshot, so a surface mounting after the last
    // publish can seed itself immediately rather than waiting for a change.
    expect(getQueueStatus()).toMatchObject({ folder: '/late', count: 5 });
  });

  it('unsubscribe stops further notifications', () => {
    const cb = vi.fn();
    const unsub = subscribeQueueStatus(cb);
    unsub();
    setQueueStatus({ folder: '/y', count: 1, done: 0, remaining: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});
