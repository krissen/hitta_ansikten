import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { Model } from 'flexlayout-react';

// stepLayoutMemory imports layouts.js + workflows.js, which reach the module
// catalog and thus every module component; ThemeEditor pulls in the theme
// manager (localStorage at import). Mock it, same as workspaceMorph.test.js.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  snapshotStepSpec,
  saveStepSpec,
  loadStepSpec,
  clearStepSpec,
  clearAllStepSpecs,
  mergeWithFactory,
  resolveStepSpec,
  migrateLegacyLayout,
  migrateReviewMemoryShape,
  stepStorageKey,
  LEGACY_LAYOUT_KEY,
} from '../src/renderer/workspace/flexlayout/stepLayoutMemory.js';
import { getWorkspaceSpec } from '../src/renderer/workspace/flexlayout/workflows.js';
import { ensureBottomBorder } from '../src/renderer/workspace/flexlayout/layouts.js';

// jsdom here does not expose localStorage; provide a minimal Map-backed one.
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
});

beforeEach(() => {
  window.localStorage.clear();
});

// --- Model builders (headless; no React) ---------------------------------

function tab(id, component) {
  return { type: 'tab', id, name: component, component, config: { moduleId: component } };
}

function makeModel(layout) {
  return Model.fromJson(ensureBottomBorder({ global: { splitterSize: 4 }, layout }));
}

// A row of the given [component, weight] tabsets (one tab each).
function rowModel(...panes) {
  return makeModel({
    type: 'row',
    weight: 100,
    children: panes.map(([c, w], i) => ({
      type: 'tabset',
      id: `ts-${c}-${i}`,
      weight: w,
      children: [tab(`t-${c}-${i}`, c)],
    })),
  });
}

describe('snapshotStepSpec', () => {
  it('captures real tabsets as an ordered { moduleId, weight } spec', () => {
    const model = rowModel(['file-queue', 15], ['review-module', 15], ['image-viewer', 70]);
    expect(snapshotStepSpec(model)).toEqual([
      { moduleId: 'file-queue', weight: 15 },
      { moduleId: 'review-module', weight: 15 },
      { moduleId: 'image-viewer', weight: 70 },
    ]);
  });

  it('excludes border-parked tabs (they belong to the live model, not step memory)', () => {
    // culling in a real tabset; a File Queue parked in the bottom border.
    const model = Model.fromJson({
      global: { splitterSize: 4 },
      layout: {
        type: 'row',
        weight: 100,
        children: [{ type: 'tabset', id: 'ts-c', weight: 100, children: [tab('t-c', 'culling')] }],
      },
      borders: [
        {
          type: 'border',
          location: 'bottom',
          children: [tab('t-parked', 'file-queue')],
        },
      ],
    });
    const spec = snapshotStepSpec(model);
    expect(spec.map((p) => p.moduleId)).toEqual(['culling']);
    expect(spec.map((p) => p.moduleId)).not.toContain('file-queue');
  });

  it('de-duplicates a module that appears in more than one tabset (first wins)', () => {
    const model = rowModel(['image-viewer', 40], ['image-viewer', 60]);
    expect(snapshotStepSpec(model)).toEqual([{ moduleId: 'image-viewer', weight: 40 }]);
  });

  it('captures a multi-tab tabset as a group pane with its selected active tab', () => {
    const model = makeModel({
      type: 'row', weight: 100,
      children: [
        { type: 'tabset', id: 'ts-r', weight: 15, children: [tab('t-r', 'review-module')] },
        {
          type: 'tabset', id: 'ts-g', weight: 85, selected: 0,
          children: [tab('t-v', 'image-viewer'), tab('t-q', 'file-queue')],
        },
      ],
    });
    expect(snapshotStepSpec(model)).toEqual([
      { moduleId: 'review-module', weight: 15 },
      { tabs: ['image-viewer', 'file-queue'], active: 'image-viewer', weight: 85 },
    ]);
  });

  it('records the group active tab from the tabset selection (file-queue on top)', () => {
    const model = makeModel({
      type: 'row', weight: 100,
      children: [{
        type: 'tabset', id: 'ts-g', weight: 100, selected: 1,
        children: [tab('t-v', 'image-viewer'), tab('t-q', 'file-queue')],
      }],
    });
    expect(snapshotStepSpec(model)).toEqual([
      { tabs: ['image-viewer', 'file-queue'], active: 'file-queue', weight: 100 },
    ]);
  });

  it('returns [] for a null model', () => {
    expect(snapshotStepSpec(null)).toEqual([]);
  });
});

