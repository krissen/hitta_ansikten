import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent, waitFor } from '@testing-library/react';
import { settle } from './helpers/settle.js';

// REFRESH_DEBOUNCE_MS in PlayerCountModule (not exported); waits use a margin.
const REFRESH_MS = 400;

// Chip removal in Räkna spelare must publish the (possibly empty) scan scope and
// recount — or clear. Before the fix, InputBar's removeRoot only patched local
// state without firing onAutoApply, so deselecting a folder never recounted and
// an empty selection could never be published (Gallra kept adopting the last
// non-empty scope).

const { postMock, getMock, api } = vi.hoisted(() => {
  const postMock = vi.fn().mockResolvedValue({
    total_images: 0,
    files_resolved: 0,
    players: [],
    excluded: null,
    baseline: 0,
    baseline_method: 'median',
    time_range: null,
  });
  const getMock = vi.fn().mockResolvedValue({});
  // Stable api object: PlayerCountModule's folder-watch effect depends on
  // runCount, which depends on `api`. A fresh object per render would re-run
  // that effect and clear any pending debounce — masking the very timers these
  // tests exercise. The real backend api is a singleton, so mirror that here.
  return { postMock, getMock, api: { post: postMock, get: getMock } };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api }),
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: () => {},
  useModuleAPI: () => ({
    emit: vi.fn(),
    on: () => () => {},
    waitForListeners: vi.fn().mockResolvedValue(true),
    hasListeners: () => false,
  }),
}));

import { PlayerCountModule } from '../src/renderer/components/PlayerCountModule.jsx';
import { getScanScope, setScanScope } from '../src/renderer/shared/scanScope.js';
import { clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

const countCalls = () =>
  postMock.mock.calls.filter(([url]) => url === '/api/v1/players/count');

// Wait until a count has both fired AND had its response rendered.
//
// waitFor(countCalls().length === 1) only proves the POST was *issued* — the
// response is still an unresolved promise at that point, and the module is
// mid-count (isLoading true, hasRun false). Interacting with the chips in that
// window races the response: on an idle machine the resolution lands between
// the poll and the click, under load it does not, and the click then hits a
// component in a different state than the test assumes. Settling on the
// rendered outcome instead removes the window entirely.
//
// The summary row is the positive signal: it renders on exactly
// `!isLoading && !error && hasRun && result`, so waiting for it to appear means
// the count landed *and* succeeded. Waiting instead for the loading and
// never-run indicators to be absent would be satisfied by a failed count too
// (both are gated on !error), and would then return immediately having waited
// for nothing.
const settleCount = (container) =>
  waitFor(() => {
    expect(container.querySelector('.player-count-summary')).not.toBeNull();
  });

describe('PlayerCountModule — chip removal publishes/clears scan scope', () => {
  beforeEach(() => {
    postMock.mockClear();
    getMock.mockClear();
    // A run count now anchors the working folder; clear it so the anchor-prefill
    // fallback in adopt-on-mount can't leak a selection into the "nothing adopted" case.
    clearWorkingFolder();
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
    // Seed a two-folder scope so the adopt-on-mount effect runs an initial count
    // (and renders two removable chips).
    setScanScope({
      roots: ['/photos/a', '/photos/b'],
      globs: [],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });
  });

  it('removing one chip recounts with the remaining root and reduces the shared scope', async () => {
    const { container } = render(<PlayerCountModule />);
    await waitFor(() => expect(countCalls().length).toBe(1));
    await settleCount(container); // …and let the adopt count's response render
    postMock.mockClear();

    const removes = container.querySelectorAll('.input-bar-chip-remove');
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]); // remove '/photos/a'

    await waitFor(() => expect(countCalls().length).toBe(1));
    expect(countCalls()[0][1]).toEqual(expect.objectContaining({ roots: ['/photos/b'] }));
    expect(getScanScope()).toEqual(expect.objectContaining({ roots: ['/photos/b'] }));
  });

  it('removing the last chip clears without a count and empties the shared scope', async () => {
    const { container } = render(<PlayerCountModule />);
    await waitFor(() => expect(countCalls().length).toBe(1));
    await settleCount(container); // …and let the adopt count's response render

    // Remove both chips one at a time.
    let removes = container.querySelectorAll('.input-bar-chip-remove');
    fireEvent.click(removes[0]);
    await waitFor(() => {
      expect(container.querySelectorAll('.input-bar-chip-remove')).toHaveLength(1);
    });
    await settleCount(container); // the recount that removal triggered must land too
    postMock.mockClear();

    removes = container.querySelectorAll('.input-bar-chip-remove');
    fireEvent.click(removes[0]); // remove the last one → empty selection

    await waitFor(() => {
      // No chips left, and the empty-state prompt is back.
      expect(container.querySelectorAll('.input-bar-chip-remove')).toHaveLength(0);
    });
    // No POST fired for the empty selection.
    expect(countCalls().length).toBe(0);
    // Shared scope cleared and folder watches released.
    expect(getScanScope()).toBeNull();
    expect(window.ansiktenAPI.unwatchFolder).toHaveBeenCalled();
    // Empty-state prompt (the "Räkna" call-to-action) is shown again.
    expect(screen.getByText('Räkna', { selector: 'strong' })).toBeTruthy();
  });
});

