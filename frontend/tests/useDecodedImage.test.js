import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
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

afterEach(() => {
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

  it('cancels a stale decode on url change and closes the leaked bitmap', async () => {
    installFakes();
    const { result, rerender } = renderHook(({ url }) => useDecodedImage(url), {
      initialProps: { url: 'file:///first.jpg' }
    });

    const first = images[0];

    // Switch URL before the first image finishes loading.
    rerender({ url: 'file:///second.jpg' });
    const second = images[1];

    // The first now resolves late: its bitmap must be closed, not committed.
    await act(async () => { first.fireLoad(); });
    await act(async () => { second.fireLoad(); });

    await waitFor(() => expect(result.current.loading).toBe(false));

    // Two bitmaps were created; the stale (first) one is closed.
    expect(bitmaps).toHaveLength(2);
    expect(bitmaps[0].close).toHaveBeenCalledTimes(1);
    // The committed image is the second decode.
    expect(result.current.image).toBe(bitmaps[1]);
    expect(bitmaps[1].close).not.toHaveBeenCalled();
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