describe('save / load round-trip', () => {
  it('persists and reloads a spec', () => {
    const spec = [
      { moduleId: 'file-queue', weight: 20 },
      { moduleId: 'review-module', weight: 20 },
      { moduleId: 'image-viewer', weight: 60 },
    ];
    saveStepSpec('review', spec);
    expect(loadStepSpec('review')).toEqual(spec);
  });

  it('does not persist an empty spec (never wipes to junk)', () => {
    saveStepSpec('review', []);
    expect(window.localStorage.getItem(stepStorageKey('review'))).toBeNull();
  });

  it('returns null for an absent key', () => {
    expect(loadStepSpec('culling')).toBeNull();
  });

  it('returns null (not a throw) for a corrupt value', () => {
    window.localStorage.setItem(stepStorageKey('review'), '{not json');
    expect(loadStepSpec('review')).toBeNull();
  });

  it('returns null for a structurally invalid spec', () => {
    window.localStorage.setItem(stepStorageKey('review'), JSON.stringify([{ moduleId: 'x' }]));
    expect(loadStepSpec('review')).toBeNull();
    window.localStorage.setItem(stepStorageKey('review'), JSON.stringify({ nope: true }));
    expect(loadStepSpec('review')).toBeNull();
  });
});

describe('clear', () => {
  it('clearStepSpec forgets one step', () => {
    saveStepSpec('review', [{ moduleId: 'image-viewer', weight: 100 }]);
    clearStepSpec('review');
    expect(loadStepSpec('review')).toBeNull();
  });

  it('clearAllStepSpecs forgets every step', () => {
    saveStepSpec('review', [{ moduleId: 'image-viewer', weight: 100 }]);
    saveStepSpec('culling', [{ moduleId: 'culling', weight: 100 }]);
    clearAllStepSpecs();
    expect(loadStepSpec('review')).toBeNull();
    expect(loadStepSpec('culling')).toBeNull();
  });
});

describe('mergeWithFactory', () => {
  const factory = getWorkspaceSpec('review'); // review-module | [image-viewer, file-queue]

  it('keeps a saved group-form spec verbatim (factory modules all present)', () => {
    const saved = [
      { moduleId: 'review-module', weight: 20 },
      { tabs: ['image-viewer', 'file-queue'], active: 'file-queue', weight: 80 },
    ];
    expect(mergeWithFactory(saved, factory)).toEqual(saved);
  });

  it('appends factory modules the saved spec dropped (essential modules kept)', () => {
    // User closed the File Queue, saving a queue-less review shape.
    const saved = [
      { moduleId: 'review-module', weight: 30 },
      { moduleId: 'image-viewer', weight: 70 },
    ];
    const merged = mergeWithFactory(saved, factory);
    const ids = merged.map((p) => p.moduleId);
    expect(ids).toContain('file-queue'); // re-added from factory
    // Saved order + weights preserved, factory-only module appended at the end.
    expect(merged.slice(0, 2)).toEqual(saved);
    expect(merged[merged.length - 1].moduleId).toBe('file-queue');
  });

  it('keeps the saved spec verbatim when it already covers the factory', () => {
    const saved = [
      { moduleId: 'file-queue', weight: 25 },
      { moduleId: 'review-module', weight: 15 },
      { moduleId: 'image-viewer', weight: 60 },
    ];
    expect(mergeWithFactory(saved, factory)).toEqual(saved);
  });

  it('preserves a user extra pane not in the factory', () => {
    const saved = [
      { moduleId: 'file-queue', weight: 15 },
      { moduleId: 'review-module', weight: 15 },
      { moduleId: 'image-viewer', weight: 55 },
      { moduleId: 'log-viewer', weight: 15 },
    ];
    expect(mergeWithFactory(saved, factory).map((p) => p.moduleId)).toContain('log-viewer');
  });

  it('falls back to the factory for an invalid saved spec', () => {
    expect(mergeWithFactory(null, factory)).toBe(factory);
    expect(mergeWithFactory([], factory)).toBe(factory);
  });
});

