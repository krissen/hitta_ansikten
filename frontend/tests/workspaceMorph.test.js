import { describe, it, expect, vi } from 'vitest';
import { Model, Actions } from 'flexlayout-react';

// workspaceMorph imports moduleRegistry, which imports every module component;
// ThemeEditor pulls in the theme manager (localStorage at import). Mock it, same
// as moduleCatalog.test.js / workflowSteps.test.js.
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import { applyWorkspace, bottomBorderId } from '../src/renderer/workspace/flexlayout/workspaceMorph.js';
import { getWorkspaceSpec } from '../src/renderer/workspace/flexlayout/workflows.js';
import { ensureBottomBorder } from '../src/renderer/workspace/flexlayout/layouts.js';

// --- Model builders (headless; no React) ---------------------------------

const GLOBAL = { tabEnableRenderOnDemand: true, splitterSize: 4 };

function tab(id, component) {
  return { type: 'tab', id, name: component, component, config: { moduleId: component } };
}

function makeModel(layout) {
  return Model.fromJson(ensureBottomBorder({ global: GLOBAL, layout }));
}

// A single full-width tabset holding the given modules (stacked tabs).
function soloModel(...components) {
  return makeModel({
    type: 'row',
    weight: 100,
    children: [{
      type: 'tabset', id: 'ts-main', weight: 100,
      children: components.map((c, i) => tab(`t-${c}-${i}`, c)),
    }],
  });
}

// An arbitrary three-column starting layout (the pre-companion review shape),
// used as an INPUT the morph must reshape — not the target shape any more.
function trioModel() {
  return makeModel({
    type: 'row', weight: 100,
    children: [
      { type: 'tabset', id: 'ts-q', weight: 15, children: [tab('t-q', 'file-queue')] },
      { type: 'tabset', id: 'ts-r', weight: 15, children: [tab('t-r', 'review-module')] },
      { type: 'tabset', id: 'ts-v', weight: 70, children: [tab('t-v', 'image-viewer')] },
    ],
  });
}

// The new review target shape: review-module | [image-viewer (active), file-queue].
// The group tabset holds both viewer and queue as stacked tabs, viewer selected.
function reviewGroupModel() {
  return makeModel({
    type: 'row', weight: 100,
    children: [
      { type: 'tabset', id: 'ts-r', weight: 15, children: [tab('t-r', 'review-module')] },
      {
        type: 'tabset', id: 'ts-g', weight: 85, selected: 0,
        children: [
          tab('t-v', 'image-viewer'),
          { ...tab('t-q', 'file-queue'), enableRenderOnDemand: false },
        ],
      },
    ],
  });
}

// The tabset (by id) hosting a module, or null.
function tabsetIdOf(model, component) {
  const tabNode = realTabs(model).find((t) => t.getComponent() === component);
  return tabNode ? tabNode.getParent().getId() : null;
}

// The selected (visible) component within the tabset that hosts `component`.
function selectedInTabsetOf(model, component) {
  const tabNode = realTabs(model).find((t) => t.getComponent() === component);
  return tabNode?.getParent()?.getSelectedNode?.()?.getComponent?.() ?? null;
}

// --- Inspection helpers ---------------------------------------------------

function realTabs(model) {
  const out = [];
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getParent()?.getType() === 'tabset') {
      out.push(n);
    }
  });
  return out;
}

function realComponents(model) {
  return realTabs(model).map((t) => t.getComponent());
}

function parkedComponents(model) {
  const out = [];
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getParent()?.getType() === 'border') out.push(n.getComponent());
  });
  return out;
}

function nodeId(model, component) {
  let id = null;
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getComponent() === component) id = n.getId();
  });
  return id;
}

function tabsetWeightOf(model, component) {
  const tabNode = realTabs(model).find((t) => t.getComponent() === component);
  return tabNode ? tabNode.getParent().getWeight() : null;
}

const reviewSpec = getWorkspaceSpec('review');
const cullingSpec = getWorkspaceSpec('culling');
const countSpec = getWorkspaceSpec('count');

