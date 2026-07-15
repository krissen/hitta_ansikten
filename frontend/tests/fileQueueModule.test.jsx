import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest';
import { render, act, cleanup, fireEvent } from '@testing-library/react';
import { PreprocessingStatus } from '../src/renderer/services/preprocessing/index.js';
import { setWorkingFolder, clearWorkingFolder } from '../src/renderer/shared/workingFolder.js';
import { t } from '../src/i18n/index.js';

// Characterization + fence tests for FileQueueModule.
//
// FileQueueModule (~2700 lines, ~129 hooks) is the repo's biggest god-component:
// it owns the file queue state, preprocessing orchestration (via a
// getPreprocessingManager singleton), the face-based NEF-rename flow, a stack of
// localStorage preference readers, and the FileQueueItem row subcomponent. These
// tests pin the CURRENT observable behavior so the planned decomposition
// (H8/H9 — pure extractions → preprocessing hook → queue reducer + rename logic)
// can move code without silently changing it. They EXTEND the existing pure-helper
// coverage (fileQueueEligibility.test.js), which is not duplicated here.
//
// Everything the component reaches outside its own render — the backend API, the
// module event bus, toasts, the file-watch IPC, the api-client singleton and the
// preprocessing manager — is mocked with controllable stubs. The i18n catalog and
// Icon are left REAL so assertions key off the actual Swedish text.
//
// Coverage gaps (documented honestly, closed when H8/H9 extract pure logic —
// mirrors how H2/H4 closed ReviewModule's gaps):
//  - loadFile's full "openModule → waitForListeners → emit load-image" handshake
//    is only exercised indirectly (fix-mode undo, auto-load and the workspace
//    poll are not driven); the 'completed' item state is pinned via a restored
//    queue, not via a live review-complete round-trip.
//  - The preprocessing "all done" completion toast (prevPreprocessingCountRef)
//    compares an object against a string status and is left as-is; its exact
//    firing is not asserted here (a known quirk for H8 to untangle).
//  - FileQueueItem's width-measured confirmed-names row depends on canvas
//    measureText (absent under jsdom) and is intentionally not exercised; the
//    status icon / status text / preprocess indicator surfaces are pinned instead.

// ---------------------------------------------------------------------------
// Group 1: preference readers (pure functions, exported seam).
//
// These read localStorage directly and are the cleanest extraction targets in
// H8. They are pinned as pure units (no React) here. The `export` on each is a
// behavior-neutral seam added for this fence (noted in the PR body).
// ---------------------------------------------------------------------------
import { FileQueueModule } from '../src/renderer/components/FileQueueModule.jsx';
import { naturalSortCompare } from '../src/renderer/components/fileQueue/queueUtils.js';
import {
  getAutoLoadPreference,
  getRenameConfig,
  getNotificationPreference,
  getPreprocessingConfig,
  getRequireRenameConfirmation,
  getAutoRemoveMissingPreference,
  getToastDurationMultiplier,
  getInsertModePreference,
} from '../src/renderer/components/fileQueue/fileQueuePrefs.js';

// --- mount harness -------------------------------------------------------
// Controllable stubs for everything FileQueueModule reaches outside its render.
const h = vi.hoisted(() => {
  const registry = new Map(); // module-event name -> latest useModuleEvent handler
  const ipc = new Map(); // window.ansiktenAPI.on(channel) -> handler
  const managerHandlers = new Map(); // preprocessing event -> Set<handler>
  const api = { get: vi.fn(), post: vi.fn() };
  const emit = vi.fn();
  const showToast = vi.fn();
  const confirm = vi.fn();
  const manager = {
    on: (evt, cb) => {
      if (!managerHandlers.has(evt)) managerHandlers.set(evt, new Set());
      managerHandlers.get(evt).add(cb);
    },
    off: (evt, cb) => managerHandlers.get(evt)?.delete(cb),
    addToQueue: vi.fn(),
    removeFile: vi.fn(() => null),
    stop: vi.fn(),
    markDone: vi.fn(),
    getCachedData: vi.fn(() => null),
    setHashChecker: vi.fn(),
    completed: new Map(),
  };
  return {
    registry, ipc, managerHandlers, api, emit, showToast, confirm, manager,
    isConnected: true,
    recentFiles: [],
    renamePreview: { items: [] },
    renameResult: { renamed: [], skipped: [], errors: [] },
  };
});

