import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { settle } from './helpers/settle.js';
import React, { useEffect } from 'react';

// Late-mount recovery integration test (Nagelfar issue-001).
//
// Review's late-mount recovery emits 'request-current-image' on mount; ImageViewer
// must answer by re-emitting its CURRENT image as 'image-loaded'. The handler
// reads component STATE (imagePath/image), so its useModuleEvent subscription
// needs a deps array — without one it keeps the mount closure (imagePath = null)
// and re-emits nothing for any image loaded after mount. This test mounts the
// REAL ImageViewer under the REAL ModuleAPIProvider (in-memory event bus), loads
// an image AFTER mount, then fires request-current-image and asserts the re-emit
// actually carries that image. The no-deps regression makes it fire zero times.

// Only Toast, preferences and the HTTP client are mocked; the module event bus
// (ModuleAPIProvider + useModuleEvent) is REAL — that's the seam under test.
vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => vi.fn(),
}));
vi.mock('../src/renderer/workspace/preferences.js', () => ({
  preferences: { get: (_key, fallback) => fallback },
}));
vi.mock('../src/renderer/shared/api-client.js', () => ({
  apiClient: {
    get: vi.fn().mockResolvedValue({}),
    post: vi.fn().mockResolvedValue({}),
    onWSEvent: vi.fn(),
    offWSEvent: vi.fn(),
  },
}));

import { ImageViewer } from '../src/renderer/components/ImageViewer.jsx';
import { ModuleAPIProvider } from '../src/renderer/context/ModuleAPIContext.jsx';
import { useEmitEvent, useModuleEvent } from '../src/renderer/hooks/useModuleEvent.js';

beforeAll(() => {
  // jsdom stubs for the browser bits ImageViewer touches on mount/draw.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  if (!window.matchMedia) {
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  }
  // A permissive 2D context: every method is a no-op, every property reads 0.
  const ctx = new Proxy({}, { get: () => () => {} });
  HTMLCanvasElement.prototype.getContext = () => ctx;

  // Image that "loads" as soon as src is assigned (onload is wired first).
  globalThis.Image = class {
    constructor() { this.width = 120; this.height = 90; this.onload = null; this.onerror = null; }
    set src(_v) { queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
    decode() { return Promise.resolve(); }
  };
  // Force the HTMLImageElement fallback path in loadImage (no ImageBitmap).
  delete globalThis.createImageBitmap;
  window.ansiktenAPI = { send: vi.fn() };
});

// Test harness: captures the bus emit and every image-loaded payload.
const bus = { emit: null, loaded: [] };
function Probe() {
  const emit = useEmitEvent();
  useEffect(() => { bus.emit = emit; }, [emit]);
  useModuleEvent('image-loaded', (data) => { bus.loaded.push(data); }, []);
  return null;
}

// Let the queued Image.onload and the load promise settle. The macrotask this
// awaits already drained every microtask the chain queues, so the two
// hand-counted flushes that used to bracket it added nothing.
const flush = settle;

async function mountViewer() {
  await act(async () => {
    render(
      <ModuleAPIProvider>
        <ImageViewer node={null} />
        <Probe />
      </ModuleAPIProvider>,
    );
  });
  await flush();
}

beforeEach(() => {
  bus.emit = null;
  bus.loaded = [];
});

afterEach(() => {
  cleanup();
});

describe('ImageViewer — late-mount recovery (request-current-image)', () => {
  it('re-emits an image that was loaded AFTER mount', async () => {
    await mountViewer();
    expect(bus.emit).toBeTypeOf('function');

    // Load an image after mount (the real load-image → loadImage → image-loaded path).
    await act(async () => { bus.emit('load-image', { imagePath: '/photos/a.jpg', skipAutoDetect: false }); });
    await flush();

    const initial = bus.loaded.filter((d) => d?.imagePath === '/photos/a.jpg');
    expect(initial.length).toBeGreaterThanOrEqual(1);

    // Now the recovery request (as Review emits on late mount). The handler must
    // see the CURRENT image, not the mount-time null.
    bus.loaded = [];
    await act(async () => { bus.emit('request-current-image'); });
    await flush();

    expect(bus.loaded.length).toBeGreaterThanOrEqual(1);
    expect(bus.loaded.at(-1)).toMatchObject({ imagePath: '/photos/a.jpg' });
  });

  it('re-emits nothing when no image has been loaded yet', async () => {
    await mountViewer();
    bus.loaded = [];
    await act(async () => { bus.emit('request-current-image'); });
    await flush();
    expect(bus.loaded).toHaveLength(0);
  });
});