describe('applyWorkspace — solo specs', () => {
  it('morphs a two-pane layout into a solo culling workspace', () => {
    const model = soloModel('image-viewer', 'review-module');
    applyWorkspace(model, cullingSpec);
    expect(realComponents(model).sort()).toEqual(['culling']);
  });

  it('adds the solo module when it was absent', () => {
    const model = soloModel('statistics-dashboard');
    applyWorkspace(model, countSpec);
    expect(realComponents(model)).toEqual(['player-count']);
  });

  it('preserves an existing target node id (add-only when needed)', () => {
    const model = soloModel('culling', 'image-viewer');
    const before = nodeId(model, 'culling');
    applyWorkspace(model, cullingSpec);
    // culling was already present → same node id (state preserved).
    expect(nodeId(model, 'culling')).toBe(before);
    expect(realComponents(model)).toEqual(['culling']);
  });
});

describe('applyWorkspace — review companion-tab shape', () => {
  it('builds review-module | [image-viewer (active), file-queue] with spec weights', () => {
    const model = soloModel('culling');
    applyWorkspace(model, reviewSpec);
    // Two columns: review-module, then the viewer+queue group.
    expect(realComponents(model)).toEqual(['review-module', 'image-viewer', 'file-queue']);
    expect(tabsetWeightOf(model, 'review-module')).toBe(15);
    expect(tabsetWeightOf(model, 'image-viewer')).toBe(85);
    // Image Viewer and File Queue share ONE tabset (the group column).
    expect(tabsetIdOf(model, 'image-viewer')).toBe(tabsetIdOf(model, 'file-queue'));
    expect(tabsetIdOf(model, 'review-module')).not.toBe(tabsetIdOf(model, 'image-viewer'));
  });

  it('reveals the Image Viewer as the group\'s active tab (File Queue hidden behind it)', () => {
    const model = soloModel('culling');
    applyWorkspace(model, reviewSpec);
    expect(selectedInTabsetOf(model, 'image-viewer')).toBe('image-viewer');
  });

  it('pins the hidden File Queue to enableRenderOnDemand:false so it stays mounted', () => {
    const model = soloModel('culling');
    applyWorkspace(model, reviewSpec);
    const queue = realTabs(model).find((t) => t.getComponent() === 'file-queue');
    expect(queue.isEnableRenderOnDemand()).toBe(false);
  });

  it('is idempotent on the already-correct group shape (same node ids, no churn)', () => {
    const model = reviewGroupModel();
    const ids = {
      q: nodeId(model, 'file-queue'),
      r: nodeId(model, 'review-module'),
      v: nodeId(model, 'image-viewer'),
    };
    applyWorkspace(model, reviewSpec);
    expect(nodeId(model, 'file-queue')).toBe(ids.q);
    expect(nodeId(model, 'review-module')).toBe(ids.r);
    expect(nodeId(model, 'image-viewer')).toBe(ids.v);
    expect(realComponents(model)).toEqual(['review-module', 'image-viewer', 'file-queue']);
    expect(tabsetIdOf(model, 'image-viewer')).toBe(tabsetIdOf(model, 'file-queue'));
  });

  it('sets the group (image-viewer, weight 85) as the active tabset when arriving from another step', () => {
    const model = soloModel('culling');
    applyWorkspace(model, reviewSpec);
    const active = model.getActiveTabset();
    expect(active).toBeTruthy();
    const activeComponents = active.getChildren().map((c) => c.getComponent?.());
    expect(activeComponents).toContain('image-viewer');
  });

  it('preserves the user\'s active pane on idempotent re-entry (does not steal focus to the primary)', () => {
    const model = reviewGroupModel();
    // Simulate the user working in Review: make its tabset active.
    const reviewTab = realTabs(model).find((t) => t.getComponent() === 'review-module');
    model.doAction(Actions.setActiveTabset(reviewTab.getParent().getId()));
    const activeBefore = model.getActiveTabset().getId();

    // The File Queue re-enters the review step on every file load — this must not
    // yank focus to the Image Viewer.
    applyWorkspace(model, reviewSpec);
    expect(model.getActiveTabset().getId()).toBe(activeBefore);
  });

  it('does not re-select the group active tab on the idempotent fast path (keeps the queue visible if the user opened it)', () => {
    const model = reviewGroupModel();
    // User opened the File Queue companion tab (Cmd+Shift+U).
    const queueTab = realTabs(model).find((t) => t.getComponent() === 'file-queue');
    model.doAction(Actions.selectTab(queueTab.getId()));
    expect(selectedInTabsetOf(model, 'file-queue')).toBe('file-queue');
    // A file-load re-entry must not yank the visible tab back to the viewer.
    applyWorkspace(model, reviewSpec);
    expect(selectedInTabsetOf(model, 'file-queue')).toBe('file-queue');
  });
});

