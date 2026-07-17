import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';

// Characterization + smoke tests for FlexLayoutWorkspace.
//
// FlexLayoutWorkspace is the layout host: it owns the FlexLayout model, the
// ~40-case menu-command switch, applyUIPreferences, and the SHORTCUT_SECTIONS
// data. These tests pin the CURRENT observable behavior so the planned
// decomposition (H2: split out the command switch, shortcutSections.js,
// applyUIPreferences, MODULE_COMPONENTS registry) can't silently change it.
//
// The real module components are heavy (canvas, BackendContext, WebSocket) and
// irrelevant here, so every one is mocked with a trivial marker component. The
// theme manager is mocked both to avoid its matchMedia dependency at import and
// to observe theme-command dispatch. moduleAPI is a controllable stub.

// --- Hoisted mock handles (referenced inside vi.mock factories) ---
const h = vi.hoisted(() => {
  const setPreference = vi.fn();
  const emit = vi.fn();
  const on = vi.fn(() => () => {});
  // Confirm dialog stub — defaults to "confirmed" so paths that don't care are
  // unaffected; the dirty-guard tests override per-call.
  const confirm = vi.fn().mockResolvedValue(true);
  const moduleAPI = {
    emit,
    on,
    hasListeners: () => false,
    waitForListeners: vi.fn().mockResolvedValue(true),
    http: { get: vi.fn(), post: vi.fn() },
    ws: { on: () => {}, off: () => {} },
    ipc: { send: vi.fn(), invoke: vi.fn() },
  };
  return { setPreference, emit, on, confirm, moduleAPI };
});

// Trivial marker component for a mocked module. Renders a div carrying the
// module's own component-id class so the factory output is identifiable.
function markerComponent(id) {
  return function Marker() {
    return <div className={id} data-testid={`mock-${id}`} />;
  };
}

vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: h.setPreference },
}));

vi.mock('../src/renderer/context/ModuleAPIContext.jsx', () => ({
  useModuleAPI: () => h.moduleAPI,
}));

// The workspace uses useConfirm to guard a step switch that would discard
// unsaved Review edits; feed it a controllable stub.
vi.mock('../src/renderer/context/ConfirmContext.jsx', () => ({
  useConfirm: () => h.confirm,
}));

// Mock every module component so FlexLayoutWorkspace can mount without pulling
// in canvas/backend/websocket machinery. Named export per file must match the
// symbol FlexLayoutWorkspace imports.
vi.mock('../src/renderer/components/ImageViewer.jsx', () => ({ ImageViewer: markerComponent('image-viewer') }));
vi.mock('../src/renderer/components/OriginalView.jsx', () => ({ OriginalView: markerComponent('original-view') }));
vi.mock('../src/renderer/components/LogViewer.jsx', () => ({ LogViewer: markerComponent('log-viewer') }));
vi.mock('../src/renderer/components/StatisticsDashboard.jsx', () => ({ StatisticsDashboard: markerComponent('statistics-dashboard') }));
vi.mock('../src/renderer/components/ReviewModule.jsx', () => ({ ReviewModule: markerComponent('review-module') }));
vi.mock('../src/renderer/components/DatabaseManagement.jsx', () => ({ DatabaseManagement: markerComponent('database-management') }));
vi.mock('../src/renderer/components/FileQueueModule.jsx', () => ({ FileQueueModule: markerComponent('file-queue') }));
vi.mock('../src/renderer/components/ThemeEditor.jsx', () => ({ ThemeEditor: markerComponent('theme-editor') }));
vi.mock('../src/renderer/components/PreferencesModule.jsx', () => ({ PreferencesModule: markerComponent('preferences') }));
vi.mock('../src/renderer/components/RefineFacesModule.jsx', () => ({ RefineFacesModule: markerComponent('refine-faces') }));
vi.mock('../src/renderer/components/PlayerCountModule.jsx', () => ({ PlayerCountModule: markerComponent('player-count') }));
vi.mock('../src/renderer/components/CullingModule.jsx', () => ({ CullingModule: markerComponent('culling') }));
vi.mock('../src/renderer/components/TrashPanel.jsx', () => ({ TrashPanel: markerComponent('trash') }));
vi.mock('../src/renderer/components/ImportModule.jsx', () => ({ ImportModule: markerComponent('import') }));
vi.mock('../src/renderer/components/RenameNefModule.jsx', () => ({ RenameNefModule: markerComponent('rename-nef') }));
vi.mock('../src/renderer/components/StartupLanding.jsx', () => ({ StartupLanding: () => <div data-testid="mock-landing" /> }));
// The persistent WorkflowBar renders above the layout; it depends on the module
// API (useEmitEvent) and workingFolder, neither relevant to the host-behavior
// tests here. Stub it, as with the module components and the landing.
vi.mock('../src/renderer/components/WorkflowBar.jsx', () => ({ WorkflowBar: () => <div data-testid="mock-workflow-bar" /> }));