vi.mock('../src/renderer/context/BackendContext.jsx', () => ({
  useBackend: () => ({ api: h.api, isConnected: h.isConnected }),
}));

vi.mock('../src/renderer/context/ToastContext.jsx', () => ({
  useToast: () => h.showToast,
}));

// The rename confirmation moved from the native window.confirm() to the
// promise-based useConfirm() (fas B4). Swap the context hook for a controllable
// stub so the confirm-gate tests assert against it instead of the window global.
vi.mock('../src/renderer/context/ConfirmContext.jsx', () => ({
  useConfirm: () => h.confirm,
}));

vi.mock('../src/renderer/hooks/useModuleEvent.js', () => ({
  useEmitEvent: () => h.emit,
  useModuleEvent: (eventName, handler) => {
    if (eventName) h.registry.set(eventName, handler);
  },
  useModuleAPI: () => ({
    emit: h.emit,
    on: () => () => {},
    hasListeners: () => true,
    waitForListeners: vi.fn().mockResolvedValue(true),
  }),
}));

vi.mock('../src/renderer/shared/api-client.js', () => ({
  apiClient: {
    batchDeleteCache: vi.fn().mockResolvedValue({}),
    setPriorityCacheHashes: vi.fn().mockResolvedValue({}),
  },
}));

// Keep PreprocessingStatus real (assertions key off its string values); only
// swap the singleton factory for our controllable fake manager.
vi.mock('../src/renderer/services/preprocessing/index.js', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, getPreprocessingManager: () => h.manager };
});

// jsdom (as configured here) does not expose a bare `localStorage` global; the
// preference readers and the queue persistence effect both reach for it.
beforeAll(() => {
  if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage) {
    const store = new Map();
    const ls = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
    globalThis.localStorage = ls;
    if (typeof window !== 'undefined') window.localStorage = ls;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};
  }
});

function setPrefs(obj) {
  localStorage.setItem('ansikten-preferences', JSON.stringify(obj));
}