describe('applyWorkspace — keepMounted parking', () => {
  it('parks the File Queue (keepMounted) instead of deleting it on a solo morph', () => {
    const model = trioModel();
    const queueIdBefore = nodeId(model, 'file-queue');
    applyWorkspace(model, cullingSpec);

    // Culling is the only real tab; the queue is parked (still mounted), not gone.
    expect(realComponents(model)).toEqual(['culling']);
    expect(parkedComponents(model)).toContain('file-queue');
    // Same node id → state preserved.
    expect(nodeId(model, 'file-queue')).toBe(queueIdBefore);
  });

  it('un-parks the File Queue when morphing back to the review step (node id preserved)', () => {
    const model = trioModel();
    const queueIdBefore = nodeId(model, 'file-queue');
    applyWorkspace(model, cullingSpec);   // park the queue
    expect(parkedComponents(model)).toContain('file-queue');

    applyWorkspace(model, reviewSpec);    // bring it back
    expect(parkedComponents(model)).not.toContain('file-queue');
    expect(realComponents(model)).toEqual(['review-module', 'image-viewer', 'file-queue']);
    // Un-parked into the group column, hidden behind the viewer, still mounted.
    expect(tabsetIdOf(model, 'file-queue')).toBe(tabsetIdOf(model, 'image-viewer'));
    const queue = realTabs(model).find((t) => t.getComponent() === 'file-queue');
    expect(queue.isEnableRenderOnDemand()).toBe(false);
    expect(nodeId(model, 'file-queue')).toBe(queueIdBefore);
  });

  it('deletes a clean, non-kept module (image-viewer) rather than parking it', () => {
    const model = trioModel();
    applyWorkspace(model, cullingSpec);
    expect(parkedComponents(model)).not.toContain('image-viewer');
    expect(realComponents(model)).toEqual(['culling']);
  });
});

describe('applyWorkspace — keepDirty parking', () => {
  it('parks a dirty review-module across a solo morph and preserves its node id', () => {
    const model = trioModel();
    const reviewIdBefore = nodeId(model, 'review-module');
    applyWorkspace(model, cullingSpec, { keepDirty: new Set(['review-module']) });

    expect(realComponents(model)).toEqual(['culling']);
    expect(parkedComponents(model)).toEqual(expect.arrayContaining(['review-module', 'file-queue']));
    expect(nodeId(model, 'review-module')).toBe(reviewIdBefore);
  });

  it('deletes a clean review-module when it is NOT flagged dirty', () => {
    const model = trioModel();
    applyWorkspace(model, cullingSpec, { keepDirty: new Set() });
    // review-module is clean and not keepMounted → deleted, not parked.
    expect(parkedComponents(model)).not.toContain('review-module');
  });
});

describe('applyWorkspace — from an empty / non-target starting layout', () => {
  it('builds the review trio from a database layout (all non-target, clean)', () => {
    const model = makeModel({
      type: 'row', weight: 100,
      children: [
        { type: 'tabset', id: 'ts-db', weight: 30, children: [tab('t-db', 'database-management')] },
        { type: 'tabset', id: 'ts-st', weight: 70, children: [tab('t-st', 'statistics-dashboard')] },
      ],
    });
    applyWorkspace(model, reviewSpec);
    expect(realComponents(model)).toEqual(['review-module', 'image-viewer', 'file-queue']);
    expect(parkedComponents(model)).toEqual([]);
    expect(tabsetIdOf(model, 'file-queue')).toBe(tabsetIdOf(model, 'image-viewer'));
  });
});

describe('bottomBorderId', () => {
  it('finds the injected bottom border', () => {
    const model = soloModel('culling');
    expect(bottomBorderId(model)).toBeTruthy();
  });
});