import {
  FlexLayoutWorkspace,
  SHORTCUT_SECTIONS,
  applyUIPreferences,
} from '../src/renderer/workspace/flexlayout/FlexLayoutWorkspace.jsx';

// jsdom (as configured here) lacks these; FlexLayout's Layout and effects,
// plus preferences/layout persistence, touch them.
beforeAll(() => {
  if (!window.localStorage) {
    const store = new Map();
    window.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    };
  }
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
    });
  }
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  // jsdom reports every element as 0x0. FlexLayout defers rendering a tab's
  // *content* (tabEnableRenderOnDemand) until its panel has a non-zero size, so
  // without a real rect the factory never mounts a module component. Give
  // elements a fixed non-zero box so the layout pass sizes the panels and the
  // factory actually runs.
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} };
  };
});

// Collect the component-ids of every tab currently in a model.
function tabComponents(model) {
  const ids = [];
  model.visitNodes((node) => {
    if (node.getType() === 'tab') ids.push(node.getComponent());
  });
  return ids;
}

async function mountWorkspace() {
  let utils;
  await act(async () => {
    utils = render(<FlexLayoutWorkspace />);
    // Let the model-init and IPC-setup effects run.
    await Promise.resolve();
  });
  return utils;
}

// Retrieve the menu-command handler the component registered via
// window.ansiktenAPI.on('menu-command', ...).
function menuCommandHandler() {
  const reg = window.ansiktenAPI.on.mock.calls.find(([evt]) => evt === 'menu-command');
  return reg ? reg[1] : null;
}

async function dispatch(command) {
  const handler = menuCommandHandler();
  await act(async () => {
    await handler(command);
  });
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  h.setPreference.mockClear();
  h.emit.mockClear();
  h.on.mockClear();
  h.confirm.mockClear();
  h.confirm.mockResolvedValue(true);
  h.moduleAPI.waitForListeners.mockClear();
  // Fresh electron bridge each test: capture IPC listeners, stub invoke.
  window.ansiktenAPI = {
    on: vi.fn(() => () => {}),
    invoke: vi.fn().mockResolvedValue(null),
    send: vi.fn(),
    launchIntent: null,
  };
  delete window.workspace;
  delete window.fileQueue;
});

describe('FlexLayoutWorkspace — smoke', () => {
  it('mounts and renders the default review layout without throwing', async () => {
    await mountWorkspace();
    // window.workspace is published by the component once the model exists.
    expect(window.workspace).toBeTruthy();
    expect(window.workspace.model).toBeTruthy();
    // Default layout is 'review' → review-module + image-viewer tabs.
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'image-viewer',
      'review-module',
    ]);
  });

  it('renders a known module tab via the factory (mocked component)', async () => {
    const { container } = await mountWorkspace();
    // The factory maps component-id → component; the review-module marker
    // should be in the DOM (its tab is selected in the default layout).
    expect(container.querySelector('[data-testid="mock-review-module"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="mock-image-viewer"]')).toBeTruthy();
  });

  it('registers a menu-command IPC listener when ready', async () => {
    await mountWorkspace();
    expect(menuCommandHandler()).toBeTypeOf('function');
  });
});