describe('resolveStepSpec', () => {
  it('returns the factory spec when there is no saved memory', () => {
    expect(resolveStepSpec('review')).toEqual(getWorkspaceSpec('review'));
  });

  it('returns the saved spec (merged with factory) when present', () => {
    const saved = [
      { moduleId: 'image-viewer', weight: 80 },
      { moduleId: 'review-module', weight: 20 },
    ];
    saveStepSpec('review', saved);
    const resolved = resolveStepSpec('review');
    // Saved order/weights lead, dropped essential (file-queue) appended.
    expect(resolved.slice(0, 2)).toEqual(saved);
    expect(resolved.map((p) => p.moduleId)).toContain('file-queue');
  });

  it('returns null for an unknown step', () => {
    expect(resolveStepSpec('nope')).toBeNull();
  });
});

describe('migrateLegacyLayout', () => {
  // A legacy full-model JSON (the pre-per-step single key).
  const legacyJson = {
    global: { splitterSize: 4 },
    layout: {
      type: 'row',
      weight: 100,
      children: [
        { type: 'tabset', weight: 20, children: [tab('l-r', 'review-module')] },
        { type: 'tabset', weight: 80, children: [tab('l-v', 'image-viewer')] },
      ],
    },
  };

  it('seeds the review step from the legacy key, then removes the legacy key', () => {
    window.localStorage.setItem(LEGACY_LAYOUT_KEY, JSON.stringify(legacyJson));
    migrateLegacyLayout();

    expect(window.localStorage.getItem(LEGACY_LAYOUT_KEY)).toBeNull();
    expect(loadStepSpec('review')).toEqual([
      { moduleId: 'review-module', weight: 20 },
      { moduleId: 'image-viewer', weight: 80 },
    ]);
  });

  it('does not overwrite an existing review memory', () => {
    const existing = [{ moduleId: 'image-viewer', weight: 100 }];
    saveStepSpec('review', existing);
    window.localStorage.setItem(LEGACY_LAYOUT_KEY, JSON.stringify(legacyJson));

    migrateLegacyLayout();

    expect(loadStepSpec('review')).toEqual(existing); // untouched
    expect(window.localStorage.getItem(LEGACY_LAYOUT_KEY)).toBeNull(); // still removed
  });

  it('discards a corrupt legacy value without seeding review', () => {
    window.localStorage.setItem(LEGACY_LAYOUT_KEY, '{broken');
    migrateLegacyLayout();
    expect(window.localStorage.getItem(LEGACY_LAYOUT_KEY)).toBeNull();
    expect(loadStepSpec('review')).toBeNull();
  });

  it('is a no-op when there is no legacy key', () => {
    migrateLegacyLayout();
    expect(loadStepSpec('review')).toBeNull();
  });
});

describe('migrateReviewMemoryShape', () => {
  it('folds an old three-column review memory into the companion-tab group form', () => {
    saveStepSpec('review', [
      { moduleId: 'file-queue', weight: 15 },
      { moduleId: 'review-module', weight: 15 },
      { moduleId: 'image-viewer', weight: 70 },
    ]);
    migrateReviewMemoryShape();
    expect(loadStepSpec('review')).toEqual([
      { moduleId: 'review-module', weight: 15 },
      { tabs: ['image-viewer', 'file-queue'], active: 'image-viewer', weight: 85 },
    ]);
  });

  it('is idempotent — a memory already in the group form is untouched', () => {
    const groupForm = [
      { moduleId: 'review-module', weight: 15 },
      { tabs: ['image-viewer', 'file-queue'], active: 'image-viewer', weight: 85 },
    ];
    saveStepSpec('review', groupForm);
    migrateReviewMemoryShape();
    expect(loadStepSpec('review')).toEqual(groupForm);
  });

  it('leaves a memory without both queue and viewer columns alone', () => {
    const other = [{ moduleId: 'review-module', weight: 100 }];
    saveStepSpec('review', other);
    migrateReviewMemoryShape();
    expect(loadStepSpec('review')).toEqual(other);
  });

  it('is a no-op when there is no review memory', () => {
    migrateReviewMemoryShape();
    expect(loadStepSpec('review')).toBeNull();
  });
});
