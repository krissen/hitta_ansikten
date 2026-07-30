import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { gridThumbnailCache } from '../src/renderer/shared/grid-thumbnail-cache.js';
import { settle } from './helpers/settle.js';

// Characterization + fence tests for CullingModule.
//
// CullingModule (~1700 lines) owns the stats-driven culling workspace: the
// filter bar (roots/preset/player/glob) and its auto-apply query flow, the
// loupe↔grid view-mode switch (persisted), the cull/undo action loop, the
// document-level keyboard handlers (single-key nav/cull on window + a
// capture-phase Enter/Esc handler gated on the active tabset and the open
// context menu), and the live per-player stats panel. These tests pin the
// CURRENT observable behavior so the planned decomposition (H6) can extract
// pure logic without silently changing it. They EXTEND the existing pure-helper
// coverage (cullingGridNav / cullingNames / gridThumbnailCache) and the render
// smoke (cullingModuleSmoke / cullingGridRender), which are not duplicated here.
//
// Everything the component reaches for outside its own render — the backend API,
// the module event bus, the folder-watch IPC and the singleton grid thumbnail
// cache — is mocked with controllable stubs. The i18n strings the user sees are
// left REAL so assertions key off the actual Swedish text.
//
// Coverage notes (documented honestly):
//  - The grid-mode single-click "highlight player" path is debounced 200ms and
//    is only exercised indirectly (loupe-click filter is pinned); the debounce
//    timing itself is left to the pure-helper layer.
//  - Preview resolution (stat-file-stable / NEF conversion) is orthogonal to the
//    seams H6 targets and is not driven here.

