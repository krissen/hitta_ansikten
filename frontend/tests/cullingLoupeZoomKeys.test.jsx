import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { settle } from './helpers/settle.js';
import { ZOOM_STEP } from '../src/renderer/shared/canvasViewport.js';

// Loupe zoom shortcuts (+ / - / = / 0) in CullingModule.
//
// The keys are bound in a document-level CAPTURE-phase keydown handler and
// forwarded to the CanvasImageView imperative handle, mirroring ImageViewer's
// bindings: + zooms in a step, - zooms out a step, = resets to 1:1 (resetZoom)
// and 0 returns to auto-fit. Capture + stopImmediatePropagation matters:
// ImageViewer binds the same keys on document without any tabset gating, so
// culling must CLAIM the event when it acts (or one keystroke zooms both
// viewers) and let it propagate untouched when any gate fails. These tests pin
// the guards: active tabset, single view only, a drawable image required, and
// full suppression while a text field (the inline rename input) has focus.
//
// The harness follows tests/cullingModuleFence.test.jsx (mocked backend +
// module-event bus), plus two extra seams so the ref calls are observable:
// CanvasImageView is replaced by a stub exposing a spy imperative handle, and
// useDecodedImage returns a controllable drawable.

const h = vi.hoisted(() => {
  const registry = new Map(); // eventName -> latest useModuleEvent handler
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    registry,
    api,
    nextFiles: { files: [], players: [] },
    nextStats: {},
    // What the mocked useDecodedImage returns (a fake drawable by default).
    decoded: { image: { width: 100, height: 80 }, loading: false, error: null },
    // Spy imperative handle installed by the CanvasImageView stub.
    viewApi: null,
  };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: h.api }),
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: (eventName, handler) => {
    if (eventName) h.registry.set(eventName, handler);
  },
  useModuleAPI: () => ({
    emit: vi.fn(),
    on: () => () => {},
    waitForListeners: vi.fn().mockResolvedValue(true),
    hasListeners: () => false,
  }),
}));

vi.mock('../src/renderer/hooks/useDecodedImage.js', () => ({
  useDecodedImage: () => h.decoded,
  default: () => h.decoded,
}));

vi.mock('../src/renderer/components/CanvasImageView.jsx', async () => {
  const ReactMod = await import('react');
  const CanvasImageView = ReactMod.forwardRef(function CanvasImageViewStub(_props, ref) {
    ReactMod.useImperativeHandle(ref, () => h.viewApi);
    return ReactMod.createElement('div', { 'data-testid': 'loupe-canvas-stub' });
  });
  return { CanvasImageView, default: CanvasImageView };
});

import { CullingModule } from '../src/renderer/components/CullingModule.jsx';

beforeAll(() => {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!window.localStorage) {
    const store = new Map();
    window.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  }
});

const FILES = [
  { path: '/p/260601_120000_Alice.jpg', basename: '260601_120000_Alice.jpg', mtime_ms: 100, size: 10 },
  { path: '/p/260601_120100_Bob.jpg', basename: '260601_120100_Bob.jpg', mtime_ms: 200, size: 20 },
];

let originalFetch;

beforeEach(() => {
  cleanup();
  h.registry.clear();
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.nextFiles = { files: FILES, players: ['Alice', 'Bob'] };
  h.nextStats = { baseline: 5, players: [], excluded: null };
  h.decoded = { image: { width: 100, height: 80 }, loading: false, error: null };
  h.viewApi = {
    zoom: vi.fn(),
    resetZoom: vi.fn(),
    autoFit: vi.fn(),
    setPan: vi.fn(),
    getTransform: vi.fn(),
    centerOnRect: vi.fn(),
    applyTransform: vi.fn(),
  };
  h.api.post.mockImplementation((path) => {
    if (path.includes('/culling/files')) return Promise.resolve(h.nextFiles);
    if (path.includes('/players/count')) return Promise.resolve(h.nextStats);
    return Promise.resolve({});
  });
  try { localStorage.clear(); } catch { /* ignore */ }
  originalFetch = global.fetch;
  global.fetch = vi.fn(() => new Promise(() => {}));
  globalThis.window.ansiktenAPI = {
    watchFolder: vi.fn(),
    unwatchFolder: vi.fn(),
    onFolderChanged: () => () => {},
    invoke: vi.fn().mockResolvedValue([]),
  };
});

