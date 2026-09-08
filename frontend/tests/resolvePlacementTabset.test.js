import { describe, it, expect } from 'vitest';
import { Model, Actions } from 'flexlayout-react';

import { resolvePlacementTabset } from '../src/renderer/workspace/flexlayout/tabsetUtils.js';

// Role lookup mirroring the registry for the component ids used in these
// fixtures — passed as roleOf so reuse is gated on a tabset actually hosting a
// module of the wanted role (React-free; keeps this test light).
const ROLE = {
  'review-module': 'side',
  'file-queue': 'side',
  'log-viewer': 'bottom',
  'image-viewer': 'main',
  culling: 'main',
  'statistics-dashboard': 'main',
  'database-management': 'main',
};
const roleOf = (component) => ROLE[component] || 'main';

// Two-tabset layout mirroring the default review layout: a narrow 15% side
// column first, then the wide 85% main area. On a freshly-loaded model the
// render/measure pass hasn't run, so every tabset rect is 0 — placement must
// still resolve deterministically from weight.
function freshReviewModel() {
  return Model.fromJson({
    global: { tabSetMinWidth: 100, tabSetMinHeight: 100, splitterSize: 4 },
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          weight: 15,
          children: [
            { type: 'tab', name: 'Review', component: 'review-module' },
          ],
        },
        {
          type: 'tabset',
          weight: 85,
          children: [
            { type: 'tab', name: 'Image Viewer', component: 'image-viewer' },
          ],
        },
      ],
    },
  });
}

// A single-tabset (solo) layout: no side column, no bottom bar.
function soloModel() {
  return Model.fromJson({
    global: {},
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          weight: 100,
          children: [{ type: 'tab', name: 'Culling', component: 'culling' }],
        },
      ],
    },
  });
}

// Fake model over explicit tabset specs so geometry-dependent branches (left
// column, bottom bar) are testable without a real render/measure pass. Each
// spec may carry `components` — the tab component ids the tabset hosts, which
// drives the role-hosting reuse gate.
function fakeModel(specs) {
  const nodes = specs.map((s) => ({
    getType: () => 'tabset',
    getWeight: () => s.weight ?? 0,
    getRect: () => s.rect ?? { x: 0, y: 0, width: 0, height: 0 },
    getId: () => s.id,
    getChildren: () =>
      (s.components ?? []).map((component) => ({
        getType: () => 'tab',
        getComponent: () => component,
      })),
  }));
  return { visitNodes: (cb) => nodes.forEach(cb) };
}

function idOfWeight(model, weight) {
  let id = null;
  model.visitNodes((n) => {
    if (n.getType() === 'tabset' && n.getWeight() === weight) id = n.getId();
  });
  return id;
}

