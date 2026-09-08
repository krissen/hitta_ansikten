import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';

// Guards the open-count hand-off's external-load flag. handleOpenCount signals
// signalExternalLoad() unconditionally before morphing to Count; PlayerCount must
// CONSUME that flag even when it was already mounted (the morph fast-path skips a
// remount, so adopt-on-mount never runs). Otherwise the one-shot flag lingers and
// is swallowed by the next consumer (culling's adopt-on-mount), opening Gallra
// without its scope. count-load fires on every open-count, so it's the reliable
// consumption point.

const { postMock, getMock, emitMock, waitForListenersMock, handlers } =
  vi.hoisted(() => ({
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
    handlers: {},
  }));

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: { post: postMock, get: getMock } }),
}));

// Capture module-event handlers so the test can invoke count-load directly,
// simulating the emit that handleOpenCount fires after the morph.
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: (name, handler) => {
    handlers[name] = handler;
  },
  useModuleAPI: () => ({
    emit: emitMock,
    on: () => () => {},
    waitForListeners: waitForListenersMock,
    hasListeners: () => false,
  }),
}));

import { PlayerCountModule } from '../src/renderer/components/PlayerCountModule.jsx';
import {
  setScanScope,
  signalExternalLoad,
  takeExternalLoad,
} from '../src/renderer/shared/scanScope.js';
import { clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

const countCalls = () =>
  postMock.mock.calls.filter(([url]) => url === '/api/v1/players/count');

describe('PlayerCountModule — open-count consumes the external-load flag', () => {
  beforeEach(() => {
    postMock.mockClear();
    getMock.mockClear();
    emitMock.mockClear();
    setScanScope(null);
    clearWorkingFolder();
    takeExternalLoad(); // clear any leaked flag
    for (const k of Object.keys(handlers)) delete handlers[k];
    globalThis.window.ansiktenAPI = {
      watchFolder: vi.fn(),
      unwatchFolder: vi.fn(),
      onFolderChanged: () => () => {},
      invoke: vi.fn().mockResolvedValue([]),
    };
  });

  it('count-load consumes the flag even when Räkna is already mounted (no leak to culling)', async () => {
    // Räkna is already on screen: mount it first (no external flag yet, no scope).
    render(<PlayerCountModule />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());
    expect(countCalls().length).toBe(0);

    // handleOpenCount signals the external load, then (after the no-op morph)
    // emits count-load. The morph did NOT remount, so adopt-on-mount never re-ran.
    signalExternalLoad();
    handlers['count-load']({ roots: ['/photos'] });

    // The flag was consumed by the count-load handler — a following consumer
    // (culling's adopt-on-mount) sees nothing pending.
    expect(takeExternalLoad()).toBe(false);
    // count-load still drove the count explicitly.
    await waitFor(() => expect(countCalls().length).toBe(1));
    expect(countCalls()[0][1].roots).toEqual(['/photos']);
  });

  it('count-load with no roots still consumes the flag (invalid payload cannot leak)', async () => {
    render(<PlayerCountModule />);
    await waitFor(() => expect(getMock).toHaveBeenCalled());

    signalExternalLoad();
    handlers['count-load']({});

    expect(takeExternalLoad()).toBe(false);
    expect(countCalls().length).toBe(0);
  });
});