describe('FlexLayoutWorkspace — menu-command dispatch (characterization)', () => {
  beforeEach(mountWorkspace);

  it('open-culling opens the culling module as a new tab', async () => {
    expect(tabComponents(window.workspace.model)).not.toContain('culling');
    await dispatch('open-culling');
    expect(tabComponents(window.workspace.model)).toContain('culling');
  });

  it('open-trash opens the trash module as a new tab', async () => {
    await dispatch('open-trash');
    expect(tabComponents(window.workspace.model)).toContain('trash');
  });

  it('layout-comparison replaces the layout with the comparison preset', async () => {
    await dispatch('layout-comparison');
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'image-viewer',
      'original-view',
    ]);
  });

  it('layout-database replaces the layout with the database preset', async () => {
    await dispatch('layout-database');
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'database-management',
      'statistics-dashboard',
    ]);
  });

  it('reset-layout restores the review preset', async () => {
    await dispatch('layout-comparison');
    await dispatch('reset-layout');
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'image-viewer',
      'review-module',
    ]);
  });

  it('theme-light / theme-dark / theme-system forward to the theme manager', async () => {
    await dispatch('theme-light');
    await dispatch('theme-dark');
    await dispatch('theme-system');
    expect(h.setPreference.mock.calls.map((c) => c[0])).toEqual([
      'light',
      'dark',
      'system',
    ]);
  });

  it('open-file opens the multi-file dialog via IPC', async () => {
    await dispatch('open-file');
    expect(window.ansiktenAPI.invoke).toHaveBeenCalledWith('open-multi-file-dialog');
  });

  it('an unknown command is broadcast to modules via moduleAPI.emit (default case)', async () => {
    await dispatch('some-unknown-view-command');
    expect(h.emit).toHaveBeenCalledWith('some-unknown-view-command', {});
  });

  it('a theme command is NOT broadcast as a module event (handled, not defaulted)', async () => {
    h.emit.mockClear();
    await dispatch('theme-dark');
    expect(h.emit).not.toHaveBeenCalledWith('theme-dark', {});
  });
});

