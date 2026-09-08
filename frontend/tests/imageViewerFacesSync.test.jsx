import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  beforeEach,
  afterEach,
} from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { settle } from './helpers/settle.js';
import React, { useEffect } from 'react';

// Faces/active-index sync between ReviewModule and ImageViewer (PR3 races B + C).
//
// ImageViewer mirrors Review's faces (`faces-detected`) and active index
// (`active-face-changed`). Two races are pinned here:
//
//  B — a same-image faces re-emit (fired after every confirm/ignore) must NOT
//      reset ImageViewer's active index to 0; only a NEW image resets it.
//  C — faces detected while the image is still decoding (originalImagePath not
//      yet updated) must be buffered and replayed once the image finishes
//      loading, instead of being dropped.
//
// The seam under test is the REAL ImageViewer + REAL ModuleAPIProvider event
// bus. CanvasImageView is mocked so we can (a) hand ImageViewer an imperative
// ref and (b) capture the drawOverlay closure — invoking it in single-box mode
// reveals which face index is active (only faces[activeFaceIndex] is drawn).

const cap = vi.hoisted(() => ({
  drawOverlay: null,
  image: null,
  methods: {
    autoFit: vi.fn(),
    resetZoom: vi.fn(),
    centerOnRect: vi.fn(),
    applyTransform: vi.fn(),
    zoom: vi.fn(),
  },
}));

vi.mock('../src/renderer/components/CanvasImageView.jsx', () => ({
  CanvasImageView: React.forwardRef(function MockCanvas(
    { image, drawOverlay },
    ref,
  ) {
    cap.image = image;
    cap.drawOverlay = drawOverlay;
    React.useImperativeHandle(ref, () => cap.methods, []);
    return null;
  }),
}));

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
import {
  useEmitEvent,
  useModuleEvent,
} from '../src/renderer/hooks/useModuleEvent.js';

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(0), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
  }
  globalThis.Image = class {
    constructor() {
      this.width = 400;
      this.height = 300;
      this.onload = null;
      this.onerror = null;
    }
    set src(_v) {
      queueMicrotask(() => this.onload && this.onload());
    }
    get src() {
      return this._src;
    }
    decode() {
      return Promise.resolve();
    }
  };
  delete globalThis.createImageBitmap; // force the HTMLImageElement path
  window.ansiktenAPI = { send: vi.fn() };
});

const FACE_W = 20; // bounding_box.width — the face-box strokeRect's telltale width

// A face with a distinct bounding_box.x so the drawn box identifies the index.
function faceAt(x) {
  return {
    face_id: `f_${x}`,
    bounding_box: { x, y: 0, width: FACE_W, height: 20 },
  };
}

// Invoke the captured overlay in single-box mode and collect the X's of the
// actual face boxes (strokeRect calls whose width equals the bbox width — this
// excludes the active-highlight and label-highlight rects, which have other
// widths). Only faces[activeFaceIndex] is drawn, so the result is that face's x.
function drawnXs() {
  const xs = [];
  const ctx = new Proxy(
    {
      measureText: () => ({ width: 0 }),
      strokeRect: (x, _y, w) => {
        if (w === FACE_W) xs.push(x);
      },
    },
    {
      get: (target, prop) => (prop in target ? target[prop] : () => {}),
      set: () => true,
    },
  );
  cap.drawOverlay(ctx, {
    scale: 1,
    x: 0,
    y: 0,
    canvasWidth: 500,
    canvasHeight: 500,
  });
  return xs;
}

const bus = { emit: null };
function Probe() {
  const emit = useEmitEvent();
  useEffect(() => {
    bus.emit = emit;
  }, [emit]);
  // Swallow image-loaded so the bus has a subscriber (parity with real layout).
  useModuleEvent('image-loaded', () => {}, []);
  return null;
}

// The macrotask this awaits already drains every microtask the load chain
// queues, so the two hand-counted flushes that used to bracket it added nothing.
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

