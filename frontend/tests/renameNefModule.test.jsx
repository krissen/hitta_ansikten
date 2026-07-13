import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';

// Focused tests for RenameNefModule's Review hand-off (etapp 2, part E): after a
// successful rename the result panel offers "Granska ansikten…", which emits
// open-review-queue scoped to the folders the run actually targeted (frozen at
// execute-start, not the live selection).
//
// Backend, toasts, the event bus, the websocket progress feed and preferences
// are mocked; the i18n catalog and shared UI primitives are left REAL so the
// assertions key off the actual Swedish button labels the user sees.

const h = vi.hoisted(() => {
  const emit = vi.fn();
  const showToast = vi.fn();
  const registry = new Map(); // eventName -> latest useModuleEvent handler
  const api = { post: vi.fn() };
  return { emit, showToast, registry, api, dest: null };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: h.api }),
}));
vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => h.showToast,
}));
vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => h.emit,
  useModuleEvent: (eventName, handler) => {
    if (eventName) h.registry.set(eventName, handler);
  },
  useModuleAPI: () => ({ emit: h.emit, on: () => () => {} }),
}));
vi.mock('../src/renderer/hooks/useWebSocket.js', () => ({
  useWebSocket: () => {},
}));
vi.mock('../src/renderer/workspace/preferences.js', () => ({
  preferences: { get: () => h.dest },
}));

import { RenameNefModule } from '../src/renderer/components/RenameNefModule.jsx';
import { t } from '../src/i18n/index.js';

beforeEach(() => {
  cleanup();
  clearWorkingFolder();
  h.emit.mockClear();
  h.showToast.mockClear();
  h.api.post.mockReset();
  h.dest = '/events/cupen'; // seeds the initial roots via the preference fallback
  h.api.post.mockImplementation((path) => {
    if (path.includes('/rename-nef/preview')) {
      return Promise.resolve({ to_rename: 2, already_named: 0, no_date: [], items: [
        { original_path: '/events/cupen/DSC_1.NEF', original: 'DSC_1.NEF', new_name: '250601_101500.NEF' },
        { original_path: '/events/cupen/DSC_2.NEF', original: 'DSC_2.NEF', new_name: '250601_101600.NEF' },
      ] });
    }
    if (path.includes('/rename-nef/execute')) {
      return Promise.resolve({ renamed: ['a', 'b'], skipped: [], errors: [] });
    }
    return Promise.resolve({});
  });
});

afterEach(() => {
  clearWorkingFolder();
  vi.restoreAllMocks();
});

async function mountRename() {
  let utils;
  await act(async () => {
    utils = render(<RenameNefModule />);
    await Promise.resolve();
  });
  return utils;
}

// Click a <button> by its exact text label.
async function clickButton(container, label) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`button not found: ${label}`);
  await act(async () => {
    fireEvent.click(btn);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function previewThenExecute(container) {
  await clickButton(container, t('renameNef.preview'));
  await clickButton(container, t('renameNef.execute'));
}

describe('RenameNefModule — Review hand-off', () => {
  it('shows the "Granska ansikten…" button after a successful rename and hands the folder to Review', async () => {
    const { container } = await mountRename();
    await previewThenExecute(container);

    const reviewBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === t('renameNef.reviewFaces'),
    );
    expect(reviewBtn).toBeTruthy();

    await clickButton(container, t('renameNef.reviewFaces'));
    expect(h.emit).toHaveBeenCalledWith('open-review-queue', { roots: ['/events/cupen'] });
  });

  it('freezes the hand-off roots at execute-start (editing the selection afterwards does not change them)', async () => {
    const { container } = await mountRename();
    await previewThenExecute(container);

    // Remove the folder chip AFTER the run: live roots become empty, but the
    // result panel (and its frozen resultRoots) persist.
    const removeChip = container.querySelector('.rename-nef-chip-x');
    expect(removeChip).toBeTruthy();
    await act(async () => {
      fireEvent.click(removeChip);
      await Promise.resolve();
    });

    await clickButton(container, t('renameNef.reviewFaces'));
    // Still the folder the rename actually ran on, not the now-empty selection.
    expect(h.emit).toHaveBeenCalledWith('open-review-queue', { roots: ['/events/cupen'] });
  });

  it('does not offer Review before any rename has run', async () => {
    const { container } = await mountRename();
    const reviewBtn = [...container.querySelectorAll('button')].find(
      (b) => b.textContent === t('renameNef.reviewFaces'),
    );
    expect(reviewBtn).toBeUndefined();
  });
});