describe('FlexLayoutWorkspace — pipeline hand-offs (Rename → Review, queue-files)', () => {
  // moduleAPI.on records (event, handler). The setup effect re-registers on every
  // model change (a layout reload), so return the LATEST registration — it closes
  // over the current model; an earlier one closes over a stale (pre-reload) model.
  function moduleApiHandler(evt) {
    const reg = h.on.mock.calls.findLast(([e]) => e === evt);
    return reg ? reg[1] : null;
  }
  // IPC listeners are captured on the fresh window.ansiktenAPI.on mock (latest).
  function ipcHandler(evt) {
    const reg = window.ansiktenAPI.on.mock.calls.findLast(([e]) => e === evt);
    return reg ? reg[1] : null;
  }
  function tabId(model, component) {
    let id = null;
    model.visitNodes((n) => {
      if (n.getType() === 'tab' && n.getComponent() === component) id = n.getId();
    });
    return id;
  }
  const reviewTabId = (model) => tabId(model, 'review-module');

  beforeEach(mountWorkspace);

  it('open-review-queue (no unsaved edits) loads the queue-review layout and hands roots to the queue', async () => {
    expect(tabComponents(window.workspace.model)).not.toContain('file-queue');
    const handler = moduleApiHandler('open-review-queue');
    await act(async () => { await handler({ roots: ['/events/cupen'] }); });

    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'file-queue',
      'image-viewer',
      'review-module',
    ]);
    expect(h.emit).toHaveBeenCalledWith('file-queue-load', { roots: ['/events/cupen'] });
    expect(h.moduleAPI.waitForListeners).toHaveBeenCalledWith('file-queue-load', 2000);
  });

  it('open-review-queue with unsaved Review edits keeps the existing Review tab (no layout reload)', async () => {
    const before = reviewTabId(window.workspace.model);
    expect(before).toBeTruthy();
    // Mark a file dirty so the guard must preserve Review state.
    const dirty = moduleApiHandler('review-dirty');
    await act(async () => { dirty({ imagePath: '/x.nef', dirty: true }); });

    const handler = moduleApiHandler('open-review-queue');
    await act(async () => { await handler({ roots: ['/events/cupen'] }); });

    // Same node id → the layout was NOT rebuilt (which would discard Review).
    expect(reviewTabId(window.workspace.model)).toBe(before);
    // Queue still brought up and roots still handed off.
    expect(tabComponents(window.workspace.model)).toContain('file-queue');
    expect(h.emit).toHaveBeenCalledWith('file-queue-load', { roots: ['/events/cupen'] });
  });

  it('a workflow-step switch with unsaved Review edits does NOT prompt — the morph parks the dirty Review instead of discarding it', async () => {
    // Under the old destructive rebuild this switch required a discard confirm.
    // Morphing preserves the dirty Review (parked in the background border), so
    // the switch is non-destructive and must never prompt (PR 3 semantics; see
    // docs/dev/ux-principles.md).
    const dirty = moduleApiHandler('review-dirty');
    await act(async () => { dirty({ imagePath: '/x.nef', dirty: true }); });
    const reviewBefore = reviewTabId(window.workspace.model);
    expect(reviewBefore).toBeTruthy();

    h.confirm.mockClear();
    await act(async () => { await window.workspace.openWorkflowStep('player-count'); });

    expect(h.confirm).not.toHaveBeenCalled();
    // Switched to the target step…
    expect(tabComponents(window.workspace.model)).toContain('player-count');
    expect(window.workspace.activeStep).toBe('count');
    // …and the dirty Review survives with the SAME node id (parked, not rebuilt).
    expect(reviewTabId(window.workspace.model)).toBe(reviewBefore);
  });

  it('a workflow-step switch morphs into the target step (no confirm, target present)', async () => {
    const dirty = moduleApiHandler('review-dirty');
    await act(async () => { dirty({ imagePath: '/x.nef', dirty: true }); });

    h.confirm.mockClear();
    await act(async () => { await window.workspace.openWorkflowStep('player-count'); });

    expect(h.confirm).not.toHaveBeenCalled();
    expect(tabComponents(window.workspace.model)).toContain('player-count');
  });

  it('a workflow-step switch with no unsaved edits does not prompt', async () => {
    await act(async () => { await window.workspace.openWorkflowStep('player-count'); });
    expect(h.confirm).not.toHaveBeenCalled();
    expect(tabComponents(window.workspace.model)).toContain('player-count');
  });

  it('clicking the already-active step is a focus no-op: no confirm, no reload, even when dirty', async () => {
    // Make Review the active step via the normal hand-off (also mounts the queue).
    const openReview = moduleApiHandler('open-review-queue');
    await act(async () => { await openReview({ roots: ['/events/cupen'] }); });
    const reviewBefore = reviewTabId(window.workspace.model);
    expect(reviewBefore).toBeTruthy();

    // Dirty, then click the SAME (active) step.
    const dirty = moduleApiHandler('review-dirty');
    await act(async () => { dirty({ imagePath: '/x.nef', dirty: true }); });
    h.confirm.mockClear();
    await act(async () => { await window.workspace.openWorkflowStep('review-module'); });

    // No prompt, and the review node id is unchanged → the layout was not rebuilt.
    expect(h.confirm).not.toHaveBeenCalled();
    expect(reviewTabId(window.workspace.model)).toBe(reviewBefore);
  });

  it('a stale active step whose tab was closed falls through and rebuilds the surface', async () => {
    // Make Review active and mount its surface.
    const openReview = moduleApiHandler('open-review-queue');
    await act(async () => { await openReview({ roots: ['/events/cupen'] }); });
    expect(tabComponents(window.workspace.model)).toContain('review-module');

    // Load a different layout from the menu: review-module is gone, but
    // activeStep still lingers on 'review'.
    await act(async () => { window.workspace.loadLayout('database'); });
    expect(tabComponents(window.workspace.model)).not.toContain('review-module');

    // Clicking Granska must NOT take the focus fast-path (that would open a
    // bare Review); it falls through to rebuild the queue-review surface.
    await act(async () => { await window.workspace.openWorkflowStep('review-module'); });
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'file-queue',
      'image-viewer',
      'review-module',
    ]);
  });

  it('a dirty click on the mounted step focuses it (no confirm/reload) even when activeStep is null', async () => {
    // Fresh default Review layout: review-module is mounted, activeStep is null.
    const before = reviewTabId(window.workspace.model);
    expect(before).toBeTruthy();

    const dirty = moduleApiHandler('review-dirty');
    await act(async () => { dirty({ imagePath: '/x.nef', dirty: true }); });
    h.confirm.mockClear();
    await act(async () => { await window.workspace.openWorkflowStep('review-module'); });

    // Mounted + dirty → focus, never the discard prompt (N5); layout untouched.
    expect(h.confirm).not.toHaveBeenCalled();
    expect(reviewTabId(window.workspace.model)).toBe(before);
  });

  it('a clean click on the mounted-but-not-active step rebuilds the canonical surface', async () => {
    // Fresh default Review layout (review + viewer, NO queue), activeStep null,
    // nothing dirty. A clean click must build the full queue-review surface, not
    // no-op into a queue-less dead end.
    expect(tabComponents(window.workspace.model)).not.toContain('file-queue');
    await act(async () => { await window.workspace.openWorkflowStep('review-module'); });

    expect(h.confirm).not.toHaveBeenCalled();
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'file-queue',
      'image-viewer',
      'review-module',
    ]);
  });

  it('opening a step module via the command route marks its workflow step active', async () => {
    await dispatch('open-player-count');
    expect(window.workspace.activeStep).toBe('count');
    await dispatch('open-culling');
    expect(window.workspace.activeStep).toBe('culling');
  });

  it('opening a stepless module (preferences) leaves activeStep untouched', async () => {
    await dispatch('open-player-count');
    expect(window.workspace.activeStep).toBe('count');
    await dispatch('open-preferences');
    expect(window.workspace.activeStep).toBe('count');
  });

  it('queue-files IPC mounts the queue when absent and re-emits the payload as file-queue-load', async () => {
    expect(tabComponents(window.workspace.model)).not.toContain('file-queue');
    const handler = ipcHandler('queue-files');
    expect(handler).toBeTypeOf('function');
    await act(async () => { await handler({ files: ['/a.nef', '/b.nef'], startQueue: true, clear: false }); });

    expect(tabComponents(window.workspace.model)).toContain('file-queue');
    expect(h.emit).toHaveBeenCalledWith('file-queue-load', { files: ['/a.nef', '/b.nef'], startQueue: true, clear: false });
  });

  it('queue-files IPC dismisses the startup landing even without startQueue (no image loads)', async () => {
    // launchIntent is null in this harness → the landing overlay is up at mount.
    expect(document.querySelector('[data-testid="mock-landing"]')).toBeTruthy();

    const handler = ipcHandler('queue-files');
    // No startQueue: the queue fills but no image loads, so nothing else would
    // hide the landing — ensureQueueMounted must dismiss it.
    await act(async () => { await handler({ files: ['/a.nef'], startQueue: false }); });

    expect(document.querySelector('[data-testid="mock-landing"]')).toBeNull();
    expect(h.emit).toHaveBeenCalledWith('file-queue-load', { files: ['/a.nef'], startQueue: false });
  });

  it('enterStep(review) builds the review trio beside an existing queue WITHOUT remounting it', async () => {
    // Build a queue-only layout: the database preset has no Review/Viewer; add a
    // File Queue tab so neither review surface exists but the queue does.
    await dispatch('layout-database');
    await act(async () => { window.workspace.openModule('file-queue'); });
    const queueIdBefore = tabId(window.workspace.model, 'file-queue');
    expect(queueIdBefore).toBeTruthy();
    expect(tabComponents(window.workspace.model)).not.toContain('review-module');
    expect(tabComponents(window.workspace.model)).not.toContain('image-viewer');

    // loadFile calls enterStep('review'). The morph never rebuilds the model, so
    // the live FileQueue keeps its node id (currentFileRef/currentIndex survive)
    // while Review + Image Viewer are morphed in around it.
    await act(async () => { window.workspace.enterStep('review'); });
    expect(tabId(window.workspace.model, 'file-queue')).toBe(queueIdBefore);
    expect(tabComponents(window.workspace.model)).toContain('review-module');
    expect(tabComponents(window.workspace.model)).toContain('image-viewer');
  });

  it('enterStep(review) morphs in the MISSING Review beside an existing Viewer (queue kept)', async () => {
    // A partial surface: queue + viewer, Review closed. The comparison preset has
    // image-viewer (+ original-view) but no review/queue; add a queue.
    await dispatch('layout-comparison');
    await act(async () => { window.workspace.openModule('file-queue'); });
    const queueIdBefore = tabId(window.workspace.model, 'file-queue');
    expect(queueIdBefore).toBeTruthy();
    expect(tabComponents(window.workspace.model)).toContain('image-viewer');
    expect(tabComponents(window.workspace.model)).not.toContain('review-module');

    await act(async () => { window.workspace.enterStep('review'); });
    // Queue not remounted; Review added; Viewer still there.
    expect(tabId(window.workspace.model, 'file-queue')).toBe(queueIdBefore);
    expect(tabComponents(window.workspace.model)).toContain('review-module');
    expect(tabComponents(window.workspace.model)).toContain('image-viewer');
  });

  it('enterStep(review) morphs in the MISSING Viewer beside an existing Review (queue kept)', async () => {
    // A partial surface: queue + review, Viewer closed. Build it from the
    // database preset (no review/viewer/queue), adding queue then review.
    await dispatch('layout-database');
    await act(async () => { window.workspace.openModule('file-queue'); });
    await act(async () => { window.workspace.openModule('review-module'); });
    const queueIdBefore = tabId(window.workspace.model, 'file-queue');
    expect(queueIdBefore).toBeTruthy();
    expect(tabComponents(window.workspace.model)).toContain('review-module');
    expect(tabComponents(window.workspace.model)).not.toContain('image-viewer');

    await act(async () => { window.workspace.enterStep('review'); });
    // Queue not remounted; Viewer added; Review still there.
    expect(tabId(window.workspace.model, 'file-queue')).toBe(queueIdBefore);
    expect(tabComponents(window.workspace.model)).toContain('image-viewer');
    expect(tabComponents(window.workspace.model)).toContain('review-module');
  });

  it('enterStep(review) builds the full trio from a queue-less start (blank start)', async () => {
    // Database preset: no queue, no review surface. Morph builds the trio.
    await dispatch('layout-database');
    expect(tabComponents(window.workspace.model)).not.toContain('file-queue');
    await act(async () => { window.workspace.enterStep('review'); });
    expect(tabComponents(window.workspace.model).sort()).toEqual([
      'file-queue',
      'image-viewer',
      'review-module',
    ]);
  });

  it('open-review-queue does not reload the layout when a File Queue tab already exists (emit reaches the live queue)', async () => {
    // First hand-off loads the pipeline layout (queue absent → loadLayout).
    const handler = moduleApiHandler('open-review-queue');
    await act(async () => { await handler({ roots: ['/a'] }); });
    const queueIdBefore = tabId(window.workspace.model, 'file-queue');
    expect(queueIdBefore).toBeTruthy();

    h.emit.mockClear();
    // Second hand-off with the queue already mounted: must NOT rebuild the layout
    // (which would drop the emit against the dying listener) — same node id — and
    // the emit must still reach the live queue. Re-fetch the handler: the first
    // reload re-registered it against the now-current model.
    const handler2 = moduleApiHandler('open-review-queue');
    await act(async () => { await handler2({ roots: ['/b'] }); });
    expect(tabId(window.workspace.model, 'file-queue')).toBe(queueIdBefore);
    expect(h.emit).toHaveBeenCalledWith('file-queue-load', { roots: ['/b'] });
  });
});

