import { describe, it, expect } from 'vitest';
import { Model, Actions } from 'flexlayout-react';

import { resolvePlacementTabset } from '../src/renderer/workspace/flexlayout/tabsetUtils.js';

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
        { type: 'tabset', weight: 15, children: [{ type: 'tab', name: 'Review', component: 'review-module' }] },
        { type: 'tabset', weight: 85, children: [{ type: 'tab', name: 'Image Viewer', component: 'image-viewer' }] },
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
        { type: 'tabset', weight: 100, children: [{ type: 'tab', name: 'Culling', component: 'culling' }] },
      ],
    },
  });
}

// Fake model over explicit tabset specs so geometry-dependent branches (left
// column, bottom bar) are testable without a real render/measure pass.
function fakeModel(specs) {
  const nodes = specs.map((s) => ({
    getType: () => 'tabset',
    getWeight: () => s.weight ?? 0,
    getRect: () => s.rect ?? null,
    getId: () => s.id,
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
    const placement = resolvePlacementTabset(model, 'main');
    expect(placement).toEqual({ tabsetId: idOfWeight(model, 85) });
  });

  it('ignores the active tabset: a main module lands in the main area even when a narrow side column is active (the bug)', () => {
    const model = freshReviewModel();
    const narrowId = idOfWeight(model, 15);
    model.doAction(Actions.setActiveTabset(narrowId));
    expect(model.getActiveTabset().getId()).toBe(narrowId);

    // Placement is role-driven, not active-driven → still the wide main area.
    const placement = resolvePlacementTabset(model, 'main');
    expect(placement.tabsetId).toBe(idOfWeight(model, 85));
    expect(placement.tabsetId).not.toBe(narrowId);
  });

  it('picks the largest tabset by area once geometry is measured', () => {
    const model = fakeModel([
      { id: 'left', weight: 15, rect: { x: 0, y: 0, width: 150, height: 1000 } },
      { id: 'main', weight: 85, rect: { x: 150, y: 0, width: 850, height: 1000 } },
    ]);
    expect(resolvePlacementTabset(model, 'main')).toEqual({ tabsetId: 'main' });
  });
});

describe('resolvePlacementTabset — side', () => {
  it('reuses an existing narrow column (by weight before measure)', () => {
    const model = freshReviewModel();
    const placement = resolvePlacementTabset(model, 'side');
    expect(placement).toEqual({ tabsetId: idOfWeight(model, 15) });
  });

  it('prefers the LEFT-most narrow column once geometry is measured', () => {
    const model = fakeModel([
      { id: 'left', weight: 15, rect: { x: 0, y: 0, width: 150, height: 1000 } },
      { id: 'right-narrow', weight: 15, rect: { x: 850, y: 0, width: 150, height: 1000 } },
      { id: 'main', weight: 70, rect: { x: 150, y: 0, width: 700, height: 1000 } },
    ]);
    expect(resolvePlacementTabset(model, 'side')).toEqual({ tabsetId: 'left' });
  });

  it('signals a LEFT split off the main area when no narrow column exists', () => {
    const model = soloModel();
    const mainId = idOfWeight(model, 100);
    expect(resolvePlacementTabset(model, 'side')).toEqual({ split: 'left', refTabsetId: mainId });
  });
});

describe('resolvePlacementTabset — bottom', () => {
  it('reuses an existing bottom bar in the lower half of the main area', () => {
    const model = fakeModel([
      { id: 'main', weight: 80, rect: { x: 0, y: 0, width: 1000, height: 800 } },
      { id: 'bar', weight: 20, rect: { x: 0, y: 800, width: 1000, height: 200 } },
    ]);
    expect(resolvePlacementTabset(model, 'bottom')).toEqual({ tabsetId: 'bar' });
  });

  it('signals a BOTTOM split off the main area when no bottom bar exists', () => {
    const model = soloModel();
    const mainId = idOfWeight(model, 100);
    expect(resolvePlacementTabset(model, 'bottom')).toEqual({ split: 'bottom', refTabsetId: mainId });
  });

  it('splits, not stacks, before the first measure pass (all rects zero-sized)', () => {
    // FlexLayout's getRect() returns a zero-sized Rect (not null) until measured.
    // A left side column and the main area both report y === 0 here — the bottom
    // module must NOT treat the side column as a bottom bar, but split instead.
    const model = fakeModel([
      { id: 'left', weight: 15, rect: { x: 0, y: 0, width: 0, height: 0 } },
      { id: 'main', weight: 85, rect: { x: 0, y: 0, width: 0, height: 0 } },
    ]);
    expect(resolvePlacementTabset(model, 'bottom')).toEqual({ split: 'bottom', refTabsetId: 'main' });
  });
});

describe('resolvePlacementTabset — degenerate', () => {
  it('returns null when the model has no tabsets', () => {
    expect(resolvePlacementTabset(fakeModel([]), 'main')).toBeNull();
  });
});
