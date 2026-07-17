import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Regression guard for the toolbar "Gallra" hand-off scope source. The button
// opens culling on the CURRENT input, not the last count's params: if the user
// counted scope A and then edits the visible wildcard to B without pressing
// Räkna, the button (enabled off `input`) must hand over B — not the stale A
// still held in lastParamsRef. (The per-player row click keeps last-count params
// because a row belongs to that result; only the unfiltered button follows input.)

const { postMock, getMock, emitMock, waitForListenersMock } = vi.hoisted(() => ({
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
  emitMock: vi.fn(),
  waitForListenersMock: vi.fn().mockResolvedValue(true),
}));

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { post: postMock, get: getMock } }),
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: () => {},
  useModuleAPI: () => ({
    emit: emitMock,
    on: () => () => {},
    waitForListeners: waitForListenersMock,
    hasListeners: () => false,
  }),
}));

import { PlayerCountModule } from '../src/renderer/components/PlayerCountModule.jsx';
import { setScanScope, signalExternalLoad, takeExternalLoad } from '../src/renderer/shared/scanScope.js';
import { clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

const countCalls = () =>
  postMock.mock.calls.filter(([url]) => url === '/api/v1/players/count');
const cullPlayerEmits = () =>
  emitMock.mock.calls.filter(([evt]) => evt === 'cull-player');

describe('PlayerCountModule — "Gallra" button hands over the live input scope', () => {
  beforeEach(() => {
    postMock.mockClear();
    getMock.mockClear();
    emitMock.mockClear();
    // Running a count now anchors the working folder; clear it between tests so
    // adopt-on-mount's anchor-prefill fallback can't leak a selection into the
    // "no selection" case.
    clearWorkingFolder();
    takeExternalLoad(); // clear any leaked one-shot external-load flag
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
    globalThis.window.workspace = { openModule: vi.fn() };
    // Seed scope A (folder, no wildcard) so adopt-on-mount runs an initial count,
    // setting lastParamsRef with globs: [].
    setScanScope({
      roots: ['/photos'],
      globs: [],
      recursive: true,
      date_from: null,
      date_to: null,
      extension_preset: 'jpg',
    });
  });

  it('emits cull-player with the edited wildcard, not the stale last-count params', async () => {
    render(<PlayerCountModule />);
    // Initial adopt-on-mount count (scope A: no wildcard).
    await waitFor(() => expect(countCalls().length).toBe(1));

    // Edit the wildcard WITHOUT pressing Räkna — updates input, no recount.
    const glob = screen.getByPlaceholderText(/Wildcard/);
    fireEvent.change(glob, { target: { value: '*ArvidW*' } });
    expect(countCalls().length).toBe(1); // still only the adopt count

    // Click the toolbar Gallra button.
    fireEvent.click(screen.getByText(/Gallra/));

    await waitFor(() => expect(cullPlayerEmits().length).toBe(1));
    const payload = cullPlayerEmits()[0][1];
    expect(payload.name).toBeNull(); // unfiltered
    // The discriminator: globs come from the live input (['*ArvidW*']), NOT the
    // stale adopt params ([]).
    expect(payload.globs).toEqual(['*ArvidW*']);
    expect(payload.roots).toEqual(['/photos']);
    expect(payload.extension_preset).toBe('jpg');
    expect(window.workspace.openModule).toHaveBeenCalledWith('culling');
  });

  it('is disabled when there is no selection (no folders, no wildcard)', async () => {
    setScanScope(null); // nothing to adopt
    render(<PlayerCountModule />);
    const button = screen.getByText(/Gallra/).closest('button');
    expect(button.disabled).toBe(true);
  });

  it('adopt-on-mount does NOT run a count when an external load was signalled', async () => {
    // The open-count hand-off signals an external load before Räkna mounts; the
    // count-load consumer will drive the count, so adopt-on-mount must stand down
    // even though a scan scope is present (scope A seeded in beforeEach).
    signalExternalLoad();
    render(<PlayerCountModule />);
    // Give the mount effects a tick; no adopt count should fire.
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(countCalls().length).toBe(0);
    // The one-shot flag was consumed.
    expect(takeExternalLoad()).toBe(false);
  });
});
