import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { gridThumbnailCache } from '../src/renderer/shared/grid-thumbnail-cache.js';
import { settle } from './helpers/settle.js';

// PR "tömbart urval" — Gallra spelare (culling):
//  - a "Rensa" button empties the workspace (same semantics as CLI --clear),
//  - the folder chips re-scan on removal (last chip → clearWorkspace),
// both driven by the shared clearWorkspace() the CLI --clear path now also uses.

// REFRESH_DEBOUNCE_MS in CullingModule (not exported); waits use a margin.
const REFRESH_MS = 400;

const h = vi.hoisted(() => {
  const registry = new Map();
  const api = { get: vi.fn(), post: vi.fn() };
  return { registry, api, nextFiles: { files: [], players: [] }, nextStats: {} };
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
import { getScanScope, setScanScope } from '../src/renderer/shared/scanScope.js';

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
const STATS = {
  baseline: 5,
  players: [{ name: 'Alice', count: 6, pct: 50, delta_pct: 10, level: 'ok' }],
  excluded: null,
};

let originalFetch;

beforeEach(() => {
  cleanup();
  h.registry.clear();
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.nextFiles = { files: FILES, players: ['Alice', 'Bob'] };
  h.nextStats = STATS;
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
  setScanScope(null);
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
  // What a mount settles into differs per test (some adopt a scope and scan,
  // one deliberately hangs mid-scan), so there is no single rendered outcome to
  // wait for here — settle the effect chain instead of counting its awaits.
  await settle();
  return utils;
}

async function loadFiles(roots = ['/p']) {
  const handler = h.registry.get('culling-load');
  await act(async () => {
    await handler({ roots, clear: true, recursive: false });
  });
  await settle();
  // The load's own outcome, asserted rather than assumed: every test below
  // starts from a list that is actually on screen.
  expect(document.querySelectorAll('.culling-files li')).toHaveLength(FILES.length);
}

function lastPost(fragment) {
  const calls = h.api.post.mock.calls.filter(([p]) => p.includes(fragment));
  return calls.length ? calls[calls.length - 1][1] : undefined;
}
function findButton(container, text) {
  return [...container.querySelectorAll('.culling-filterbar button')].find(
    (b) => b.textContent === text
  );
}

describe('CullingModule — Rensa button', () => {
  it('empties the file list, stats, shared scope and thumbnail cache', async () => {
    const { container } = await mountCulling();
    await loadFiles(['/p']);
    expect(container.querySelectorAll('.culling-files li')).toHaveLength(2);
    // A scope was published by the load.
    expect(getScanScope()).not.toBeNull();

    const clearSpy = vi.spyOn(gridThumbnailCache, 'clear');
    const rensa = findButton(container, 'Rensa');
    expect(rensa).toBeTruthy();
    fireEvent.click(rensa);

    // Wait on the positive half of the outcome (the cache was freed) so the
    // emptiness assertions below mean "cleared" and not "not started yet".
    await waitFor(() => expect(clearSpy).toHaveBeenCalled());

    // List + stats emptied, "välj mapp"-hint back, scope cleared.
    expect(container.querySelector('.culling-files li')).toBeNull();
    expect(container.querySelector('.culling-stat-row')).toBeNull();
    expect(getScanScope()).toBeNull();
  });

  it('is disabled when there is nothing to clear', async () => {
    const { container } = await mountCulling();
    // Fresh mount, no scope adopted, no roots → nothing to clear.
    const rensa = findButton(container, 'Rensa');
    expect(rensa.disabled).toBe(true);
  });
});

describe('CullingModule — root chip removal', () => {
  it('re-scans with the remaining root when one of several chips is removed', async () => {
    const { container } = await mountCulling();
    await loadFiles(['/a', '/b']);
    const before = h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length;

    const removes = container.querySelectorAll('.culling-chip-x');
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0].closest('button')); // remove '/a'

    // Settle on the re-scan itself rather than on a counted flush.
    await waitFor(() => expect(
      h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length
    ).toBe(before + 1));
    expect(lastPost('/culling/files')).toMatchObject({ roots: ['/b'] });
  });

  it('removing the last chip clears the workspace', async () => {
    const { container } = await mountCulling();
    await loadFiles(['/only']);
    expect(container.querySelectorAll('.culling-files li')).toHaveLength(2);

    const removes = container.querySelectorAll('.culling-chip-x');
    expect(removes).toHaveLength(1);
    fireEvent.click(removes[0].closest('button'));
    // Everything asserted below is an absence, so the wait cannot settle on a
    // rendered anchor — drain the whole effect chain instead.
    await settle();

    expect(container.querySelector('.culling-files li')).toBeNull();
    expect(container.querySelector('.culling-chip')).toBeNull();
    expect(getScanScope()).toBeNull();
  });
});

describe('CullingModule — clear cancels pending refreshes (Codex round 2)', () => {
  // Driven off a fake clock: the debounce window is advanced exactly rather than
  // slept through on the real clock, so the test neither depends on wall-clock
  // margins nor spends REFRESH_DEBOUNCE_MS doing nothing.
  it('clearing while a folder-watch refresh is scheduled does not POST a null query', async () => {
    vi.useFakeTimers();
    try {
      let folderCb = null;
      globalThis.window.ansiktenAPI = {
        watchFolder: vi.fn(),
        unwatchFolder: vi.fn(),
        onFolderChanged: (cb) => { folderCb = cb; return () => {}; },
        invoke: vi.fn().mockResolvedValue([]),
      };
      const { container } = await mountCulling();
      await loadFiles(['/p']);

      // Schedule a debounced folder-change refresh (its callback reads
      // lastQueryRef.current at fire time — null after a clear → loadList(null)).
      expect(typeof folderCb).toBe('function');
      folderCb();

      // Clear the workspace (Rensa) while that timer is pending.
      const rensa = findButton(container, 'Rensa');
      const filesBefore = h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length;
      // Full macrotask flush rather than a counted microtask: every assertion
      // below is negative, and a negative assertion cannot tell "the clear
      // cancelled the refresh" from "the continuation never ran". Free here
      // because the clock is already fake.
      await act(async () => {
        fireEvent.click(rensa);
        await vi.advanceTimersByTimeAsync(0);
      });

      // Advance past the debounce window: the cancelled refresh must never fire.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(REFRESH_MS * 2);
      });

      const filesAfter = h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length;
      expect(filesAfter).toBe(filesBefore);
      // Specifically: no /culling/files POST with a null/undefined body.
      const nullBody = h.api.post.mock.calls.filter(
        ([p, body]) => p.includes('/culling/files') && body == null
      );
      expect(nullBody).toHaveLength(0);
      // Workspace stays cleared.
      expect(container.querySelector('.culling-files li')).toBeNull();
      expect(getScanScope()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CullingModule — clear/chip state consistency (Codex round 3)', () => {
  // Fynd 5: clearWorkspace must empty the player dropdown too — a stale name
  // would let selectPlayer set a *name* glob (canFilter true) and Visa would
  // then POST /culling/files with no roots/globs (empty-scope 400).
  it('empties the player dropdown on Rensa (no stale names to pick)', async () => {
    const { container } = await mountCulling();
    await loadFiles(['/p']); // players: ['Alice', 'Bob']
    const selectBefore = container.querySelectorAll('.culling-filterbar select.form-select')[1];
    expect([...selectBefore.options].map((o) => o.value)).toContain('Alice');

    const rensa = findButton(container, 'Rensa');
    fireEvent.click(rensa);

    // Only the "Alla spelare" placeholder (value '') remains — settled on the
    // rendered option list, which is the outcome the user would see.
    await waitFor(() => {
      const selectAfter = container.querySelectorAll('.culling-filterbar select.form-select')[1];
      expect([...selectAfter.options].map((o) => o.value)).toEqual(['']);
    });
  });

  // Fynd 6: removing the last root chip while a carried path-glob (adopted from a
  // Räkna spelare count that mixed folders + a wildcard) is still present must
  // re-scan the glob-only scope, not clear the workspace.
  it('keeps a glob-only carried scope when the last root chip is removed', async () => {
    const { container } = await mountCulling();
    // cull-player hand-off carries both a root and a path-glob.
    const cullPlayer = h.registry.get('cull-player');
    await act(async () => {
      await cullPlayer({ roots: ['/a'], globs: ['*.jpg'], recursive: true, name: '' });
    });
    await waitFor(() => expect(container.querySelectorAll('.culling-chip-x')).toHaveLength(1));
    expect(getScanScope()).not.toBeNull();
    const before = h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length;

    // Remove the only root chip.
    const remove = container.querySelector('.culling-chip-x');
    fireEvent.click(remove.closest('button'));

    // Re-scanned as a glob-only scope (roots empty, glob kept) — NOT cleared.
    await waitFor(() => expect(
      h.api.post.mock.calls.filter(([p]) => p.includes('/culling/files')).length
    ).toBe(before + 1));
    expect(lastPost('/culling/files')).toMatchObject({ roots: [], globs: ['*.jpg'] });
    expect(getScanScope()).not.toBeNull();
    expect(container.querySelectorAll('.culling-files li').length).toBeGreaterThan(0);
  });
});

describe('CullingModule — clear enabled during in-flight adopt (Codex round 4)', () => {
  // Fynd 7: adopting a glob-only scope (globs, no roots) starts an active scan
  // while roots/files are empty and hasRun is still false. canClear must not be
  // disabled during that expensive scan — the user has to be able to clear it.
  it('keeps Rensa enabled while a glob-only adopt scan is in flight, and clearing fences it', async () => {
    // /culling/files hangs so the adopt scan stays in flight.
    let resolveFiles;
    h.api.post.mockImplementation((path) => {
      if (path.includes('/culling/files')) return new Promise((res) => { resolveFiles = res; });
      if (path.includes('/players/count')) return Promise.resolve(h.nextStats);
      return Promise.resolve({});
    });
    // A glob-only shared scope to adopt on mount (no roots).
    setScanScope({
      roots: [],
      globs: ['*.jpg'],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });

    const { container } = await mountCulling();

    // Mid-scan: no roots, no files, hasRun false — but a glob scope + an active
    // scan mean there IS something to clear. Rensa must be enabled.
    expect(container.querySelectorAll('.culling-files li')).toHaveLength(0);
    const rensa = findButton(container, 'Rensa');
    expect(rensa.disabled).toBe(false);

    // Clearing fences the in-flight scan (per the earlier sweep). Both waits are
    // full drains: the assertions are absences, and an absence cannot tell "the
    // fence held" from "the continuation never ran".
    fireEvent.click(rensa);
    await settle();
    // The hung scan resolves AFTER the clear: it must not repopulate.
    resolveFiles(h.nextFiles);
    await settle();

    expect(container.querySelector('.culling-files li')).toBeNull();
    expect(getScanScope()).toBeNull();
  });
});