const h = vi.hoisted(() => {
  const registry = new Map(); // eventName -> latest useModuleEvent handler
  const api = { get: vi.fn(), post: vi.fn() };
  return {
    registry,
    api,
    nextFiles: { files: [], players: [] },
    nextStats: {},
    trashResp: { trashed: [{ id: 't1' }] },
    restoreResp: { restored: ['t1'] },
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

import { CullingModule } from '../src/renderer/components/CullingModule.jsx';

// jsdom (as configured here) lacks these; the grid column-count effect installs
// a ResizeObserver, and the view-mode/column-width persistence reads/writes
// localStorage.
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

// --- node stubs modelling the FlexLayout tab the module lives in ---------
// null → treated as active+visible (simplest). The active flag drives every
// isTabsetActive gate the module installs: both the capture-phase Enter/Esc
// gate and (since I1) the main keydown handler.
function makeNode({ visible = true, active = true } = {}) {
  const model = { getActiveTabset: () => ({ getId: () => (active ? 'TS1' : 'OTHER') }) };
  return {
    isVisible: () => visible,
    getModel: () => model,
    getParent: () => ({ getId: () => 'TS1' }),
  };
}

const FILES = [
  { path: '/p/260601_120000_Alice.jpg', basename: '260601_120000_Alice.jpg', mtime_ms: 100, size: 10 },
  { path: '/p/260601_120100_Bob.jpg', basename: '260601_120100_Bob.jpg', mtime_ms: 200, size: 20 },
  { path: '/p/260601_120200_Carol.jpg', basename: '260601_120200_Carol.jpg', mtime_ms: 300, size: 30 },
];

const STATS = {
  baseline: 5,
  players: [
    { name: 'Alice', count: 6, pct: 50, delta_pct: 10, level: 'ok' },
    { name: 'Bob', count: 4, pct: 33, delta_pct: -5, level: 'low' },
  ],
  excluded: null,
};

let originalFetch;

beforeEach(() => {
  cleanup();
  h.registry.clear();
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.nextFiles = { files: FILES, players: ['Alice', 'Bob', 'Carol'] };
  h.nextStats = STATS;
  h.trashResp = { trashed: [{ id: 't1' }] };
  h.restoreResp = { restored: ['t1'] };
  h.api.post.mockImplementation((path) => {
    if (path.includes('/culling/files')) return Promise.resolve(h.nextFiles);
    if (path.includes('/players/count')) return Promise.resolve(h.nextStats);
    if (path.includes('/culling/trash')) return Promise.resolve(h.trashResp);
    if (path.includes('/culling/restore')) return Promise.resolve(h.restoreResp);
    if (path.includes('/culling/rename')) return Promise.resolve({ path: '/p/renamed.jpg' });
    return Promise.resolve({});
  });
  try { localStorage.clear(); } catch { /* ignore */ }
  // Never-resolving fetch so grid thumbnails don't fire async state updates
  // after assertions (would warn about updates outside act()).
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
  // Drain before the mocks go away. Work a test leaves behind can land outside
  // any act() scope — React schedules it on its own Scheduler macrotask — and
  // whether it lands before or after the test body ends is exactly what CPU
  // contention shifts. Landing after means it commits during teardown: after
  // vi.restoreAllMocks() here, and inside Testing Library's cleanup, which
  // Vitest's reverse hook order runs after this hook. The transport is gone by
  // then, and the effect throws where no test can see it. Draining here settles
  // that work while the mocks still function. Same hazard that took dev red
  // through fileQueueModule.test.jsx.
  //
  // settle() is one macrotask: it drains queued work, but deliberately does not
  // wait for a promise that is genuinely still pending. Every api mock in these
  // files resolves immediately, so that is enough today — a mock that resolves
  // on a timer would reopen this.
  await settle();
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function mountCulling(node = null) {
  let utils;
  await act(async () => {
    utils = render(<CullingModule node={node} />);
  });
  // No single rendered outcome to wait for — a bare mount adopts nothing and
  // renders an empty workspace — so drain the effect chain instead of counting
  // how many awaits it happens to have.
  await settle();
  return utils;
}

// Drive the file list the way the CLI hand-off does: fire the 'culling-load'
// module event the component subscribed to. Resolves the mocked list + stats.
async function loadFiles({ files = FILES, players = ['Alice', 'Bob', 'Carol'] } = {}) {
  h.nextFiles = { files, players };
  const handler = h.registry.get('culling-load');
  await act(async () => {
    await handler({ roots: ['/p'], clear: true, recursive: false });
  });
  // The rendered outcome is view-mode dependent — the file list only exists in
  // the loupe (`viewMode === 'single'`), and two tests here load in grid mode —
  // so there is no anchor common to every caller. Drain the chain instead.
  await settle();
}

// Last request body posted to a given endpoint path fragment.
function lastPost(fragment) {
  const calls = h.api.post.mock.calls.filter(([p]) => p.includes(fragment));
  return calls.length ? calls[calls.length - 1][1] : undefined;
}
function countPost(fragment) {
  return h.api.post.mock.calls.filter(([p]) => p.includes(fragment)).length;
}

describe('CullingModule — filter/query flow (characterization)', () => {
  it('a culling-load populates the list, selects the first file, and posts the files query', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const rows = container.querySelectorAll('.culling-files li');
    expect(rows).toHaveLength(3);
    expect(container.querySelector('.culling-files li.active')).toBe(rows[0]);
    expect(container.querySelector('.culling-list-header').textContent).toContain('3 bilder');
    expect(lastPost('/culling/files')).toMatchObject({ roots: ['/p'], extension_preset: 'jpg' });
  });

  it('changing the file-type preset re-runs the query with the new preset', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const before = countPost('/culling/files');
    const select = container.querySelector('.culling-filterbar select.form-select');
    fireEvent.change(select, { target: { value: 'nef' } });
    await waitFor(() => expect(countPost('/culling/files')).toBe(before + 1));
    expect(lastPost('/culling/files')).toMatchObject({ extension_preset: 'nef' });
  });

  it('picking a player auto-applies an exact player filter plus a *name* glob', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const selects = container.querySelectorAll('.culling-filterbar select.form-select');
    const playerSelect = selects[1]; // [0] = preset, [1] = player
    fireEvent.change(playerSelect, { target: { value: 'Bob' } });
    await waitFor(() => expect(lastPost('/culling/files'))
      .toMatchObject({ player: 'Bob', name_glob: '*Bob*' }));
  });

  it('typing a glob and pressing Enter runs it as a name_glob refinement', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const glob = container.querySelector('input.culling-glob');
    fireEvent.change(glob, { target: { value: '*Arvid*' } });
    fireEvent.keyDown(glob, { key: 'Enter' });
    await waitFor(() => expect(lastPost('/culling/files'))
      .toMatchObject({ name_glob: '*Arvid*', player: null }));
  });
});

describe('CullingModule — view mode switching (characterization)', () => {
  it('the Rutnät toggle switches loupe→grid and persists the choice', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    expect(container.querySelector('.culling-main')).toBeTruthy(); // loupe by default
    const toggle = [...container.querySelectorAll('.culling-filterbar button')]
      .find((b) => b.textContent === 'Rutnät');
    await act(async () => { fireEvent.click(toggle); });
    expect(container.querySelector('.culling-grid')).toBeTruthy();
    expect(container.querySelector('.culling-main')).toBeNull();
    expect(localStorage.getItem('ansikten.culling.viewMode')).toBe('grid');
  });

  it('restores the persisted grid mode on mount', async () => {
    localStorage.setItem('ansikten.culling.viewMode', 'grid');
    const { container } = await mountCulling();
    await loadFiles();
    expect(container.querySelector('.culling-grid')).toBeTruthy();
  });

  it('Esc in the loupe returns to the grid overview', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    expect(container.querySelector('.culling-grid')).toBeTruthy();
  });

  it('Enter in the grid opens the focused cell in the loupe', async () => {
    localStorage.setItem('ansikten.culling.viewMode', 'grid');
    const { container } = await mountCulling();
    await loadFiles();
    expect(container.querySelector('.culling-grid')).toBeTruthy();
    await act(async () => { fireEvent.keyDown(document, { key: 'Enter' }); });
    expect(container.querySelector('.culling-main')).toBeTruthy();
    expect(container.querySelector('.culling-grid')).toBeNull();
  });
});