describe('PlayerCountModule — clearing guards (Codex P2 fixes)', () => {
  beforeEach(() => {
    postMock.mockClear();
    postMock.mockResolvedValue({
      total_images: 0,
      files_resolved: 0,
      players: [],
      excluded: null,
      baseline: 0,
      baseline_method: 'median',
      time_range: null,
    });
    getMock.mockClear();
    // A run count now anchors the working folder; clear it so the anchor-prefill
    // fallback in adopt-on-mount can't leak a selection into the blank-tab case.
    clearWorkingFolder();
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
  });

  // Fynd 1: a blank tab that never ran a count must NOT clear the shared scope on
  // an empty auto-apply — that would clobber a selection Gallra published after
  // this tab mounted.
  it('a blank-tab auto-apply does not clobber a scope published after mount', async () => {
    setScanScope(null); // no scope to adopt → this tab never counts
    const { container } = render(<PlayerCountModule />);
    await waitFor(() => expect(getMock).toHaveBeenCalled()); // mount settled
    // Nothing adopted, no chips, no count.
    expect(container.querySelectorAll('.input-bar-chip-remove')).toHaveLength(0);
    expect(countCalls().length).toBe(0);

    // Gallra publishes a scope AFTER this tab mounted.
    setScanScope({
      roots: ['/gallra'],
      globs: [],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });

    // Toggle the file-type control on the still-blank tab → an empty auto-apply.
    const preset = screen.getByTitle('Filtyper (skiftlägesokänsligt)');
    fireEvent.change(preset, { target: { value: 'nef' } });
    // Both assertions below are negative — the scope was not clobbered, no count
    // fired — so drain the whole auto-apply chain rather than one microtask: a
    // counted flush would let "the blank-tab guard held" and "the chain stopped
    // one await short" look the same.
    await settle();

    // The scope Gallra published survives untouched; still no count fired.
    expect(getScanScope()).toEqual(expect.objectContaining({ roots: ['/gallra'] }));
    expect(countCalls().length).toBe(0);
  });

  // Fynd 2: removing the only chip while a folder-watch refresh is in flight must
  // fence that request (seq bump) so its late response can't repopulate the
  // just-cleared result.
  //
  // Driven off a fake clock. Sleeping REFRESH_DEBOUNCE_MS + margin on the real
  // clock and asserting immediately after assumes the debounce callback AND the
  // re-render it triggers both complete within that margin — on a loaded machine
  // they do not, and the assertions then read a DOM that has not caught up yet.
  it('removing the only chip fences an in-flight folder-watch refresh', async () => {
    vi.useFakeTimers();
    try {
      setScanScope({
        roots: ['/solo'],
        globs: [],
        recursive: true,
        date_from: null,
        date_to: null,
        extension_preset: 'jpg',
      });
      let folderCb = null;
      globalThis.window.ansiktenAPI = {
        watchFolder: vi.fn(),
        unwatchFolder: vi.fn(),
        onFolderChanged: (cb) => { folderCb = cb; return () => {}; },
        invoke: vi.fn().mockResolvedValue([]),
      };
      const populated = {
        total_images: 3,
        files_resolved: 3,
        players: [{ name: 'A', count: 3, pct: 100, delta_pct: 0, delta_n: 0, level: 'ok', timestamps: [] }],
        excluded: null,
        baseline: 3,
        baseline_method: 'median',
        time_range: null,
      };
      postMock.mockResolvedValue(populated);

      let container;
      await act(async () => {
        ({ container } = render(<PlayerCountModule />));
      });
      expect(countCalls().length).toBe(1); // adopt count

      // The next count (the folder-watch refresh) hangs → stays in flight.
      let resolveRefresh;
      postMock.mockImplementationOnce(() => new Promise((res) => { resolveRefresh = res; }));
      folderCb(); // schedule the debounced refresh
      await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS); });
      expect(countCalls().length).toBe(2); // refresh is in flight
      // The silent refresh turned the "refreshing" indicator on.
      expect(container.querySelector('.player-count-refreshing')).not.toBeNull();

      // Remove the only chip → empty clear branch must fence the in-flight refresh.
      //
      // advanceTimersByTimeAsync(0) rather than a bare act(): it flushes a whole
      // macrotask, not just the microtask queue. Everything asserted from here
      // on is negative, and a negative assertion cannot tell "the fence held"
      // from "the continuation never ran" — so the flush must not silently
      // depend on how many awaits runCount happens to have before its seq check.
      // Free under the fake clock.
      const remove = container.querySelector('.input-bar-chip-remove');
      await act(async () => { fireEvent.click(remove); await vi.advanceTimersByTimeAsync(0); });
      expect(container.querySelector('.input-bar-chip-remove')).toBeNull();

      // Fynd 4: the clear releases the refresh spinner even though the fenced
      // request's finally never runs (it can't repopulate, but it also can't clean
      // up its own flag).
      expect(container.querySelector('.player-count-refreshing')).toBeNull();

      // The stale refresh resolves AFTER the clear: it must NOT repopulate.
      await act(async () => { resolveRefresh(populated); await vi.advanceTimersByTimeAsync(0); });

      expect(getScanScope()).toBeNull();
      // Empty-state prompt is (still) shown — the late response did not repopulate.
      expect(screen.getByText('Räkna', { selector: 'strong' })).toBeTruthy();
      // And the spinner stayed off after the late resolve.
      expect(container.querySelector('.player-count-refreshing')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Fynd 2 (scheduled variant): removing the only chip while a refresh is merely
  // debounce-scheduled must cancel the timer so it can't POST null params.
  it('removing the only chip cancels a scheduled folder-watch refresh', async () => {
    vi.useFakeTimers();
    try {
      setScanScope({
        roots: ['/solo'],
        globs: [],
        recursive: true,
        date_from: null,
        date_to: null,
        extension_preset: 'jpg',
      });
      let folderCb = null;
      globalThis.window.ansiktenAPI = {
        watchFolder: vi.fn(),
        unwatchFolder: vi.fn(),
        onFolderChanged: (cb) => { folderCb = cb; return () => {}; },
        invoke: vi.fn().mockResolvedValue([]),
      };

      let container;
      await act(async () => {
        ({ container } = render(<PlayerCountModule />));
      });
      expect(countCalls().length).toBe(1); // adopt count

      folderCb(); // schedule (but do not yet fire) a debounced refresh
      postMock.mockClear();

      // Remove the only chip → empty clear branch must clearTimeout the refresh.
      // Full macrotask flush, for the same reason as the sister test above.
      const remove = container.querySelector('.input-bar-chip-remove');
      await act(async () => { fireEvent.click(remove); await vi.advanceTimersByTimeAsync(0); });
      expect(container.querySelector('.input-bar-chip-remove')).toBeNull();

      // Advance past the debounce window: the cancelled refresh must never POST.
      await act(async () => { await vi.advanceTimersByTimeAsync(REFRESH_MS * 2); });
      expect(countCalls().length).toBe(0);
      expect(getScanScope()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
