import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

// jsdom lacks scrollIntoView; the active-face auto-scroll effect calls it.
beforeAll(() => {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
});

// Characterization + smoke tests for ReviewModule.
//
// ReviewModule (~1540 lines) owns the face-review UI: the detect→render flow,
// the document-level keyboard handler (Enter/Esc/arrows/digits/letters), the
// inline autocomplete inside FaceCard, and the confirm/ignore/unconfirm/advance
// state machine with its dirty-state + auto-save side effects. These tests pin
// the CURRENT observable behavior so the planned decomposition (H4) can extract
// pure logic without silently changing it.
//
// Everything the component reaches for outside its own render — the backend API,
// the module event bus, toasts, websockets, thumbnails and preferences — is
// mocked with controllable stubs. The i18n catalog, normalizeSuffix and Icon are
// left REAL so assertions can key off the actual Swedish strings the user sees.
//
// Coverage gaps (documented honestly, to be closed when H4 extracts pure logic):
//  - The name-mismatch / high-confidence-ignore ConfirmDialog branches are not
//    exercised (they gate on match_alternatives[0].confidence >= 75 with a
//    differing typed name; reachable but left for the extraction PR).
//  - saveAllChanges' batch-confirm payload shape is only checked via the
//    auto-save path, not per-field.
//  - useDropdownPosition's flip geometry is untestable under jsdom (0-sized
//    rects); only the presence/order of suggestions is pinned, not placement.

const h = vi.hoisted(() => {
  const emit = vi.fn();
  const showToast = vi.fn();
  const confirm = vi.fn();
  const registry = new Map(); // eventName -> latest useModuleEvent handler
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    emit,
    showToast,
    confirm,
    registry,
    api,
    people: [],
    nextDetect: { faces: [], file_hash: 'hash', processing_time_ms: 3 },
  };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: h.api }),
}));

vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => h.showToast,
}));

// discardChanges moved from the native window.confirm() to the promise-based
// useConfirm() (fas B6). Swap the context hook for a controllable stub so the
// discard-gate test asserts against it instead of the window global.
vi.mock('../src/renderer/context/ConfirmContext.jsx', () => ({
  useConfirm: () => h.confirm,
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => h.emit,
  useModuleEvent: (eventName, handler) => {
    if (eventName) h.registry.set(eventName, handler);
  },
  useModuleAPI: () => ({ emit: h.emit, on: () => () => {} }),
}));

vi.mock('../src/renderer/hooks/useWebSocket.js', () => ({
  useWebSocket: () => {},
}));

vi.mock('../src/renderer/shared/thumbnail-cache.js', () => ({
  useThumbnail: () => ({ url: null, loading: false, error: false }),
}));

vi.mock('../src/renderer/workspace/preferences.js', () => ({
  preferences: { get: (_key, fallback) => fallback },
}));

import { ReviewModule } from '../src/renderer/components/ReviewModule.jsx';

const visibleNode = { isVisible: () => true };
const hiddenNode = { isVisible: () => false };

// A node modelling the FlexLayout tabset Review lives in, plus the model-wide
// active tabset. Review's keyboard is gated on the active tabset (I1): live when
// its own tabset is active OR a companion image surface (image-viewer /
// original-view) is. `activeComponent` sets what the active tabset hosts.
function tabNode({ mine = 'TSR', activeId = 'TSR', activeComponent = 'review-module', visible = true } = {}) {
  const activeTabset = {
    getId: () => activeId,
    getSelectedNode: () => ({ getComponent: () => activeComponent }),
  };
  return {
    isVisible: () => visible,
    getModel: () => ({ getActiveTabset: () => activeTabset }),
    getParent: () => ({ getId: () => mine }),
  };
}

// Build a detected face with sensible defaults; override per test.
function face(overrides = {}) {
  return {
    face_id: `f_${Math.random().toString(36).slice(2)}`,
    bounding_box: [0, 0, 10, 10],
    person_name: '',
    is_confirmed: false,
    match_alternatives: [],
    ...overrides,
  };
}

async function mountReview(node = visibleNode) {
  let utils;
  await act(async () => {
    utils = render(<ReviewModule node={node} />);
    await Promise.resolve();
  });
  return utils;
}

