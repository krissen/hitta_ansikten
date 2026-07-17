import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { Layout, Model, Actions } from 'flexlayout-react';

// MOUNT-LEVEL guard for the parking invariant (Nagelfar PR #237 round 1).
//
// workspaceMorph.test.js proves parking preserves state via the node-id proxy
// (same id ⇒ React keeps the instance). This test pins the property DIRECTLY at
// the React level: a stateful probe mounted in the review trio must survive a
// morph to a solo step (parked in the background border) and back — one mount,
// state intact — not just keep its node id. If FlexLayout ever stopped honoring
// per-tab enableRenderOnDemand:false in a collapsed border (unmounting the
// parked content), this fails even though the node-id proxy would still pass.

// applyWorkspace imports moduleRegistry, which imports every module component;
// ThemeEditor pulls in the theme manager (localStorage at import).
vi.mock('../src/renderer/theme-manager.js', () => ({
  themeManager: { setPreference: vi.fn() },
}));

import { applyWorkspace, revealHiddenModuleTab } from '../src/renderer/workspace/flexlayout/workspaceMorph.js';
import { getWorkspaceSpec } from '../src/renderer/workspace/flexlayout/workflows.js';
import { ensureBottomBorder } from '../src/renderer/workspace/flexlayout/layouts.js';

// jsdom reports every element as 0x0; give a fixed non-zero box so FlexLayout's
// render-on-demand actually mounts tab content (matches the other host tests).
beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
  HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} };
  };
});

// The probe stands in for the keepMounted File Queue. It tracks mounts (a
// remount runs the mount-only effect again) and holds an internal counter a
// remount would reset.
const spy = { mounts: 0, counter: null, setCounter: null };
function Probe() {
  const [counter, setCounter] = useState(0);
  useEffect(() => { spy.mounts += 1; }, []);
  spy.setCounter = setCounter;
  spy.counter = counter;
  return <div className="file-queue-probe">{counter}</div>;
}

const factory = (node) => {
  // Render the stateful probe for the File Queue; trivial markers for the rest.
  if (node.getComponent() === 'file-queue') return <Probe />;
  return <div className={node.getComponent()} />;
};

function reviewTrioModel() {
  return Model.fromJson(ensureBottomBorder({
    global: { tabEnableRenderOnDemand: true, splitterSize: 4, tabSetMinWidth: 50, tabSetMinHeight: 50 },
    layout: {
      type: 'row', weight: 100,
      children: [
        { type: 'tabset', id: 'ts-q', weight: 15, children: [
          { type: 'tab', id: 'q', name: 'Filkö', component: 'file-queue', enableRenderOnDemand: false, config: { moduleId: 'file-queue' } },
        ]},
        { type: 'tabset', id: 'ts-r', weight: 15, children: [
          { type: 'tab', id: 'r', name: 'Granska', component: 'review-module', config: { moduleId: 'review-module' } },
        ]},
        { type: 'tabset', id: 'ts-v', weight: 70, children: [
          { type: 'tab', id: 'v', name: 'Bildvisare', component: 'image-viewer', config: { moduleId: 'image-viewer' } },
        ]},
      ],
    },
  }));
}

// A solo starting layout (arriving from another step) the morph reshapes into
// the review companion-tab group.
function soloModel(component) {
  return Model.fromJson(ensureBottomBorder({
    global: { tabEnableRenderOnDemand: true, splitterSize: 4, tabSetMinWidth: 50, tabSetMinHeight: 50 },
    layout: {
      type: 'row', weight: 100,
      children: [{ type: 'tabset', id: 'ts-solo', weight: 100, children: [
        { type: 'tab', id: 's', name: component, component, config: { moduleId: component } },
      ]}],
    },
  }));
}

function queueNode(model) {
  let found = null;
  model.visitNodes((n) => {
    if (n.getType() === 'tab' && n.getComponent() === 'file-queue') found = n;
  });
  return found;
}

describe('File Queue as a hidden companion tab stays mounted (review group)', () => {
  it('builds review from a solo step: queue mounts once, hidden behind the viewer, state survives re-entry', async () => {
    spy.mounts = 0;
    spy.counter = null;
    spy.setCounter = null;

    const model = soloModel('culling');
    // Morph into the review group BEFORE first render so the queue starts as the
    // hidden companion tab, exactly as arriving at the review step would.
    applyWorkspace(model, getWorkspaceSpec('review'));

    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });

    const q = queueNode(model);
    // Hidden behind the Image Viewer (viewer is the group's active tab)…
    expect(q.isVisible()).toBe(false);
    // …but pinned to stay mounted, and actually mounted once.
    expect(q.isEnableRenderOnDemand()).toBe(false);
    expect(spy.mounts).toBe(1);

    // The queue holds in-flight state (e.g. current index) while hidden.
    await act(async () => { spy.setCounter(42); });
    expect(spy.counter).toBe(42);

    // A file-load re-entry (enterStep('review') on every load) is idempotent: no
    // remount, state intact.
    await act(async () => {
      applyWorkspace(model, getWorkspaceSpec('review'));
      await Promise.resolve();
    });
    expect(spy.mounts).toBe(1);
    expect(spy.counter).toBe(42);

    // The user opens the queue tab (Cmd+Shift+U): it becomes visible, still one
    // mount, still holding its state.
    await act(async () => {
      model.doAction(Actions.selectTab(q.getId()));
      await Promise.resolve();
    });
    expect(queueNode(model).isVisible()).toBe(true);
    expect(spy.mounts).toBe(1);
    expect(spy.counter).toBe(42);
  });
});

