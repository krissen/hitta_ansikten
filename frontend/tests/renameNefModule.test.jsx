import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { settle } from './helpers/settle.js';
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
  return { emit, showToast, registry, api, dest: null, recursive: false };
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
  preferences: {
    get: (key) => (key === 'renameNef.recursive' ? h.recursive : h.dest),
    set: (key, val) => { if (key === 'renameNef.recursive') h.recursive = val; },
  },
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
  h.recursive = false;
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
  });
  await settle();
  return utils;
}

// Click a <button> by its exact text label.
async function clickButton(container, label) {
  const btn = [...container.querySelectorAll('button')].find((b) => b.textContent === label);
  if (!btn) throw new Error(`button not found: ${label}`);
  await act(async () => {
    fireEvent.click(btn);
  });
  await settle();
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
    });
    await settle();

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

// Toggle a checkbox by the visible label text on its wrapping <label>.
function toggleCheckbox(container, labelText) {
  const label = [...container.querySelectorAll('label')].find((l) => l.textContent.includes(labelText));
  if (!label) throw new Error(`checkbox not found: ${labelText}`);
  const box = label.querySelector('input[type="checkbox"]');
  fireEvent.click(box);
  return box;
}

function lastPost(pathFragment) {
  const call = [...h.api.post.mock.calls].reverse().find(([p]) => p.includes(pathFragment));
  return call ? call[1] : null;
}

describe('RenameNefModule — protect named files', () => {
  it('sends include_named=false and recursive=false by default', async () => {
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.preview'));
    expect(lastPost('/rename-nef/preview')).toMatchObject({ include_named: false, recursive: false });
  });

  it('opts in to renaming named files when the danger checkbox is ticked', async () => {
    h.api.post.mockImplementation((path) => {
      if (path.includes('/rename-nef/preview')) {
        return Promise.resolve({ to_rename: 1, already_named: 0, named_affected: 1, no_date: [], items: [
          { original_path: '/events/cupen/250601_101500_Elis.NEF', original: '250601_101500_Elis.NEF', new_name: '250601_101500.NEF' },
        ] });
      }
      return Promise.resolve({});
    });
    const { container } = await mountRename();
    toggleCheckbox(container, t('renameNef.includeNamedLabel'));
    await settle();
    await clickButton(container, t('renameNef.preview'));
    expect(lastPost('/rename-nef/preview')).toMatchObject({ include_named: true });
    // The stripping warning surfaces with the affected count.
    expect(container.textContent).toContain(t('renameNef.namedAffectedWarning', { count: 1 }));
  });

  it('persists the recursive toggle and forwards it', async () => {
    const { container } = await mountRename();
    toggleCheckbox(container, t('renameNef.recursiveLabel'));
    await settle();
    expect(h.recursive).toBe(true); // written through preferences.set
    await clickButton(container, t('renameNef.preview'));
    expect(lastPost('/rename-nef/preview')).toMatchObject({ recursive: true });
  });
});

describe('RenameNefModule — restore names', () => {
  beforeEach(() => {
    h.api.post.mockImplementation((path) => {
      if (path.includes('/restore-names/preview')) {
        return Promise.resolve({ total_files: 1, to_restore: 1, already_correct: 0, no_record: [], items: [
          { original_path: '/events/cupen/250601_101500.NEF', original: '250601_101500.NEF', new_name: '250601_101500_Elis.NEF' },
        ] });
      }
      if (path.includes('/restore-names/execute')) {
        return Promise.resolve({ renamed: [{ from: '250601_101500.NEF', to: '250601_101500_Elis.NEF' }], skipped: [], errors: [] });
      }
      return Promise.resolve({});
    });
  });

  it('previews then executes the SHA1 restore flow', async () => {
    const { container } = await mountRename();
    await clickButton(container, t('renameNef.restore'));
    expect(lastPost('/restore-names/preview')).toMatchObject({ recursive: false });
    expect(container.textContent).toContain('250601_101500_Elis.NEF');

    await clickButton(container, t('renameNef.restoreExecute'));
    expect(lastPost('/restore-names/execute')).toBeTruthy();
    expect(container.textContent).toContain(t('renameNef.restored'));
  });
});