describe('resolvePlacementTabset — main', () => {
  it('picks the main area by weight before any rect is measured', () => {
    const model = freshReviewModel();
    const placement = resolvePlacementTabset(model, 'main', roleOf);
    expect(placement).toEqual({ tabsetId: idOfWeight(model, 85) });
  });

  it('ignores the active tabset: a main module lands in the main area even when a narrow side column is active (the bug)', () => {
    const model = freshReviewModel();
    const narrowId = idOfWeight(model, 15);
    model.doAction(Actions.setActiveTabset(narrowId));
    expect(model.getActiveTabset().getId()).toBe(narrowId);

    // Placement is role-driven, not active-driven → still the wide main area.
    const placement = resolvePlacementTabset(model, 'main', roleOf);
    expect(placement.tabsetId).toBe(idOfWeight(model, 85));
    expect(placement.tabsetId).not.toBe(narrowId);
  });

  it('picks the largest tabset by area once geometry is measured', () => {
    const model = fakeModel([
      {
        id: 'left',
        weight: 15,
        rect: { x: 0, y: 0, width: 150, height: 1000 },
        components: ['review-module'],
      },
      {
        id: 'main',
        weight: 85,
        rect: { x: 150, y: 0, width: 850, height: 1000 },
        components: ['image-viewer'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'main', roleOf)).toEqual({
      tabsetId: 'main',
    });
  });
});

describe('resolvePlacementTabset — side', () => {
  it('reuses an existing side column (by weight before measure)', () => {
    const model = freshReviewModel();
    const placement = resolvePlacementTabset(model, 'side', roleOf);
    expect(placement).toEqual({ tabsetId: idOfWeight(model, 15) });
  });

  it('prefers the LEFT-most side column once geometry is measured', () => {
    const model = fakeModel([
      {
        id: 'left',
        weight: 15,
        rect: { x: 0, y: 0, width: 150, height: 1000 },
        components: ['file-queue'],
      },
      {
        id: 'right-narrow',
        weight: 15,
        rect: { x: 850, y: 0, width: 150, height: 1000 },
        components: ['review-module'],
      },
      {
        id: 'main',
        weight: 70,
        rect: { x: 150, y: 0, width: 700, height: 1000 },
        components: ['image-viewer'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'side', roleOf)).toEqual({
      tabsetId: 'left',
    });
  });

  it('signals a LEFT split off the main area when no side column exists', () => {
    const model = soloModel();
    const mainId = idOfWeight(model, 100);
    expect(resolvePlacementTabset(model, 'side', roleOf)).toEqual({
      split: 'left',
      refTabsetId: mainId,
    });
  });

  it('does NOT hijack a narrow non-side column (Database 30/70): splits instead', () => {
    // The Database layout: a 30-weight database-management column beside a
    // 70-weight statistics panel. The narrow column is NOT a side column (it
    // hosts a main module), so a side module must split, not dock onto Database.
    const model = fakeModel([
      {
        id: 'db',
        weight: 30,
        rect: { x: 0, y: 0, width: 300, height: 1000 },
        components: ['database-management'],
      },
      {
        id: 'stats',
        weight: 70,
        rect: { x: 300, y: 0, width: 700, height: 1000 },
        components: ['statistics-dashboard'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'side', roleOf)).toEqual({
      split: 'left',
      refTabsetId: 'stats',
    });
  });
});

describe('resolvePlacementTabset — bottom', () => {
  it('reuses an existing bottom bar that hosts a bottom module', () => {
    const model = fakeModel([
      {
        id: 'main',
        weight: 80,
        rect: { x: 0, y: 0, width: 1000, height: 800 },
        components: ['image-viewer'],
      },
      {
        id: 'bar',
        weight: 20,
        rect: { x: 0, y: 800, width: 1000, height: 200 },
        components: ['log-viewer'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'bottom', roleOf)).toEqual({
      tabsetId: 'bar',
    });
  });

  it('does NOT reuse a panel below main that hosts a non-bottom module: splits instead', () => {
    const model = fakeModel([
      {
        id: 'main',
        weight: 80,
        rect: { x: 0, y: 0, width: 1000, height: 800 },
        components: ['image-viewer'],
      },
      {
        id: 'below',
        weight: 20,
        rect: { x: 0, y: 800, width: 1000, height: 200 },
        components: ['statistics-dashboard'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'bottom', roleOf)).toEqual({
      split: 'bottom',
      refTabsetId: 'main',
    });
  });

  it('signals a BOTTOM split off the main area when no bottom bar exists', () => {
    const model = soloModel();
    const mainId = idOfWeight(model, 100);
    expect(resolvePlacementTabset(model, 'bottom', roleOf)).toEqual({
      split: 'bottom',
      refTabsetId: mainId,
    });
  });

  it('splits, not stacks, before the first measure pass (all rects zero-sized)', () => {
    // FlexLayout's getRect() returns a zero-sized Rect (not null) until measured.
    // A left side column and the main area both report y === 0 here — the bottom
    // module must NOT treat the side column as a bottom bar, but split instead.
    const model = fakeModel([
      {
        id: 'left',
        weight: 15,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        components: ['review-module'],
      },
      {
        id: 'main',
        weight: 85,
        rect: { x: 0, y: 0, width: 0, height: 0 },
        components: ['image-viewer'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'bottom', roleOf)).toEqual({
      split: 'bottom',
      refTabsetId: 'main',
    });
  });
});

describe('resolvePlacementTabset — reuse gate without roleOf', () => {
  it('disables side/bottom reuse when no roleOf is given (always splits)', () => {
    const model = fakeModel([
      {
        id: 'left',
        weight: 15,
        rect: { x: 0, y: 0, width: 150, height: 1000 },
        components: ['file-queue'],
      },
      {
        id: 'main',
        weight: 85,
        rect: { x: 150, y: 0, width: 850, height: 1000 },
        components: ['image-viewer'],
      },
    ]);
    expect(resolvePlacementTabset(model, 'side')).toEqual({
      split: 'left',
      refTabsetId: 'main',
    });
  });
});

describe('resolvePlacementTabset — degenerate', () => {
  it('returns null when the model has no tabsets', () => {
    expect(resolvePlacementTabset(fakeModel([]), 'main', roleOf)).toBeNull();
  });
});
