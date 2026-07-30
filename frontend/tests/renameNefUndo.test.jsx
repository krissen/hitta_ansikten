import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { settle } from './helpers/settle.js';
import { clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

// Tests for RenameNefModule's "Ångra senaste namnbyte…" flow: the button fetches
// undoable batches, previews the newest as a from → to table (with skip marks),
// and confirming runs the reversal. Backend/toast/event-bus/websocket/prefs are
// mocked; the real i18n catalog and shared UI primitives are kept so assertions
// key off the actual Swedish labels.

const h = vi.hoisted(() => {
  const emit = vi.fn();
  const showToast = vi.fn();
  const api = { post: vi.fn(), get: vi.fn() };
  return { emit, showToast, api };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: h.api }),
}));
vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => h.showToast,
}));
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => h.emit,
  useModuleEvent: () => {},
  useModuleAPI: () => ({ emit: h.emit, on: () => () => {} }),
}));
vi.mock('../src/renderer/hooks/useWebSocket.js', () => ({
  useWebSocket: () => {},
}));
vi.mock('../src/renderer/workspace/preferences.js', () => ({
  preferences: { get: () => null, set: () => {} },
}));

import { RenameNefModule } from '../src/renderer/components/RenameNefModule.jsx';
import { t } from '../src/i18n/index.js';

const UNDO_PREVIEW = {
  batch_id: 'b1',
  tool: 'rename-nef',
  op: 'rename',
  ts: '2026-07-14T08:15:00+00:00',
  count: 2,
  to_revert: 1,
  to_skip: 1,
  items: [
    { from: '/p/250601_101500.NEF', to: '/p/DSC_1.NEF', from_name: '250601_101500.NEF', to_name: 'DSC_1.NEF', status: 'ok', reason: null },
    { from: '/p/250601_101600.NEF', to: '/p/DSC_2.NEF', from_name: '250601_101600.NEF', to_name: 'DSC_2.NEF', status: 'skip', reason: 'filen saknas' },
  ],
};

beforeEach(() => {
  cleanup();
  clearWorkingFolder();
  h.emit.mockClear();
  h.showToast.mockClear();
  h.api.post.mockReset();
  h.api.get.mockReset();
  h.api.get.mockResolvedValue({
    batches: [
      { batch_id: 'b1', ts: '2026-07-14T08:15:00+00:00', tool: 'rename-nef', op: 'rename', count: 2, undoable: true },
      { batch_id: 'b0', ts: '2026-07-13T08:15:00+00:00', tool: 'import', op: 'copy', count: 3, undoable: false },
    ],
  });
  h.api.post.mockImplementation((path, body) => {
    if (path.includes('/rename-journal/undo')) {
      if (body.execute) {
        return Promise.resolve({
          batch_id: 'b1', reverted: 1, skipped: 1, errors: 0,
          results: [
            { path: '/p/250601_101500.NEF', status: 'reverted', reason: null },
            { path: '/p/250601_101600.NEF', status: 'skipped', reason: 'filen saknas' },
          ],
        });
      }
      return Promise.resolve(UNDO_PREVIEW);
    }
    return Promise.resolve({});
  });
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
  clearWorkingFolder();
  vi.restoreAllMocks();
});

async function mountRename() {
  let utils;
  await act(async () => {
    utils = render(<RenameNefModule />);
  });
  await settle();
  return utils;
}

async function clickButton(container, label) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`button not found: ${label}`);
  await act(async () => {
    fireEvent.click(btn);
  });
  await settle();
}

describe('RenameNefModule — undo flow', () => {
  it('previews the newest undoable batch, then only offers undoable batches in the selector', async () => {
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.undo'));

    // Preview table shows both rows; the skip row is marked.
    expect(container.textContent).toContain('DSC_1.NEF');
    expect(container.querySelector('.rename-nef-row-skip')).toBeTruthy();

    // The header names the action being undone with a Swedish tool label.
    const header = container.querySelector('.rename-nef-undo-header');
    expect(header).toBeTruthy();
    expect(header.textContent).toContain(t('renameNef.undoToolRenameNef'));

    // The non-undoable import/copy batch is filtered out of the selector.
    const options = [...container.querySelectorAll('select option')];
    // Only one undoable batch → selector is hidden entirely.
    expect(options.length).toBe(0);
    expect(h.api.get).toHaveBeenCalledWith('/api/v1/rename-journal/batches');
  });

  it('runs the reversal on confirm and shows the result', async () => {
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.undo'));
    await clickButton(container, t('renameNef.undoExecute'));

    expect(h.api.post).toHaveBeenCalledWith(
      '/api/v1/rename-journal/undo',
      { batch_id: 'b1', execute: true },
    );
    expect(container.textContent).toContain(t('renameNef.undone'));
    expect(h.showToast).toHaveBeenCalled();
  });

  it('does not offer an import move batch (rename-only undo)', async () => {
    // Only rename batches are undoable; an import move is filtered out, so the
    // flow shows the "nothing to undo" toast and no preview.
    h.api.get.mockResolvedValue({
      batches: [{ batch_id: 'mv', ts: '2026-07-14T09:00:00+00:00', tool: 'import', op: 'move', count: 4, undoable: false }],
    });
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.undo'));

    expect(h.showToast).toHaveBeenCalled();
    expect(container.querySelector('.rename-nef-table')).toBeNull();
    expect(container.querySelector('.rename-nef-undo-header')).toBeNull();
  });

  it('shows a toast and no preview when there is no undoable batch', async () => {
    h.api.get.mockResolvedValue({
      batches: [{ batch_id: 'b0', ts: '2026-07-13T08:15:00+00:00', tool: 'import', op: 'copy', count: 3, undoable: false }],
    });
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.undo'));

    expect(h.showToast).toHaveBeenCalled();
    expect(container.querySelector('.rename-nef-table')).toBeNull();
  });
});