afterEach(async () => {
  // Drain before the mocks go away. React commits the DOM before it runs
  // passive effects, so a wait that settles on rendered output can return with
  // an effect still pending; it then commits during teardown — after
  // vi.restoreAllMocks() here, and inside Testing Library's cleanup, which
  // Vitest's reverse hook order runs after this hook. The transport is gone by
  // then, and the effect throws where no test can see it. Draining here settles
  // those effects while their mocks still work. Same hazard that took dev red
  // through fileQueueModule.test.jsx.
  await settle();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function mountCulling(node = null) {
  let utils;
  await act(async () => {
    utils = render(<CullingModule node={node} />);
  });
  await settle();
  return utils;
}

async function loadFiles({ files = FILES, players = ['Alice', 'Bob'] } = {}) {
  h.nextFiles = { files, players };
  const handler = h.registry.get('culling-load');
  await act(async () => {
    await handler({ roots: ['/p'], clear: true, recursive: false });
  });
  // Drain the load (list, stats and the auto-fit effect it triggers) instead of
  // counting the awaits in that chain; the clear below depends on it having run.
  await settle();
  // The new-file auto-fit effect fires on load; the tests below only care
  // about key-driven calls.
  h.viewApi.autoFit.mockClear();
}

function press(key, target = document) {
  fireEvent.keyDown(target, { key });
}

describe('CullingModule — loupe zoom keys (+ / - / = / 0)', () => {
  it('forwards the keys to the view ref with ImageViewer semantics', async () => {
    await mountCulling();
    await loadFiles();

    await act(async () => { press('+'); });
    expect(h.viewApi.zoom).toHaveBeenCalledTimes(1);
    expect(h.viewApi.zoom).toHaveBeenLastCalledWith(ZOOM_STEP);

    await act(async () => { press('-'); });
    expect(h.viewApi.zoom).toHaveBeenCalledTimes(2);
    expect(h.viewApi.zoom).toHaveBeenLastCalledWith(1 / ZOOM_STEP);

    await act(async () => { press('='); });
    expect(h.viewApi.resetZoom).toHaveBeenCalledTimes(1);
    // No faces in culling: 1:1 centers on the image (no centerRect argument).
    expect(h.viewApi.resetZoom).toHaveBeenCalledWith();

    await act(async () => { press('0'); });
    expect(h.viewApi.autoFit).toHaveBeenCalledTimes(1);
  });

  it('is suppressed while the inline rename input has focus', async () => {
    const { container } = await mountCulling();
    await loadFiles();

    // Enter begins the inline rename; the input is a text field the zoom keys
    // must never steal from ("+", "-", "0" are all typeable filename chars).
    await act(async () => { press('Enter'); });
    const input = container.querySelector('.culling-rename-input');
    expect(input).toBeTruthy();

    for (const key of ['+', '-', '=', '0']) {
      await act(async () => { press(key, input); });
    }
    expect(h.viewApi.zoom).not.toHaveBeenCalled();
    expect(h.viewApi.resetZoom).not.toHaveBeenCalled();
    expect(h.viewApi.autoFit).not.toHaveBeenCalled();
  });

  it('does nothing in grid view', async () => {
    localStorage.setItem('ansikten.culling.viewMode', 'grid');
    const { container } = await mountCulling();
    await loadFiles();
    expect(container.querySelector('.culling-grid')).toBeTruthy();

    for (const key of ['+', '-', '=', '0']) {
      await act(async () => { press(key); });
    }
    expect(h.viewApi.zoom).not.toHaveBeenCalled();
    expect(h.viewApi.resetZoom).not.toHaveBeenCalled();
    expect(h.viewApi.autoFit).not.toHaveBeenCalled();
  });

  it('claims the event when it acts — a later document-level listener never sees it', async () => {
    await mountCulling();
    await loadFiles();

    // Stand-in for ImageViewer's ungated document-level shortcut listener
    // (useKeyboardShortcuts), registered after the module's capture-phase
    // handler: stopImmediatePropagation must block it, otherwise one keystroke
    // would zoom both the loupe and a mounted ImageViewer tab.
    const other = vi.fn();
    document.addEventListener('keydown', other);
    try {
      await act(async () => { press('+'); });
    } finally {
      document.removeEventListener('keydown', other);
    }
    expect(h.viewApi.zoom).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  it('lets the event propagate when a gate fails (grid view)', async () => {
    localStorage.setItem('ansikten.culling.viewMode', 'grid');
    const { container } = await mountCulling();
    await loadFiles();
    expect(container.querySelector('.culling-grid')).toBeTruthy();

    const other = vi.fn();
    document.addEventListener('keydown', other);
    try {
      await act(async () => { press('+'); });
    } finally {
      document.removeEventListener('keydown', other);
    }
    // Culling did not act — and did not swallow the key either, so another
    // module's viewer (e.g. ImageViewer) can still respond to it.
    expect(h.viewApi.zoom).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('lets the event propagate when another tabset is active', async () => {
    // Visible but NOT the active tabset — the exact split-layout scenario the
    // capture-phase claim exists for: an inactive culling panel must neither
    // zoom its own loupe nor swallow the key from the active module.
    const node = {
      isVisible: () => true,
      getModel: () => ({ getActiveTabset: () => ({ getId: () => 'OTHER' }) }),
      getParent: () => ({ getId: () => 'TS1' }),
    };
    await mountCulling(node);
    await loadFiles();

    const other = vi.fn();
    document.addEventListener('keydown', other);
    try {
      await act(async () => { press('+'); });
    } finally {
      document.removeEventListener('keydown', other);
    }
    expect(h.viewApi.zoom).not.toHaveBeenCalled();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('does nothing while the loupe has no drawable image', async () => {
    h.decoded = { image: null, loading: true, error: null };
    await mountCulling();
    await loadFiles();

    for (const key of ['+', '-', '=', '0']) {
      await act(async () => { press(key); });
    }
    expect(h.viewApi.zoom).not.toHaveBeenCalled();
    expect(h.viewApi.resetZoom).not.toHaveBeenCalled();
    expect(h.viewApi.autoFit).not.toHaveBeenCalled();
  });
});