describe('CullingModule — cull / undo sequencing (characterization)', () => {
  it('x trashes the current file exactly once with its path and drops it from the list', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    fireEvent.keyDown(document, { key: 'x' });
    await waitFor(() => expect(countPost('/culling/trash')).toBe(1));
    expect(lastPost('/culling/trash')).toEqual({ paths: [FILES[0].path] });
    await waitFor(() => expect(container.querySelectorAll('.culling-files li')).toHaveLength(2));
  });

  it('Delete trashes the current file (same path as x)', async () => {
    await mountCulling();
    await loadFiles();
    fireEvent.keyDown(document, { key: 'Delete' });
    await waitFor(() => expect(lastPost('/culling/trash')).toEqual({ paths: [FILES[0].path] }));
  });

  it('x is ignored when another tabset is active (visible but inactive — double-trash guard)', async () => {
    const { container } = await mountCulling(makeNode({ active: false }));
    await loadFiles();
    fireEvent.keyDown(document, { key: 'x' });
    // Full drain: both assertions are absences, and an absence cannot tell "the
    // active-tabset gate held" from "the trash chain never got to run".
    await settle();
    // No trash call, list unchanged — a visible-but-inactive Culling panel must
    // not cull; the key belongs to whichever module owns the active tabset.
    expect(countPost('/culling/trash')).toBe(0);
    expect(container.querySelectorAll('.culling-files li')).toHaveLength(3);
  });

  it('Cmd+Z restores the most recently trashed id', async () => {
    await mountCulling();
    await loadFiles();
    fireEvent.keyDown(document, { key: 'x' });
    // The undo needs the trash id, so wait for the trash to land before undoing.
    await waitFor(() => expect(countPost('/culling/trash')).toBe(1));
    fireEvent.keyDown(document, { key: 'z', metaKey: true });
    await waitFor(() => expect(lastPost('/culling/restore')).toEqual({ ids: ['t1'] }));
    // The restore *response* re-renders the list (and re-runs the preview effect
    // for the restored file). Drain it inside the test: a render left pending at
    // teardown commits after the mocks are restored and throws there instead.
    await settle();
  });
});

describe('CullingModule — context-menu Enter/Esc gate (#106)', () => {
  // Open the right-click menu on the first file row.
  async function openMenu(container) {
    const row = container.querySelector('.culling-files li');
    await act(async () => {
      fireEvent.contextMenu(row, { clientX: 10, clientY: 10 });
    });
    expect(container.querySelector('.culling-context-menu')).toBeTruthy();
  }

  it('Enter is a no-op while the menu is open and does not leak to later handlers', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    await openMenu(container);
    // A stand-in for "another module's" capture-phase document handler,
    // registered AFTER the module's own — stopImmediatePropagation must block it.
    const other = vi.fn();
    document.addEventListener('keydown', other, true);
    await act(async () => { fireEvent.keyDown(document, { key: 'Enter' }); });
    document.removeEventListener('keydown', other, true);
    // No rename started (Enter would beginEdit if it were not gated by the menu).
    expect(container.querySelector('.culling-rename-input')).toBeNull();
    // Did not leak to the later document handler.
    expect(other).not.toHaveBeenCalled();
  });

  it('Esc closes the menu and does not leak to later handlers', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    await openMenu(container);
    const other = vi.fn();
    document.addEventListener('keydown', other, true);
    await act(async () => { fireEvent.keyDown(document, { key: 'Escape' }); });
    document.removeEventListener('keydown', other, true);
    expect(container.querySelector('.culling-context-menu')).toBeNull();
    expect(other).not.toHaveBeenCalled();
    // The loupe stays put — Esc was consumed by the menu, not treated as
    // "return to grid".
    expect(container.querySelector('.culling-main')).toBeTruthy();
  });
});

