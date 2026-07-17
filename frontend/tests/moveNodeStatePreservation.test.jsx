import { describe, it, expect, beforeAll, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import React, { useEffect, useRef, useState } from 'react';
import { Layout, Model, Actions, DockLocation } from 'flexlayout-react';

// STEP 0 SPIKE (PR 3): empirically verify that Actions.moveNode in
// flexlayout-react 0.8.17 PRESERVES a moved tab's React component instance
// (and therefore its state) — the load-bearing assumption of the morphing
// engine. FlexLayout keys each rendered tab by its node id; moveNode keeps the
// same TabNode id, so React should keep the same instance across the move
// rather than unmount+remount it.
//
// If this test fails, the morphing design must fall back to the park-in-border
// strategy (see the PR 3 brief). The result of this spike is reported in the
// final PR summary.
//
// The probe component tracks two things across a move:
//   - mountCount: incremented in a mount-only effect (runs once per real mount;
//     a remount would run it again).
//   - an internal counter set imperatively before the move; a remount would
//     reset it to its initial value.

// jsdom reports every element as 0x0. FlexLayout defers rendering a tab's
// content (tabEnableRenderOnDemand) until its panel has a non-zero size, so give
// elements a fixed non-zero box, matching flexLayoutWorkspace.test.jsx.
beforeAll(() => {
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { x: 0, y: 0, top: 0, left: 0, right: 1200, bottom: 800, width: 1200, height: 800, toJSON() {} };
  };
});

// Module-scoped observers so the probe can report across renders/moves.
const spy = { mounts: 0, latestCounter: null, setCounter: null };

function Probe() {
  const [counter, setCounter] = useState(0);
  const mountedRef = useRef(false);
  useEffect(() => {
    // Mount-only effect: a genuine unmount+remount runs this again.
    spy.mounts += 1;
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  // Publish the live setter + value so the test can mutate and read state.
  spy.setCounter = setCounter;
  spy.latestCounter = counter;
  return <div className="probe" data-testid="probe">{counter}</div>;
}

function twoTabsetModel() {
  return Model.fromJson({
    global: {
      tabEnableRenderOnDemand: false, // keep both tabs mounted regardless of visibility
      splitterSize: 4,
      tabSetMinWidth: 50,
      tabSetMinHeight: 50,
    },
    layout: {
      type: 'row',
      weight: 100,
      children: [
        {
          type: 'tabset',
          id: 'ts-left',
          weight: 50,
          children: [
            { type: 'tab', id: 'probe-tab', name: 'Probe', component: 'probe', config: {} },
          ],
        },
        {
          type: 'tabset',
          id: 'ts-right',
          weight: 50,
          children: [
            { type: 'tab', id: 'other-tab', name: 'Other', component: 'other', config: {} },
          ],
        },
      ],
    },
  });
}

const factory = (node) => {
  const component = node.getComponent();
  if (component === 'probe') return <Probe />;
  return <div className="other" data-testid="other" />;
};

describe('SPIKE: Actions.moveNode preserves component state (flexlayout-react 0.8.17)', () => {
  it('moving a tab to another tabset keeps the same React instance (no remount, state survives)', async () => {
    spy.mounts = 0;
    spy.latestCounter = null;
    spy.setCounter = null;

    const model = twoTabsetModel();
    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });

    // Probe mounted exactly once.
    expect(spy.mounts).toBe(1);
    expect(spy.latestCounter).toBe(0);

    // Mutate internal state — a remount would reset this back to 0.
    await act(async () => { spy.setCounter(42); });
    expect(spy.latestCounter).toBe(42);

    // Morph: move the probe tab into the right tabset (same node id retained).
    await act(async () => {
      model.doAction(Actions.moveNode('probe-tab', 'ts-right', DockLocation.CENTER, -1));
      await Promise.resolve();
    });

    // The tab node id must have survived the move.
    expect(model.getNodeById('probe-tab')).toBeTruthy();
    expect(model.getNodeById('probe-tab').getParent().getId()).toBe('ts-right');

    // The decisive assertions: no second mount, and the state is intact.
    expect(spy.mounts).toBe(1);
    expect(spy.latestCounter).toBe(42);
  });

  it('moving a tab into a NEW split tabset also preserves the instance', async () => {
    spy.mounts = 0;
    spy.latestCounter = null;
    spy.setCounter = null;

    const model = twoTabsetModel();
    await act(async () => {
      render(<Layout model={model} factory={factory} />);
      await Promise.resolve();
    });
    expect(spy.mounts).toBe(1);
    await act(async () => { spy.setCounter(7); });

    // Move the probe tab to a fresh split off the right tabset (RIGHT creates a
    // new tabset). This is the "addNode/moveNode into a new pane" morph shape.
    await act(async () => {
      model.doAction(Actions.moveNode('probe-tab', 'ts-right', DockLocation.RIGHT, -1));
      await Promise.resolve();
    });

    expect(model.getNodeById('probe-tab')).toBeTruthy();
    expect(spy.mounts).toBe(1);
    expect(spy.latestCounter).toBe(7);
  });
});