// Drive the detect flow the way FileQueue does: fire the 'image-loaded' module
// event the component subscribed to, with a mocked detect result.
async function loadImage(faces, imagePath = '/photos/a.jpg') {
  h.nextDetect = { faces, file_hash: 'hash', processing_time_ms: 3 };
  const handler = h.registry.get('image-loaded');
  await act(async () => {
    await handler({ imagePath });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function lastEmit(eventName) {
  const calls = h.emit.mock.calls.filter(([e]) => e === eventName);
  return calls.length ? calls[calls.length - 1][1] : undefined;
}

beforeEach(() => {
  cleanup();
  h.emit.mockClear();
  h.showToast.mockClear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.registry.clear();
  h.people = [];
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.api.get.mockImplementation((path) => {
    if (path.includes('people/names')) return Promise.resolve(h.people);
    if (path.includes('manual-suffix')) return Promise.resolve({ raw: '' });
    return Promise.resolve({});
  });
  h.api.post.mockImplementation((path) => {
    if (path.includes('detect-faces')) return Promise.resolve(h.nextDetect);
    return Promise.resolve({});
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ReviewModule — smoke', () => {
  it('mounts without throwing (no TDZ / hook-order regression)', () => {
    expect(() => render(<ReviewModule node={null} />)).not.toThrow();
  });

  it('asks ImageViewer to re-send the current image on mount (late-mount recovery)', async () => {
    // A Review panel opened after an image already loaded misses the one-shot
    // image-loaded; request-current-image makes ImageViewer re-emit it.
    await mountReview();
    expect(h.emit).toHaveBeenCalledWith('request-current-image');
    expect(h.emit).toHaveBeenCalledWith('request-queue-status');
  });

  it('waits for an image before any faces are shown', async () => {
    const { container } = await mountReview();
    expect(container.querySelector('.review-status').textContent).toBe(
      'Väntar på bild…',
    );
    expect(container.querySelectorAll('.face-card')).toHaveLength(0);
  });

  it('renders a face card per detected face from the mocked detect result', async () => {
    const { container } = await mountReview();
    await loadImage([face(), face(), face()]);
    expect(container.querySelectorAll('.face-card')).toHaveLength(3);
    // Detection completion is broadcast so ImageViewer can draw the boxes.
    expect(h.emit).toHaveBeenCalledWith(
      'faces-detected',
      expect.objectContaining({ imagePath: '/photos/a.jpg' }),
    );
  });

  it('shows the manual-naming affordance when detection finds no faces', async () => {
    const { container } = await mountReview();
    await loadImage([]);
    const prompt = container.querySelector('.no-faces-detected');
    expect(prompt).toBeTruthy();
    const btn = container.querySelector('.add-manual-name-btn');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Lägg till namn manuellt');
  });

  it('does NOT show the manual-name button when detection errors (faces empty but not ok)', async () => {
    const { container } = await mountReview();
    h.api.post.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    const handler = h.registry.get('image-loaded');
    await act(async () => {
      await handler({ imagePath: '/photos/err.jpg' });
      await Promise.resolve();
    });
    expect(container.querySelector('.no-faces-detected')).toBeNull();
    expect(container.querySelector('.add-manual-name-btn')).toBeNull();
  });
});

describe('ReviewModule — keyboard navigation (characterization)', () => {
  it('Enter confirms the current face using its top alternative', async () => {
    const { container } = await mountReview();
    await loadImage([
      face({ match_alternatives: [{ name: 'Anna', confidence: 90, is_ignored: false }] }),
    ]);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    // Observable effect: the card flips to its confirmed status text.
    const status = container.querySelector('.status-text.confirmed');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Anna');
  });

  it('ArrowDown advances the active face and broadcasts active-face-changed', async () => {
    await mountReview();
    await loadImage([face(), face()]);
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    });
    // center:true — the target (face 1) is unconfirmed, so ImageViewer centers.
    expect(lastEmit('active-face-changed')).toEqual({ index: 1, center: true });
  });

  it('a digit key selects the matching alternative and confirms', async () => {
    const { container } = await mountReview();
    await loadImage([
      face({ match_alternatives: [{ name: 'Bob', confidence: 88, is_ignored: false }] }),
    ]);
    await act(async () => {
      fireEvent.keyDown(document, { key: '1' });
    });
    const status = container.querySelector('.status-text.confirmed');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Bob');
  });

  it('I ignores the current face (rejected badge)', async () => {
    const { container } = await mountReview();
    await loadImage([face()]);
    await act(async () => {
      fireEvent.keyDown(document, { key: 'i' });
    });
    const badge = container.querySelector('.status-text.rejected');
    expect(badge).toBeTruthy();
    expect(badge.textContent).toContain('Ignorerad');
  });

  // Visibility is now a NECESSARY-but-not-sufficient condition: the gate also
  // checks the active tabset (I1). A hidden tab is still ignored (unchanged).
  it('shortcuts require visibility — hidden tab ignores keys', async () => {
    await mountReview(hiddenNode);
    await loadImage([face(), face()]);
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    });
    expect(h.emit).not.toHaveBeenCalledWith('active-face-changed', expect.anything());
  });

  // I1: a visible-but-inactive Review (a foreign, non-companion tabset is
  // active — e.g. Culling in a split) must NOT handle keys. This is the guard
  // that stops the double-trash: Cmd+Backspace pressed while Culling is active
  // no longer also reaches a merely-visible Review.
  it('is silent when a foreign, non-companion tabset is active (visible but inactive)', async () => {
    await mountReview(tabNode({ mine: 'TSR', activeId: 'TSC', activeComponent: 'culling' }));
    await loadImage([face(), face()]);
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    });
    expect(h.emit).not.toHaveBeenCalledWith('active-face-changed', expect.anything());
  });

  // I1: the normal flow — the user clicks the image (activating ImageViewer's
  // tabset) and then presses a key — must keep working. image-viewer is a
  // declared companion, so Review stays live even though its own tab is only
  // visible, not active.
  it('stays live when a companion image surface hosts the active tabset', async () => {
    await mountReview(tabNode({ mine: 'TSR', activeId: 'TSI', activeComponent: 'image-viewer' }));
    await loadImage([face(), face()]);
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    });
    expect(lastEmit('active-face-changed')).toEqual({ index: 1, center: true });
  });

  it('typing in a name input does NOT trigger single-key shortcuts (guard)', async () => {
    const { container } = await mountReview();
    await loadImage([face()]);
    const input = container.querySelector('.autocomplete-wrapper input');
    expect(input).toBeTruthy();
    h.emit.mockClear();
    // 'x' would skip the image (emit review-complete) if treated as a shortcut.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'x' });
    });
    expect(h.emit).not.toHaveBeenCalledWith('review-complete', expect.anything());
    // 'i' would ignore the face; the card must stay unconfirmed.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'i' });
    });
    expect(container.querySelector('.status-text.rejected')).toBeNull();
  });

  it('Escape with pending changes prompts a discard confirmation', async () => {
    // Declining the discard prompt: the promise-based confirm resolves false.
    h.confirm.mockResolvedValue(false);
    await mountReview();
    await loadImage([
      face({ match_alternatives: [{ name: 'Cara', confidence: 90 }] }),
      face(),
    ]);
    // Confirm face 0 → creates a pending change.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    h.confirm.mockClear();
    // Escape on the module (not an input) → discardChanges → useConfirm().
    await act(async () => {
      fireEvent.keyDown(document.querySelector('.review-module'), { key: 'Escape' });
    });
    expect(h.confirm).toHaveBeenCalled();
  });
});

