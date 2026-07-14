import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Regression guard for the applyOptions/self-notify ordering: committing a
// counting option (matchgap / min images / baseline) must fire EXACTLY ONE
// POST /players/count. setCountSettings notifies subscribers synchronously, so
// if applyOptions publishes before adopting the sanitized value into
// optionsRef, the module's own countSettings subscription sees a stale ref,
// treats the self-originated change as external, and fires a second recount.

const { postMock, getMock } = vi.hoisted(() => ({
  postMock: vi.fn().mockResolvedValue({
    total_images: 0,
    files_resolved: 0,
    players: [],
    excluded: null,
    baseline: 0,
    baseline_method: 'median',
    time_range: null,
  }),
  getMock: vi.fn().mockResolvedValue({}),
}));

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { post: postMock, get: getMock } }),
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
import { setScanScope } from '../src/renderer/shared/scanScope.js';

const countCalls = () =>
  postMock.mock.calls.filter(([url]) => url === '/api/v1/players/count');

describe('PlayerCountModule — one recount per committed option change', () => {
  beforeEach(() => {
    postMock.mockClear();
    getMock.mockClear();
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
    // Seed a shared scan scope so the adopt-on-mount effect runs an initial
    // count (setting lastParamsRef, without which option changes don't recount).
    setScanScope({
      roots: ['/photos'],
      globs: [],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });
  });

  it('fires exactly one POST /players/count when an option is committed', async () => {
    render(<PlayerCountModule />);
    // Initial adopt-on-mount count.
    await waitFor(() => expect(countCalls().length).toBe(1));
    postMock.mockClear();

    // Type a new matchgap value (preview only — no recount per keystroke)...
    const gap = screen.getByTitle(/Minsta lucka mellan matcher/);
    fireEvent.change(gap, { target: { value: '45' } });
    expect(countCalls().length).toBe(0);

    // ...and commit on blur: applyOptions publishes to the shared store (whose
    // notify runs synchronously through this module's own subscription) and
    // submits. The self-notify guard must suppress the subscription's recount,
    // leaving exactly one request.
    fireEvent.blur(gap);
    await waitFor(() => expect(countCalls().length).toBe(1));
    expect(countCalls()[0][1]).toEqual(expect.objectContaining({ gap_minutes: 45 }));
    // Give any erroneous second (subscription-triggered) recount a chance to
    // land before asserting the total stayed at one.
    await new Promise((r) => setTimeout(r, 0));
    expect(countCalls().length).toBe(1);
  });

  // The baseline select is the sensitive path for the ordering bug: number
  // inputs preview per keystroke (setOptions → the optionsRef sync effect runs
  // before blur), which masks a stale ref, while the discrete select commits
  // directly — under the broken ordering this test observes 2 POSTs.
  it('fires exactly one recount on a baseline select change too', async () => {
    render(<PlayerCountModule />);
    await waitFor(() => expect(countCalls().length).toBe(1));
    postMock.mockClear();

    const select = screen.getByTitle('Referens för över-/underrepresentation');
    fireEvent.change(select, { target: { value: 'mean' } });
    await waitFor(() => expect(countCalls().length).toBe(1));
    expect(countCalls()[0][1]).toEqual(expect.objectContaining({ baseline: 'mean' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(countCalls().length).toBe(1);
  });
});
