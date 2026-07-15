import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Chip removal in Räkna spelare must publish the (possibly empty) scan scope and
// recount — or clear. Before the fix, InputBar's removeRoot only patched local
// state without firing onAutoApply, so deselecting a folder never recounted and
// an empty selection could never be published (Gallra kept adopting the last
// non-empty scope).

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
import { getScanScope, setScanScope } from '../src/renderer/shared/scanScope.js';

const countCalls = () =>
  postMock.mock.calls.filter(([url]) => url === '/api/v1/players/count');

describe('PlayerCountModule — chip removal publishes/clears scan scope', () => {
  beforeEach(() => {
    postMock.mockClear();
    getMock.mockClear();
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

    // Remove both chips one at a time.
    let removes = container.querySelectorAll('.input-bar-chip-remove');
    fireEvent.click(removes[0]);
    await waitFor(() => {
      expect(container.querySelectorAll('.input-bar-chip-remove')).toHaveLength(1);
    });
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
