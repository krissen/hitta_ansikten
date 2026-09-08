import { describe, it, expect, vi } from 'vitest';
import { createLaunchQueue } from '../src/main/launch-queue.js';

describe('createLaunchQueue — hold until ready', () => {
  it('holds commands enqueued before ready and delivers them on markReady', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);

    q.enqueue({ type: 'a' });
    q.enqueue({ type: 'b' });
    expect(deliver).not.toHaveBeenCalled();
    expect(q.pending()).toBe(2);
    expect(q.isReady()).toBe(false);

    q.markReady();
    expect(deliver.mock.calls.map((c) => c[0])).toEqual([
      { type: 'a' },
      { type: 'b' },
    ]);
    expect(q.pending()).toBe(0);
  });

  it('delivers immediately once ready', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);
    q.markReady();
    q.enqueue({ type: 'a' });
    expect(deliver).toHaveBeenCalledWith({ type: 'a' });
    expect(q.pending()).toBe(0);
  });

  it('ignores null/undefined commands', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);
    q.enqueue(null);
    q.enqueue(undefined);
    q.markReady();
    expect(deliver).not.toHaveBeenCalled();
  });
});

describe('createLaunchQueue — FIFO, not a single slot', () => {
  it('an initial launch and a second launch before ready both deliver, in order', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);

    // Initial CLI launch...
    q.enqueue({ type: 'open-culling', payload: { roots: ['/a'] } });
    // ...then a second-instance launch arrives before the renderer is ready.
    q.enqueue({ type: 'queue-files', payload: { files: ['/b.nef'] } });

    // Neither is clobbered; both are held.
    expect(q.pending()).toBe(2);
    q.markReady();

    expect(deliver.mock.calls.map((c) => c[0].type)).toEqual([
      'open-culling',
      'queue-files',
    ]);
  });
});

describe('createLaunchQueue — reload re-arm (markNotReady)', () => {
  it('re-arms the hold so mid-reload commands queue instead of being delivered into a dead page', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);
    q.markReady();

    // Renderer starts reloading: re-arm the hold.
    q.markNotReady();
    expect(q.isReady()).toBe(false);

    // A command that arrives mid-reload must be held, not sent.
    q.enqueue({ type: 'load-image', payload: { imagePath: '/x.nef' } });
    expect(deliver).not.toHaveBeenCalled();
    expect(q.pending()).toBe(1);

    // Renderer re-mounts and re-signals ready → the held command delivers.
    q.markReady();
    expect(deliver).toHaveBeenCalledWith({
      type: 'load-image',
      payload: { imagePath: '/x.nef' },
    });
  });

  it('markNotReady preserves already-pending commands (queue survives the reset)', () => {
    const deliver = vi.fn();
    const q = createLaunchQueue(deliver);
    q.enqueue({ type: 'a' }); // pending (never ready)
    q.markNotReady(); // reset while something is already held
    expect(q.pending()).toBe(1);
    q.markReady();
    expect(deliver).toHaveBeenCalledWith({ type: 'a' });
  });
});