describe('ReviewModule — autocomplete (characterization)', () => {
  it('ranks prefix matches before substring matches, case-insensitively', async () => {
    h.people = ['Anna Andersson', 'Anders', 'Johanna', 'Hanna'];
    const { container } = await mountReview();
    await loadImage([face()]);
    const input = container.querySelector('.autocomplete-wrapper input');
    await act(async () => {
      fireEvent.change(input, { target: { value: 'anna' } });
    });
    const items = [...document.querySelectorAll('.autocomplete-item')].map(
      (el) => el.textContent,
    );
    // prefix (startsWith 'anna') first, then substring matches; 'Anders' excluded.
    expect(items).toEqual(['Anna Andersson', 'Johanna', 'Hanna']);
  });

  it('shows no suggestions for an empty query', async () => {
    h.people = ['Anna', 'Bertil'];
    const { container } = await mountReview();
    await loadImage([face()]);
    const input = container.querySelector('.autocomplete-wrapper input');
    await act(async () => {
      fireEvent.change(input, { target: { value: '' } });
    });
    expect(document.querySelectorAll('.autocomplete-item')).toHaveLength(0);
  });
});

describe('ReviewModule — face state transitions (characterization)', () => {
  it('confirming one of several faces auto-advances to the next', async () => {
    await mountReview();
    await loadImage([
      face({ match_alternatives: [{ name: 'Dan', confidence: 90 }] }),
      face(),
    ]);
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    // doConfirmFace → navigateToFace(1, 0) → active face becomes index 1.
    expect(lastEmit('active-face-changed')).toEqual({ index: 1, center: true });
  });

  it('confirming the LAST unreviewed face still syncs the active index (center:false)', async () => {
    // willAllBeDone: navigation is skipped (auto-save takes over), but
    // ImageViewer's active index must still follow the acted-on face so the
    // single-box highlight matches. center:false avoids jumping to a done face.
    await mountReview();
    await loadImage([
      face({ is_confirmed: true, person_name: 'Ada' }),
      face({ match_alternatives: [{ name: 'Bo', confidence: 90 }] }),
    ]);
    // Move to the one unreviewed face (index 1), then confirm it.
    await act(async () => {
      fireEvent.keyDown(document, { key: 'ArrowDown' });
    });
    h.emit.mockClear();
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    expect(lastEmit('active-face-changed')).toEqual({ index: 1, center: false });
    // faces-detected is emitted BEFORE active-face-changed on the confirm path.
    const order = h.emit.mock.calls.map(([e]) => e).filter(
      (e) => e === 'faces-detected' || e === 'active-face-changed',
    );
    expect(order.indexOf('faces-detected')).toBeLessThan(order.indexOf('active-face-changed'));
  });

  it('double-clicking a confirmed face unconfirms it (input reappears)', async () => {
    const { container } = await mountReview();
    await loadImage([face({ is_confirmed: true, person_name: 'Eve' })]);
    expect(container.querySelector('.autocomplete-wrapper input')).toBeNull();
    const card = container.querySelector('.face-card');
    await act(async () => {
      fireEvent.doubleClick(card);
    });
    expect(container.querySelector('.autocomplete-wrapper input')).toBeTruthy();
  });

  it('emits review-dirty=false after detect and review-dirty=true once a face is pending', async () => {
    await mountReview();
    await loadImage([
      face({ match_alternatives: [{ name: 'Fia', confidence: 90 }] }),
      face(),
    ]);
    // After a clean detection with a current image, dirty is false.
    expect(lastEmit('review-dirty')).toEqual({
      imagePath: '/photos/a.jpg',
      dirty: false,
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    expect(lastEmit('review-dirty')).toEqual({
      imagePath: '/photos/a.jpg',
      dirty: true,
    });
  });

  it('auto-saves and emits review-complete once every face is reviewed', async () => {
    vi.useFakeTimers();
    let utils;
    await act(async () => {
      utils = render(<ReviewModule node={visibleNode} />);
    });
    // Drive detect under fake timers.
    h.nextDetect = {
      faces: [face({ match_alternatives: [{ name: 'Gustav', confidence: 90 }] })],
      file_hash: 'hash',
      processing_time_ms: 3,
    };
    await act(async () => {
      await h.registry.get('image-loaded')({ imagePath: '/photos/a.jpg' });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Enter' });
    });
    h.emit.mockClear();
    // The all-done auto-save is debounced 500ms; advance past it.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(h.api.post).toHaveBeenCalledWith(
      '/api/v1/batch-confirm',
      expect.any(Object),
    );
    expect(h.emit).toHaveBeenCalledWith(
      'review-complete',
      expect.objectContaining({ imagePath: '/photos/a.jpg', success: true }),
    );
    utils.unmount();
  });
});
