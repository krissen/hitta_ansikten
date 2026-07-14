import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { NetworkError } from '../src/renderer/shared/api-client.js';

// A lost connection during a card import is only "still running" (WS "done"
// owns the summary) when the backend actually started — proven by at least one
// transfer progress event. A connection that never reached the backend
// (crashed/unstarted server) is offline too, but no import runs and no "done"
// event ever comes, so it must surface as an error rather than hang the panel.

// A single stable `api` object — a fresh one each render would change
// loadVolumes (memoized on [api]) and spin the mount effect forever.
const mocks = vi.hoisted(() => ({ api: { post: null, get: null } }));
const ws = vi.hoisted(() => ({ cb: null }));

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: mocks.api }),
}));
vi.mock('../src/renderer/hooks/useWebSocket.js', () => ({
  useWebSocket: (event, callback) => { if (event === 'import-progress') ws.cb = callback; },
}));
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useModuleEvent: () => {},
  useEmitEvent: () => () => {},
}));
vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => () => {},
}));
vi.mock('../src/renderer/workspace/preferences.js', () => ({
  preferences: { get: () => '~/dest', set: () => {} },
}));
vi.mock('../src/renderer/shared/workingFolder.js', () => ({
  setWorkingFolder: () => {},
}));

import { ImportModule } from '../src/renderer/components/ImportModule.jsx';

const OFFLINE = () => new NetworkError('Ingen nätverksanslutning', { isOffline: true });

async function renderReady() {
  mocks.api.get.mockResolvedValue({
    volumes: [{ mount: '/Volumes/CARD', name: 'CARD', nef_count: 2, total_bytes: 1024 }],
  });
  render(<ImportModule />);
  // The card <select> appears once volumes load.
  await screen.findByRole('combobox');
}

function runButton() {
  return screen.queryByRole('button', { name: 'Importera' });
}

describe('ImportModule — lost connection is ongoing only after server-side progress', () => {
  beforeEach(() => {
    // Reassign the spies but keep the same `api` object identity (stable ref).
    mocks.api.post = vi.fn();
    mocks.api.get = vi.fn();
    ws.cb = null;
  });
  afterEach(() => cleanup());

  it('offline BEFORE any progress → shows an error and re-enables the button', async () => {
    mocks.api.post.mockRejectedValueOnce(OFFLINE());
    await renderReady();

    await act(async () => {
      fireEvent.click(runButton());
    });

    // No progress event was seen this run → a lost connection is a real failure.
    expect(screen.getByText(/Ingen nätverksanslutning/)).toBeTruthy();
    // running was reset: the primary button is back to its idle label and enabled.
    const btn = runButton();
    expect(btn).toBeTruthy();
    expect(btn.disabled).toBe(false);
  });

  it('connection lost AFTER a transfer progress event → treated as ongoing (no error, stays running)', async () => {
    let rejectPost;
    mocks.api.post.mockImplementationOnce(() => new Promise((_, rej) => { rejectPost = rej; }));
    await renderReady();

    await act(async () => {
      fireEvent.click(runButton());
    });

    // The backend streams a per-file event — the import is under way.
    act(() => {
      ws.cb({ phase: 'transfer', current: 1, total: 2, file: 'DSC0001.NEF', percent: 50 });
    });

    // Now the HTTP response is lost.
    await act(async () => {
      rejectPost(OFFLINE());
    });

    // No error banner, and the panel stays in the running state (button relabelled
    // and disabled) — the WS "done" event will finish the UI.
    expect(screen.queryByText(/Ingen nätverksanslutning/)).toBeNull();
    expect(runButton()).toBeNull();
    const running = screen.getByRole('button', { name: 'Importerar…' });
    expect(running.disabled).toBe(true);
  });
});
