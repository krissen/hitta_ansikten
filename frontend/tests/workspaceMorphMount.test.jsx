import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { Layout, Model } from 'flexlayout-react';

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

import { applyWorkspace } from '../src/renderer/workspace/flexlayout/workspaceMorph.js';
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