describe('applyUIPreferences', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.getElementById('flexlayout-preferences-style')?.remove();
  });

  it('returns false and does nothing when no .flexlayout__layout element exists', () => {
    expect(applyUIPreferences()).toBe(false);
    expect(document.getElementById('flexlayout-preferences-style')).toBeNull();
  });

  it('sets the --font-size CSS var and injects a preferences <style> from override values', () => {
    const layoutEl = document.createElement('div');
    layoutEl.className = 'flexlayout__layout';
    document.body.appendChild(layoutEl);

    const ok = applyUIPreferences({
      appearance: {
        tabsHeight: 40,
        tabsFontSize: 16,
        tabPaddingLeft: 12,
        tabPaddingRight: 10,
        tabMinGap: 7,
      },
    });

    expect(ok).toBe(true);
    // Font size is applied directly to the layout element's CSS var.
    expect(layoutEl.style.getPropertyValue('--font-size')).toBe('16px');

    // A single style element is created and carries the sizing rules.
    const styleEl = document.getElementById('flexlayout-preferences-style');
    expect(styleEl).toBeTruthy();
    expect(styleEl.tagName).toBe('STYLE');
    expect(styleEl.textContent).toContain('height: 40px');
    expect(styleEl.textContent).toContain('font-size: 16px');
    expect(styleEl.textContent).toContain('padding: 4px 10px 4px 12px');
    expect(styleEl.textContent).toContain('gap: 7px');
    // tabsHeight + 4 for the tabbar outer min-height.
    expect(styleEl.textContent).toContain('min-height: 44px');
  });

  it('reuses the existing style element on a second call (no duplicates)', () => {
    const layoutEl = document.createElement('div');
    layoutEl.className = 'flexlayout__layout';
    document.body.appendChild(layoutEl);

    applyUIPreferences();
    applyUIPreferences();

    expect(document.querySelectorAll('#flexlayout-preferences-style')).toHaveLength(1);
  });
});

