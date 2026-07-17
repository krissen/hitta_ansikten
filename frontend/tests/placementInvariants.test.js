import { describe, it, expect, vi } from 'vitest';
import { Model } from 'flexlayout-react';

// The catalog imports every module component; ThemeEditor pulls the theme
// manager, which reads localStorage at import time (unavailable under jsdom).
// Mock it away — the catalog still references the real component modules.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import {
  resolvePlacementTabset,
  applyPlacement,
} from '../src/renderer/workspace/flexlayout/tabsetUtils.js';
import {
  MODULE_CATALOG,
  getModuleRole,
  getModuleWeight,
} from '../src/renderer/workspace/flexlayout/moduleRegistry.js';

// Real registry role lookup — the same roleOf the workspace injects, so the
// matrix exercises the production reuse gate.
const roleOf = getModuleRole;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// A fake model over explicit tabset specs — lets us drive geometry-dependent
// branches (measured/unmeasured, left column, bottom bar) and the role-hosting
// reuse gate without a real render pass. `getRect()` returns a zero-sized Rect
// for the unmeasured cases, mirroring FlexLayout (which never returns null).
// `components` lists the tab component ids the tabset hosts.
function fakeModel(specs) {
  const nodes = specs.map((s) => ({
    getType: () => 'tabset',
    getWeight: () => s.weight ?? 0,
    getRect: () => s.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    getId: () => s.id,
    getChildren: () => (s.components ?? []).map((component) => ({
      getType: () => 'tab',
      getComponent: () => component,
    })),
  }));
  return { visitNodes: (cb) => nodes.forEach(cb) };
}

const ZERO = { x: 0, y: 0, width: 0, height: 0 };

// Real single-tabset (solo) model: no side column, no bottom bar.
function soloModel() {
  return Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      weight: 100,
      children: [
        { type: 'tabset', weight: 100, children: [{ type: 'tab', name: 'Culling', component: 'culling' }] },
      ],
    },
  });
}

function tabsetIdOfComponent(model, component) {
  let id = null;
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getComponent?.() === component) {
      id = n.getParent().getId();
    }
  });
  return id;
}

function weightOfTabset(model, tabsetId) {
  return model.getNodeById(tabsetId).getWeight();
}

// ---------------------------------------------------------------------------
// (a) Placement-descriptor matrix: role × layout-state → expected descriptor.
// ---------------------------------------------------------------------------

// A side column hosts a side module; the main area hosts a main module.
const MEASURED_TWO = () => fakeModel([
  { id: 'left', weight: 15, rect: { x: 0, y: 0, width: 150, height: 1000 }, components: ['file-queue'] },
  { id: 'main', weight: 85, rect: { x: 150, y: 0, width: 850, height: 1000 }, components: ['image-viewer'] },
]);
const UNMEASURED_TWO = () => fakeModel([
  { id: 'left', weight: 15, rect: ZERO, components: ['file-queue'] },
  { id: 'main', weight: 85, rect: ZERO, components: ['image-viewer'] },
]);
const MEASURED_BOTTOM = () => fakeModel([
  { id: 'main', weight: 80, rect: { x: 0, y: 0, width: 1000, height: 800 }, components: ['image-viewer'] },
  { id: 'bar', weight: 20, rect: { x: 0, y: 800, width: 1000, height: 200 }, components: ['log-viewer'] },
]);
// Database layout: a narrow main-role column (database-management, weight 30)
// beside the statistics panel (weight 70). The narrow column is NOT a side
// column — a size-only heuristic would wrongly reuse it.
const DATABASE = () => fakeModel([
  { id: 'db', weight: 30, rect: { x: 0, y: 0, width: 300, height: 1000 }, components: ['database-management'] },
  { id: 'stats', weight: 70, rect: { x: 300, y: 0, width: 700, height: 1000 }, components: ['statistics-dashboard'] },
]);
// A panel below main that hosts a non-bottom module — not a bottom bar.
const BOTTOM_NONBOTTOM = () => fakeModel([
  { id: 'main', weight: 80, rect: { x: 0, y: 0, width: 1000, height: 800 }, components: ['image-viewer'] },
  { id: 'below', weight: 20, rect: { x: 0, y: 800, width: 1000, height: 200 }, components: ['statistics-dashboard'] },
]);
const SOLO = () => fakeModel([{ id: 'only', weight: 100, rect: ZERO, components: ['culling'] }]);

const CASES = [
  // main → always the largest area (weight fallback), never a split.
  ['main / measured, two tabsets', MEASURED_TWO, 'main', { tabsetId: 'main' }],
  ['main / unmeasured (weight fallback)', UNMEASURED_TWO, 'main', { tabsetId: 'main' }],
  ['main / solo', SOLO, 'main', { tabsetId: 'only' }],

  // side → reuse a tabset hosting a side module, else LEFT split.
  ['side / measured side column present', MEASURED_TWO, 'side', { tabsetId: 'left' }],
  ['side / unmeasured side column present', UNMEASURED_TWO, 'side', { tabsetId: 'left' }],
  ['side / solo (no side column)', SOLO, 'side', { split: 'left', refTabsetId: 'only' }],
  ['side / Database narrow non-side column → split, not hijack', DATABASE, 'side', { split: 'left', refTabsetId: 'stats' }],

  // bottom → reuse a measured bottom bar hosting a bottom module, else split.
  ['bottom / measured bar present', MEASURED_BOTTOM, 'bottom', { tabsetId: 'bar' }],
  ['bottom / measured no bar', MEASURED_TWO, 'bottom', { split: 'bottom', refTabsetId: 'main' }],
  ['bottom / measured panel below hosts non-bottom → split', BOTTOM_NONBOTTOM, 'bottom', { split: 'bottom', refTabsetId: 'main' }],
  ['bottom / unmeasured (no measured bar)', UNMEASURED_TWO, 'bottom', { split: 'bottom', refTabsetId: 'main' }],
  ['bottom / solo', SOLO, 'bottom', { split: 'bottom', refTabsetId: 'only' }],
];