async function loadImage(path) {
  await act(async () => {
    bus.emit('load-image', { imagePath: path, skipAutoDetect: false });
  });
  await flush();
}

beforeEach(() => {
  bus.emit = null;
  cap.drawOverlay = null;
  cap.image = null;
  cap.methods.centerOnRect.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ImageViewer — faces/active-index sync (B)', () => {
  it('a same-image faces-detected re-emit does NOT reset the active index', async () => {
    await mountViewer();
    await loadImage('/photos/a.jpg');
    await act(async () => {
      bus.emit('boxes-single');
    });

    // First faces batch for this image → active index resets to 0 (face @100).
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(100), faceAt(300)],
        imagePath: '/photos/a.jpg',
      });
    });
    await flush();
    expect(drawnXs()).toContain(100);

    // User navigates to face 1 (@300).
    await act(async () => {
      bus.emit('active-face-changed', { index: 1, center: false });
    });
    await flush();
    expect(drawnXs()).toContain(300);

    // A same-path re-emit (as Review fires after each confirm/ignore) must keep
    // the active index on face 1, not snap back to face 0.
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(100), faceAt(300)],
        imagePath: '/photos/a.jpg',
      });
    });
    await flush();
    const xs = drawnXs();
    expect(xs).toContain(300);
    expect(xs).not.toContain(100);
  });

  it('faces for a NEW image reset the active index to the first face', async () => {
    await mountViewer();
    await loadImage('/photos/a.jpg');
    await act(async () => {
      bus.emit('boxes-single');
    });
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(100), faceAt(300)],
        imagePath: '/photos/a.jpg',
      });
    });
    await act(async () => {
      bus.emit('active-face-changed', { index: 1, center: false });
    });
    await flush();
    expect(drawnXs()).toContain(300);

    // Switch to a different image, then its faces arrive → index back to 0.
    await loadImage('/photos/b.jpg');
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(100), faceAt(300)],
        imagePath: '/photos/b.jpg',
      });
    });
    await flush();
    const xs = drawnXs();
    expect(xs).toContain(100);
    expect(xs).not.toContain(300);
  });

  it('active-face-changed with center:false does not center the view', async () => {
    await mountViewer();
    await loadImage('/photos/a.jpg');
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(100), faceAt(300)],
        imagePath: '/photos/a.jpg',
      });
    });
    cap.methods.centerOnRect.mockClear();
    await act(async () => {
      bus.emit('active-face-changed', { index: 1, center: false });
    });
    await flush();
    expect(cap.methods.centerOnRect).not.toHaveBeenCalled();

    // center omitted (previous behavior) → centers when auto-center is enabled.
    await act(async () => {
      bus.emit('active-face-changed', { index: 0 });
    });
    await flush();
    expect(cap.methods.centerOnRect).toHaveBeenCalled();
  });
});

describe('ImageViewer — faces buffered during decode (C)', () => {
  it('replays faces that arrived before the image finished loading', async () => {
    await mountViewer();
    await loadImage('/photos/a.jpg'); // originalImagePath = /photos/a.jpg, no faces
    await act(async () => {
      bus.emit('boxes-single');
    });

    // Faces for /photos/b.jpg arrive while /photos/a.jpg is still the loaded
    // image (simulating detection completing inside b's decode window). The
    // path mismatch buffers them instead of dropping — nothing is drawn yet.
    await act(async () => {
      bus.emit('faces-detected', {
        faces: [faceAt(150), faceAt(350)],
        imagePath: '/photos/b.jpg',
      });
    });
    await flush();
    expect(drawnXs()).toHaveLength(0);

    // Now /photos/b.jpg finishes loading → buffered faces replay and render.
    await loadImage('/photos/b.jpg');
    const xs = drawnXs();
    expect(xs).toContain(150); // active index reset to first face of the new image
  });
});