describe('SHORTCUT_SECTIONS data sanity', () => {
  it('every section has an id, title, modules array and non-empty shortcuts', () => {
    expect(Array.isArray(SHORTCUT_SECTIONS)).toBe(true);
    expect(SHORTCUT_SECTIONS.length).toBeGreaterThan(0);
    for (const section of SHORTCUT_SECTIONS) {
      expect(typeof section.id).toBe('string');
      expect(section.id).not.toHaveLength(0);
      expect(typeof section.title).toBe('string');
      expect(Array.isArray(section.modules)).toBe(true);
      expect(Array.isArray(section.shortcuts)).toBe(true);
      expect(section.shortcuts.length).toBeGreaterThan(0);
    }
  });

  it('every shortcut has a non-empty keys array and a description', () => {
    for (const section of SHORTCUT_SECTIONS) {
      for (const sc of section.shortcuts) {
        expect(Array.isArray(sc.keys)).toBe(true);
        expect(sc.keys.length).toBeGreaterThan(0);
        expect(sc.keys.every((k) => typeof k === 'string' && k.length > 0)).toBe(true);
        expect(typeof sc.desc).toBe('string');
        expect(sc.desc.length).toBeGreaterThan(0);
      }
    }
  });

  it('section ids are unique', () => {
    const ids = SHORTCUT_SECTIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('no duplicate key-combination within a single section', () => {
    for (const section of SHORTCUT_SECTIONS) {
      const combos = section.shortcuts.map((sc) => sc.keys.join('+'));
      expect(new Set(combos).size, `duplicate shortcut in section "${section.id}"`).toBe(
        combos.length,
      );
    }
  });

  it('the shortcuts-help overlay keys each row by desc, so descriptions are unique within a section', () => {
    // ShortcutRow is rendered with key={shortcut.desc}; duplicate descs in a
    // section would collide React keys. Pin that invariant as data.
    for (const section of SHORTCUT_SECTIONS) {
      const descs = section.shortcuts.map((sc) => sc.desc);
      expect(new Set(descs).size, `duplicate desc in section "${section.id}"`).toBe(
        descs.length,
      );
    }
  });
});