describe('placement-descriptor matrix (role × layout state)', () => {
  it.each(CASES)('%s', (_name, makeModel, role, expected) => {
    expect(resolvePlacementTabset(makeModel(), role, roleOf)).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// (b) Weight invariant: after a split, the new side/bottom pane is never
//     weighted >= the main area — so main stays unambiguous by weight.
// ---------------------------------------------------------------------------

describe('split weight invariant (new side/bottom pane < main)', () => {
  it('side split from a solo workspace: pane 15, main 85', () => {
    const model = soloModel();
    const mainId = tabsetIdOfComponent(model, 'culling');
    const placement = resolvePlacementTabset(model, 'side', roleOf);
    expect(placement).toEqual({ split: 'left', refTabsetId: mainId });

    applyPlacement(model, { type: 'tab', name: 'Queue', component: 'file-queue' }, placement, 15);

    const paneId = tabsetIdOfComponent(model, 'file-queue');
    expect(weightOfTabset(model, paneId)).toBe(15);
    expect(weightOfTabset(model, mainId)).toBe(85);
    expect(weightOfTabset(model, paneId)).toBeLessThan(weightOfTabset(model, mainId));
  });

  it('bottom split from a solo workspace: pane 20, main 80', () => {
    const model = soloModel();
    const mainId = tabsetIdOfComponent(model, 'culling');
    const placement = resolvePlacementTabset(model, 'bottom', roleOf);
    expect(placement).toEqual({ split: 'bottom', refTabsetId: mainId });

    applyPlacement(model, { type: 'tab', name: 'Logs', component: 'log-viewer' }, placement, 20);

    const paneId = tabsetIdOfComponent(model, 'log-viewer');
    expect(weightOfTabset(model, paneId)).toBe(20);
    expect(weightOfTabset(model, mainId)).toBe(80);
    expect(weightOfTabset(model, paneId)).toBeLessThan(weightOfTabset(model, mainId));
  });

  it('WITHOUT a pane weight the split would tie at 50/50 (the bug) — the catalog weight is what prevents it', () => {
    // Guard the failure mode: a null weight leaves FlexLayout's default sizing,
    // which halves the target (pane == main). This is why every split-producing
    // role must carry a weight (asserted below).
    const model = soloModel();
    const placement = resolvePlacementTabset(model, 'side', roleOf);
    applyPlacement(model, { type: 'tab', name: 'Queue', component: 'file-queue' }, placement, null);

    const mainId = tabsetIdOfComponent(model, 'culling');
    const paneId = tabsetIdOfComponent(model, 'file-queue');
    expect(weightOfTabset(model, paneId)).toBe(weightOfTabset(model, mainId));
  });

  it('every split-producing role (side/bottom) carries a weight in (0, 50) so the invariant holds', () => {
    for (const [id, entry] of Object.entries(MODULE_CATALOG)) {
      if (entry.role === 'main') continue; // main never splits
      const w = getModuleWeight(id);
      expect(w, `weight for ${id} (${entry.role})`).not.toBeNull();
      expect(w, `weight for ${id}`).toBeGreaterThan(0);
      expect(w, `weight for ${id}`).toBeLessThan(50);
    }
  });

  it('does not resize when docking into an existing tabset (no split)', () => {
    const model = soloModel();
    const onlyId = tabsetIdOfComponent(model, 'culling');
    const before = weightOfTabset(model, onlyId);
    // A main module docks CENTER into the existing tabset — weight untouched.
    const placement = resolvePlacementTabset(model, 'main', roleOf);
    expect(placement).toEqual({ tabsetId: onlyId });
    applyPlacement(model, { type: 'tab', name: 'Stats', component: 'statistics-dashboard' }, placement, getModuleWeight('statistics-dashboard'));
    expect(weightOfTabset(model, onlyId)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Cross-check: role resolution stays unambiguous after a side split (the
// second-in-class failure this matrix is meant to close), and the freshly
// created side pane is itself reusable next time (role-hosting gate).
// ---------------------------------------------------------------------------

describe('role resolution after a side split stays unambiguous', () => {
  it('a subsequent main placement lands in main, and a subsequent side placement reuses the new side pane', () => {
    const model = soloModel();
    const mainId = tabsetIdOfComponent(model, 'culling');
    // Open a side pane via split (sized to its catalog weight, 15).
    const sidePlacement = resolvePlacementTabset(model, 'side', roleOf);
    applyPlacement(model, { type: 'tab', name: 'Queue', component: 'file-queue' }, sidePlacement, getModuleWeight('file-queue'));
    const sidePaneId = tabsetIdOfComponent(model, 'file-queue');

    // main → still the original main area (85 > 15), not the new side column.
    expect(resolvePlacementTabset(model, 'main', roleOf)).toEqual({ tabsetId: mainId });
    // side → now reuses the freshly created side pane (it hosts a side module).
    expect(resolvePlacementTabset(model, 'side', roleOf)).toEqual({ tabsetId: sidePaneId });
  });
});

// Sanity: getModuleRole feeds the matrix roles for real modules.
describe('module roles feed placement', () => {
  it('file-queue/review are side, log-viewer is bottom, others main', () => {
    expect(getModuleRole('file-queue')).toBe('side');
    expect(getModuleRole('review-module')).toBe('side');
    expect(getModuleRole('log-viewer')).toBe('bottom');
    expect(getModuleRole('image-viewer')).toBe('main');
  });
});