describe('FileQueueModule — preference readers (pure)', () => {
  beforeEach(() => {
    try { localStorage.clear(); } catch { /* ignore */ }
  });

  it('getAutoLoadPreference defaults to true and reads the stored flag', () => {
    expect(getAutoLoadPreference()).toBe(true); // no prefs
    setPrefs({ fileQueue: { autoLoadOnStartup: false } });
    expect(getAutoLoadPreference()).toBe(false);
  });

  it('getInsertModePreference defaults to alphabetical', () => {
    expect(getInsertModePreference()).toBe('alphabetical');
    setPrefs({ fileQueue: { insertMode: 'bottom' } });
    expect(getInsertModePreference()).toBe('bottom');
  });

  it('getRequireRenameConfirmation defaults to true (safety gate on)', () => {
    expect(getRequireRenameConfirmation()).toBe(true);
    setPrefs({ rename: { requireConfirmation: false } });
    expect(getRequireRenameConfirmation()).toBe(false);
  });

  it('getAutoRemoveMissingPreference defaults to true', () => {
    expect(getAutoRemoveMissingPreference()).toBe(true);
    setPrefs({ fileQueue: { autoRemoveMissing: false } });
    expect(getAutoRemoveMissingPreference()).toBe(false);
  });

  it('getToastDurationMultiplier defaults to 1.0', () => {
    expect(getToastDurationMultiplier()).toBe(1.0);
    setPrefs({ notifications: { toastDuration: 2.5 } });
    expect(getToastDurationMultiplier()).toBe(2.5);
  });

  it('getNotificationPreference has per-key defaults (pause on, resume off)', () => {
    expect(getNotificationPreference('showStatusIndicator')).toBe(true);
    expect(getNotificationPreference('showToastOnPause')).toBe(true);
    expect(getNotificationPreference('showToastOnResume')).toBe(false);
    setPrefs({ preprocessing: { notifications: { showToastOnResume: true, showToastOnPause: false } } });
    expect(getNotificationPreference('showToastOnResume')).toBe(true);
    expect(getNotificationPreference('showToastOnPause')).toBe(false);
  });

  it('getRenameConfig returns null when no non-default rename keys are set', () => {
    expect(getRenameConfig()).toBeNull();
    setPrefs({ rename: {} });
    expect(getRenameConfig()).toBeNull();
  });

  it('getRenameConfig includes only the explicitly-set keys (defaults omitted)', () => {
    setPrefs({ rename: { useFirstNameOnly: true, nameSeparator: '_' } });
    expect(getRenameConfig()).toEqual({ useFirstNameOnly: true, nameSeparator: '_' });
  });

  it('getPreprocessingConfig fills enabled/maxWorkers defaults', () => {
    expect(getPreprocessingConfig()).toEqual({});
    setPrefs({ preprocessing: { parallelWorkers: 4 } });
    expect(getPreprocessingConfig()).toMatchObject({ enabled: true, maxWorkers: 4 });
  });

  it('naturalSortCompare orders filenames numeric-aware', () => {
    const items = [
      { fileName: 'IMG_10.NEF' },
      { fileName: 'IMG_2.NEF' },
      { fileName: 'IMG_1.NEF' },
    ];
    const sorted = [...items].sort(naturalSortCompare).map((i) => i.fileName);
    expect(sorted).toEqual(['IMG_1.NEF', 'IMG_2.NEF', 'IMG_10.NEF']);
  });

  it('readers swallow malformed JSON and fall back to defaults', () => {
    localStorage.setItem('ansikten-preferences', '{not json');
    expect(getAutoLoadPreference()).toBe(true);
    expect(getInsertModePreference()).toBe('alphabetical');
    expect(getRenameConfig()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Groups 2-5: full-mount characterization.
// ---------------------------------------------------------------------------
beforeEach(() => {
  cleanup();
  h.registry.clear();
  h.ipc.clear();
  h.managerHandlers.clear();
  h.emit.mockClear();
  h.showToast.mockClear();
  h.confirm.mockReset();
  h.confirm.mockResolvedValue(true);
  h.api.get.mockReset();
  h.api.post.mockReset();
  h.manager.addToQueue.mockClear();
  h.manager.removeFile.mockClear();
  h.manager.markDone.mockClear();
  h.manager.stop.mockClear();
  h.manager.completed.clear();
  h.isConnected = true;
  h.recentFiles = [];
  h.renamePreview = { items: [] };
  h.renameResult = { renamed: [], skipped: [], errors: [] };

  h.api.get.mockImplementation((path) => {
    if (path.includes('/management/recent-files')) return Promise.resolve(h.recentFiles);
    if (path.includes('/preprocessing/cache/status')) return Promise.resolve({});
    return Promise.resolve({});
  });
  h.api.post.mockImplementation((path) => {
    if (path.includes('/files/rename-preview')) return Promise.resolve(h.renamePreview);
    if (path.includes('/files/rename')) return Promise.resolve(h.renameResult);
    if (path.includes('/statistics/file-stats')) return Promise.resolve({});
    if (path.includes('/management/undo-file')) return Promise.resolve({});
    if (path.includes('/culling/trash')) return Promise.resolve({ trashed: [{ id: 't1' }] });
    if (path.includes('/culling/restore')) return Promise.resolve({ restored: ['t1'] });
    return Promise.resolve({});
  });

  try { localStorage.clear(); } catch { /* ignore */ }

  window.ansiktenAPI = {
    on: (channel, handler) => { h.ipc.set(channel, handler); return () => h.ipc.delete(channel); },
    onFileDeleted: () => () => {},
    onWatcherError: () => () => {},
    watchFile: vi.fn(),
    unwatchFile: vi.fn(),
    unwatchAllFiles: vi.fn(),
    invoke: vi.fn().mockResolvedValue([]),
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function mountQueue(node = null) {
  let utils;
  await act(async () => {
    utils = render(<FileQueueModule node={node} />);
    await Promise.resolve();
  });
  // Flush the on-mount loadProcessedFiles round-trip so processedFilesLoaded is set.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return utils;
}

// The CLI/queue payload now arrives as the renderer 'file-queue-load' module
// event (the workspace marshals the old `queue-files` IPC into it after
// ensuring the queue is mounted), so drive that handler here.
async function addViaIpc(files, opts = {}) {
  const handler = h.registry.get('file-queue-load');
  await act(async () => {
    handler({ files, position: opts.position, clear: opts.clear, startQueue: opts.startQueue });
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fireManager(evt, data) {
  const set = h.managerHandlers.get(evt);
  await act(async () => {
    set?.forEach((cb) => cb(data));
    await Promise.resolve();
  });
}

function lastEmit(eventName) {
  const calls = h.emit.mock.calls.filter(([e]) => e === eventName);
  return calls.length ? calls[calls.length - 1][1] : undefined;
}

// Rename posts share the /files/rename prefix with the preview endpoint; match
// the mutation endpoint only.
function renamePosts() {
  return h.api.post.mock.calls.filter(
    ([p]) => p.includes('/files/rename') && !p.includes('preview'),
  );
}

function itemNames(container) {
  return [...container.querySelectorAll('.file-item .file-name')].map((el) =>
    el.textContent.trim(),
  );
}

describe('FileQueueModule — queue basics (characterization)', () => {
  it('files from the queue-files IPC event appear natural-sorted (alphabetical default)', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/c.jpg', '/p/a.jpg', '/p/b.jpg']);
    expect(itemNames(container)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('numeric-aware ordering keeps IMG_2 before IMG_10', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/IMG_10.jpg', '/p/IMG_2.jpg', '/p/IMG_1.jpg']);
    expect(itemNames(container)).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg']);
  });

  it('a duplicate path is ignored and warns "already in queue"', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/a.jpg']);
    h.showToast.mockClear();
    await addViaIpc(['/p/a.jpg']);
    expect(container.querySelectorAll('.file-item')).toHaveLength(1);
    expect(h.showToast).toHaveBeenCalledWith('Filen finns redan i kön', 'info', 2500);
  });

  it('unsupported files (e.g. XMP sidecars) are filtered out on add', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/a.jpg', '/p/a.xmp']);
    expect(itemNames(container)).toEqual(['a.jpg']);
  });

  it('the × remove button drops the file and tells the preprocessing manager', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/a.jpg', '/p/b.jpg']);
    const firstRemove = container.querySelector('.file-item .remove-btn');
    await act(async () => { fireEvent.click(firstRemove); });
    expect(itemNames(container)).toEqual(['b.jpg']);
    expect(h.manager.removeFile).toHaveBeenCalledWith('/p/a.jpg');
  });

  it('emits queue-status reflecting the queue total after an add', async () => {
    await mountQueue();
    await addViaIpc(['/p/a.jpg', '/p/b.jpg']);
    const status = lastEmit('queue-status');
    expect(status).toMatchObject({ total: 2, done: 0, remaining: 2 });
  });

  it('answers a request-queue-status probe with the current status', async () => {
    await mountQueue();
    await addViaIpc(['/p/a.jpg']);
    h.emit.mockClear();
    await act(async () => { h.registry.get('request-queue-status')(); });
    expect(lastEmit('queue-status')).toMatchObject({ total: 1 });
  });
});

describe('FileQueueModule — preprocessing orchestration (characterization)', () => {
  it('enqueues eligible fresh files with the preprocessing manager', async () => {
    await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    expect(h.manager.addToQueue).toHaveBeenCalledWith('/p/fresh.jpg');
  });

  it('a status-change event surfaces the in-progress indicator on the row', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    await fireManager('status-change', { filePath: '/p/fresh.jpg', status: PreprocessingStatus.HASHING });
    expect(container.querySelector('.preprocess-indicator.loading')).toBeTruthy();
  });

  it('a completed event flips the row to the cached (bolt) indicator', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    await fireManager('completed', { filePath: '/p/fresh.jpg', hash: 'hh', faceCount: 2 });
    expect(container.querySelector('.preprocess-indicator.completed')).toBeTruthy();
  });

  it('an error event toasts the failure and marks the row', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    await fireManager('error', { filePath: '/p/fresh.jpg', error: 'boom' });
    expect(container.querySelector('.preprocess-indicator.error')).toBeTruthy();
    expect(h.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Kunde inte förbehandla'), 'error', 4000,
    );
  });

  it('a paused event shows the buffered status and a pause toast (default on)', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    await fireManager('paused', { readyCount: 3, queueLength: 5 });
    expect(container.querySelector('.preprocessing-status .status-paused')).toBeTruthy();
    expect(h.showToast).toHaveBeenCalledWith(
      expect.stringContaining('Förbehandling pausad'), 'info', 3000,
    );
  });

  it('a resumed event clears the buffered status (no toast by default)', async () => {
    const { container } = await mountQueue();
    await addViaIpc(['/p/fresh.jpg']);
    await fireManager('paused', { readyCount: 1, queueLength: 2 });
    h.showToast.mockClear();
    await fireManager('resumed', {});
    expect(container.querySelector('.preprocessing-status .status-paused')).toBeNull();
    expect(h.showToast).not.toHaveBeenCalled();
  });
});

describe('FileQueueModule — rename flow (characterization)', () => {
  // An already-processed file (fix-mode off) is rename-eligible without a live
  // review round-trip, so it is the simplest way to surface the rename control.
  async function mountWithProcessed(container) {
    h.recentFiles = [{ name: '250601_120000_Alice.NEF', hash: 'h1' }];
    const utils = await mountQueue();
    await addViaIpc(['/p/250601_120000_Alice.NEF']);
    return utils;
  }

  function renameButton(container) {
    return [...container.querySelectorAll('.file-queue-footer button')].find((b) =>
      b.textContent.includes('Byt namn'),
    );
  }

  it('offers a rename control for an already-processed (eligible) file', async () => {
    const { container } = await mountWithProcessed();
    expect(renameButton(container)).toBeTruthy();
  });

  it('confirmation gate on (default): declining aborts without a rename request', async () => {
    h.confirm.mockResolvedValue(false);
    const { container } = await mountWithProcessed();
    await act(async () => {
      fireEvent.click(renameButton(container));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.confirm).toHaveBeenCalled();
    expect(renamePosts()).toHaveLength(0);
  });

  it('confirmation gate on: accepting posts the rename and updates the row path', async () => {
    h.confirm.mockResolvedValue(true);
    // Short target: FileQueueItem truncates displayed names past 25 chars, so a
    // long new name would surface as an ellipsis; the path update is the point.
    h.renameResult = {
      renamed: [{ original: '/p/250601_120000_Alice.NEF', new: '/p/Alice_A.NEF' }],
      skipped: [], errors: [],
    };
    const { container } = await mountWithProcessed();
    await act(async () => {
      fireEvent.click(renameButton(container));
      // Extra flushes: the confirm() await now precedes the rename post.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(renamePosts()).toHaveLength(1);
    expect(renamePosts()[0][1]).toMatchObject({ file_paths: ['/p/250601_120000_Alice.NEF'] });
    expect(itemNames(container)).toEqual(['Alice_A.NEF']);
  });

  it('confirmation gate off (preference): renames with no confirm dialog', async () => {
    setPrefs({ rename: { requireConfirmation: false } });
    const { container } = await mountWithProcessed();
    await act(async () => {
      fireEvent.click(renameButton(container));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(renamePosts()).toHaveLength(1);
  });
});

describe('FileQueueModule — FileQueueItem render states (characterization)', () => {
  // Seed a persisted queue so items land in each status without driving the
  // full load/review round-trip. Auto-load is disabled so no file is opened.
  function seedQueue(items) {
    setPrefs({ fileQueue: { autoLoadOnStartup: false } });
    localStorage.setItem('ansikten-file-queue', JSON.stringify({
      queue: items, currentIndex: -1, autoAdvance: true, fixMode: false, showPreviewNames: false,
    }));
  }

  function rowByName(container, name) {
    return [...container.querySelectorAll('.file-item')].find((el) =>
      el.querySelector('.file-name')?.textContent.includes(name),
    );
  }

  it('renders the right icon + status text for each item state', async () => {
    seedQueue([
      { id: '1', filePath: '/p/pending.jpg', fileName: 'pending.jpg', status: 'pending', isAlreadyProcessed: false },
      { id: '2', filePath: '/p/done.jpg', fileName: 'done.jpg', status: 'completed', isAlreadyProcessed: false },
      { id: '3', filePath: '/p/err.jpg', fileName: 'err.jpg', status: 'error', isAlreadyProcessed: false },
      { id: '4', filePath: '/p/gone.jpg', fileName: 'gone.jpg', status: 'missing', isAlreadyProcessed: false },
      { id: '5', filePath: '/p/proc.jpg', fileName: 'proc.jpg', status: 'pending', isAlreadyProcessed: true },
    ]);
    const { container } = await mountQueue();

    const pending = rowByName(container, 'pending.jpg');
    expect(pending.querySelector('.status-icon.pending')).toBeTruthy();
    expect(pending.querySelector('.file-status').textContent).toBe('I kö');

    const done = rowByName(container, 'done.jpg');
    expect(done.classList.contains('completed')).toBe(true);
    expect(done.querySelector('.status-icon.completed')).toBeTruthy();
    expect(done.querySelector('.file-status').textContent).toBe('Klar');

    const err = rowByName(container, 'err.jpg');
    expect(err.querySelector('.status-icon.error')).toBeTruthy();
    expect(err.querySelector('.file-status').textContent).toBe('Fel');

    const missing = rowByName(container, 'gone.jpg');
    expect(missing.querySelector('.status-icon.missing')).toBeTruthy();
    expect(missing.querySelector('.file-status').textContent).toBe('Hittas ej');

    const processed = rowByName(container, 'proc.jpg');
    expect(processed.querySelector('.status-icon.already-done')).toBeTruthy();
    expect(processed.querySelector('.file-status').textContent).toBe('Behandlad');
  });

  it('an already-processed row (fix-mode off) offers the reprocess button', async () => {
    seedQueue([
      { id: '5', filePath: '/p/proc.jpg', fileName: 'proc.jpg', status: 'pending', isAlreadyProcessed: true },
    ]);
    const { container } = await mountQueue();
    expect(container.querySelector('.file-item .reprocess-btn')).toBeTruthy();
  });
});

describe('FileQueueModule — folder hand-off + working-folder offer', () => {
  afterEach(() => clearWorkingFolder());

  it('file-queue-load with roots expands the folder via expand-folders and queues the files', async () => {
    window.ansiktenAPI.invoke = vi.fn().mockResolvedValue(['/dir/a.jpg', '/dir/b.jpg']);
    const { container } = await mountQueue();
    await act(async () => {
      h.registry.get('file-queue-load')({ roots: ['/dir'] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.ansiktenAPI.invoke).toHaveBeenCalledWith('expand-folders', ['/dir']);
    expect(itemNames(container)).toEqual(['a.jpg', 'b.jpg']);
  });

  it('file-queue-load with roots that expand to nothing warns instead of silently doing nothing', async () => {
    window.ansiktenAPI.invoke = vi.fn().mockResolvedValue([]);
    const { container } = await mountQueue();
    await act(async () => {
      h.registry.get('file-queue-load')({ roots: ['/empty'] });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.querySelectorAll('.file-item')).toHaveLength(0);
    // showToast is wrapped with a duration multiplier, so match on message+type.
    expect(
      h.showToast.mock.calls.some(
        (c) => c[0] === t('fileQueue.toasts.noSupportedFound') && c[1] === 'warning',
      ),
    ).toBe(true);
  });

  it('offers to load the working-folder anchor when the queue is empty', async () => {
    setWorkingFolder({ roots: ['/events/cupen'], step: 'rename' });
    const { container, getByText } = await mountQueue();
    const btn = getByText(t('fileQueue.emptyStates.loadFolderOffer', { name: 'cupen' }));
    expect(btn).toBeTruthy();

    window.ansiktenAPI.invoke = vi.fn().mockResolvedValue(['/events/cupen/x.jpg']);
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(window.ansiktenAPI.invoke).toHaveBeenCalledWith('expand-folders', ['/events/cupen']);
    expect(itemNames(container)).toEqual(['x.jpg']);
  });

  it('shows no folder offer when the anchor is unset', async () => {
    clearWorkingFolder();
    const { queryByText } = await mountQueue();
    expect(queryByText(/Ladda/)).toBeNull();
  });
});