describe('CullingModule — Enter/Esc active-tabset gate (characterization)', () => {
  it('Enter begins an inline rename when culling is the active tabset', async () => {
    const { container } = await mountCulling(makeNode({ active: true }));
    await loadFiles();
    await act(async () => { fireEvent.keyDown(document, { key: 'Enter' }); });
    expect(container.querySelector('.culling-rename-input')).toBeTruthy();
  });

  it('Enter is ignored when another tabset is active', async () => {
    const { container } = await mountCulling(makeNode({ active: false }));
    await loadFiles();
    await act(async () => { fireEvent.keyDown(document, { key: 'Enter' }); });
    expect(container.querySelector('.culling-rename-input')).toBeNull();
  });
});

describe('CullingModule — gridThumbnailCache.clear() wiring (#114)', () => {
  it('clears the grid thumbnail cache on unmount (teardown cleanup)', async () => {
    const clearSpy = vi.spyOn(gridThumbnailCache, 'clear');
    const utils = await mountCulling();
    await loadFiles();
    clearSpy.mockClear();
    await act(async () => { utils.unmount(); });
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });

  it('clears the grid thumbnail cache on a bare --clear (empties the working set)', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const clearSpy = vi.spyOn(gridThumbnailCache, 'clear');
    const handler = h.registry.get('culling-load');
    await act(async () => {
      await handler({ roots: [], clear: true });
    });
    // Positive anchor (the cache was freed) before the emptiness assertion.
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());
    // Working set emptied — the "välj mapp" hint returns.
    expect(container.querySelector('.culling-files li')).toBeNull();
  });
});

describe('CullingModule — stats spinner vs bare --clear', () => {
  it('resets the stats spinner when a bare --clear discards an in-flight /players/count', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    // Start a stats refetch that never resolves — the header spinner turns on.
    h.api.post.mockImplementation((path) => {
      if (path.includes('/players/count')) return new Promise(() => {});
      if (path.includes('/culling/files')) return Promise.resolve(h.nextFiles);
      return Promise.resolve({});
    });
    const handler = h.registry.get('culling-load');
    await act(async () => {
      await handler({ roots: ['/p'], clear: true, recursive: false });
    });
    await waitFor(() => expect(
      container.querySelector('.culling-stats-loading .loading-spinner')
    ).toBeTruthy());
    // Bare --clear while that request is in flight: the seq bump discards the
    // response, so its finally can never clear the flag — the clear path must
    // reset it itself or the spinner sticks forever in the emptied workspace.
    await act(async () => {
      await handler({ roots: [], clear: true });
    });
    // The assertion is an absence (the spinner was reset), so drain rather than
    // wait for an anchor: "reset" and "never ran" look identical otherwise.
    await settle();
    expect(container.querySelector('.culling-stats-loading .loading-spinner')).toBeNull();
  });
});

describe('CullingModule — stats panel interaction (characterization)', () => {
  it('renders a row per counted player from the stats response', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const rows = container.querySelectorAll('.culling-stat-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('.culling-stat-name').textContent).toBe('Alice');
  });

  it('clicking a stats row in the loupe filters the list to that player', async () => {
    const { container } = await mountCulling();
    await loadFiles();
    const aliceRow = [...container.querySelectorAll('.culling-stat-row')]
      .find((r) => r.textContent.includes('Alice'));
    fireEvent.click(aliceRow);
    await waitFor(() => expect(lastPost('/culling/files'))
      .toMatchObject({ player: 'Alice', name_glob: '*Alice*' }));
  });
});
