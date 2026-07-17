import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';

// Scope-clearing tests for CullingModule's live stats panel.
//
// The file list (/culling/files) and the per-player counts (/players/count) are
// two independent requests: the list resolves fast, the count scan is slow. When
// the SCAN scope changes (a new selection, folder, date span…) the panel must
// blank immediately so the previous selection's players can't sit next to the
// freshly-repainted file list until the slow count lands. A change that does NOT
// alter the scan scope — a player-filter click, a baseline/min-images tweak, a
// cull/rename refresh — must instead keep the numbers up (header spinner only).
//
// The harness mirrors cullingModuleFence.test.jsx: everything the component
// reaches outside its render is mocked, i18n strings stay REAL so assertions key
// off the actual Swedish text (.culling-stats-empty renders "Inga …").

const h = vi.hoisted(() => {
  const registry = new Map(); // eventName -> latest useModuleEvent handler
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

const FILES_A = [
  { path: '/a/260601_120000_Alice.jpg', basename: '260601_120000_Alice.jpg', mtime_ms: 100, size: 10 },
  { path: '/a/260601_120100_Bob.jpg', basename: '260601_120100_Bob.jpg', mtime_ms: 200, size: 20 },
];
const FILES_B = [
  { path: '/b/260701_090000_Carol.jpg', basename: '260701_090000_Carol.jpg', mtime_ms: 300, size: 30 },
];

const STATS_A = {
  baseline: 5,
  players: [
    { name: 'Alice', count: 6, pct: 60, delta_pct: 10, level: 'ok' },
    { name: 'Bob', count: 4, pct: 40, delta_pct: -5, level: 'low' },
  ],
  excluded: null,
};
const STATS_B = {
  baseline: 3,
  players: [{ name: 'Carol', count: 3, pct: 100, delta_pct: 0, level: 'ok' }],
  excluded: null,
};

// A controllable /players/count: when armed, the next count request never
// resolves on its own — the test resolves it explicitly via `resolveStats`.
let hangStats = false;
let pendingStatsResolve = null;
function resolveStats(value) {
  const r = pendingStatsResolve;
  pendingStatsResolve = null;
  r?.(value);
}

let originalFetch;

beforeEach(() => {
  cleanup();
  h.registry.clear();
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.nextFiles = { files: FILES_A, players: ['Alice', 'Bob'] };
  h.nextStats = STATS_A;
  hangStats = false;
  pendingStatsResolve = null;
  h.api.post.mockImplementation((path) => {
    if (path.includes('/culling/files')) return Promise.resolve(h.nextFiles);
    if (path.includes('/players/count')) {
      if (hangStats) return new Promise((resolve) => { pendingStatsResolve = resolve; });
      return Promise.resolve(h.nextStats);
    }
    if (path.includes('/culling/rename')) return Promise.resolve({ path: '/renamed.jpg' });
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

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

async function mountCulling(node = null) {
  let utils;
  await act(async () => {
    utils = render(<CullingModule node={node} />);
    await Promise.resolve();
  });
  return utils;
}

// Load a scope through the CLI hand-off event so files + stats resolve for it.
async function loadFilesA() {
  h.nextFiles = { files: FILES_A, players: ['Alice', 'Bob'] };
  h.nextStats = STATS_A;
  const handler = h.registry.get('culling-load');
  await act(async () => {
    await handler({ roots: ['/a'], clear: true, recursive: false });
    await Promise.resolve();
    await Promise.resolve();
  });
}

function statRows(container) {
  return container.querySelectorAll('.culling-stat-row');
}
function countPost(fragment) {
  return h.api.post.mock.calls.filter(([p]) => p.includes(fragment)).length;
}

describe('CullingModule — stats panel clears on scan-scope change', () => {
  it('blanks the panel the moment a new scan scope loads, then fills it when the count lands', async () => {
    const { container } = await mountCulling();
    await loadFilesA();
    // Scope A is fully loaded: Alice/Bob rows are shown next to A's file list.
    expect(statRows(container)).toHaveLength(2);
    expect(container.querySelector('.culling-stats-empty')).toBeNull();

    // Switch to scope B (a Räkna-spelare hand-off to a different folder) while the
    // /players/count for B is held pending: the list repaints to B fast, but B's
    // counts have not arrived yet.
    hangStats = true;
    h.nextFiles = { files: FILES_B, players: ['Carol'] };
    const cullPlayer = h.registry.get('cull-player');
    await act(async () => {
      await cullPlayer({ roots: ['/b'], name: 'Carol' });
      await Promise.resolve();
    });

    // The file list has repainted to B, and the stale scope-A players are GONE —
    // the panel is empty rather than showing Alice/Bob beside B's files.
    expect(container.querySelectorAll('.culling-files li')).toHaveLength(1);
    expect(statRows(container)).toHaveLength(0);
    expect(container.querySelector('.culling-stats-empty')).toBeTruthy();

    // B's count arrives → B's rows fill in.
    await act(async () => {
      resolveStats(STATS_B);
      await Promise.resolve();
    });
    const rows = statRows(container);
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.culling-stat-name').textContent).toBe('Carol');
  });

  it('does NOT blank the panel on a player-only filter (same scan scope)', async () => {
    const { container } = await mountCulling();
    await loadFilesA();
    expect(statRows(container)).toHaveLength(2);

    // Click a stats row (loupe): filters the list to that player. The scan scope
    // is unchanged (same roots), so the refetch must keep the numbers visible.
    hangStats = true;
    const aliceRow = [...statRows(container)].find((r) => r.textContent.includes('Alice'));
    await act(async () => {
      fireEvent.click(aliceRow);
      await Promise.resolve();
    });

    // A refetch was issued, but the panel still shows the players (spinner only) —
    // no blank.
    expect(statRows(container)).toHaveLength(2);
    expect(container.querySelector('.culling-stats-empty')).toBeNull();
    // Resolve the pending refetch so no state update escapes act().
    await act(async () => { resolveStats(STATS_A); await Promise.resolve(); });
  });

  it('does NOT blank the panel on a baseline change (same scan scope)', async () => {
    const { container } = await mountCulling();
    await loadFilesA();
    expect(statRows(container)).toHaveLength(2);

    // Change the baseline select to a value different from its current one: this
    // refetches the count (baseline is folded into the scope) but the scanning
    // fields are unchanged, so the panel must not blank.
    hangStats = true;
    const before = countPost('/players/count');
    const select = container.querySelector('select.culling-stats-baseline-select');
    const other = select.value === 'mean' ? 'median' : 'mean';
    await act(async () => {
      fireEvent.change(select, { target: { value: other } });
      await Promise.resolve();
    });

    expect(countPost('/players/count')).toBe(before + 1); // a refetch did fire
    expect(statRows(container)).toHaveLength(2);          // …but nothing blanked
    expect(container.querySelector('.culling-stats-empty')).toBeNull();
    await act(async () => { resolveStats(STATS_A); await Promise.resolve(); });
  });
});
