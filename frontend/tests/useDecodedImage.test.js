import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { settle } from './helpers/settle.js';
import { useDecodedImage } from '../src/renderer/hooks/useDecodedImage.js';

// jsdom's HTMLImageElement never fires load/error on its own, and there is no
// createImageBitmap. We replace both with controllable fakes: each Image
// instance records its src and exposes fire helpers so a test drives the timing.
let images = [];
let bitmaps = [];

class FakeImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
    this._src = null;
    images.push(this);
  }
  set src(v) { this._src = v; }
  get src() { return this._src; }
  fireLoad() { this.onload && this.onload(); }
  fireError() { this.onerror && this.onerror(new Event('error')); }
}

function installFakes({ bitmap = true } = {}) {
  globalThis.Image = FakeImage;
  if (bitmap) {
    globalThis.createImageBitmap = vi.fn(async () => {
      const bmp = { width: 10, height: 10, close: vi.fn() };
      bitmaps.push(bmp);
      return bmp;
    });
  } else {
    delete globalThis.createImageBitmap;
  }
}

beforeEach(() => {
  images = [];
  bitmaps = [];
});

afterEach(async () => {
  // Drain before the fakes go away — same class as the other component suites,
  // with the image decoder as the transport instead of api.post. Work a test
  // leaves behind can land outside any act() scope (React schedules it on its
  // own Scheduler macrotask), and whether it lands before or after the test body
  // ends is what CPU contention shifts. Landing after means it runs once
  // globalThis.Image and createImageBitmap are already deleted, and it throws
  // where no test can see it.
  //
  // settle() is a single macrotask: it drains queued work but deliberately does
  // not wait for a promise that is genuinely still pending. The fakes here are
  // driven by explicit fire helpers, so that is enough.
  await settle();
  delete globalThis.Image;
  delete globalThis.createImageBitmap;
  vi.restoreAllMocks();
});

describe('useDecodedImage', () => {
  it('starts idle for a falsy url', () => {
    installFakes();
    const { result } = renderHook(() => useDecodedImage(null));
    expect(result.current.image).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(images).toHaveLength(0);
  });

  it('decodes a url into an ImageBitmap and clears loading', async () => {
    installFakes();
    const { result } = renderHook(() => useDecodedImage('file:///a.jpg'));

    expect(result.current.loading).toBe(true);
    expect(images).toHaveLength(1);
    expect(images[0].src).toBe('file:///a.jpg');

    await act(async () => { images[0].fireLoad(); });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.image).toBe(bitmaps[0]);
    expect(result.current.error).toBe(null);
    expect(createImageBitmap).toHaveBeenCalledWith(
      images[0],
      { imageOrientation: 'from-image' }
    );
  });

  it('falls back to the HTMLImageElement when createImageBitmap is unavailable', async () => {
    installFakes({ bitmap: false });
    const { result } = renderHook(() => useDecodedImage('file:///b.jpg'));

    await act(async () => { images[0].fireLoad(); });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.image).toBe(images[0]);
    expect(result.current.error).toBe(null);
  });

  it('surfaces a decode error and drops the image', async () => {
    installFakes();
    const { result } = renderHook(() => useDecodedImage('file:///bad.jpg'));

    await act(async () => { images[0].fireError(); });

    await waitFor(() => expect(result.current.error).not.toBe(null));
    expect(result.current.image).toBe(null);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('never decodes a url cancelled before its load completes', async () => {
    installFakes();
    const { result, rerender } = renderHook(({ url }) => useDecodedImage(url), {
      initialProps: { url: 'file:///first.jpg' }
    });

    const first = images[0];

    // Switch URL before the first image finishes loading: cleanup must abort
    // the in-flight load (handlers detached, src blanked) so no decode work is
    // ever queued for the skipped file.
    rerender({ url: 'file:///second.jpg' });
    const second = images[1];

    expect(first.onload).toBe(null);
    expect(first.onerror).toBe(null);
    expect(first.src).toBe('');

    // Even a late load "arriving" for the first image is a no-op.
    await act(async () => { first.fireLoad(); });
    await act(async () => { second.fireLoad(); });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Only the second image was decoded; no bitmap was created for the first.
    expect(bitmaps).toHaveLength(1);
    expect(result.current.image).toBe(bitmaps[0]);
    expect(bitmaps[0].close).not.toHaveBeenCalled();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);
    expect(createImageBitmap).toHaveBeenCalledWith(
      second,
      { imageOrientation: 'from-image' }
    );
  });

  it('closes a bitmap whose decode was overtaken mid-flight', async () => {
    installFakes();
    // Deferred createImageBitmap: the decode is in progress when the URL
    // changes, so the cancelled path must close the finished bitmap.
    let resolveBitmap;
    const bmp = { width: 10, height: 10, close: vi.fn() };
    globalThis.createImageBitmap = vi.fn(
      () => new Promise((resolve) => { resolveBitmap = () => resolve(bmp); })
    );

    const { result, rerender } = renderHook(({ url }) => useDecodedImage(url), {
      initialProps: { url: 'file:///first.jpg' }
    });

    // The first image loads and its decode starts (promise pending).
    await act(async () => { images[0].fireLoad(); });
    expect(createImageBitmap).toHaveBeenCalledTimes(1);

    // Cancel while the decode is in flight, then let it finish.
    rerender({ url: 'file:///second.jpg' });
    await act(async () => { resolveBitmap(); });

    // The late bitmap is closed, never committed.
    expect(bmp.close).toHaveBeenCalledTimes(1);
    expect(result.current.image).toBe(null);
  });

  it('closes the committed bitmap on unmount', async () => {
    installFakes();
    const { result, unmount } = renderHook(() => useDecodedImage('file:///c.jpg'));

    await act(async () => { images[0].fireLoad(); });
    await waitFor(() => expect(result.current.image).toBe(bitmaps[0]));

    unmount();
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
  });
});