describe('parking preserves the component instance at the React mount level', () => {
  it('review → count → review keeps the File Queue mounted (one mount, state intact)', async () => {
    spy.mounts = 0;
    spy.counter = null;
    spy.setCounter = null;

    const model = reviewTrioModel();
    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });
    // File Queue probe mounted once.
    expect(spy.mounts).toBe(1);

    // User's in-flight state (e.g. current queue index).
    await act(async () => { spy.setCounter(17); });
    expect(spy.counter).toBe(17);

    // Morph to the solo count step: File Queue is keepMounted → parked in the
    // background border, not deleted.
    await act(async () => {
      applyWorkspace(model, getWorkspaceSpec('count'));
      await Promise.resolve();
    });
    const parked = model.getNodeById('q');
    expect(parked.getParent().getType()).toBe('border');
    // Still one mount, state intact — the parked probe was not remounted.
    expect(spy.mounts).toBe(1);
    expect(spy.counter).toBe(17);

    // Morph back to review: the File Queue is un-parked into the trio.
    await act(async () => {
      applyWorkspace(model, getWorkspaceSpec('review'));
      await Promise.resolve();
    });
    expect(model.getNodeById('q').getParent().getType()).toBe('tabset');
    // The whole round-trip cost zero remounts and lost no state.
    expect(spy.mounts).toBe(1);
    expect(spy.counter).toBe(17);
  });
});

// The review companion group: review-module | [image-viewer (active), file-queue].
function reviewGroupModel() {
  return Model.fromJson(ensureBottomBorder({
    global: { tabEnableRenderOnDemand: true, splitterSize: 4, tabSetMinWidth: 50, tabSetMinHeight: 50 },
    layout: {
      type: 'row', weight: 100,
      children: [
        { type: 'tabset', id: 'ts-r', weight: 15, children: [
          { type: 'tab', id: 'r', name: 'Granska', component: 'review-module', config: { moduleId: 'review-module' } },
        ]},
        { type: 'tabset', id: 'ts-g', weight: 85, selected: 0, children: [
          { type: 'tab', id: 'v', name: 'Bildvisare', component: 'image-viewer', config: { moduleId: 'image-viewer' } },
          { type: 'tab', id: 'q', name: 'Filkö', component: 'file-queue', enableRenderOnDemand: false, config: { moduleId: 'file-queue' } },
        ]},
      ],
    },
  }));
}

describe('revealHiddenModuleTab — surface the Image Viewer when it is hidden behind the queue', () => {
  it('(a) selects the Image Viewer when it sits hidden behind the File Queue tab', async () => {
    const model = reviewGroupModel();
    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });
    // The user opened the File Queue companion tab → the viewer is now hidden.
    await act(async () => {
      model.doAction(Actions.selectTab('q'));
      await Promise.resolve();
    });
    expect(model.getNodeById('v').isVisible()).toBe(false);

    // An image loads → surface the viewer.
    let acted;
    await act(async () => {
      acted = revealHiddenModuleTab(model, 'image-viewer');
      await Promise.resolve();
    });
    expect(acted).toBe(true);
    expect(model.getNodeById('v').isVisible()).toBe(true);
    expect(model.getNodeById('q').isVisible()).toBe(false);
  });

  it('(b) is a no-op when the Image Viewer is already the visible tab', async () => {
    const model = reviewGroupModel(); // viewer is the selected (active) tab
    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });
    expect(model.getNodeById('v').isVisible()).toBe(true);
    const selectedBefore = model.getNodeById('ts-g').getSelectedNode().getId();

    let acted;
    await act(async () => {
      acted = revealHiddenModuleTab(model, 'image-viewer');
      await Promise.resolve();
    });
    // No selection change, no action taken.
    expect(acted).toBe(false);
    expect(model.getNodeById('ts-g').getSelectedNode().getId()).toBe(selectedBefore);
    expect(model.getNodeById('v').isVisible()).toBe(true);
  });
});
